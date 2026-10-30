import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { getRequestLanguage } from "@/server/i18n";
import { loadProblemChapter } from "@/server/patterns";

type Context = { params: Promise<{ slug: string }> };

/** GET /api/problems/by-slug/:slug/chapter?language=en|zh — the problem's
 *  chapter in the current plan and its techniques, for the extension's
 *  problem view. The problem needn't be in the deck. `language` is the
 *  panel's (it names 灵茶山艾府's plans and picks the default plan); without
 *  it, the web's language cookie. */
export async function GET(req: Request, ctx: Context) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }
  const requested = new URL(req.url).searchParams.get("language");
  const language = requested === "en" || requested === "zh" ? requested : await getRequestLanguage();
  return NextResponse.json(await loadProblemChapter(user.id, slug, language));
}
