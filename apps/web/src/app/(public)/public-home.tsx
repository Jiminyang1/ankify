"use client";

import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { getExtensionInstallUrl } from "@/lib/extension-install";

const COPY = {
  en: {
    eyebrow: "Spaced repetition for LeetCode",
    title: "Remember the reasoning behind every solution.",
    body: "ankify works next to LeetCode. The Chrome extension records each practice session and its submissions, FSRS brings every problem back just before you'd forget it, and your mistake profile shows which causes of failure keep coming back.",
    start: "Continue with Google",
    getExtension: "Add to Chrome",
    note: "Free to use. Session analysis is optional and runs only on your own Anthropic, OpenAI, or DeepSeek key.",
    heroAlt: "ankify analysis dashboard showing memory score, lapse rate, and the problems most likely to slip",
    stepsTitle: "How it works",
    steps: [
      ["Practice", "Open a problem on LeetCode and start practice from the ankify panel. Every submission is recorded with its verdict."],
      ["Rate", "Finish a review and rate how it went. FSRS-6 schedules the next one; a first practice comes back a day later."],
      ["Learn", "Record why an attempt failed, or let session analysis suggest a cause, and watch your mistake profile."],
    ],
    featuresTitle: "What you get",
    features: [
      ["Practice sessions", "The extension tracks each attempt on LeetCode: submissions, verdicts, and time spent. Nothing is scheduled until you rate a review."],
      ["Mistake profile", "Confirmed causes of failure, counted once per session, show which skills keep slipping across problems."],
      ["New problems", "A daily suggestion of a problem you haven't attempted, chosen from problems similar to ones you practiced, with the reason it was picked."],
      ["Session analysis, optional", "With your own key, ankify explains why a session went wrong and suggests mistakes for you to confirm. Nothing counts until you do."],
    ],
    extras: [
      ["Your key, only if you want it", "Analysis is the only AI feature, and it runs on your own key, encrypted before it's stored."],
      ["English or 简体中文", "The interface and session analyses each have their own language setting."],
      ["Your data stays yours", "Export everything as NDJSON or delete your account from Settings."],
    ],
    finalTitle: "Your next review starts with the problem you solved today.",
    finalBody: "Sign in with Google, add the extension, and start practice on your next LeetCode problem.",
    privacy: "Privacy policy",
    terms: "Terms of use",
  },
  zh: {
    eyebrow: "为 LeetCode 设计的间隔复习",
    title: "记住每道题背后的思路。",
    body: "ankify 就在 LeetCode 旁边。Chrome 扩展记录每次练习和提交，FSRS 在你快要遗忘前把题目带回来，错误画像告诉你哪些失败原因反复出现。",
    start: "使用 Google 开始",
    getExtension: "添加到 Chrome",
    note: "免费使用。练习分析是可选的，只会使用你自己的 Anthropic、OpenAI 或 DeepSeek key。",
    heroAlt: "ankify 分析仪表盘：记忆率、遗忘率，以及最可能遗忘的题目",
    stepsTitle: "如何使用",
    steps: [
      ["练习", "在 LeetCode 打开题目，在 ankify 面板中开始练习，每次提交和结果都会被记录。"],
      ["评分", "完成复习后为这次表现评分，FSRS-6 安排下一次复习；首次练习会在一天后复习。"],
      ["总结", "记录失败的原因，或让练习分析给出建议，再看看你的错误画像。"],
    ],
    featuresTitle: "你会得到",
    features: [
      ["练习记录", "扩展记录你在 LeetCode 上的每次尝试：提交、结果和用时。只有你给复习评分后才会安排下一次。"],
      ["错误画像", "确认过的失败原因按练习计数，告诉你哪些能力在不同题目上反复出问题。"],
      ["新题推荐", "每天推荐一道你没做过的题，来自与你练习过的题相似的题目，并说明推荐理由。"],
      ["练习分析（可选）", "使用你自己的 key，ankify 解释一次练习为什么出错，并建议错误类别由你确认；确认前不会计入。"],
    ],
    extras: [
      ["只在需要时用你的 key", "练习分析是唯一的 AI 功能，只使用你自己的 key，存储前会加密。"],
      ["English 或简体中文", "界面语言与练习分析语言可以分别设置。"],
      ["数据归你所有", "可在设置中导出 NDJSON，或永久删除账户。"],
    ],
    finalTitle: "下一次复习，从今天做过的题开始。",
    finalBody: "使用 Google 登录，添加扩展，在下一道 LeetCode 题上开始练习。",
    privacy: "隐私政策",
    terms: "使用条款",
  },
};

