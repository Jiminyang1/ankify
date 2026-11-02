import { NextResponse } from "next/server";
import { planCatalog } from "@ankify/core/plan-catalog";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";

/** GET /api/study-plan/catalog — the map's tree and its problems. The same for
 *  everyone and only changes with a deploy. */
export async function GET(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json(planCatalog(), { headers: { "Cache-Control": "private, max-age=3600" } });
}
