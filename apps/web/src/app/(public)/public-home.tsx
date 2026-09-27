"use client";

import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { getExtensionInstallUrl } from "@/lib/extension-install";

type Showcase = {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  shot: ShotName;
  alt: string;
};

const COPY = {
  en: {
    eyebrow: "Spaced repetition for LeetCode",
    title: "Remember the reasoning behind every solution.",
    body: "ankify captures your problems, submissions, and failed test cases from LeetCode, then brings each one back with spaced repetition, AI quizzes built from your own mistakes, and a Study Coach that has read your code.",
    start: "Continue with Google",
    getExtension: "Add to Chrome",
    note: "Free to start: new accounts get free AI credits, then use your own Anthropic, OpenAI, or DeepSeek key.",
    heroAlt:
      "ankify review workspace: the Coin Change statement, an AI quiz about the greedy counterexample, and Study Coach explaining why the first submission failed",
    stepsTitle: "How it works",
    steps: [
      ["Solve", "Work on LeetCode as usual. Accepted or not, every attempt counts."],
      [
        "Capture",
        "One click in the Chrome extension saves the statement, your submissions, and the exact failing test case.",
      ],
      [
        "Review",
        "FSRS-6 brings each problem back just before you'd forget it, on the web or in the side panel next to LeetCode.",
      ],
    ],
    showcases: [
      {
        eyebrow: "Quiz",
        title: "A quiz for each review, built from your own mistakes.",
        body: "Five questions generated from the statement, your failed submissions, your notes, and your saved cards. Each batch covers at least four different angles and always includes a complexity question.",
        points: [
          "Answer with A–D, rate with 1–4, submit with Enter",
          "Save any missed question as a flashcard in one click",
          "Your score suggests a rating, but you always decide",
        ],
        shot: "review-quiz",
        alt: "Quiz panel with a correct answer and its explanation next to the problem statement",
      },
      {
        eyebrow: "Study Coach",
        title: "An AI tutor that has actually read your submissions.",
        body: "Ask why an attempt failed and Coach looks up your code, the failing case, your notes, and past quiz results before answering. It explains your mistake, not a generic editorial.",
        points: [
          "Available beside every page, with conversations that persist",
          "Can jump to another problem or suggest a new card or quiz",
          "Nothing is saved until you confirm it",
        ],
        shot: "coach-panel",
        alt: "Study Coach explaining why a greedy Coin Change solution fails on coins [1, 3, 4] with amount 6",
      },
      {
        eyebrow: "Chrome extension",
        title: "Review right next to LeetCode.",
        body: "The side panel shows today's queue and the problem you're on: quiz, cards, notes, and the same rating bar as the web app. A new problem is one click to capture, with all your submissions.",
        points: [
          "Detects the problem in your current tab",
          "A gold ! on the toolbar icon for solved problems you haven't saved",
          "Shares your web login, so there's no token to paste",
        ],
        shot: "extension-panel",
        alt: "ankify Chrome side panel with a Coin Change quiz question, its explanation, and the rating bar",
      },
      {
        eyebrow: "Analysis",
        title: "See which problems are about to slip.",
        body: "The dashboard reads the same FSRS state that schedules your reviews: average recall, lapse rate, and a list of the problems you're most likely to forget next.",
        points: [
          "Retrievability and stability for every problem",
          "Seven-day review forecast",
          "30-day activity history",
        ],
        shot: "analysis",
        alt: "Analysis dashboard showing memory score, lapse rate, and the needs-attention table",
      },
    ] satisfies Showcase[],
    extras: [
      ["Keyboard-first", "Rate with 1–4, answer with A–D, flip cards with Space, submit with Enter."],
      ["Free credits, then your key", "Start on free AI credits, then add your own key. Keys are encrypted before they're stored, and your key always takes priority."],
      ["English or 简体中文", "The interface and AI output each have their own language setting."],
      ["Your data stays yours", "Export everything as NDJSON or delete your account from Settings."],
    ],
    finalTitle: "Your next review starts with the problem you solved today.",
    finalBody: "Sign in with Google and capture your first problem from LeetCode. Free AI credits cover your first quizzes.",
    privacy: "Privacy policy",
    terms: "Terms of use",
  },
  zh: {
    eyebrow: "为 LeetCode 设计的间隔复习",
    title: "记住每道题背后的思路。",
    body: "ankify 从 LeetCode 收集你的题目、提交和失败用例，用间隔复习、根据你自己错误生成的 AI 测验，以及读过你代码的学习教练，把每道题在遗忘前带回来。",
    start: "使用 Google 开始",
    getExtension: "添加到 Chrome",
    note: "免费开始：新账号自带免费 AI 额度，之后使用你自己的 Anthropic、OpenAI 或 DeepSeek key。",
    heroAlt: "ankify 复习工作区：Coin Change 题面、关于贪心反例的 AI 测验，以及解释首次提交为何失败的学习教练",
    stepsTitle: "如何使用",
    steps: [
      ["刷题", "照常在 LeetCode 做题，通过或失败的每次提交都有价值。"],
      ["捕获", "在 Chrome 扩展里点一下，同步题面、全部提交和具体的失败用例。"],
      ["复习", "FSRS-6 在你快要遗忘前安排复习，可在网页或 LeetCode 旁的侧边栏完成。"],
    ],
    showcases: [
      {
        eyebrow: "测验",
        title: "每次复习都有一套新测验，来自你自己的错误。",
        body: "根据题面、失败提交、笔记和已有卡片生成五道选择题。每套至少覆盖四个角度，并且一定包含复杂度题目。",
        points: ["A–D 作答，1–4 评分，Enter 提交", "答错的题一键保存为卡片", "得分只给出建议评分，最终由你决定"],
        shot: "review-quiz",
        alt: "测验面板展示正确答案与解析，旁边是题面",
      },
      {
        eyebrow: "学习教练",
        title: "真正读过你提交代码的 AI 教练。",
        body: "问它某次提交为什么失败，教练会先查看你的代码、失败用例、笔记和过往测验，再回答。它讲的是你的错误，而不是一篇通用题解。",
        points: ["每个页面都能打开，对话会被保留", "可以跳转到其他题，或建议新的卡片与测验", "所有写入都需要你确认"],
        shot: "coach-panel",
        alt: "学习教练解释贪心解法为何在 coins [1, 3, 4]、amount 6 时失败",
      },
      {
        eyebrow: "Chrome 扩展",
        title: "在 LeetCode 旁边直接复习。",
        body: "侧边栏显示今日队列和当前题目：测验、卡片、笔记，以及与网页相同的评分栏。新题一键捕获，连同你的全部提交。",
        points: ["自动识别当前标签页的题目", "做过但未保存的题，工具栏图标显示金色 !", "与网页共用登录，无需粘贴 token"],
        shot: "extension-panel",
        alt: "ankify Chrome 侧边栏：带解析的 Coin Change 测验题与评分栏",
      },
      {
        eyebrow: "分析",
        title: "看清哪些题快要忘了。",
        body: "仪表盘读取与排期相同的 FSRS 状态：平均记忆率、遗忘率，以及最可能遗忘的题目排序。",
        points: ["每道题的可提取性与稳定性", "未来七天的复习负担", "近 30 天的复习记录"],
        shot: "analysis",
        alt: "分析仪表盘展示记忆率、遗忘率与需要关注的题目",
      },
    ] satisfies Showcase[],
    extras: [
      ["键盘优先", "1–4 评分，A–D 作答，空格翻卡，Enter 提交。"],
      ["先免费，再用自己的 key", "先用免费 AI 额度，之后填入自己的 key。key 在存储前加密，配置后优先使用你自己的 key。"],
      ["English 或简体中文", "界面语言与 AI 输出语言可以分别设置。"],
      ["数据归你所有", "可在设置中导出 NDJSON，或永久删除账户。"],
    ],
    finalTitle: "下一次复习，从今天做过的题开始。",
    finalBody: "使用 Google 登录，从 LeetCode 捕获第一道题。免费 AI 额度足够你先试几次测验。",
    privacy: "隐私政策",
    terms: "使用条款",
  },
};

