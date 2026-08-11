import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";

const PAGE_SIZE = 100;

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
    | "agent_session"
    | "agent_run"
    | "agent_message"
    | "agent_step"
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
