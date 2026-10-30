import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { getRequestLanguage } from "@/server/i18n";
import { loadPlanNext } from "@/server/profile";

/** GET /api/study-plan/next?language=en|zh — Today's Next part for the
 *  extension: the current plan's next unsolved problem and its chapter.
 *  `language` is the panel's (it names 灵茶山艾府's plans and picks the default
 *  plan when none is saved); without it, the web's language cookie. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();

  const requested = new URL(req.url).searchParams.get("language");
  const language = requested === "en" || requested === "zh" ? requested : await getRequestLanguage();
  return NextResponse.json(await loadPlanNext(user.id, language));
}
