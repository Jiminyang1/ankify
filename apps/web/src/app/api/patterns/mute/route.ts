import { patternMuteSchema } from "@ankify/contracts";
import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { setPatternMuted } from "@/server/patterns";

/** Turn the after-review suggestions from one pattern off, or back on. */
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const parsed = patternMuteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const ok = await setPatternMuted(user.id, parsed.data.key, parsed.data.muted);
  if (!ok) return NextResponse.json({ error: "pattern_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, key: parsed.data.key, muted: parsed.data.muted });
}
