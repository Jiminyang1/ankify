import { after, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schemas, type CardDraft } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { getActiveModel } from "@/lib/ai";
import { buildAiCardBatchPrompt, buildAiCardDraftPrompt } from "@/lib/card-prompt";

const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: problemId } = await ctx.params;
  const db = getDb();

  // Recover: mark active generations that timed out as failed.
  const stuckBefore = new Date(Date.now() - GENERATION_TIMEOUT_MS);
  await db
    .update(schema.cards)
    .set({ aiStatus: "failed", errorMessage: "timeout: generation did not complete" })
    .where(and(
      eq(schema.cards.problemId, problemId),
      eq(schema.cards.aiStatus, "generating"),
      lt(schema.cards.createdAt, stuckBefore),
    ));

  const candidates = await db
    .select()
    .from(schema.cards)
    .where(and(eq(schema.cards.problemId, problemId), ne(schema.cards.aiStatus, "ready")))
    .orderBy(desc(schema.cards.createdAt));

  return NextResponse.json({ ok: true, candidates });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: problemId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schemas.aiCardsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const db = getDb();
  const [problem] = await db.select().from(schema.problems).where(eq(schema.problems.id, problemId));
  if (!problem) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });

  if (parsed.data.mode === "batch") {
    const count = parsed.data.count ?? 3;
    const ids = Array.from({ length: count }, () => nanoid(12));
    await db.insert(schema.cards).values(
      ids.map((id, index) => ({
        id,
        problemId,
        aiStatus: "generating" as const,
        question: `Generating candidate ${index + 1}...`,
        answer: "",
      })),
    );
    after(() => runBatchGeneration({ problemId, candidateIds: ids, count }));
    return NextResponse.json({ ok: true, cardIds: ids }, { status: 202 });
  }

  if (parsed.data.action === "generate") {
    const rawText = parsed.data.rawText;
    const cardId = nanoid(12);
    await db.insert(schema.cards).values({
      id: cardId,
      problemId,
      aiStatus: "generating",
      question: rawText.trim().slice(0, 200) || "Generating...",
      answer: "",
    });
    after(() => runSingleGeneration({
      problemId,
      cardId,
      action: "generate",
      rawText,
    }));
    return NextResponse.json({ ok: true, cardIds: [cardId] }, { status: 202 });
  }

  const action = parsed.data.action;
  const draft = parsed.data.draft;
  const instruction = parsed.data.instruction;
  const [card] = await db.select().from(schema.cards).where(eq(schema.cards.id, parsed.data.cardId));
  if (!card || card.problemId !== problemId) {
    return NextResponse.json({ error: "card_not_found" }, { status: 404 });
  }

  await db
    .update(schema.cards)
    .set({ aiStatus: "generating", errorMessage: null, createdAt: new Date() })
    .where(eq(schema.cards.id, card.id));

  after(() => runSingleGeneration({
    problemId,
    cardId: card.id,
    action,
    draft,
    instruction,
  }));

  return NextResponse.json({ ok: true, cardIds: [card.id] }, { status: 202 });
}

async function loadPromptContext(problemId: string) {
  const db = getDb();
  const [problem] = await db.select().from(schema.problems).where(eq(schema.problems.id, problemId));
  if (!problem) throw new Error("problem_not_found");
  const submissions = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.problemId, problemId))
    .orderBy(desc(schema.submissions.submittedAt))
    .limit(25);
  return { problem, submissions };
}

async function runSingleGeneration(args: {
  problemId: string;
  cardId: string;
  action: "generate" | "polish" | "followup";
  rawText?: string;
  draft?: CardDraft;
  instruction?: string;
}) {
  const db = getDb();
  const tag = `[ai-card ${args.problemId} card=${args.cardId}]`;
  const t0 = Date.now();

  try {
    const { problem, submissions } = await loadPromptContext(args.problemId);
    const [card] = await db.select().from(schema.cards).where(eq(schema.cards.id, args.cardId));
    if (!card) throw new Error("card_not_found");

    const { model, settings } = await getActiveModel();
    const mode = settings.provider === "deepseek" ? "json" : "auto";

    const prompt = buildAiCardDraftPrompt({
      problem,
      submissions,
      action: args.action,
      rawText: args.rawText,
      draft: args.draft ?? { question: card.question, answer: card.answer },
      instruction: args.instruction,
    });

    const { object } = await generateObject({
      model,
      schema: schemas.cardDraftSchema,
      system: prompt.system,
      prompt: prompt.user,
      temperature: 0.35,
      mode,
    });

    await db
      .update(schema.cards)
      .set({
        aiStatus: "candidate",
        errorMessage: null,
        question: object.question,
        answer: object.answer,
      })
      .where(eq(schema.cards.id, args.cardId));

    console.log(`${tag} ${args.action} generated in ${Date.now() - t0}ms`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`${tag} failed after ${Date.now() - t0}ms`, err);
    await db
      .update(schema.cards)
      .set({ aiStatus: "failed", errorMessage: message.slice(0, 1000) })
      .where(eq(schema.cards.id, args.cardId));
  }
}

async function runBatchGeneration(args: { problemId: string; candidateIds: string[]; count: number }) {
  const { problemId, candidateIds, count } = args;
  const db = getDb();
  const tag = `[ai-card-batch ${problemId}]`;
  const t0 = Date.now();

  try {
    const { problem, submissions } = await loadPromptContext(problemId);
    const existingCards = await db
      .select({ question: schema.cards.question, answer: schema.cards.answer })
      .from(schema.cards)
      .where(and(eq(schema.cards.problemId, problemId), eq(schema.cards.aiStatus, "ready")))
      .orderBy(desc(schema.cards.createdAt))
      .limit(40);

    const { model, settings } = await getActiveModel();
    const mode = settings.provider === "deepseek" ? "json" : "auto";

    const prompt = buildAiCardBatchPrompt({ problem, submissions, existingCards, count });

    const { object } = await generateObject({
      model,
      schema: z.object({ candidates: z.array(schemas.cardDraftSchema).min(1).max(8) }),
      system: prompt.system,
      prompt: prompt.user,
      temperature: 0.45,
      mode,
    });

    const candidates = object.candidates.slice(0, count);
    await Promise.all(
      candidateIds.map((id, index) => {
        const candidate = candidates[index];
        if (!candidate) {
          return db
            .update(schema.cards)
            .set({ aiStatus: "failed", errorMessage: "AI returned fewer candidates than requested." })
            .where(eq(schema.cards.id, id));
        }
        return db
          .update(schema.cards)
          .set({
            aiStatus: "candidate",
            errorMessage: null,
            question: candidate.question,
            answer: candidate.answer,
          })
          .where(eq(schema.cards.id, id));
      }),
    );
    console.log(`${tag} generated ${candidates.length}/${count} candidates in ${Date.now() - t0}ms`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`${tag} failed after ${Date.now() - t0}ms`, err);
    await db
      .update(schema.cards)
      .set({ aiStatus: "failed", errorMessage: message.slice(0, 1000) })
      .where(inArray(schema.cards.id, candidateIds));
  }
}
