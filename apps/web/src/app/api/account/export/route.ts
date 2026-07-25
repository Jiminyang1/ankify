import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@ankify/db";
import { getRequestSessionUser, unauthorizedResponse } from "@/lib/auth";

const PAGE_SIZE = 100;

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const db = getDb();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (type: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type, data })}\n`),
        );
      };

      async function writePages<T extends { id: string }>(
        type: string,
        load: (afterId: string | null) => Promise<T[]>,
      ) {
        let afterId: string | null = null;
        while (true) {
          const rows = await load(afterId);
          for (const row of rows) write(type, row);
          if (rows.length < PAGE_SIZE) return;
          afterId = rows.at(-1)!.id;
        }
      }

      try {
        write("export", {
          format: "ankify-ndjson",
          version: 1,
          exportedAt: new Date().toISOString(),
        });
        write("user", {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image ?? null,
        });

        await writePages("problem", (afterId) =>
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
        await writePages("submission", (afterId) =>
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
        await writePages("card", (afterId) =>
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
        await writePages("quiz_session", (afterId) =>
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
        await writePages("review_event", (afterId) =>
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

        const settings = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.userId, user.id));
        for (const setting of settings) {
          if (setting.key.startsWith("rate-limit:")) continue;
          if (setting.key === "ai") {
            const value = setting.value as Record<string, unknown>;
            const { encryptedApiKey: _secret, ...safeValue } = value;
            write("setting", {
              ...setting,
              value: { ...safeValue, hasApiKey: Boolean(_secret) },
            });
          } else {
            write("setting", setting);
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="ankify-export-${date}.ndjson"`,
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
