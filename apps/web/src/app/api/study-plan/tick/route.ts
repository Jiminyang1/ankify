import { NextResponse } from "next/server";
import { planTickSchema } from "@ankify/contracts";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { setPlanTick } from "@/server/plan-map";
import { readJsonBody } from "@/server/request-body";

/** POST /api/study-plan/tick `{ slug, done }` — mark a problem on the map done,
 *  or clear that mark. 404 when the problem isn't on the map. */
export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === "payload_too_large" ? 413 : 400 });
  }
  const parsed = planTickSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { slug, done } = parsed.data;
  if (!(await setPlanTick(user.id, slug, done))) {
    return NextResponse.json({ error: "unknown_problem" }, { status: 404 });
  }
  return NextResponse.json({ slug, done });
}
