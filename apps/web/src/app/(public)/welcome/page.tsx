import Link from "next/link";
import { ArrowRight, BookOpenCheck, Chrome, Sparkles } from "lucide-react";
import { BrandLockup } from "@/components/brand";
import { Surface } from "@/components/ui/surface";
import { buttonClasses } from "@/components/ui/button";
import { getOptionalPageUser } from "@/server/auth";
import { getRequestLanguage } from "@/server/i18n";

export const dynamic = "force-dynamic";

const COPY = {
  en: {
    eyebrow: "Welcome to ankify",
    title: "Follow a plan, and keep what you learn.",
    body: "The extension is ready. Sign in with Google and choose a study plan, and ankify will guide you from your first problem to your first review.",
    signedIn: "Continue setup",
    signIn: "Continue with Google",
    steps: [
      ["Connect", "The extension securely reuses your ankify web session."],
      ["Solve", "Submit on a LeetCode problem, and the extension collects it with your submissions."],
      ["Review", "Talk it through with the Study Coach or rate it yourself, and it comes back before you forget."],
    ],
  },
  zh: {
    eyebrow: "欢迎使用 ankify",
    title: "跟着题单走，学过的都记得住。",
    body: "扩展已经准备好。使用 Google 登录并选好题单，ankify 会带你从第一道题走到第一次复习。",
    signedIn: "继续设置",
    signIn: "使用 Google 继续",
    steps: [
      ["连接", "扩展会安全复用 ankify 网页登录会话。"],
      ["做题", "在 LeetCode 题目上提交，扩展会收录这道题和你的提交记录。"],
      ["复习", "和学习教练讲一遍，或者自己评分，这道题会在你忘记前回来。"],
    ],
  },
} as const;

const ICONS = [Chrome, BookOpenCheck, Sparkles] as const;

export default async function WelcomePage() {
  const [user, language] = await Promise.all([getOptionalPageUser(), getRequestLanguage()]);
  const t = COPY[language];

  return (
    <div className="mx-auto max-w-4xl py-6 sm:py-12">
      <BrandLockup size="md" showTag />
      <div className="mt-10 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{t.eyebrow}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{t.title}</h1>
        <p className="mt-5 text-base leading-8 text-muted">{t.body}</p>
        <Link
          href={user ? "/today" : "/login?next=/today"}
          className={buttonClasses({ variant: "primary", size: "lg", className: "mt-7" })}
        >
          {user ? t.signedIn : t.signIn}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {t.steps.map(([title, body], index) => {
          const Icon = ICONS[index] ?? Chrome;
          return (
            <Surface key={title} className="p-5">
              <div className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-4.5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
            </Surface>
          );
        })}
      </div>
    </div>
  );
}
