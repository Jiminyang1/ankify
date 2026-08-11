import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadReviewResource } from "@/server/review-resource";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { id: problemId } = await ctx.params;
  const resource = new URL(req.url).searchParams.get("resource");
  const result = await loadReviewResource(user.id, problemId, resource);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "invalid_resource" ? 400 : 404 },
    );
  }
  return NextResponse.json(
    result.payload,
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
