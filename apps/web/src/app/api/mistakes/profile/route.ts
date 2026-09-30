import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadMistakeProfile } from "@/server/mistake-profile";

/** GET /api/mistakes/profile — confirmed patterns, unconfirmed candidates,
 *  objective session signals, and trends over the last 90 days. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json(await loadMistakeProfile(user.id), { headers: { "Cache-Control": "private, no-store" } });
}
