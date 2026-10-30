import { NextResponse } from "next/server";
import { problemDocPutSchema } from "@ankify/contracts";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { DOC_WRITE_STATUS, loadProblemDocs, saveProblemDoc } from "@/server/problem-docs";
import { readJsonBody } from "@/server/request-body";

/** GET /api/problems/:id/docs — the problem's Notes and Solutions docs, plus
 *  the legacy Cards doc that older extension builds (0.3.x) still show. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;
  const docs = await loadProblemDocs(user.id, id);
  if (!docs) return NextResponse.json({ error: "problem_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, docs }, { headers: { "Cache-Control": "private, no-store" } });
}

/** PUT /api/problems/:id/docs — the user's own edit of Notes or Solutions
 *  (or of the legacy Cards doc, from older extension builds). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  const body = await readJsonBody(req, 120_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = problemDocPutSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  const { id } = await ctx.params;
  const result = await saveProblemDoc(user.id, id, parsed.data.target, parsed.data.markdown, parsed.data.expectedVersion);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: DOC_WRITE_STATUS[result.error] });
  return NextResponse.json({ ok: true, docs: result.docs });
}
