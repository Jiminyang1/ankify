import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { loadProblemPatterns } from "@/server/patterns";

type Context = { params: Promise<{ slug: string }> };

/** The patterns this LeetCode problem belongs to, with each one's ladder.
 *  Empty when the problem isn't in any list; it needn't be in the deck. */
export async function GET(req: Request, ctx: Context) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }
  return NextResponse.json(await loadProblemPatterns(user.id, slug));
}
