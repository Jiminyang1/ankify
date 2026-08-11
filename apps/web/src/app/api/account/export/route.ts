import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { iterateAccountExport } from "@/server/account-export";

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const records = iterateAccountExport({
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image ?? null,
        });
        for await (const record of records) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(record)}\n`),
          );
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
