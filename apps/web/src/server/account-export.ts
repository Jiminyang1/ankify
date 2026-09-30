import { and, asc, eq, getTableColumns, gt } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";

const PAGE_SIZE = 100;

/** Every practice-session column except the owner token, which identifies a
 *  browser tab only while a session is live. */
const practiceSessionExportColumns = (() => {
  const columns: Partial<ReturnType<typeof getTableColumns<typeof schema.practiceSessions>>> = {
    ...getTableColumns(schema.practiceSessions),
  };
  delete columns.ownerToken;
  return columns as Omit<ReturnType<typeof getTableColumns<typeof schema.practiceSessions>>, "ownerToken">;
})();

type AccountExportUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
};

type AccountExportRecord = {
  type:
    | "export"
    | "user"
    | "problem"
    | "submission"
    | "card"
    | "quiz_session"
    | "review_event"
    | "mistake_record"
    | "practice_session"
    | "practice_session_submission"
    | "practice_improvement"
    | "session_analysis"
    | "attempt_history"
    | "attempt_history_coverage"
    | "suggestion"
    | "agent_session"
    | "agent_run"
    | "agent_message"
    | "agent_step"
    | "credit_purchase"
    | "ai_credit_ledger"
    | "setting";
  data: unknown;
};

export async function* iterateAccountExport(
  user: AccountExportUser,
): AsyncGenerator<AccountExportRecord> {
  const db = getDb();

  yield {
    type: "export",
    data: {
      format: "ankify-ndjson",
      version: 1,
      exportedAt: new Date().toISOString(),
    },
  };
  yield { type: "user", data: user };

  yield* iteratePages("problem", (afterId) =>
    db
      .select()
      .from(schema.problems)
      .where(
        and(
          eq(schema.problems.userId, user.id),
          afterId ? gt(schema.problems.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.problems.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("submission", (afterId) =>
    db
      .select()
      .from(schema.submissions)
      .where(
        and(
          eq(schema.submissions.userId, user.id),
          afterId ? gt(schema.submissions.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.submissions.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("card", (afterId) =>
    db
      .select()
      .from(schema.cards)
      .where(
        and(
          eq(schema.cards.userId, user.id),
          afterId ? gt(schema.cards.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.cards.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("quiz_session", (afterId) =>
    db
      .select()
      .from(schema.quizSessions)
      .where(
        and(
          eq(schema.quizSessions.userId, user.id),
          afterId ? gt(schema.quizSessions.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.quizSessions.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("review_event", (afterId) =>
    db
      .select()
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, user.id),
          afterId ? gt(schema.reviewEvents.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.reviewEvents.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("mistake_record", (afterId) =>
    db
      .select()
      .from(schema.mistakeRecords)
      .where(
        and(
          eq(schema.mistakeRecords.userId, user.id),
          afterId ? gt(schema.mistakeRecords.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.mistakeRecords.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("practice_session", (afterId) =>
    db
      .select(practiceSessionExportColumns)
      .from(schema.practiceSessions)
      .where(
        and(
          eq(schema.practiceSessions.userId, user.id),
          afterId ? gt(schema.practiceSessions.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.practiceSessions.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("practice_session_submission", (afterId) =>
    db
      .select()
      .from(schema.practiceSessionSubmissions)
      .where(
        and(
          eq(schema.practiceSessionSubmissions.userId, user.id),
          afterId ? gt(schema.practiceSessionSubmissions.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.practiceSessionSubmissions.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("practice_improvement", (afterId) =>
    db
      .select()
      .from(schema.practiceImprovements)
      .where(
        and(
          eq(schema.practiceImprovements.userId, user.id),
          afterId ? gt(schema.practiceImprovements.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.practiceImprovements.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("session_analysis", (afterId) =>
    db
      .select()
      .from(schema.sessionAnalyses)
      .where(
        and(
          eq(schema.sessionAnalyses.userId, user.id),
          afterId ? gt(schema.sessionAnalyses.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.sessionAnalyses.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("attempt_history", (afterId) =>
    db
      .select()
      .from(schema.attemptHistory)
      .where(
        and(
          eq(schema.attemptHistory.userId, user.id),
          afterId ? gt(schema.attemptHistory.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.attemptHistory.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("attempt_history_coverage", (afterId) =>
    db
      .select()
      .from(schema.attemptHistoryCoverage)
      .where(
        and(
          eq(schema.attemptHistoryCoverage.userId, user.id),
          afterId ? gt(schema.attemptHistoryCoverage.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.attemptHistoryCoverage.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("suggestion", (afterId) =>
    db
      .select()
      .from(schema.suggestions)
      .where(
        and(
          eq(schema.suggestions.userId, user.id),
          afterId ? gt(schema.suggestions.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.suggestions.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("agent_session", (afterId) =>
    db
      .select()
      .from(schema.agentSessions)
      .where(
        and(
          eq(schema.agentSessions.userId, user.id),
          afterId ? gt(schema.agentSessions.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.agentSessions.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("agent_run", (afterId) =>
    db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.userId, user.id),
          afterId ? gt(schema.agentRuns.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.agentRuns.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("agent_message", (afterId) =>
    db
      .select()
      .from(schema.agentMessages)
      .where(
        and(
          eq(schema.agentMessages.userId, user.id),
          afterId ? gt(schema.agentMessages.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.agentMessages.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("agent_step", (afterId) =>
    db
      .select()
      .from(schema.agentSteps)
      .where(
        and(
          eq(schema.agentSteps.userId, user.id),
          afterId ? gt(schema.agentSteps.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.agentSteps.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("credit_purchase", (afterId) =>
    db
      .select()
      .from(schema.creditPurchases)
      .where(
        and(
          eq(schema.creditPurchases.userId, user.id),
          afterId ? gt(schema.creditPurchases.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.creditPurchases.id))
      .limit(PAGE_SIZE),
  );
  yield* iteratePages("ai_credit_ledger", (afterId) =>
    db
      .select()
      .from(schema.aiCreditLedger)
      .where(
        and(
          eq(schema.aiCreditLedger.userId, user.id),
          afterId ? gt(schema.aiCreditLedger.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(schema.aiCreditLedger.id))
      .limit(PAGE_SIZE),
  );

  const settings = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.userId, user.id));

  for (const setting of settings) {
    if (setting.key.startsWith("rate-limit:")) continue;

    if (setting.key === "ai") {
      const value = setting.value as Record<string, unknown>;
      const { encryptedApiKey, ...safeValue } = value;
      yield {
        type: "setting",
        data: {
          ...setting,
          value: { ...safeValue, hasApiKey: Boolean(encryptedApiKey) },
        },
      };
      continue;
    }

    yield { type: "setting", data: setting };
  }
}

async function* iteratePages<T extends { id: string }>(
  type: AccountExportRecord["type"],
  load: (afterId: string | null) => Promise<T[]>,
): AsyncGenerator<AccountExportRecord> {
  let afterId: string | null = null;
  while (true) {
    const rows = await load(afterId);
    for (const row of rows) {
      yield { type, data: row };
    }
    if (rows.length < PAGE_SIZE) return;
    afterId = rows.at(-1)!.id;
  }
}
