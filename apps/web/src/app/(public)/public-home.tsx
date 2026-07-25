"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

export function PublicHome() {
  const { language } = useLanguage();
  const copy = language === "zh"
    ? {
        eyebrow: "为真正做过的题建立长期记忆",
        title: "不要只刷过，真正记住。",
        body: "ankify 把你的 LeetCode 题目、提交、失败用例和笔记整理成间隔复习、卡片与针对性测验。网页和 Chrome 扩展共用一次 Google 登录。",
        start: "使用 Google 开始",
        privacy: "隐私政策",
        terms: "使用条款",
        features: [
          ["一键捕获", "在 LeetCode 题目页同步题面、通过与失败提交。"],
          ["FSRS 调度", "按题目安排复习，在遗忘前把关键思路带回来。"],
          ["自己的 AI", "使用你自己的模型 key，从个人上下文生成卡片和测验。"],
        ],
      }
    : {
        eyebrow: "Long-term memory for problems you actually solved",
        title: "Don’t just solve it. Remember it.",
        body: "ankify turns your LeetCode problems, submissions, failed cases, and notes into spaced reviews, cards, and focused quizzes. The web app and Chrome extension share one Google login.",
        start: "Continue with Google",
        privacy: "Privacy policy",
        terms: "Terms of use",
        features: [
          ["One-click capture", "Sync the statement plus accepted and failed submissions from LeetCode."],
          ["FSRS scheduling", "Review whole problems shortly before the important ideas fade."],
          ["Bring your own AI", "Use your own provider key to create cards and quizzes from personal context."],
        ],
      };

  return (
    <div className="mx-auto max-w-5xl space-y-12 py-8 sm:py-14">
      <section className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{copy.eyebrow}</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">{copy.title}</h1>
        <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">{copy.body}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login?next=/today" className={buttonClasses({ variant: "primary", className: "px-5 py-2.5" })}>
            {copy.start}
            <span aria-hidden>-&gt;</span>
          </Link>
          <Link href="/privacy" className={buttonClasses({ className: "px-5 py-2.5" })}>
            {copy.privacy}
          </Link>
          <Link href="/terms" className={buttonClasses({ className: "px-5 py-2.5" })}>
            {copy.terms}
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {copy.features.map(([title, body]) => (
          <Surface key={title} className="p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
          </Surface>
        ))}
      </section>
    </div>
  );
}
