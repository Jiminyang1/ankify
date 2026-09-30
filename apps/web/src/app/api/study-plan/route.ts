import { NextResponse } from "next/server";
import { studyPlanSelectSchema } from "@ankify/contracts";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { readJsonBody } from "@/server/request-body";
import { removeCustomPlan, setCurrentStudyPlan } from "@/server/study-plans";

async function readPlan(req: Request) {
  const body = await readJsonBody(req);
  if (!body.ok) {
    return {
      response: NextResponse.json(
        { error: body.error },
        { status: body.error === "payload_too_large" ? 413 : 400 },
      ),
    };
  }
  const parsed = studyPlanSelectSchema.safeParse(body.value);
  if (!parsed.success) {
    return { response: NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 }) };
  }
  return { plan: parsed.data.plan };
}

/** Switch the plan the profile shows. */
export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  const input = await readPlan(req);
  if ("response" in input) return input.response;
  if (!(await setCurrentStudyPlan(user.id, input.plan))) {
    return NextResponse.json({ error: "unknown_plan" }, { status: 404 });
  }
  return NextResponse.json({ plan: input.plan });
}

/** Remove an imported list; the profile falls back to the default plan. */
export async function DELETE(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  const input = await readPlan(req);
  if ("response" in input) return input.response;
  await removeCustomPlan(user.id, input.plan);
  return NextResponse.json({ ok: true });
}