/** Intrinsic sizes of the captures in public/marketing (light and dark share one size). */
const SHOT_SIZE = {
  "study-coach": [2400, 1500],
  "review-quiz": [2400, 1500],
  "coach-panel": [790, 1840],
  "extension-panel": [800, 1950],
  analysis: [2400, 1333],
} as const;

type ShotName = keyof typeof SHOT_SIZE;

/** Tall captures sit beside their text instead of below it. */
const SIDE_SHOTS = new Set<ShotName>(["coach-panel", "extension-panel"]);

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

function ShowcaseText({ item }: { item: Showcase }) {
  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{item.eyebrow}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{item.title}</h2>
      </div>
      <div className="space-y-3">
        <p className="leading-7 text-muted">{item.body}</p>
        <ul className="space-y-1.5 text-sm">
          {item.points.map((point) => (
            <li key={point} className="flex gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
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
        <ThemedShot name="study-coach" alt={copy.heroAlt} priority />
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

      {copy.showcases.map((item) =>
        SIDE_SHOTS.has(item.shot) ? (
          <section key={item.shot} className="grid items-center gap-10 md:grid-cols-[1fr_minmax(0,24rem)]">
            <div className="space-y-6">
              <ShowcaseText item={item} />
            </div>
            <div className="mx-auto w-full max-w-sm">
              <ThemedShot name={item.shot} alt={item.alt} sizes="(min-width: 768px) 384px, 100vw" />
            </div>
          </section>
        ) : (
          <section key={item.shot} className="space-y-8">
            <div className="grid gap-6 md:grid-cols-2 md:items-end">
              <ShowcaseText item={item} />
            </div>
            <ThemedShot name={item.shot} alt={item.alt} />
          </section>
        ),
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
