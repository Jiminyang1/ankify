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
  credit?: { text: string; href: string };
};

const LISTS_SOURCE = "https://leetcode.cn/circle/discuss/RvFUtj/";

const COPY = {
  en: {
    eyebrow: "Spaced repetition for LeetCode",
    title: "Follow a plan. Learn the patterns. Keep them.",
    body: "Pick a study plan and work through it chapter by chapter on LeetCode. ankify collects what you solve and brings each problem back before it fades. Then a Study Coach asks which technique it takes and what in the statement tells you, so you practice recognizing the pattern instead of reciting the code.",
    start: "Continue with Google",
    getExtension: "Add to Chrome",
    note: "Free to start: new accounts get free AI credits, then use your own Anthropic, OpenAI, or DeepSeek key.",
    heroAlt:
      "ankify review workspace: the Coin Change statement beside the Study Coach, which has checked a spoken answer against the problem's Solutions doc",
    stepsTitle: "How it works",
    steps: [
      [
        "Pick a plan",
        "Top Interview 150, LeetCode 75, Top 100 Liked, 灵茶山艾府's lists, or a public LeetCode list. Your solved history shows where you already are.",
      ],
      [
        "Solve on LeetCode",
        "The Chrome extension collects a problem on your first new submission, pass or fail, with your code and the failing test case.",
      ],
      [
        "Review",
        "Each problem comes back just before you'd forget it. Talk it through with the Coach on the web or beside LeetCode, then confirm your rating.",
      ],
    ],
    showcases: [
      {
        eyebrow: "Plan",
        title: "Always know what's next.",
        body: "Your plan is a roadmap of chapters: what you've solved, what's in review, and what's due. Today shows your reviews first, then the next problem in your current chapter.",
        points: [
          "Finish a chapter and go deeper on its technique",
          "Forget a review and get one easier problem with the same technique",
          "Finish the plan and get a focused one for what you forget most",
        ],
        shot: "plan-roadmap",
        alt: "Plan page: Top Interview 150 as a roadmap of chapters, with solved, due, and not started counts",
        credit: { text: "Techniques and lists from 灵茶山艾府, used with permission", href: LISTS_SOURCE },
      },
      {
        eyebrow: "Review",
        title: "Each review starts with recognizing the pattern.",
        body: "Say which technique the problem calls for and what in the statement points to it, then how you'd solve it and what it costs. Your reply is checked against a Solutions doc for that problem, and the Coach follows up only on what you left out.",
        points: [
          "The more help you need, the lower the grade",
          "Next time it asks about the mistakes you made last time",
          "A rating is suggested, but you always decide",
        ],
        shot: "practice-panel",
        alt: "Practice results in the Study Coach: the question marked right, with each point of the Solutions doc listed",
      },
      {
        eyebrow: "Study Coach",
        title: "An AI tutor that has actually read your submissions.",
        body: "Ask why an attempt failed and the Coach looks up your code, the failing case, and your notes before answering. It explains your mistake, not a generic editorial.",
        points: [
          "Available beside every page, with conversations that persist",
          "Records the specific mistakes it finds as weak spots you can remove",
          "Edits to your notes wait for your approval",
        ],
        shot: "coach-panel",
        alt: "Study Coach explaining why a greedy Coin Change solution fails on coins [1, 3, 4] with amount 6",
      },
      {
        eyebrow: "Chrome extension",
        title: "Everything beside LeetCode.",
        body: "The side panel follows the problem in your current tab: the Coach, its weak spots, your notes and solutions, and the rating buttons when it's due. Away from a problem, it shows today's reviews and what's next in your plan.",
        points: [
          "Collects a problem on your first new submission",
          "The Coach can read the code in your editor, and you can turn that off",
          "Shares your web login, so there's no token to paste",
        ],
        shot: "extension-panel",
        alt: "ankify Chrome side panel: today's due reviews and the next problem in the plan",
      },
    ] satisfies Showcase[],
    extras: [
      ["Keyboard-first", "Rate with 1–4, submit with Enter, and press ? for help."],
      ["Free credits, then your key", "Start on free AI credits, then add your own key. Keys are encrypted before they're stored, and your key always takes priority."],
      ["English or 简体中文", "The interface and AI output each have their own language setting."],
      ["Your data stays yours", "Export everything as NDJSON or delete your account from Settings."],
    ],
    finalTitle: "Pick a plan and start with your next problem.",
    finalBody: "Sign in with Google, choose a plan, and add the extension. Free AI credits cover your first reviews.",
    privacy: "Privacy policy",
    terms: "Terms of use",
  },
  zh: {
    eyebrow: "为 LeetCode 设计的间隔复习",
    title: "跟着题单，学会模式，不再忘记。",
    body: "选一个题单，在 LeetCode 上一章一章往下做。ankify 收录你做过的题，在快要忘记前带回来。复习时，学习教练先问你用什么技巧、题目里哪句话提示了你，练的是认出模式，而不是背代码。",
    start: "使用 Google 开始",
    getExtension: "添加到 Chrome",
    note: "免费开始：新账号自带免费 AI 额度，之后使用你自己的 Anthropic、OpenAI 或 DeepSeek key。",
    heroAlt: "ankify 复习工作区：Coin Change 题面旁边是学习教练，它已对照这道题的 Solutions 文档判过一次回答",
    stepsTitle: "如何使用",
    steps: [
      ["选题单", "Top Interview 150、LeetCode 75、Top 100 Liked、灵茶山艾府的题单，或任意公开的 LeetCode 题单。做题记录会标出你已经做到哪。"],
      ["在 LeetCode 做题", "第一次新提交时，不管通过与否，Chrome 扩展都会收录这道题，连同你的代码和失败用例。"],
      ["复习", "每道题在你快要忘记前回来。在网页或 LeetCode 旁边和教练讲一遍，再确认评分。"],
    ],
    showcases: [
      {
        eyebrow: "题单",
        title: "随时知道下一步做什么。",
        body: "题单是一张按章节展开的路线图：哪些做过、哪些在复习、哪些到期。「今日」先列复习，再给出当前章节的下一题。",
        points: ["做完一章，可以继续深入这一章的技巧", "复习时忘了，推荐一道同技巧的更简单的题", "做完题单，按你最常忘的内容推荐专题题单"],
        shot: "plan-roadmap",
        alt: "题单页：Top Interview 150 按章节展开的路线图，标出已做、到期和未开始的数量",
        credit: { text: "技巧分类与题单来自灵茶山艾府，已获授权", href: LISTS_SOURCE },
      },
      {
        eyebrow: "复习",
        title: "每次复习，从认出模式开始。",
        body: "先说这道题用什么技巧、题目里哪句话提示了你，再讲解法和复杂度。回答会对照这道题的 Solutions 文档判断，教练只追问你漏掉的部分。",
        points: ["需要的提示越多，得分越低", "下次会专门问你上次犯的错", "系统给出建议评分，最终由你决定"],
        shot: "practice-panel",
        alt: "学习教练里的练习结果：这道题判为答对，并列出 Solutions 文档的每个要点",
      },
      {
        eyebrow: "学习教练",
        title: "真正读过你提交代码的 AI 教练。",
        body: "问它某次提交为什么失败，教练会先查看你的代码、失败用例和笔记，再回答。它讲的是你的错误，而不是一篇通用题解。",
        points: ["每个页面都能打开，对话会被保留", "发现的具体错误会记为易错点，你可以删除", "修改笔记需要你批准"],
        shot: "coach-panel",
        alt: "学习教练解释贪心解法为何在 coins [1, 3, 4]、amount 6 时失败",
      },
      {
        eyebrow: "Chrome 扩展",
        title: "一切都在 LeetCode 旁边。",
        body: "侧边栏跟随当前标签页的题目：教练、这道题的易错点、笔记和解法，到期时还有评分按钮。不在题目页时，显示今天的复习和题单的下一题。",
        points: ["第一次新提交时自动收录这道题", "教练可以读取编辑器里的代码，也可以关闭", "与网页共用登录，无需粘贴 token"],
        shot: "extension-panel",
        alt: "ankify Chrome 侧边栏：今天到期的复习和题单的下一题",
      },
    ] satisfies Showcase[],
    extras: [
      ["键盘优先", "1–4 评分，Enter 提交，按 ? 查看帮助。"],
      ["先免费，再用自己的 key", "先用免费 AI 额度，之后填入自己的 key。key 在存储前加密，配置后优先使用你自己的 key。"],
      ["English 或简体中文", "界面语言与 AI 输出语言可以分别设置。"],
      ["数据归你所有", "可在设置中导出 NDJSON，或永久删除账户。"],
    ],
    finalTitle: "选一个题单，从下一题开始。",
    finalBody: "使用 Google 登录，选好题单，再添加扩展。免费 AI 额度足够你完成最初几次复习。",
    privacy: "隐私政策",
    terms: "使用条款",
  },
};

/** Intrinsic sizes of the captures in public/marketing (light and dark share one size). */
const SHOT_SIZE = {
  "review-workspace": [2400, 1500],
  "plan-roadmap": [2400, 1500],
  "practice-panel": [712, 1590],
  "coach-panel": [712, 1590],
  "extension-panel": [712, 1590],
} as const;

type ShotName = keyof typeof SHOT_SIZE;

/** Tall captures sit beside their text instead of below it. */
const SIDE_SHOTS = new Set<ShotName>(["practice-panel", "coach-panel", "extension-panel"]);

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
        {item.credit && (
          <a
            href={item.credit.href}
            target="_blank"
            rel="noreferrer"
            className="block text-xs text-muted transition hover:text-fg hover:underline"
          >
            {item.credit.text}
          </a>
        )}
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
        <ThemedShot name="review-workspace" alt={copy.heroAlt} priority />
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
