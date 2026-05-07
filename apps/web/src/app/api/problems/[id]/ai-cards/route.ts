import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { and, desc, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schemas, type CardDraft } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { getActiveModel } from "@/lib/ai";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";
import { buildAiCardDraftPrompt } from "@/lib/card-prompt";

export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const db = getDb();

  const candidates = await db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.userId, user.id), eq(schema.cards.problemId, problemId), ne(schema.cards.aiStatus, "ready")))
    .orderBy(desc(schema.cards.createdAt));

  return NextResponse.json({ ok: true, candidates });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.aiCardsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, user.id)));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  if (parsed.data.action === "generate") {
    try {
      const draft = await generateAiDraft({
        userId: user.id,
        problemId,
        action: "generate",
        rawText: parsed.data.rawText?.trim() || undefined,
      });

      const cardId = nanoid(12);
      await db.insert(schema.cards).values({
        id: cardId,
        userId: user.id,
        problemId,
        aiStatus: "candidate",
        errorMessage: null,
        question: draft.question,
        answer: draft.answer,
      });

      const [card] = await db
        .select()
        .from(schema.cards)
        .where(and(eq(schema.cards.id, cardId), eq(schema.cards.userId, user.id)));
      return NextResponse.json({ ok: true, card });
    } catch (err) {
      return aiErrorResponse(err);
    }
  }

  const [card] = await db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.id, parsed.data.cardId), eq(schema.cards.userId, user.id)));
  if (!card || card.problemId !== problemId) {
    return NextResponse.json({ error: "card_not_found" }, { status: 404 });
  }
  if (card.aiStatus === "ready") {
    return NextResponse.json({ error: "card_is_already_ready" }, { status: 400 });
  }

  try {
    const draft = await generateAiDraft({
      userId: user.id,
      problemId,
      action: "followup",
      draft: parsed.data.draft,
      instruction: parsed.data.instruction.trim(),
    });

    await db
      .update(schema.cards)
      .set({
        aiStatus: "candidate",
        errorMessage: null,
        question: draft.question,
        answer: draft.answer,
      })
      .where(and(eq(schema.cards.id, card.id), eq(schema.cards.userId, user.id)));

    const [updated] = await db
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.id, card.id), eq(schema.cards.userId, user.id)));
    return NextResponse.json({ ok: true, card: updated });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

async function loadPromptContext(userId: string, problemId: string) {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)));
  if (!problem) throw new Error("problem_not_found");
  const submissions = await db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.problemId, problemId)))
    .orderBy(desc(schema.submissions.submittedAt))
    .limit(25);
  return { problem, submissions };
}

async function generateAiDraft(args: {
  problemId: string;
  userId: string;
  action: "generate" | "followup";
  rawText?: string;
  draft?: CardDraft;
  instruction?: string;
}): Promise<CardDraft> {
  const tag = `[ai-card ${args.problemId}]`;
  const t0 = Date.now();
  const { problem, submissions } = await loadPromptContext(args.userId, args.problemId);
  const { model, settings } = await getActiveModel(args.userId);
  const mode = settings.provider === "deepseek" ? "json" : "auto";

  const prompt = buildAiCardDraftPrompt({
    problem,
    submissions,
    action: args.action,
    rawText: args.rawText,
    draft: args.draft,
    instruction: args.instruction,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const { object } = await generateObject({
      model,
      schema: schemas.cardDraftSchema,
      system: prompt.system,
      prompt: prompt.user,
      temperature: 0.35,
      mode,
      abortSignal: controller.signal,
    });

    console.log(`${tag} ${args.action} generated in ${Date.now() - t0}ms`);
    return object;
  } finally {
    clearTimeout(timer);
  }
}

function aiErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "AI request failed";
  console.error("[ai-card] failed", err);
  return NextResponse.json({ error: message.slice(0, 1000) }, { status: 500 });
}
