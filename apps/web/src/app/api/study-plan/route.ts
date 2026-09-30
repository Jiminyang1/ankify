import { NextResponse } from "next/server";
import { z } from "zod";
import { STUDY_PLANS } from "@ankify/core";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { readJsonBody } from "@/server/request-body";
import { setStudyPlanSlug } from "@/server/settings";

const bodySchema = z.object({
  plan: z.string().refine((plan) => STUDY_PLANS.some((known) => known.slug === plan), "Unknown study plan."),
});

export async function POST(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === "payload_too_large" ? 413 : 400 },
    );
  }
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  await setStudyPlanSlug(user.id, parsed.data.plan);
  return NextResponse.json({ plan: parsed.data.plan });
}
