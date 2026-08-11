import { generateText, Output } from "ai";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { quizDraftSchema, type QuizItem } from "@ankify/contracts";
import { getDb, schema, type QuizSession } from "@ankify/db";
import { getActiveModel } from "@/server/ai";
import { buildQuizPrompt } from "@/server/quiz-prompt";
import { getGenerationSettings } from "@/server/settings";

const QUIZ_GENERATION_TIMEOUT_MS = 175_000;

export async function getCurrentQuizSession(userId: string, problemId: string): Promise<QuizSession | null> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.quizSessions)
    .where(
      and(
        eq(schema.quizSessions.userId, userId),
        eq(schema.quizSessions.problemId, problemId),
        ne(schema.quizSessions.status, "archived"),
      ),
    )
    .orderBy(desc(schema.quizSessions.createdAt))
    .limit(1);
  return session ?? null;
}

export async function getRecentCompletedQuizSessions(userId: string, problemId: string): Promise<QuizSession[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.quizSessions)
    .where(
      and(
        eq(schema.quizSessions.userId, userId),
        eq(schema.quizSessions.problemId, problemId),
        isNotNull(schema.quizSessions.completedAt),
      ),
    )
    .orderBy(desc(schema.quizSessions.completedAt))
    .limit(3);
}

async function loadQuizPromptContext(userId: string, problemId: string) {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)));
  if (!problem) throw new Error("problem_not_found");

  const [cards, submissions] = await Promise.all([
    db
      .select()
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.userId, userId),
          eq(schema.cards.problemId, problemId),
          eq(schema.cards.aiStatus, "ready"),
        ),
      )
      .orderBy(desc(schema.cards.createdAt))
      .limit(12),
    db
      .select()
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.problemId, problemId)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
  ]);
  return { problem, cards, submissions };
}

export async function generateQuizItems(
  userId: string,
  problemId: string,
  history: QuizSession[] = [],
): Promise<QuizItem[]> {
  const tag = `[quiz ${problemId}]`;
  const t0 = Date.now();
  const [{ problem, cards, submissions }, { model, settings }, generation] = await Promise.all([
    loadQuizPromptContext(userId, problemId),
    getActiveModel(userId),
    getGenerationSettings(userId),
  ]);
  const usesDeepSeekThinking = settings.provider === "deepseek" && settings.reasoningMode === "thinking";
  const prompt = buildQuizPrompt({
    problem,
    cards,
    submissions,
    history,
    generationLanguage: generation.language,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUIZ_GENERATION_TIMEOUT_MS);

  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: quizDraftSchema }),
      system: prompt.system,
      prompt: prompt.user,
      ...(!usesDeepSeekThinking ? { temperature: 0.3 } : {}),
      abortSignal: controller.signal,
    });

    const items: QuizItem[] = output.items.map((item, index) => {
      const choices = item.choices.map((choice) => choice.trim());
      const target = item.correctAnswer.trim();
      const answerIndex = choices.indexOf(target);
      if (answerIndex < 0) {
        throw new Error(`quiz_correct_answer_not_in_choices (item ${index + 1})`);
      }
      return {
        id: `q${index + 1}`,
        question: item.question.trim(),
        choices,
        answerIndex,
        explanation: item.explanation.trim(),
        source: item.source,
        scope: item.scope,
      };
    });
    validateScopeCoverage(items);
    console.log(`${tag} generated in ${Date.now() - t0}ms`);
    return items;
  } finally {
    clearTimeout(timer);
  }
}

function validateScopeCoverage(items: QuizItem[]) {
  const scopes = new Set(items.map((item) => item.scope));
  if (scopes.size < 4 || !scopes.has("complexity")) {
    throw new Error("quiz_scope_coverage_failed");
  }
}