/** Intrinsic size of the capture in public/marketing (light and dark share one size). */
const SHOT_SIZE = {
  analysis: [2400, 1333],
} as const;

type ShotName = keyof typeof SHOT_SIZE;

/** Light and dark captures of the same screen; CSS shows the one that matches the active theme. */
function ThemedShot({
  name,
  alt,
  priority,
  sizes = "(min-width: 1280px) 1152px, 100vw",
}: {
  name: ShotName;
  alt: string;
  priority?: boolean;
  sizes?: string;
}) {
  const [width, height] = SHOT_SIZE[name];
  const common = { width, height, sizes, priority };
  return (
    <Surface className="overflow-hidden">
      <Image {...common} alt={alt} src={`/marketing/${name}-light.png`} className="theme-light-only h-auto w-full" />
      <Image {...common} alt={alt} src={`/marketing/${name}-dark.png`} className="theme-dark-only h-auto w-full" />
    </Surface>
  );
}

function Ctas({ copy }: { copy: (typeof COPY)["en"] }) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <Link
        href="/login?next=/today"
        className={buttonClasses({ variant: "primary", size: "lg", className: "w-full sm:w-52" })}
      >
        {copy.start}
      </Link>
      <a
        href={getExtensionInstallUrl()}
        target="_blank"
        rel="noreferrer"
        className={buttonClasses({ size: "lg", className: "w-full sm:w-52" })}
      >
        {copy.getExtension}
      </a>
    </div>
  );
}

export function PublicHome() {
  const { language } = useLanguage();
  const copy = COPY[language === "zh" ? "zh" : "en"];

  return (
    <div className="mx-auto max-w-6xl space-y-24 py-8 sm:py-14">
      <section className="space-y-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{copy.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">{copy.title}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">{copy.body}</p>
          <div className="mt-8">
            <Ctas copy={copy} />
          </div>
          <p className="mt-4 text-sm text-muted">{copy.note}</p>
        </div>
        <ThemedShot name="analysis" alt={copy.heroAlt} priority />
      </section>

      <section className="space-y-8">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">{copy.stepsTitle}</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {copy.steps.map(([title, body], index) => (
            <Surface as="li" key={title} className="p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold tabular-nums text-accent">
                {index + 1}
              </span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
            </Surface>
          ))}
        </ol>
      </section>

      <section className="space-y-8">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">{copy.featuresTitle}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {copy.features.map(([title, body]) => (
            <Surface key={title} className="p-6">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
            </Surface>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {copy.extras.map(([title, body]) => (
          <Surface key={title} className="p-5">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
          </Surface>
        ))}
      </section>

      <Surface as="section" className="px-6 py-12 text-center sm:px-12">
        <h2 className="mx-auto max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">{copy.finalTitle}</h2>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-muted">{copy.finalBody}</p>
        <div className="mt-8">
          <Ctas copy={copy} />
        </div>
      </Surface>

      <footer className="flex items-center gap-4 border-t border-border pt-5 text-sm text-muted">
        <Link href="/privacy" className="transition hover:text-fg hover:underline">
          {copy.privacy}
        </Link>
        <Link href="/terms" className="transition hover:text-fg hover:underline">
          {copy.terms}
        </Link>
      </footer>
    </div>
  );
}
