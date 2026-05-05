import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { and, desc, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schemas, type QuizItem } from "@ankify/core";
import { getDb, schema, type QuizSession } from "@ankify/db";
import { getActiveModel } from "@/lib/ai";
import { buildQuizPrompt } from "@/lib/quiz-prompt";

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: problemId } = await ctx.params;
  const db = getDb();
  const [problem] = await db.select().from(schema.problems).where(eq(schema.problems.id, problemId));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  const session = await getCurrentQuizSession(problemId);
  return NextResponse.json({ ok: true, session });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.quizGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const [problem] = await db.select().from(schema.problems).where(eq(schema.problems.id, problemId));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  const current = await getCurrentQuizSession(problemId);
  if (parsed.data.action === "generate" && current) {
    return NextResponse.json({ ok: true, session: current });
  }

  try {
    const items = await generateQuizItems(problemId);
    const now = new Date();
    const sessionId = nanoid(12);

    await db.transaction(async (tx) => {
      if (parsed.data.action === "regenerate") {
        await tx
          .update(schema.quizSessions)
          .set({ status: "archived", updatedAt: now })
          .where(and(eq(schema.quizSessions.problemId, problemId), ne(schema.quizSessions.status, "archived")));
      }

      await tx.insert(schema.quizSessions).values({
        id: sessionId,
        problemId,
        status: "active",
        itemsJson: items,
        answersJson: [],
        score: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
    });

    const [session] = await db.select().from(schema.quizSessions).where(eq(schema.quizSessions.id, sessionId));
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    return quizErrorResponse(err);
  }
}

async function getCurrentQuizSession(problemId: string): Promise<QuizSession | null> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.quizSessions)
    .where(and(eq(schema.quizSessions.problemId, problemId), ne(schema.quizSessions.status, "archived")))
    .orderBy(desc(schema.quizSessions.createdAt))
    .limit(1);
  return session ?? null;
}

async function loadPromptContext(problemId: string) {
  const db = getDb();
  const [problem] = await db.select().from(schema.problems).where(eq(schema.problems.id, problemId));
  if (!problem) throw new Error("problem_not_found");

  const [cards, submissions] = await Promise.all([
    db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.problemId, problemId), eq(schema.cards.aiStatus, "ready")))
      .orderBy(desc(schema.cards.createdAt))
      .limit(12),
    db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.problemId, problemId))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
  ]);

  return { problem, cards, submissions };
}

async function generateQuizItems(problemId: string): Promise<QuizItem[]> {
  const tag = `[quiz ${problemId}]`;
  const t0 = Date.now();
  const { problem, cards, submissions } = await loadPromptContext(problemId);
  const { model, settings } = await getActiveModel();
  const mode = settings.provider === "deepseek" ? "json" : "auto";
  const prompt = buildQuizPrompt({ problem, cards, submissions });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const { object } = await generateObject({
      model,
      schema: schemas.quizDraftSchema,
      system: prompt.system,
      prompt: prompt.user,
      temperature: 0.3,
      mode,
      abortSignal: controller.signal,
    });

    console.log(`${tag} generated in ${Date.now() - t0}ms`);
    return object.items.map((item, index) => ({
      ...item,
      id: `q${index + 1}`,
      choices: item.choices.map((choice) => choice.trim()),
      question: item.question.trim(),
      explanation: item.explanation.trim(),
    }));
  } finally {
    clearTimeout(timer);
  }
}

function quizErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Quiz generation failed";
  console.error("[quiz] failed", err);
  return NextResponse.json({ error: message.slice(0, 1000) }, { status: 500 });
}
