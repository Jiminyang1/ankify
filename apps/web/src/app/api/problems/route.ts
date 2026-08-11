import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import {
  DEFAULT_PROBLEMS_PAGE_SIZE,
  InvalidProblemsCursorError,
  loadProblemsList,
} from "@/server/problems-list";

/** GET /api/problems?search=&archived=1&cursor=&limit= — paginated
 *  metadata-only problem list with card counts.
 *  Default lists non-archived; `archived=1` lists archived problems instead. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const archivedOnly = searchParams.get("archived") === "1";
  const limit = Number(
    searchParams.get("limit") ?? DEFAULT_PROBLEMS_PAGE_SIZE,
  );

  try {
    const payload = await loadProblemsList(user.id, {
      search,
      archivedOnly,
      cursor: searchParams.get("cursor"),
      limit,
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (!(error instanceof InvalidProblemsCursorError)) throw error;
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }
}
