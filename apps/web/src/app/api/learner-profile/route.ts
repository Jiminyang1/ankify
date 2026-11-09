import { NextResponse } from "next/server";
import { learnerProfilePutSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { getLearnerProfile, saveLearnerProfile } from "@/server/learner-profile";

/** GET /api/learner-profile — the markdown doc of what the Coach remembers. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json({ profile: await getLearnerProfile(user.id) });
}

/** PUT — `{ markdown, expectedVersion }`: the user's own edit (409 on a stale version). */
export async function PUT(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const parsed = learnerProfilePutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  const markdown = parsed.data.markdown.trim() ? `${parsed.data.markdown.trim()}\n` : "";
  const result = await saveLearnerProfile(user.id, markdown, parsed.data.expectedVersion);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, profile: await getLearnerProfile(user.id) }, { status: 409 });
  }
  return NextResponse.json({ profile: result.profile });
}
