import { NextResponse } from "next/server";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";
import { loadPlanStatuses } from "@/server/plan-map";

/** GET /api/study-plan/statuses — every problem the user has done, by slug. */
export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json(await loadPlanStatuses(user.id));
}
