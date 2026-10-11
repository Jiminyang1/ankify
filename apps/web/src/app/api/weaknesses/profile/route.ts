import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadWeaknessProfile } from "@/server/weaknesses";

/** GET /api/weaknesses/profile — weaknesses across problems, by category. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const profile = await loadWeaknessProfile(user.id);
  return NextResponse.json({ ok: true, profile }, { headers: { "Cache-Control": "private, no-store" } });
}
