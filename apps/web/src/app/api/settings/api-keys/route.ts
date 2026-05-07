import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, getRequestSessionUser, unauthorizedResponse } from "@/lib/auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(32).default("Chrome extension"),
});

export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const result = await auth.api.listApiKeys({
    headers: req.headers,
    query: { limit: 50, sortBy: "createdAt", sortDirection: "desc" },
  });

  return NextResponse.json({ ok: true, apiKeys: result.apiKeys });
}

export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const apiKey = await auth.api.createApiKey({
    headers: req.headers,
    body: {
      name: parsed.data.name,
      prefix: "ank_",
    },
  });

  return NextResponse.json({ ok: true, apiKey });
}
