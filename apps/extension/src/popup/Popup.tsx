import { useCallback, useEffect, useRef, useState } from "react";
import { formatQuizMarkdown } from "@ankify/core";
import type { CapturedProblem, ContentResponse, ExtSettings } from "../shared/messages";
import { clearCardDraft, getCardDraft, getSettings, setCardDraft, setSettings } from "../shared/storage";
import { PopupMarkdown } from "./PopupMarkdown";

type ApiCard = {
  id: string;
  aiStatus: "candidate" | "failed" | "ready";
  errorMessage: string | null;
  question: string;
  answer: string;
};
type LocalCandidate = ApiCard & {
  instruction: string;
  busy: string | null;
  localError: string | null;
};
type ApiProblem = {
  id: string;
  leetcodeSlug: string;
  leetcodeId: number | null;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsStability: number | null;
  notes: string | null;
};
type FsrsRating = 1 | 2 | 3 | 4;
type Previews = Record<FsrsRating, { due: string }>;
type ThemePreference = "system" | "light" | "dark";
type Language = ExtSettings["language"];
type QuizItem = {
  id: string;
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  source: "statement" | "submission" | "notes" | "card";
  scope: "approach" | "invariant" | "edge_case" | "complexity" | "implementation" | "mistake_review";
};
type QuizAnswer = {
  itemId: string;
  selectedIndex: number;
  correct: boolean;
  answeredAt: string;
};
type QuizSession = {
  id: string;
  problemId: string;
  status: "active" | "completed" | "archived";
  itemsJson: QuizItem[];
  answersJson: QuizAnswer[];
  score: number | null;
  createdAt: string;
  updatedAt: string | null;
  completedAt: string | null;
};
type CaptureResult = {
  problemId: string;
  created: boolean;
  importedSubmissions: number;
};

type State =
  | { kind: "detecting" }
  | { kind: "off-page" }
  | { kind: "loading"; slug: string }
  | { kind: "not-saved"; slug: string }
  | { kind: "captured"; problem: ApiProblem; cards: ApiCard[]; candidates: ApiCard[]; previews: Previews }
  | { kind: "error"; msg: string };

// Pinned reference to the most recent successful capture. Survives across tab
// switches so the popup can keep showing the last problem (with a "jump back"
// banner) when the active tab isn't on a LeetCode problem.
type Sticky = {
  slug: string;
  tabId: number | null;
  problem: ApiProblem;
  cards: ApiCard[];
  candidates: ApiCard[];
  previews: Previews;
};

type NavTab = "today" | "problem" | "settings";

type QueueStats = {
  dailyReviewLimit: number;
  doneToday: number;
  remaining: number;
  totalDue: number;
  dueCount: number;
};
type QueueProblem = {
  id: string;
  leetcodeSlug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  url: string;
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  fsrsStability: number | null;
  fsrsReps: number;
  fsrsLapses: number;
  cardCount: number;
};
type QueueResponse = { queue: QueueStats; problems: QueueProblem[] };

const EXT_I18N = {
  en: {
    nav: { today: "Today", problem: "Problem", settings: "Settings" },
    common: {
      retry: "Retry",
      loadingQueue: "Loading today's queue...",
      due: "due",
      leftToday: "left today",
      reviewsToday: "reviews today",
      openFullReview: "Open full review on web ↗",
      cards: (count: number) => `${count} card${count === 1 ? "" : "s"}`,
      lapses: (count: number) => `${count} lapse${count === 1 ? "" : "s"}`,
      submissions: (count: number) => `${count} submissions`,
      acceptedFailed: (accepted: number, failed: number) => `(${accepted} accepted, ${failed} failed)`,
      unknownError: "Unknown error",
    },
    difficulty: { Easy: "Easy", Medium: "Medium", Hard: "Hard" },
    fsrs: { new: "new", learning: "learning", review: "review", relearning: "relearning" },
    theme: { label: "Theme", system: "System", light: "Light", dark: "Dark" },
    language: { label: "Language", en: "EN", zh: "中" },
    rating: {
      again: "Again",
      hard: "Hard",
      good: "Good",
      easy: "Easy",
      hints: {
        again: "Could not recall it",
        hard: "Partial recall, shaky",
        good: "Main idea is clear",
        easy: "Can explain method and pitfalls",
      },
    },
    today: {
      limitReached: "Daily limit reached. Take a break.",
      allCaughtUp: "All caught up - nothing due right now.",
      noQueue: "No problems in queue.",
      dueNow: "Due now",
      stability: "stability",
    },
    problem: {
      connecting: "Connecting...",
      syncing: (slug: string) => `Syncing ${slug}...`,
      offPage: "Open a LeetCode problem tab (URL contains /problems/) to start reviewing.",
      activeTabNotOn: (title: string) => `Active tab isn't on ${title}.`,
      openIt: "Open it",
      review: "Review",
      manage: "Manage",
      syncTitle: "Sync latest LeetCode submissions",
      openWeb: "Open in web",
      syncOne: "Synced 1 new submission.",
      syncMany: (count: number) => `Synced ${count} new submissions.`,
      upToDate: "Already up to date.",
      syncFailed: "Sync failed.",
      next: "next:",
    },
    review: {
      quiz: "Quiz",
      cards: "Cards",
      notes: "Notes",
      noCards: "No cards yet.",
      goManage: "Go to Manage",
      submitRating: "Submit rating",
      alreadyRated: "Already rated in another window. Refreshing...",
      rateFailed: "Rate failed",
    },
    quiz: {
      loading: "Loading quiz...",
      generating: "Generating quiz",
      switchHint: "You can switch to Card or Notes and come back here.",
      noQuiz: "No quiz yet",
      noQuizBody: "Generate 5 focused questions from this problem, your submissions, notes, and cards.",
      generate: "Generate quiz",
      pendingTimer: (elapsed: string) => `Generating ${elapsed} / 02:00`,
      timedOut: "Quiz generation timed out. Try again.",
      failedLoad: "Failed to load quiz",
      failedGenerate: "Failed to generate quiz",
      resetConfirm: "Delete all quiz history for this problem? Past sessions cannot be recovered.",
      failedReset: "Failed to reset quiz history",
      changed: "Quiz state changed elsewhere. Reloading...",
      failedSubmit: "Failed to submit answer",
      failedSave: "Failed to save card",
      batchComplete: "Batch complete",
      noMisses: "No misses",
      missed: (count: number) => `${count} missed`,
      coverageBalanced: "coverage balanced",
      reset: "Reset",
      newBatch: "New Batch",
      scope: "Scope",
      source: "Source",
      missedLabel: "Missed",
      none: "None",
      creating: "Creating...",
      cardsSaved: "Cards saved",
      createCards: "Create cards",
      hideQuiz: "Hide Quiz",
      reviewQuiz: "Review Quiz",
      hideAnswers: "Hide all answers",
      expandQuestions: "Expand all questions",
      noQuestions: "This quiz has no questions.",
      regenerate: "Regenerate",
      regenerating: "Regenerating...",
      question: (current: number, total: number) => `Question ${current} / ${total}`,
      answered: (answered: number, total: number) => `Answered ${answered}/${total}`,
      prev: "Prev",
      next: "Next",
      correct: "Correct",
      wrong: "Wrong",
      incorrect: "Incorrect",
      saved: "Saved",
      saving: "Saving...",
      save: "Save",
      results: "Results",
      checking: "Checking answer...",
      answerHint: "Click an option to answer, or use Next to skip for now.",
      firstUnanswered: "First unanswered",
      yourAnswer: "Your answer:",
      correctAnswer: "Correct answer:",
      scopes: {
        approach: "Approach",
        invariant: "Invariant",
        edge_case: "Edge cases",
        complexity: "Complexity",
        implementation: "Implementation",
        mistake_review: "Mistakes",
      },
      sources: { statement: "Statement", submission: "Submission", notes: "Notes", card: "Card" },
    },
    cards: {
      add: "Add a card",
      savedCount: (count: number) => `${count} saved card${count === 1 ? "" : "s"}`,
      noSaved: "No saved cards yet.",
      question: "Question",
      answer: "Answer",
      deleteConfirm: "Delete this card?",
      deleteFailed: "Delete failed",
      delete: "Delete",
      aiFromNotes: "AI from notes",
      manual: "Manual Q&A",
      questionPlaceholder: "What do you want to recall?",
      answerPlaceholder: "The answer you need to remember.",
      saveCard: "Save card",
      yourNotes: "Your notes",
      notesPlaceholder: "Questions, pitfalls, or reasoning you want to remember...",
      generatingCandidate: "Generating candidate...",
      autosaved: "autosaved",
      clear: "Clear",
      autoGenerate: "Auto generate",
      generateFromNote: "Generate from note",
      timedOut: "AI card generation timed out. Try again.",
      candidateCount: (count: number) => `${count} AI candidate${count === 1 ? "" : "s"} - review & confirm`,
      failed: "Failed",
      candidate: "Candidate",
      followupPlaceholder: "Follow up instruction (optional)",
      apply: "Apply",
      confirm: "Confirm",
      applying: "Applying",
      aiFailed: "AI request failed",
      confirmFailed: "Confirm failed",
      discardFailed: "Discard failed",
    },
    capture: {
      notInDeck: "Not in your deck",
      notCaptured: (slug: string) => `Problem ${slug} hasn't been captured.`,
      reading: "Reading...",
      captureThis: "Capture this problem",
      add: "Add to ankify",
      saving: "Saving...",
      back: "Back",
    },
    notes: {
      title: "Notes",
      saving: "Saving...",
      saved: "Saved",
      placeholder: "What tripped you up, key insights, alternative approaches...",
    },
    settings: {
      appearance: "Appearance",
      appearanceHelp: "Language and theme for this extension.",
      languageHelp: "Interface language",
      themeHelp: "Popup color mode",
      connection: "Connection",
      connectionHelp: "API base URL and token the extension uses to reach your ankify web app.",
      reviewGuard: "Review guard",
      reviewGuardHelp: "Keeps LeetCode problem pages clean while reviewing.",
      resetCode: "Reset code on problem pages",
      resetCodeHelp: "When any LeetCode problem opens, restore the default starter code once.",
      apiBaseUrl: "API base URL",
      apiToken: "User API token",
      saveConnection: "Save connection",
      testConnection: "Test connection",
      testing: "Testing...",
      saved: "Saved.",
      tokenHint: "Create a token in web Settings, then paste it here.",
      required: "API base URL and token are required.",
      checking: "Checking connection...",
      connectedAs: (email: string) => `Connected as ${email}.`,
      thisUser: "this user",
      failed: "Connection failed.",
    },
  },
  zh: {
    nav: { today: "今日", problem: "题目", settings: "设置" },
    common: {
      retry: "重试",
      loadingQueue: "正在加载今日队列...",
      due: "到期",
      leftToday: "今日剩余",
      reviewsToday: "今日复习",
      openFullReview: "在 Web 打开完整复习 ↗",
      cards: (count: number) => `${count} 张卡片`,
      lapses: (count: number) => `${count} 次遗忘`,
      submissions: (count: number) => `${count} 次提交`,
      acceptedFailed: (accepted: number, failed: number) => `（${accepted} 通过，${failed} 失败）`,
      unknownError: "未知错误",
    },
    difficulty: { Easy: "简单", Medium: "中等", Hard: "困难" },
    fsrs: { new: "新题", learning: "学习中", review: "复习", relearning: "重新学习" },
    theme: { label: "主题", system: "系统", light: "浅色", dark: "深色" },
    language: { label: "语言", en: "EN", zh: "中" },
    rating: {
      again: "忘记",
      hard: "困难",
      good: "良好",
      easy: "简单",
      hints: { again: "完全想不起来", hard: "部分想起但不稳", good: "主思路清楚", easy: "能讲清方法和坑点" },
    },
    today: {
      limitReached: "已达到每日上限，休息一下吧。",
      allCaughtUp: "全部跟上了，现在没有到期题。",
      noQueue: "队列里没有题目。",
      dueNow: "当前到期",
      stability: "稳定性",
    },
    problem: {
      connecting: "连接中...",
      syncing: (slug: string) => `同步 ${slug}...`,
      offPage: "打开一个 LeetCode 题目页（URL 包含 /problems/）开始复习。",
      activeTabNotOn: (title: string) => `当前标签页不是 ${title}。`,
      openIt: "打开它",
      review: "复习",
      manage: "管理",
      syncTitle: "同步最新 LeetCode 提交",
      openWeb: "在 Web 打开",
      syncOne: "已同步 1 次新提交。",
      syncMany: (count: number) => `已同步 ${count} 次新提交。`,
      upToDate: "已经是最新。",
      syncFailed: "同步失败。",
      next: "下次：",
    },
    review: {
      quiz: "测验",
      cards: "卡片",
      notes: "笔记",
      noCards: "还没有卡片。",
      goManage: "去管理",
      submitRating: "提交评分",
      alreadyRated: "已在另一个窗口评分，正在刷新...",
      rateFailed: "评分失败",
    },
    quiz: {
      loading: "正在加载测验...",
      generating: "正在生成测验",
      switchHint: "你可以先切到卡片或笔记，稍后回到这里。",
      noQuiz: "还没有测验",
      noQuizBody: "根据这道题、提交、笔记和卡片生成 5 道聚焦问题。",
      generate: "生成测验",
      pendingTimer: (elapsed: string) => `生成中 ${elapsed} / 02:00`,
      timedOut: "测验生成超时，请重试。",
      failedLoad: "加载测验失败",
      failedGenerate: "生成测验失败",
      resetConfirm: "删除这道题的所有测验历史？过去的 session 无法恢复。",
      failedReset: "重置测验历史失败",
      changed: "测验状态已在其他地方变化，正在重新加载...",
      failedSubmit: "提交答案失败",
      failedSave: "保存卡片失败",
      batchComplete: "本批完成",
      noMisses: "没有错题",
      missed: (count: number) => `错 ${count} 题`,
      coverageBalanced: "覆盖均衡",
      reset: "重置",
      newBatch: "新一批",
      scope: "范围",
      source: "来源",
      missedLabel: "错题",
      none: "无",
      creating: "创建中...",
      cardsSaved: "卡片已保存",
      createCards: "创建卡片",
      hideQuiz: "隐藏测验",
      reviewQuiz: "回看测验",
      hideAnswers: "隐藏全部答案",
      expandQuestions: "展开全部问题",
      noQuestions: "这个测验没有问题。",
      regenerate: "重新生成",
      regenerating: "重新生成中...",
      question: (current: number, total: number) => `第 ${current} / ${total} 题`,
      answered: (answered: number, total: number) => `已答 ${answered}/${total}`,
      prev: "上题",
      next: "下题",
      correct: "正确",
      wrong: "错误",
      incorrect: "错误",
      saved: "已保存",
      saving: "保存中...",
      save: "保存",
      results: "结果",
      checking: "正在检查答案...",
      answerHint: "点击选项作答，或用下题暂时跳过。",
      firstUnanswered: "第一道未答题",
      yourAnswer: "你的答案：",
      correctAnswer: "正确答案：",
      scopes: { approach: "思路", invariant: "不变量", edge_case: "边界情况", complexity: "复杂度", implementation: "实现", mistake_review: "错因复盘" },
      sources: { statement: "题目", submission: "提交", notes: "笔记", card: "卡片" },
    },
    cards: {
      add: "添加卡片",
      savedCount: (count: number) => `${count} 张已保存卡片`,
      noSaved: "还没有已保存卡片。",
      question: "问题",
      answer: "答案",
      deleteConfirm: "删除这张卡片？",
      deleteFailed: "删除失败",
      delete: "删除",
      aiFromNotes: "AI 从笔记生成",
      manual: "手动 Q&A",
      questionPlaceholder: "你想回忆什么？",
      answerPlaceholder: "需要记住的答案。",
      saveCard: "保存卡片",
      yourNotes: "你的笔记",
      notesPlaceholder: "想记住的问题、坑点或推理过程...",
      generatingCandidate: "正在生成候选卡片...",
      autosaved: "已自动保存",
      clear: "清空",
      autoGenerate: "自动生成",
      generateFromNote: "从笔记生成",
      timedOut: "AI 卡片生成超时，请重试。",
      candidateCount: (count: number) => `${count} 张 AI 候选卡片 - 检查并确认`,
      failed: "失败",
      candidate: "候选",
      followupPlaceholder: "后续修改指令（可选）",
      apply: "应用",
      confirm: "确认",
      applying: "应用中",
      aiFailed: "AI 请求失败",
      confirmFailed: "确认失败",
      discardFailed: "丢弃失败",
    },
    capture: {
      notInDeck: "不在你的题库中",
      notCaptured: (slug: string) => `题目 ${slug} 还没有捕获。`,
      reading: "读取中...",
      captureThis: "捕获这道题",
      add: "添加到 ankify",
      saving: "保存中...",
      back: "返回",
    },
    notes: { title: "笔记", saving: "保存中...", saved: "已保存", placeholder: "哪里卡住了、关键洞察、其他解法..." },
    settings: {
      appearance: "外观",
      appearanceHelp: "扩展里的语言和主题。",
      languageHelp: "界面语言",
      themeHelp: "弹窗颜色模式",
      connection: "连接",
      connectionHelp: "插件用这里的 API 地址和 token 连接你的 ankify Web 服务。",
      reviewGuard: "复习保护",
      reviewGuardHelp: "复习时保持 LeetCode 题目页干净。",
      resetCode: "打开题目时重置代码",
      resetCodeHelp: "进入任意 LeetCode 题目页时，自动恢复一次默认代码模板。",
      apiBaseUrl: "API base URL",
      apiToken: "用户 API token",
      saveConnection: "保存连接",
      testConnection: "测试连接",
      testing: "测试中...",
      saved: "已保存。",
      tokenHint: "在 Web 设置中创建 token，然后粘贴到这里。",
      required: "需要 API base URL 和 token。",
      checking: "正在检查连接...",
      connectedAs: (email: string) => `已连接为 ${email}。`,
      thisUser: "此用户",
      failed: "连接失败。",
    },
  },
} as const;

function getExtText(settings: ExtSettings) {
  return EXT_I18N[settings.language === "zh" ? "zh" : "en"];
}

function getRatingButtons(t: ReturnType<typeof getExtText>): { rating: FsrsRating; label: string; hint: string }[] {
  return [
    { rating: 1, label: t.rating.again, hint: t.rating.hints.again },
    { rating: 2, label: t.rating.hard, hint: t.rating.hints.hard },
    { rating: 3, label: t.rating.good, hint: t.rating.hints.good },
    { rating: 4, label: t.rating.easy, hint: t.rating.hints.easy },
  ];
}

function difficultyLabel(difficulty: ApiProblem["difficulty"] | CapturedProblem["difficulty"], t: ReturnType<typeof getExtText>) {
  return t.difficulty[difficulty];
}

function fsrsLabel(state: ApiProblem["fsrsState"], t: ReturnType<typeof getExtText>) {
  return t.fsrs[state];
}

function quizScopeLabel(scope: QuizItem["scope"], t: ReturnType<typeof getExtText>) {
  return t.quiz.scopes[scope];
}

function quizSourceLabel(source: QuizItem["source"], t: ReturnType<typeof getExtText>) {
  return t.quiz.sources[source];
}

const THEME_OPTIONS: { value: ThemePreference; key: "system" | "light" | "dark" }[] = [
  { value: "system", key: "system" },
  { value: "light", key: "light" },
  { value: "dark", key: "dark" },
];

const QUIZ_PENDING_TTL_MS = 125_000;
const AI_CARD_PENDING_TTL_MS = 65_000;
const CARD_GENERATION_TARGET_SECONDS = 60;
const PENDING_OPERATION_EVENT = "ankify:pending-operation";

type PendingOperation = {
  id: string;
  kind: string;
  startedAt: number;
};

/* ── helpers ── */

function jsonHeaders(settings: ExtSettings): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiToken) h["x-ankify-token"] = settings.apiToken;
  return h;
}

function authHeaders(settings: ExtSettings): HeadersInit {
  return settings.apiToken ? { "x-ankify-token": settings.apiToken } : {};
}

/* Per-field caps mirror packages/core/src/schemas.ts captureProblemSchema. */
const CAPTURE_LIMITS = {
  descriptionMd: 200_000,
  code: 200_000,
  output: 50_000,
  errorMessage: 10_000,
  submissions: 50,
} as const;

function clip(value: string | undefined, max: number): string | undefined {
  if (value == null) return value;
  return value.length > max ? value.slice(0, max) : value;
}

function trimCapturePayload(p: CapturedProblem): CapturedProblem {
  return {
    ...p,
    descriptionMd: clip(p.descriptionMd, CAPTURE_LIMITS.descriptionMd),
    submissions: p.submissions.slice(0, CAPTURE_LIMITS.submissions).map((s) => ({
      ...s,
      code: clip(s.code, CAPTURE_LIMITS.code) ?? "",
      failedTestcase: clip(s.failedTestcase, CAPTURE_LIMITS.output),
      expectedOutput: clip(s.expectedOutput, CAPTURE_LIMITS.output),
      actualOutput: clip(s.actualOutput, CAPTURE_LIMITS.output),
      errorMessage: clip(s.errorMessage, CAPTURE_LIMITS.errorMessage),
    })),
  };
}

async function readActiveProblem(): Promise<CapturedProblem> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  const resp = (await chrome.tabs.sendMessage(tab.id, {
    type: "capture_current_problem",
  })) as ContentResponse;
  if (resp.type !== "captured") {
    throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
  }
  return resp.data;
}

async function saveCapturedProblem(settings: ExtSettings, problem: CapturedProblem): Promise<CaptureResult> {
  const res = await fetch(`${settings.apiBaseUrl}/api/capture`, {
    method: "POST",
    headers: jsonHeaders(settings),
    body: JSON.stringify(trimCapturePayload(problem)),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as CaptureResult;
}

function pendingQuizKey(problemId: string) {
  return `ankify.pending.quiz.${problemId}`;
}

function pendingAiCardKey(problemId: string) {
  return `ankify.pending.aiCard.${problemId}`;
}

function pendingCandidateAiKey(problemId: string, cardId: string) {
  return `ankify.pending.aiCandidate.${problemId}.${cardId}`;
}

function readPendingOperation(key: string): PendingOperation | null {
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingOperation;
    if (!value?.id || !value.kind || !value.startedAt) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - value.startedAt > pendingOperationTtlMs(key)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function pendingOperationTtlMs(key: string) {
  return key.startsWith("ankify.pending.quiz.") ? QUIZ_PENDING_TTL_MS : AI_CARD_PENDING_TTL_MS;
}

function writePendingOperation(key: string, kind: string): PendingOperation {
  const operation: PendingOperation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    startedAt: Date.now(),
  };
  window.sessionStorage.setItem(key, JSON.stringify(operation));
  window.dispatchEvent(new CustomEvent(PENDING_OPERATION_EVENT, { detail: { key } }));
  return operation;
}

function clearPendingOperation(key: string) {
  window.sessionStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent(PENDING_OPERATION_EVENT, { detail: { key } }));
}

function isSessionNewerThanPending(session: QuizSession | null, pending: PendingOperation | null) {
  if (!session || !pending) return false;
  return new Date(session.createdAt).getTime() >= pending.startedAt - 1000;
}

function useElapsedSeconds(active: boolean, startedAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active || !startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (!active || !startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsedSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function apiErrorMessage(json: { error?: string; message?: string } | null, fallback: string) {
  return json?.message ?? json?.error ?? fallback;
}

function mergeCandidatePendingState(
  card: ApiCard,
  previous: LocalCandidate | undefined,
  problemId: string,
): Pick<LocalCandidate, "instruction" | "busy" | "localError"> {
  const pending = readPendingOperation(pendingCandidateAiKey(problemId, card.id));
  return {
    instruction: previous?.instruction ?? "",
    busy: pending ? "followup" : previous?.busy === "followup" ? null : previous?.busy ?? null,
    localError: previous?.localError ?? null,
  };
}

function applyThemePreference(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }
}

function parseSlugFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/leetcode\.com\/problems\/([^/?#]+)/);
  return m?.[1] ?? null;
}

function isDue(fsrsDue: string | null): boolean {
  if (!fsrsDue) return true;
  return new Date(fsrsDue).getTime() <= Date.now();
}

/** Compact interval: "10m", "1d", "3w", "2mo" */
function formatInterval(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "now";
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (ms < hr) return `${Math.max(1, Math.round(ms / min))}m`;
  if (ms < day) return `${Math.max(1, Math.round(ms / hr))}h`;
  if (ms < 30 * day) return `${Math.max(1, Math.round(ms / day))}d`;
  if (ms < 365 * day) return `${Math.round(ms / (30 * day))}mo`;
  return `${Math.round(ms / (365 * day))}y`;
}

async function fetchProblemBySlug(
  settings: ExtSettings,
  slug: string,
): Promise<{ problem: ApiProblem; cards: ApiCard[]; candidates: ApiCard[]; previews: Previews } | "not_captured"> {
  const res = await fetch(`${settings.apiBaseUrl}/api/problems/by-slug/${encodeURIComponent(slug)}`, {
    headers: authHeaders(settings),
  });
  if (res.status === 404) return "not_captured";
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as {
    problem: ApiProblem;
    cards: ApiCard[];
    candidates: ApiCard[];
    previews: Previews;
  };
}

/* ── Collapse (used only for ready cards) ── */

function Collapse({ header, defaultOpen, children }: { header: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="collapse">
      <button type="button" className="collapse-head" onClick={() => setOpen((v) => !v)}>
        <span className="collapse-chevron">{open ? "▾" : "▸"}</span>
        <span className="collapse-label">{header}</span>
      </button>
      <div className={`collapse-body scroll-area${open ? " collapse-body-open" : ""}`}>
        <div className="collapse-inner">{children}</div>
      </div>
    </div>
  );
}

/* ── Popup ── */

export function Popup() {
  const [state, setState] = useState<State>({ kind: "detecting" });
  const [sticky, setSticky] = useState<Sticky | null>(null);
  const [settings, setLocalSettings] = useState<ExtSettings | null>(null);
  const [tab, setTab] = useState<NavTab>("today");
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    chrome.storage.local.get("ankify.theme").then((r) => {
      const saved = r["ankify.theme"] as string | undefined;
      if (saved === "system" || saved === "dark" || saved === "light") {
        setTheme(saved);
        applyThemePreference(saved);
      }
    });
  }, []);

  function setThemePreference(next: ThemePreference) {
    setTheme(next);
    applyThemePreference(next);
    chrome.storage.local.set({ "ankify.theme": next });
  }

  function saveLocalSettings(next: Partial<ExtSettings>) {
    void setSettings(next);
    setLocalSettings((prev) => (prev ? { ...prev, ...next } : prev));
  }

  useEffect(() => {
    getSettings().then(setLocalSettings);
  }, []);

  // Tracks the slug we last initiated a detect for. Auto-triggered detects
  // (tab activation / URL update) skip when the slug hasn't changed so the
  // popup doesn't tear itself down to the "detecting" / "loading" placeholder
  // mid-action. The user-facing Refresh button passes `force: true` to bypass.
  const currentSlugRef = useRef<string | null>(null);
  const hasDetectedOnceRef = useRef(false);

  const detect = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!settings) return;
      const force = opts?.force ?? false;

      let activeUrl: string | undefined;
      let activeTabId: number | null = null;
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeUrl = activeTab?.url;
        activeTabId = activeTab?.id ?? null;
      } catch {
        // tab query can fail if the popup is closing; treat as no slug
      }
      const slug = parseSlugFromUrl(activeUrl);

      // Skip when this isn't the first detect, slug hasn't changed, and the
      // caller didn't explicitly force a refresh. Avoids tearing the UI down
      // every time LeetCode fires a "complete" tab event.
      if (!force && hasDetectedOnceRef.current && slug === currentSlugRef.current) {
        return;
      }
      hasDetectedOnceRef.current = true;
      currentSlugRef.current = slug;

      if (!slug) {
        setState({ kind: "off-page" });
        return;
      }

      setState({ kind: "loading", slug });
      try {
        const data = await fetchProblemBySlug(settings, slug);
        // User navigated away while we were fetching: discard the result.
        if (currentSlugRef.current !== slug) return;
        if (data === "not_captured") {
          setState({ kind: "not-saved", slug });
        } else {
          setState({ kind: "captured", ...data });
          // Pin the latest captured problem so we can keep showing it if the
          // user switches to a non-LeetCode tab next.
          setSticky({ slug, tabId: activeTabId, ...data });
        }
      } catch (e) {
        if (currentSlugRef.current !== slug) return;
        setState({ kind: "error", msg: e instanceof Error ? e.message : getExtText(settings).common.unknownError });
      }
    },
    [settings],
  );

  useEffect(() => {
    if (settings) void detect();
  }, [settings, detect]);

  /* Side Panel persists across tab changes — re-detect on tab swap or real
   * URL change. We deliberately ignore `info.status === "complete"` because
   * LeetCode's SPA fires it on every internal load even when the slug is
   * unchanged, and the slug-equality guard inside `detect()` would skip the
   * work anyway — listening to `info.url` keeps the listener noise low too. */
  useEffect(() => {
    if (!settings) return;
    const onActivated = () => void detect();
    const onUpdated = (_tabId: number, info: chrome.tabs.TabChangeInfo, t: chrome.tabs.Tab) => {
      if (!t.active) return;
      if (info.url) void detect();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [settings, detect]);

  const captured = state.kind === "captured" ? state : null;
  const text = settings ? getExtText(settings) : EXT_I18N.en;

  // Jump back to the LeetCode tab where the sticky problem was last seen.
  // Falls back to any open tab on that slug if the original tab is gone, or
  // opens a fresh tab as a last resort. Force-detect after to refresh.
  const jumpToSticky = useCallback(async () => {
    if (!sticky) return;
    const targetUrl = `https://leetcode.com/problems/${sticky.slug}/`;
    try {
      if (sticky.tabId != null) {
        const tab = await chrome.tabs.get(sticky.tabId).catch(() => null);
        if (tab) {
          await chrome.tabs.update(sticky.tabId, { active: true });
          if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
          return;
        }
      }
      const matches = await chrome.tabs.query({ url: `*://leetcode.com/problems/${sticky.slug}/*` });
      if (matches.length > 0 && matches[0]?.id != null) {
        await chrome.tabs.update(matches[0].id, { active: true });
        if (matches[0].windowId != null) await chrome.windows.update(matches[0].windowId, { focused: true });
        return;
      }
      await chrome.tabs.create({ url: targetUrl });
    } catch {
      // chrome.tabs.update can reject if the tab was just closed mid-call; ignore
    }
  }, [sticky]);

  return (
    <div className="popup-shell">
      {/* Nav */}
      <nav className="popup-nav">
        <div className="popup-nav-tabs">
          {(["today", "problem", "settings"] as NavTab[]).map((navTab) => (
            <button
              key={navTab}
              type="button"
              className="popup-nav-tab"
              data-active={tab === navTab}
              onClick={() => setTab(navTab)}
            >
              {text.nav[navTab]}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="popup-main">
        {tab === "today" && settings && (
          <div className="tab-pane" key="today">
            <TodayTab
              settings={settings}
              onJumpToProblem={() => setTab("problem")}
            />
          </div>
        )}

        {tab === "problem" && settings && (
          <div className="tab-pane" key="problem">
            <ProblemTab
              state={state}
              settings={settings}
              captured={captured}
              sticky={sticky}
              onJumpToSticky={jumpToSticky}
              onRefresh={() => detect({ force: true })}
              onError={(msg) => setState({ kind: "error", msg })}
            />
          </div>
        )}

        {tab === "settings" && settings && (
          <div className="tab-pane" key="settings">
            <SettingsTab
              settings={settings}
              theme={theme}
              onThemeChange={setThemePreference}
              onSave={saveLocalSettings}
            />
          </div>
        )}
      </main>
    </div>
  );
}

/* ── TodayTab ── */

function TodayTab({
  settings,
  onJumpToProblem,
}: {
  settings: ExtSettings;
  onJumpToProblem: () => void;
}) {
  const t = getExtText(settings);
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/review/queue?limit=20`, {
        headers: authHeaders(settings),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(apiErrorMessage(j, `HTTP ${res.status}`));
      }
      setData((await res.json()) as QueueResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedLoad);
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Refresh on focus + every 30s. */
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [load]);

  async function jumpToProblem(p: QueueProblem) {
    const url = p.url || `https://leetcode.com/problems/${p.leetcodeSlug}/`;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id != null) {
        await chrome.tabs.update(activeTab.id, { url });
      } else {
        await chrome.tabs.create({ url });
      }
      onJumpToProblem();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.unknownError);
    }
  }

  if (loading && !data) return <p className="popup-muted">{t.common.loadingQueue}</p>;

  if (error) {
    return (
      <div className="stack">
        <div className="err-banner">{error}</div>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          {t.common.retry}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { queue, problems } = data;
  const limit = queue.dailyReviewLimit;
  const progressPct = limit > 0 ? Math.min(100, Math.round((queue.doneToday / limit) * 100)) : 0;

  return (
    <div className="stack">
      <div className="panel today-stats">
        <div className="today-stats-row">
          <div>
            <div className="today-stats-num">
              {queue.doneToday}
              <span className="today-stats-num-soft"> / {limit || "∞"}</span>
            </div>
            <div className="today-stats-label">{t.common.reviewsToday}</div>
          </div>
          <div className="today-stats-side">
            <div>
              <span className="today-stats-pillval">{queue.dueCount}</span>
              <span className="today-stats-pilllabel"> {t.common.due}</span>
            </div>
            <div>
              <span className="today-stats-pillval">{queue.remaining}</span>
              <span className="today-stats-pilllabel"> {t.common.leftToday}</span>
            </div>
          </div>
        </div>
        {limit > 0 && (
          <div className="today-progress">
            <div className="today-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      {problems.length === 0 ? (
        <div className="panel panel-quiet">
          <p className="popup-muted" style={{ margin: 0, textAlign: "center" }}>
            {queue.remaining === 0
              ? t.today.limitReached
              : queue.totalDue === 0
                ? t.today.allCaughtUp
                : t.today.noQueue}
          </p>
        </div>
      ) : (
        <div className="problem-list">
          <div className="section-label">{t.today.dueNow}</div>
          {problems.map((p) => (
            <button
              key={p.id}
              type="button"
              className="problem-list-item"
              onClick={() => void jumpToProblem(p)}
            >
              <div className="problem-list-item-row">
                <span className="problem-list-item-title">{p.title}</span>
                <span className={`pill pill-${p.difficulty.toLowerCase()}`}>{difficultyLabel(p.difficulty, t)}</span>
              </div>
              <div className="problem-list-item-meta">
                <span className="pill pill-state">{fsrsLabel(p.fsrsState, t)}</span>
                <span>{t.common.cards(p.cardCount)}</span>
                {p.fsrsStability != null && <span>{t.today.stability} {p.fsrsStability.toFixed(1)}d</span>}
                {p.fsrsLapses > 0 && <span>{t.common.lapses(p.fsrsLapses)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <a
        href={`${settings.apiBaseUrl}/review`}
        target="_blank"
        rel="noreferrer"
        className="hero-link"
      >
        {t.common.openFullReview}
      </a>
    </div>
  );
}

/* ── ProblemTab ── */

function ProblemTab({
  state,
  settings,
  captured,
  sticky,
  onJumpToSticky,
  onRefresh,
  onError,
}: {
  state: State;
  settings: ExtSettings;
  captured: {
    problem: ApiProblem;
    cards: ApiCard[];
    candidates: ApiCard[];
    previews: Previews;
  } | null;
  sticky: Sticky | null;
  onJumpToSticky: () => void;
  onRefresh: () => void;
  onError: (msg: string) => void;
}) {
  const t = getExtText(settings);
  const [mode, setMode] = useState<"review" | "manage">("review");
  const [syncState, setSyncState] = useState<{
    busy: boolean;
    message: string | null;
    tone: "success" | "error";
  }>({ busy: false, message: null, tone: "success" });
  const lastProblemIdRef = useRef<string | null>(null);

  // When the active tab has no slug but we have a sticky pin from earlier,
  // keep showing that problem instead of the bare "off-page" placeholder.
  const isStickyView = state.kind === "off-page" && sticky !== null;
  const displayCaptured = captured ?? (isStickyView ? sticky : null);

  // Auto-select mode when problem changes: due → review, otherwise → manage
  useEffect(() => {
    if (!displayCaptured) return;
    const newId = displayCaptured.problem.id;
    if (lastProblemIdRef.current !== newId) {
      setMode(isDue(displayCaptured.problem.fsrsDue) ? "review" : "manage");
      setSyncState({ busy: false, message: null, tone: "success" });
      lastProblemIdRef.current = newId;
    }
  }, [displayCaptured]);

  async function syncLatestSubmissions() {
    if (!displayCaptured || syncState.busy) return;

    setSyncState({ busy: true, message: null, tone: "success" });
    try {
      const capturedProblem = await readActiveProblem();
      if (capturedProblem.leetcodeSlug !== displayCaptured.problem.leetcodeSlug) {
        throw new Error(`Active tab is ${capturedProblem.leetcodeSlug}, not ${displayCaptured.problem.leetcodeSlug}.`);
      }
      const result = await saveCapturedProblem(settings, capturedProblem);
      setSyncState({
        busy: false,
        message:
          result.importedSubmissions === 1
            ? t.problem.syncOne
            : result.importedSubmissions > 1
              ? t.problem.syncMany(result.importedSubmissions)
              : t.problem.upToDate,
        tone: "success",
      });
      onRefresh();
    } catch (e) {
      setSyncState({
        busy: false,
        message: e instanceof Error ? e.message : t.problem.syncFailed,
        tone: "error",
      });
    }
  }

  if (state.kind === "detecting") return <p className="popup-muted">{t.problem.connecting}</p>;
  if (state.kind === "loading") return <p className="popup-muted">{t.problem.syncing(state.slug)}</p>;

  if (state.kind === "off-page" && !sticky) {
    return (
      <div className="panel panel-quiet">
        <p className="popup-muted" style={{ margin: 0 }}>
          {t.problem.offPage}
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="stack">
        <div className="err-banner">{state.msg}</div>
        <button type="button" onClick={onRefresh} className="btn btn-primary">
          {t.common.retry}
        </button>
      </div>
    );
  }

  if (state.kind === "not-saved") {
    return (
      <CaptureView
        slug={state.slug}
        settings={settings}
        onCaptured={onRefresh}
        onError={onError}
      />
    );
  }

  if (!displayCaptured) return null;

  const { problem, cards, candidates, previews } = displayCaptured;
  const due = isDue(problem.fsrsDue);

  return (
    <>
      {isStickyView && (
        <div className="sticky-banner">
          <span className="sticky-banner-text">
            {t.problem.activeTabNotOn(problem.title)}
          </span>
          <button type="button" className="btn btn-primary btn-inline" onClick={onJumpToSticky}>
            {t.problem.openIt}
          </button>
        </div>
      )}
      {mode === "review" ? (
    <ReviewView
      problem={problem}
      cards={cards}
      previews={previews}
      settings={settings}
      due={due}
      mode={mode}
      onModeChange={setMode}
      onSync={syncLatestSubmissions}
      syncBusy={syncState.busy}
      syncMessage={syncState.message}
      syncTone={syncState.tone}
      canSync={!isStickyView}
      onRefresh={onRefresh}
      onRated={onRefresh}
    />
  ) : (
    <ManageView
      problem={problem}
      cards={cards}
      candidates={candidates}
      settings={settings}
      due={due}
      mode={mode}
      onModeChange={setMode}
      onSync={syncLatestSubmissions}
      syncBusy={syncState.busy}
      syncMessage={syncState.message}
      syncTone={syncState.tone}
      canSync={!isStickyView}
      onRefresh={onRefresh}
    />
  )}
    </>
  );
}

/* ── ProblemCard (Module 1: context + mode toggle) ── */

function ProblemCard({
  problem,
  settings,
  due,
  mode,
  onModeChange,
  onSync,
  syncBusy,
  syncMessage,
  syncTone,
  canSync,
}: {
  problem: ApiProblem;
  settings: ExtSettings;
  due: boolean;
  mode: "review" | "manage";
  onModeChange: (m: "review" | "manage") => void;
  onSync: () => void;
  syncBusy: boolean;
  syncMessage: string | null;
  syncTone: "success" | "error";
  canSync: boolean;
}) {
  const t = getExtText(settings);
  return (
    <div className="problem-card">
      <div className="problem-card-top">
        <div className="problem-card-info">
          <h2 className="problem-card-title">
            {problem.leetcodeId != null && (
              <span className="problem-card-num">{problem.leetcodeId}. </span>
            )}
            {problem.title}
          </h2>
          <div className="problem-card-tags">
            <span className={`pill pill-${problem.difficulty.toLowerCase()}`}>{difficultyLabel(problem.difficulty, t)}</span>
            {due ? (
              <span className="pill pill-due">{t.common.due}</span>
            ) : (
              <span className="problem-card-next">{t.problem.next} {formatInterval(problem.fsrsDue)}</span>
            )}
          </div>
        </div>
        <div className="problem-card-actions">
          <button
            type="button"
            className="problem-header-web"
            title={t.problem.syncTitle}
            aria-label={t.problem.syncTitle}
            disabled={!canSync || syncBusy}
            onClick={onSync}
          >
            {syncBusy ? "…" : "↻"}
          </button>
          <a
            href={`${settings.apiBaseUrl}/problems/${problem.id}`}
            target="_blank"
            rel="noreferrer"
            className="problem-header-web"
            title={t.problem.openWeb}
            aria-label={t.problem.openWeb}
          >
            ↗
          </a>
        </div>
      </div>
      {syncMessage && <div className={`problem-card-sync problem-card-sync-${syncTone}`}>{syncMessage}</div>}
      <div className="problem-card-mode">
        <button
          type="button"
          className={`problem-card-mode-btn${mode === "review" ? " active" : ""}`}
          onClick={() => onModeChange("review")}
        >
          {t.problem.review}
        </button>
        <button
          type="button"
          className={`problem-card-mode-btn${mode === "manage" ? " active" : ""}`}
          onClick={() => onModeChange("manage")}
        >
          {t.problem.manage}
        </button>
      </div>
    </div>
  );
}

/* ── ReviewView ── */

function ReviewView({
  problem,
  cards,
  previews,
  settings,
  due,
  mode,
  onModeChange,
  onSync,
  syncBusy,
  syncMessage,
  syncTone,
  canSync,
  onRefresh,
  onRated,
}: {
  problem: ApiProblem;
  cards: ApiCard[];
  previews: Previews;
  settings: ExtSettings;
  due: boolean;
  mode: "review" | "manage";
  onModeChange: (m: "review" | "manage") => void;
  onSync: () => void;
  syncBusy: boolean;
  syncMessage: string | null;
  syncTone: "success" | "error";
  canSync: boolean;
  onRefresh: () => void;
  onRated: () => void;
}) {
  const t = getExtText(settings);
  const [view, setView] = useState<"quiz" | "card" | "notes">("quiz");

  return (
    <div className="review-workspace">
      {/* Module 1 — problem context */}
      <ProblemCard
        problem={problem}
        settings={settings}
        due={due}
        mode={mode}
        onModeChange={onModeChange}
        onSync={onSync}
        syncBusy={syncBusy}
        syncMessage={syncMessage}
        syncTone={syncTone}
        canSync={canSync}
      />

      {/* Module 2 — content */}
      <div className="content-card">
        <div className="content-card-tabs">
          {(["quiz", "card", "notes"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="content-card-tab"
              data-active={view === v}
              onClick={() => setView(v)}
            >
              {v === "quiz" ? t.review.quiz : v === "card" ? t.review.cards : t.review.notes}
            </button>
          ))}
        </div>

        <div className="review-stage-body">
          {view === "quiz" && (
            <div className="review-stage-pane tab-pane" key="quiz">
              <QuizPanel
                problem={problem}
                settings={settings}
                onRefresh={onRefresh}
              />
            </div>
          )}

          {view === "card" && (
            <div className="review-stage-pane tab-pane" key="card">
              {cards.length === 0 ? (
                <div className="review-empty">
                  <p className="popup-muted" style={{ margin: 0, marginBottom: 12, textAlign: "center" }}>
                    {t.review.noCards}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onModeChange("manage")}
                  >
                    {t.review.goManage}
                  </button>
                </div>
              ) : (
                <CardFlipper cards={cards} />
              )}
            </div>
          )}

          {view === "notes" && (
            <div className="review-stage-pane tab-pane" key="notes">
              <NotesPanel problem={problem} settings={settings} />
            </div>
          )}
        </div>
      </div>

      {/* Module 3 — rating */}
      {due && (
        <div className="rating-card">
          <QuickRate
            problemId={problem.id}
            previews={previews}
            settings={settings}
            onRated={onRated}
          />
        </div>
      )}
    </div>
  );
}

/* ── QuizPanel ── */

function QuizPanel({ problem, settings, onRefresh }: { problem: ApiProblem; settings: ExtSettings; onRefresh: () => void }) {
  const t = getExtText(settings);
  const [session, setSession] = useState<QuizSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pendingQuiz, setPendingQuiz] = useState<PendingOperation | null>(null);
  const [submittingItem, setSubmittingItem] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ item: QuizItem; answer: QuizAnswer } | null>(null);
  const [savedItemIds, setSavedItemIds] = useState<Set<string>>(new Set());
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savingMissed, setSavingMissed] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingElapsedSeconds = useElapsedSeconds(Boolean(pendingQuiz), pendingQuiz?.startedAt ?? null);

  const refreshPendingQuiz = useCallback(() => {
    const pending = readPendingOperation(pendingQuizKey(problem.id));
    setPendingQuiz(pending);
    setGenerating(Boolean(pending));
    return pending;
  }, [problem.id]);

  const loadSession = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    setFeedback(null);
    setSavedItemIds(new Set());
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz`, {
        headers: authHeaders(settings),
      });
      const json = (await res.json().catch(() => null)) as { session?: QuizSession | null; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const nextSession = json?.session ?? null;
      const pending = readPendingOperation(pendingQuizKey(problem.id));
      if (isSessionNewerThanPending(nextSession, pending) && nextSession?.status === "active") {
        clearPendingOperation(pendingQuizKey(problem.id));
        setPendingQuiz(null);
        setGenerating(false);
      } else {
        setPendingQuiz(pending);
        setGenerating(Boolean(pending));
      }
      const pendingFeedback = getStoredQuizFeedback(problem.id, nextSession);
      setSession(nextSession);
      setFeedback(pendingFeedback);
      setCurrentIndex(pendingFeedback ? getQuizItemIndex(nextSession, pendingFeedback.item.id) : getFirstUnansweredQuizIndex(nextSession));
      setSavingMissed(false);
      setShowResults(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedLoad);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [problem.id, settings]);

  useEffect(() => {
    refreshPendingQuiz();
    void loadSession();
  }, [loadSession, refreshPendingQuiz]);

  useEffect(() => {
    const key = pendingQuizKey(problem.id);
    const handlePendingChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && detail.key !== key) return;
      refreshPendingQuiz();
    };
    window.addEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
    return () => window.removeEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
  }, [problem.id, refreshPendingQuiz]);

  useEffect(() => {
    if (!pendingQuiz) return;
    const timer = window.setInterval(() => {
      const pending = readPendingOperation(pendingQuizKey(problem.id));
      if (!pending) {
        setPendingQuiz(null);
        setGenerating(false);
        setError(t.quiz.timedOut);
        return;
      }
      void loadSession({ silent: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadSession, pendingQuiz, problem.id]);

  async function generateQuiz(action: "generate" | "regenerate" | "nextBatch") {
    const pendingKey = pendingQuizKey(problem.id);
    const operation = writePendingOperation(pendingKey, action);
    setPendingQuiz(operation);
    setGenerating(true);
    setError(null);
    setFeedback(null);
    setShowResults(false);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ action }),
      });
      const json = (await res.json().catch(() => null)) as {
        session?: QuizSession;
        error?: string;
        message?: string;
      } | null;
      if (!res.ok || !json?.session) throw new Error(apiErrorMessage(json, `HTTP ${res.status}`));
      if (session) clearStoredQuizFeedback(problem.id, session.id);
      clearStoredQuizFeedback(problem.id, json.session.id);
      clearPendingOperation(pendingKey);
      setPendingQuiz(null);
      setSession(json.session);
      setSavedItemIds(new Set());
      setCurrentIndex(getFirstUnansweredQuizIndex(json.session));
    } catch (e) {
      clearPendingOperation(pendingKey);
      setPendingQuiz(null);
      setError(e instanceof Error ? e.message : t.quiz.failedGenerate);
    } finally {
      setGenerating(false);
    }
  }

  async function resetHistory() {
    if (!window.confirm(t.quiz.resetConfirm)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz`, {
        method: "DELETE",
        headers: authHeaders(settings),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      if (session) clearStoredQuizFeedback(problem.id, session.id);
      clearPendingOperation(pendingQuizKey(problem.id));
      setPendingQuiz(null);
      setSession(null);
      setSavedItemIds(new Set());
      setFeedback(null);
      setCurrentIndex(0);
      setShowResults(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedReset);
    }
  }

  async function submitAnswer(item: QuizItem, selectedIndex: number) {
    if (!session || isQuizItemAnswered(session, item.id) || submittingItem) return;
    setSubmittingItem(true);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz/${session.id}`, {
        method: "PATCH",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ itemId: item.id, selectedIndex }),
      });
      if (res.status === 409) {
        setError(t.quiz.changed);
        await loadSession({ silent: true });
        return;
      }
      const json = (await res.json().catch(() => null)) as {
        session?: QuizSession;
        item?: QuizItem;
        answer?: QuizAnswer;
        error?: string;
      } | null;
      if (!res.ok || !json?.session || !json.item || !json.answer) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setSession(json.session);
      storeQuizFeedback(problem.id, json.session.id, json.item.id);
      setFeedback({ item: json.item, answer: json.answer });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedSubmit);
    } finally {
      setSubmittingItem(false);
    }
  }

  async function saveAsCard(item: QuizItem) {
    if (!session) return;
    setSavingItemId(item.id);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/quiz/${session.id}/save-card`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ itemId: item.id }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSavedItemIds((prev) => new Set(prev).add(item.id));
      void onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.quiz.failedSave);
    } finally {
      setSavingItemId(null);
    }
  }

  async function saveMissedAsCards() {
    if (!session || savingMissed) return;
    const missedItems = getMissedQuizItems(session).filter((item) => !savedItemIds.has(item.id));
    if (missedItems.length === 0) return;
    setSavingMissed(true);
    try {
      for (const item of missedItems) {
        await saveAsCard(item);
      }
    } finally {
      setSavingMissed(false);
    }
  }

  function goNext() {
    if (!session) return;
    if (feedback) clearStoredQuizFeedback(problem.id, session.id);
    setFeedback(null);
    setCurrentIndex(getNextUnansweredQuizIndex(session, currentIndex));
  }

  function goToQuestion(index: number) {
    if (!session) return;
    if (feedback) clearStoredQuizFeedback(problem.id, session.id);
    setFeedback(null);
    setCurrentIndex(clampNumber(index, 0, session.itemsJson.length - 1));
  }

  if (loading) {
    return <div className="quiz-empty"><p className="popup-muted">{t.quiz.loading}</p></div>;
  }

  if (pendingQuiz) {
    return (
      <div className="quiz-empty">
        <div className="quiz-pending-bar"><span /></div>
        <div className="quiz-empty-title">{t.quiz.generating}</div>
        <p className="popup-muted">{t.quiz.switchHint}</p>
        <div className="quiz-pending-timer">{t.quiz.pendingTimer(formatElapsedSeconds(pendingElapsedSeconds))}</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="quiz-empty">
        <div className="quiz-empty-kicker">{t.review.quiz}</div>
        <div className="quiz-empty-title">{t.quiz.noQuiz}</div>
        <p className="popup-muted">{t.quiz.noQuizBody}</p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={generating}
          onClick={() => void generateQuiz("generate")}
        >
          {generating ? t.quiz.generating : t.quiz.generate}
        </button>
        {error && <div className="err-banner quiz-error">{error}</div>}
      </div>
    );
  }

  if (session.status === "completed" && !feedback) {
    const suggested = getSuggestedRating(session.score ?? 0, t);
    const missedItems = getMissedQuizItems(session);
    const unsavedMissedCount = missedItems.filter((item) => !savedItemIds.has(item.id)).length;
    const accuracy = Math.round(((session.score ?? 0) / Math.max(1, session.itemsJson.length)) * 100);
    const scopeBreakdown = getQuizBreakdown(session, "scope", t);
    const sourceBreakdown = getQuizBreakdown(session, "source", t);
    const missedScopes = Array.from(new Set(missedItems.map((item) => item.scope))).map((scope) => quizScopeLabel(scope, t));
    return (
      <div className="quiz-panel">
        <div className="quiz-results scroll-area">
          <div className="quiz-overview-card">
            <div className="quiz-overview-main">
              <div className="quiz-score-card">
                <div className="quiz-score-value">
                  {session.score ?? 0}<span>/{session.itemsJson.length}</span>
                </div>
                <div className="quiz-score-label">{accuracy}% · {suggested.label}</div>
              </div>
              <div className="quiz-overview-copy">
                <div className="quiz-overview-title">{t.quiz.batchComplete}</div>
                <div className="quiz-overview-meta">
                  {missedItems.length === 0 ? t.quiz.noMisses : t.quiz.missed(missedItems.length)} · {t.quiz.coverageBalanced}
                </div>
              </div>
              <div className="quiz-overview-actions">
                <button
                  type="button"
                  className="quiz-link-btn quiz-link-muted"
                  disabled={generating}
                  onClick={() => void resetHistory()}
                  title={t.quiz.resetConfirm}
                >
                  {t.quiz.reset}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-inline quiz-next-batch"
                  disabled={generating}
                  onClick={() => void generateQuiz("nextBatch")}
                >
                  {generating ? t.quiz.generating : t.quiz.newBatch}
                </button>
              </div>
            </div>

            <div className="quiz-overview-rows">
              <QuizBreakdown label={t.quiz.scope} items={scopeBreakdown} />
              <QuizBreakdown label={t.quiz.source} items={sourceBreakdown} />
            </div>

            <div className="quiz-missed-row">
              <div>
                <span className="quiz-missed-label">{t.quiz.missedLabel}</span>
                <span>{missedScopes.length > 0 ? missedScopes.join(" · ") : t.quiz.none}</span>
              </div>
              <button
                type="button"
                className="quiz-missed-save"
                disabled={unsavedMissedCount === 0 || savingMissed}
                onClick={() => void saveMissedAsCards()}
              >
                {savingMissed ? t.quiz.creating : unsavedMissedCount === 0 ? t.quiz.cardsSaved : t.quiz.createCards}
                {unsavedMissedCount > 0 && !savingMissed && <span>{unsavedMissedCount}</span>}
              </button>
            </div>
          </div>

          <div className="quiz-review-toggle-wrap">
            <button type="button" className="quiz-review-toggle" onClick={() => setShowResults((value) => !value)}>
              <span>{showResults ? t.quiz.hideQuiz : t.quiz.reviewQuiz}</span>
              <span>{showResults ? t.quiz.hideAnswers : t.quiz.expandQuestions}</span>
            </button>
          </div>
          {showResults && session.itemsJson.map((item, index) => {
            const answer = session.answersJson.find((a) => a.itemId === item.id) ?? null;
            const correctChoice = item.choices[item.answerIndex] ?? "";
            const selectedChoice = answer ? item.choices[answer.selectedIndex] : null;
            const saved = savedItemIds.has(item.id);
            const saving = savingItemId === item.id;
            return (
              <div key={item.id} className="quiz-result-item">
                <div className="quiz-result-meta">
                  <span>{t.quiz.question(index + 1, session.itemsJson.length)}</span>
                  <span className={answer?.correct ? "quiz-ok" : "quiz-bad"}>
                    {answer?.correct ? t.quiz.correct : t.quiz.incorrect}
                  </span>
                </div>
                <div className="quiz-result-tags">
                  <span>{quizSourceLabel(item.source, t)}</span>
                  <span>{quizScopeLabel(item.scope, t)}</span>
                </div>
                <PopupMarkdown>{formatQuizMarkdown(item.question)}</PopupMarkdown>
                {selectedChoice && (
                  <div className="quiz-result-line">
                    {t.quiz.yourAnswer} <PopupMarkdown className="popup-md-inline">{formatQuizMarkdown(selectedChoice)}</PopupMarkdown>
                  </div>
                )}
                <div className="quiz-result-line">
                  {t.quiz.correctAnswer} <PopupMarkdown className="popup-md-inline">{formatQuizMarkdown(correctChoice)}</PopupMarkdown>
                </div>
                <PopupMarkdown>{formatQuizMarkdown(item.explanation)}</PopupMarkdown>
                <button
                  type="button"
                  className={`quiz-result-save${saved ? " is-saved" : ""}`}
                  disabled={saved || saving}
                  onClick={() => void saveAsCard(item)}
                >
                  {saved ? t.quiz.saved : saving ? t.quiz.saving : t.quiz.save}
                </button>
              </div>
            );
          })}
        </div>
        {error && <div className="err-banner quiz-error">{error}</div>}
      </div>
    );
  }

  const item = session.itemsJson[currentIndex] ?? session.itemsJson[0];
  if (!item) {
    return (
      <div className="quiz-empty">
        <p className="popup-muted">{t.quiz.noQuestions}</p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={generating}
          onClick={() => void generateQuiz("regenerate")}
        >
          {generating ? t.quiz.regenerating : t.quiz.regenerate}
        </button>
      </div>
    );
  }

  const answeredCount = session.answersJson.length;
  const activeAnswer = session.answersJson.find((answer) => answer.itemId === item.id) ?? null;
  const activeFeedback = feedback?.item.id === item.id ? feedback : activeAnswer ? { item, answer: activeAnswer } : null;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < session.itemsJson.length - 1;
  const progressPct = Math.max(8, (answeredCount / session.itemsJson.length) * 100);

  return (
    <div className="quiz-panel">
      <div className="quiz-panel-head">
        <div>
          <div className="quiz-head-title">{t.quiz.question(currentIndex + 1, session.itemsJson.length)}</div>
          <div className="quiz-head-meta">{t.quiz.answered(answeredCount, session.itemsJson.length)}</div>
          <div className="quiz-progress"><span style={{ width: `${progressPct}%` }} /></div>
        </div>
        <div className="quiz-nav-row">
          <button
            type="button"
            className="quiz-link-btn"
            disabled={!canGoPrev}
            onClick={() => goToQuestion(currentIndex - 1)}
          >
            {t.quiz.prev}
          </button>
          <button
            type="button"
            className="quiz-link-btn"
            disabled={!canGoNext}
            onClick={() => goToQuestion(currentIndex + 1)}
          >
            {t.quiz.next}
          </button>
          <button
            type="button"
            className="quiz-link-btn quiz-link-muted"
            disabled={generating}
            onClick={() => void generateQuiz("regenerate")}
          >
            {t.quiz.regenerate}
          </button>
          <button
            type="button"
            className="quiz-link-btn quiz-link-muted"
            disabled={generating}
            onClick={() => void resetHistory()}
            title={t.quiz.resetConfirm}
          >
            {t.quiz.reset}
          </button>
        </div>
      </div>
      <div className="quiz-active scroll-area">
        <div className="quiz-question">
          <PopupMarkdown>{formatQuizMarkdown(item.question)}</PopupMarkdown>
        </div>
        <div className="quiz-choices">
          {item.choices.map((choice, index) => {
            const wasSelected = activeFeedback?.answer.selectedIndex === index;
            const isCorrect = activeFeedback && item.answerIndex === index;
            return (
              <button
                key={index}
                type="button"
                disabled={!!activeFeedback || submittingItem}
                onClick={() => void submitAnswer(item, index)}
                className={`quiz-choice${isCorrect ? " is-correct" : ""}${activeFeedback && wasSelected && !isCorrect ? " is-wrong" : ""}`}
              >
                <span className="quiz-choice-letter">{String.fromCharCode(65 + index)}</span>
                <PopupMarkdown>{formatQuizMarkdown(choice)}</PopupMarkdown>
              </button>
            );
          })}
        </div>
        {activeFeedback ? (
          <div className={`quiz-feedback${activeFeedback.answer.correct ? " is-correct" : " is-wrong"}`}>
            <div className="quiz-feedback-head">
              <div className="quiz-feedback-title">{activeFeedback.answer.correct ? t.quiz.correct : t.quiz.wrong}</div>
              <span>{quizSourceLabel(item.source, t)} · {quizScopeLabel(item.scope, t)}</span>
            </div>
            <div className="quiz-feedback-body">
              <PopupMarkdown>{formatQuizMarkdown(item.explanation)}</PopupMarkdown>
            </div>
            <div className="quiz-actions">
              <button
                type="button"
                className="quiz-save-btn"
                disabled={savedItemIds.has(item.id) || savingItemId === item.id}
                onClick={() => void saveAsCard(item)}
              >
                {savedItemIds.has(item.id) ? t.quiz.saved : savingItemId === item.id ? t.quiz.saving : t.quiz.save}
              </button>
              <button type="button" className="btn btn-primary btn-inline" onClick={goNext}>
                {session.status === "completed" ? t.quiz.results : t.quiz.next}
              </button>
            </div>
          </div>
        ) : (
          <div className="quiz-hint-row">
            <p className="quiz-hint">{submittingItem ? t.quiz.checking : t.quiz.answerHint}</p>
            {answeredCount < session.itemsJson.length && !canGoNext && (
              <button type="button" className="quiz-link-btn" onClick={() => goToQuestion(getFirstUnansweredQuizIndex(session))}>
                {t.quiz.firstUnanswered}
              </button>
            )}
          </div>
        )}
        {error && <div className="err-banner quiz-error">{error}</div>}
      </div>
    </div>
  );
}

function getFirstUnansweredQuizIndex(session: QuizSession | null) {
  if (!session) return 0;
  const idx = session.itemsJson.findIndex((item) => !session.answersJson.some((answer) => answer.itemId === item.id));
  return idx === -1 ? 0 : idx;
}

function getNextUnansweredQuizIndex(session: QuizSession, currentIndex: number) {
  const afterCurrent = session.itemsJson.findIndex((item, index) => index > currentIndex && !isQuizItemAnswered(session, item.id));
  if (afterCurrent !== -1) return afterCurrent;
  return getFirstUnansweredQuizIndex(session);
}

function isQuizItemAnswered(session: QuizSession, itemId: string) {
  return session.answersJson.some((answer) => answer.itemId === itemId);
}

function getQuizItemIndex(session: QuizSession | null, itemId: string) {
  if (!session) return 0;
  const idx = session.itemsJson.findIndex((item) => item.id === itemId);
  return idx === -1 ? getFirstUnansweredQuizIndex(session) : idx;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function quizFeedbackStorageKey(problemId: string, sessionId: string) {
  return `ankify.quiz.pendingFeedback.${problemId}.${sessionId}`;
}

function storeQuizFeedback(problemId: string, sessionId: string, itemId: string) {
  window.sessionStorage.setItem(quizFeedbackStorageKey(problemId, sessionId), itemId);
}

function clearStoredQuizFeedback(problemId: string, sessionId: string) {
  window.sessionStorage.removeItem(quizFeedbackStorageKey(problemId, sessionId));
}

function getStoredQuizFeedback(problemId: string, session: QuizSession | null) {
  if (!session) return null;
  const itemId = window.sessionStorage.getItem(quizFeedbackStorageKey(problemId, session.id));
  if (!itemId) return null;
  const item = session.itemsJson.find((quizItem) => quizItem.id === itemId);
  const answer = session.answersJson.find((quizAnswer) => quizAnswer.itemId === itemId);
  if (!item || !answer) {
    clearStoredQuizFeedback(problemId, session.id);
    return null;
  }
  return { item, answer };
}

function QuizBreakdown({ label, items }: { label: string; items: { label: string; count: number }[] }) {
  return (
    <div className="quiz-breakdown-row">
      <span className="quiz-breakdown-label">{label}</span>
      <div className="quiz-breakdown">
        {items.map((item) => (
          <span key={item.label}>{item.label} <b>{item.count}</b></span>
        ))}
      </div>
    </div>
  );
}

function getMissedQuizItems(session: QuizSession) {
  return session.itemsJson.filter((item) => {
    const answer = session.answersJson.find((a) => a.itemId === item.id);
    return answer && !answer.correct;
  });
}

function getQuizBreakdown(session: QuizSession, field: "scope" | "source", t: ReturnType<typeof getExtText>) {
  const counts = new Map<string, number>();
  session.itemsJson.forEach((item) => {
    const key = field === "scope" ? quizScopeLabel(item.scope, t) : quizSourceLabel(item.source, t);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

function getSuggestedRating(score: number, t: ReturnType<typeof getExtText>): { rating: FsrsRating; label: string } {
  if (score <= 1) return { rating: 1, label: t.rating.again };
  if (score === 2) return { rating: 2, label: t.rating.hard };
  if (score <= 4) return { rating: 3, label: t.rating.good };
  return { rating: 4, label: t.rating.easy };
}

/* ── ManageView ── */

function ManageView({
  problem,
  cards,
  candidates,
  settings,
  due,
  mode,
  onModeChange,
  onSync,
  syncBusy,
  syncMessage,
  syncTone,
  canSync,
  onRefresh,
}: {
  problem: ApiProblem;
  cards: ApiCard[];
  candidates: ApiCard[];
  settings: ExtSettings;
  due: boolean;
  mode: "review" | "manage";
  onModeChange: (m: "review" | "manage") => void;
  onSync: () => void;
  syncBusy: boolean;
  syncMessage: string | null;
  syncTone: "success" | "error";
  canSync: boolean;
  onRefresh: () => void;
}) {
  const t = getExtText(settings);
  return (
    <div className="stack">
      <ProblemCard
        problem={problem}
        settings={settings}
        due={due}
        mode={mode}
        onModeChange={onModeChange}
        onSync={onSync}
        syncBusy={syncBusy}
        syncMessage={syncMessage}
        syncTone={syncTone}
        canSync={canSync}
      />

      <div className="panel">
        <div className="section-label">{t.cards.add}</div>
        <AddCardForm problem={problem} settings={settings} onAdded={onRefresh} />
      </div>

      {candidates.length > 0 && (
        <CandidateList
          problem={problem}
          candidates={candidates}
          settings={settings}
          onRefresh={onRefresh}
        />
      )}

      <div>
        <div className="section-label">
          {t.cards.savedCount(cards.length)}
        </div>
        {cards.length === 0 ? (
          <div className="panel panel-quiet">
            <p className="popup-muted" style={{ margin: 0, textAlign: "center" }}>
              {t.cards.noSaved}
            </p>
          </div>
        ) : (
          <CardList cards={cards} settings={settings} onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}

/* ── CardFlipper ── */

function CardFlipper({ cards }: { cards: ApiCard[] }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Reset flip when card changes
  useEffect(() => {
    setFlipped(false);
  }, [idx]);

  // Keyboard: Space flips, ←/→ navigates (ignore when typing)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowLeft") {
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setIdx((i) => Math.min(cards.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cards.length]);

  const card = cards[idx];
  if (!card) return null;

  return (
    <div className="card-flipper">
      <div
        className="card-flipper-stage"
        onClick={() => setFlipped((f) => !f)}
        role="button"
        tabIndex={0}
        aria-label={flipped ? "Show question" : "Show answer"}
      >
        <div className={`card-flipper-inner${flipped ? " is-flipped" : ""}`}>
          <div className="card-face card-face-front">
            <div className="card-face-label">Question</div>
            <div className="card-face-content scroll-area">
              <PopupMarkdown className="card-face-md">{card.question}</PopupMarkdown>
            </div>
            <div className="card-face-hint">Tap or press Space</div>
          </div>
          <div className="card-face card-face-back">
            <div className="card-face-label card-face-label-answer">Answer</div>
            <div className="card-face-content scroll-area">
              <PopupMarkdown className="card-face-md">{card.answer}</PopupMarkdown>
            </div>
            <div className="card-face-hint">Tap to flip back</div>
          </div>
        </div>
      </div>

      <div className="card-flipper-nav">
        <button
          type="button"
          className="card-flipper-arrow"
          disabled={idx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          aria-label="Previous card"
        >
          ←
        </button>
        <span className="card-flipper-pos">
          {idx + 1} / {cards.length}
        </span>
        <button
          type="button"
          className="card-flipper-arrow"
          disabled={idx >= cards.length - 1}
          onClick={() => setIdx((i) => Math.min(cards.length - 1, i + 1))}
          aria-label="Next card"
        >
          →
        </button>
      </div>
    </div>
  );
}

/* ── NotesPanel (local-first auto-save) ── */

type NotesDraft = { value: string; dirty: boolean; ts: number };

function notesDraftKey(problemId: string) {
  return `ankify.notes-draft.${problemId}`;
}

function readNotesDraft(problemId: string): NotesDraft | null {
  try {
    const raw = window.localStorage.getItem(notesDraftKey(problemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotesDraft;
    if (typeof parsed?.value !== "string" || typeof parsed?.dirty !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeNotesDraft(problemId: string, value: string, dirty: boolean) {
  try {
    const payload: NotesDraft = { value, dirty, ts: Date.now() };
    window.localStorage.setItem(notesDraftKey(problemId), JSON.stringify(payload));
  } catch {
    // localStorage can fail on quota; never block typing
  }
}

function NotesPanel({ problem, settings }: { problem: ApiProblem; settings: ExtSettings }) {
  const t = getExtText(settings);
  // Initial value: always prefer the local snapshot when it exists. It's the
  // most recent text the user saw, whether or not it's been synced — `dirty`
  // is for *syncing* decisions, not for *display* decisions. Falling back to
  // `problem.notes` would show a stale prop (last fetched at popup-detect
  // time) every time the tab is switched away and back.
  const [notes, setNotes] = useState(() => {
    const draft = readNotesDraft(problem.id);
    if (draft) return draft.value;
    return problem.notes ?? "";
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  // Tracks the last value we believe the server has. Initialized from the
  // freshly-fetched `problem.notes` prop (not from `notes`, which may be a
  // local-only draft that was never confirmed). Updated on every successful
  // PATCH so the dirty-detection logic stays accurate.
  const savedRef = useRef(problem.notes ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // If the popup picked up a dirty draft on mount whose value diverges from
  // what the server returned, re-sync once so the server catches up. Compare
  // against the live `problem.notes` prop (best signal for the server's
  // current state) rather than savedRef.
  useEffect(() => {
    const draft = readNotesDraft(problem.id);
    const serverValue = problem.notes ?? "";
    if (draft?.dirty && draft.value !== serverValue) {
      void persist(draft.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem.id]);

  async function persist(value: string) {
    if (value === savedRef.current) return;
    setStatus("saving");
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}`, {
        method: "PATCH",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ notes: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      savedRef.current = value;
      writeNotesDraft(problem.id, value, false);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1200);
    } catch {
      // Stay dirty so the next change retries.
      setStatus("idle");
    }
  }

  function handleChange(value: string) {
    setNotes(value);
    writeNotesDraft(problem.id, value, true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(value), 1500);
  }

  function flushSave() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void persist(notes);
  }

  return (
    <div className="notes-panel">
      <div className="notes-panel-header">
        <span className="section-label" style={{ margin: 0 }}>{t.notes.title}</span>
        <span className={`notes-panel-status${status !== "idle" ? " is-visible" : ""}`}>
          {status === "saving" ? t.notes.saving : status === "saved" ? t.notes.saved : ""}
        </span>
      </div>
      <textarea
        className="notes-panel-textarea scroll-area"
        value={notes}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={flushSave}
        placeholder={t.notes.placeholder}
      />
    </div>
  );
}

/* ── QuickRate ── */

function QuickRate({
  problemId,
  previews,
  settings,
  onRated,
}: {
  problemId: string;
  previews: Previews;
  settings: ExtSettings;
  onRated: () => void;
}) {
  const t = getExtText(settings);
  const [rating, setRating] = useState<FsrsRating>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/review/rate`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ problemId, rating }),
      });
      if (res.status === 409) {
        setError(t.review.alreadyRated);
        onRated();
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onRated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.review.rateFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quick-rate">
      <div className="rate-row">
        {getRatingButtons(t).map((b) => {
          const active = rating === b.rating;
          const interval = formatInterval(previews?.[b.rating]?.due);
          return (
            <button
              key={b.rating}
              type="button"
              className={`rate-btn rate-btn-flat${active ? " rate-btn-active" : ""}`}
              title={b.hint}
              onClick={() => setRating(b.rating)}
            >
              <span className="rate-btn-label">{b.label}</span>
              <span className="rate-btn-interval">{interval}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="btn btn-primary rate-submit-inline"
          disabled={busy}
          onClick={submit}
          aria-label={t.review.submitRating}
          title={t.review.submitRating}
        >
          {busy ? "…" : "→"}
        </button>
      </div>

      {error && <div className="err-banner" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

/* ── CardList (saved cards) ── */

function CardList({
  cards,
  settings,
  onRefresh,
}: {
  cards: ApiCard[];
  settings: ExtSettings;
  onRefresh: () => void;
}) {
  const t = getExtText(settings);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteCard(cardId: string) {
    if (!window.confirm(t.cards.deleteConfirm)) return;
    setDeletingId(cardId);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/cards`, {
        method: "DELETE",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ ids: [cardId] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      onRefresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t.cards.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {cards.map((card) => (
        <Collapse key={card.id} header={<span className="card-q-preview">{card.question}</span>}>
          <div className="card-q-box">
            <div className="card-q-label">{t.cards.question}</div>
            <PopupMarkdown>{card.question}</PopupMarkdown>
          </div>
          <div className="card-a-box">
            <div className="card-a-label">{t.cards.answer}</div>
            <PopupMarkdown>{card.answer}</PopupMarkdown>
          </div>
          <button
            type="button"
            className="btn-xs btn-xs-danger"
            style={{ marginTop: 10 }}
            disabled={deletingId === card.id}
            onClick={() => deleteCard(card.id)}
          >
            {deletingId === card.id ? "…" : t.cards.delete}
          </button>
        </Collapse>
      ))}
    </>
  );
}

/* ── AddCardForm ── */

function AddCardForm({
  problem,
  settings,
  onAdded,
}: {
  problem: ApiProblem;
  settings: ExtSettings;
  onAdded: () => void;
}) {
  const t = getExtText(settings);
  const slug = problem.leetcodeSlug;
  const [mode, setMode] = useState<"manual" | "ai">("ai");
  const [busy, setBusy] = useState<false | "manual" | "auto" | "note">(false);
  const [pendingAiCard, setPendingAiCard] = useState<PendingOperation | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* manual */
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  /* AI */
  const [rawText, setRawText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const userEditedRef = useRef(false);
  const pendingAiCardElapsedSeconds = useElapsedSeconds(Boolean(pendingAiCard), pendingAiCard?.startedAt ?? null);

  useEffect(() => {
    userEditedRef.current = false;
    let cancelled = false;
    void getCardDraft(slug).then((saved) => {
      if (cancelled) return;
      if (!userEditedRef.current) setRawText(saved);
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void setCardDraft(slug, rawText), 380);
    return () => clearTimeout(t);
  }, [rawText, slug, hydrated]);

  const refreshPendingAiCard = useCallback(() => {
    const pending = readPendingOperation(pendingAiCardKey(problem.id));
    setPendingAiCard(pending);
    if (pending?.kind === "auto" || pending?.kind === "note") {
      setBusy(pending.kind);
    } else {
      setBusy((current) => (current === "auto" || current === "note" ? false : current));
    }
    return pending;
  }, [problem.id]);

  useEffect(() => {
    refreshPendingAiCard();
  }, [refreshPendingAiCard]);

  useEffect(() => {
    const key = pendingAiCardKey(problem.id);
    const handlePendingChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && detail.key !== key) return;
      refreshPendingAiCard();
    };
    window.addEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
    return () => window.removeEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
  }, [problem.id, refreshPendingAiCard]);

  useEffect(() => {
    if (!pendingAiCard) return;
    const timer = window.setInterval(() => {
      const pending = readPendingOperation(pendingAiCardKey(problem.id));
      if (!pending) {
        setPendingAiCard(null);
        setBusy((current) => (current === "auto" || current === "note" ? false : current));
        setError(t.cards.timedOut);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pendingAiCard, problem.id]);

  const updateRawText = (v: string) => {
    userEditedRef.current = true;
    setRawText(v.slice(0, 6000));
  };

  async function clearLocalDraft() {
    await clearCardDraft(slug);
    userEditedRef.current = false;
    setRawText("");
  }

  async function handleManualSave() {
    if (!question.trim() || !answer.trim()) return;
    setBusy("manual");
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/user-card`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ mode: "manual", question: question.trim(), answer: answer.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(apiErrorMessage(j, `HTTP ${res.status}`));
      }
      setQuestion("");
      setAnswer("");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  async function handleAiGenerate(kind: "auto" | "note") {
    if (kind === "note" && !rawText.trim()) return;
    const pendingKey = pendingAiCardKey(problem.id);
    const operation = writePendingOperation(pendingKey, kind);
    setPendingAiCard(operation);
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/ai-cards`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({
          mode: "single",
          action: "generate",
          ...(kind === "note" ? { rawText: rawText.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(apiErrorMessage(j, `HTTP ${res.status}`));
      }
      if (kind === "note") await clearLocalDraft();
      clearPendingOperation(pendingKey);
      setPendingAiCard(null);
      onAdded();
    } catch (e) {
      clearPendingOperation(pendingKey);
      setPendingAiCard(null);
      setError(e instanceof Error ? e.message : t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mode-tabs">
        <button type="button" className={`mode-tab${mode === "ai" ? " active" : ""}`} onClick={() => setMode("ai")}>
          {t.cards.aiFromNotes}
        </button>
        <button type="button" className={`mode-tab${mode === "manual" ? " active" : ""}`} onClick={() => setMode("manual")}>
          {t.cards.manual}
        </button>
      </div>

      {mode === "manual" && (
        <div className="stack">
          <label className="field-label">
            {t.cards.question}
            <textarea
              className="textarea-card field-ta"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t.cards.questionPlaceholder}
              disabled={!!busy}
            />
          </label>
          <label className="field-label">
            {t.cards.answer}
            <textarea
              className="textarea-card field-ta"
              rows={4}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={t.cards.answerPlaceholder}
              disabled={!!busy}
            />
          </label>
          {error && <div className="err-banner">{error}</div>}
          <button
            type="button"
            onClick={handleManualSave}
            disabled={!!busy || !question.trim() || !answer.trim()}
            className="btn btn-primary"
          >
            {busy ? t.quiz.saving : t.cards.saveCard}
          </button>
        </div>
      )}

      {mode === "ai" && (
        <div className="stack">
          <label className="field-label">
            {t.cards.yourNotes}
            <textarea
              className="textarea-card field-ta"
              rows={5}
              value={rawText}
              onChange={(e) => updateRawText(e.target.value)}
              placeholder={t.cards.notesPlaceholder}
              disabled={!!busy}
            />
          </label>
          <div className="ai-toolbar">
            <span className="draft-hint">
              {pendingAiCard ? t.cards.generatingCandidate : `${rawText.length}/6000${rawText.trim() && hydrated ? ` · ${t.cards.autosaved}` : ""}`}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {rawText.trim() && (
                <button type="button" className="link-quiet btn-inline" onClick={clearLocalDraft} disabled={!!busy}>
                  {t.cards.clear}
                </button>
              )}
              <button type="button" onClick={() => handleAiGenerate("auto")} disabled={!!busy} className="btn btn-ghost">
                {busy === "auto" ? t.quiz.generating : t.cards.autoGenerate}
              </button>
              <button
                type="button"
                onClick={() => handleAiGenerate("note")}
                disabled={!rawText.trim() || !!busy}
                className="btn btn-primary"
              >
                {busy === "note" ? t.quiz.generating : t.cards.generateFromNote}
              </button>
            </div>
          </div>
          {pendingAiCard && (
            <div className="operation-timer">
              {t.quiz.pendingTimer(formatElapsedSeconds(pendingAiCardElapsedSeconds)).replace("02:00", formatElapsedSeconds(CARD_GENERATION_TARGET_SECONDS))}
            </div>
          )}

          {error && <div className="err-banner">{error}</div>}
        </div>
      )}
    </div>
  );
}

/* ── CandidateList ── */

function CandidateList({
  problem,
  candidates,
  settings,
  onRefresh,
}: {
  problem: ApiProblem;
  candidates: ApiCard[];
  settings: ExtSettings;
  onRefresh: () => void;
}) {
  const t = getExtText(settings);
  const [local, setLocal] = useState<LocalCandidate[]>([]);
  const [pendingVersion, setPendingVersion] = useState(0);

  useEffect(() => {
    setLocal((prev) => {
      const prevById = new Map(prev.map((c) => [c.id, c]));
      return candidates.map((c) => ({
        ...c,
        ...mergeCandidatePendingState(c, prevById.get(c.id), problem.id),
      }));
    });
  }, [candidates, pendingVersion, problem.id]);

  useEffect(() => {
    const handlePendingChange = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && !key.startsWith(`ankify.pending.aiCandidate.${problem.id}.`)) return;
      setPendingVersion((value) => value + 1);
    };
    window.addEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
    return () => window.removeEventListener(PENDING_OPERATION_EVENT, handlePendingChange);
  }, [problem.id]);

  useEffect(() => {
    if (!local.some((card) => card.busy === "followup")) return;
    const timer = window.setInterval(() => setPendingVersion((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [local]);

  function update(id: string, patch: Record<string, unknown>) {
    setLocal((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function patchCard(id: string, body: Record<string, unknown>) {
    const res = await fetch(`${settings.apiBaseUrl}/api/cards/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(settings),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error ?? `HTTP ${res.status}`);
    }
  }

  async function runAi(
    card: LocalCandidate,
    instruction?: string,
  ) {
    const pendingKey = pendingCandidateAiKey(problem.id, card.id);
    writePendingOperation(pendingKey, "followup");
    update(card.id, { busy: "followup", localError: null });
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/problems/${problem.id}/ai-cards`, {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({
          mode: "single",
          action: "followup",
          cardId: card.id,
          draft: { question: card.question.trim(), answer: card.answer.trim() },
          instruction,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(apiErrorMessage(j, `HTTP ${res.status}`));
      }
      clearPendingOperation(pendingKey);
      update(card.id, { busy: null, instruction: "" });
      onRefresh();
    } catch (e) {
      clearPendingOperation(pendingKey);
      update(card.id, { busy: null, localError: e instanceof Error ? e.message : t.cards.aiFailed });
    }
  }

  async function confirm(id: string, q: string, a: string) {
    update(id, { busy: "confirm", localError: null });
    try {
      await patchCard(id, { aiStatus: "ready", question: q.trim(), answer: a.trim() });
      onRefresh();
    } catch (e) {
      update(id, { busy: null, localError: e instanceof Error ? e.message : t.cards.confirmFailed });
    }
  }

  async function discard(id: string) {
    update(id, { busy: "discard", localError: null });
    try {
      const res = await fetch(`${settings.apiBaseUrl}/api/cards`, {
        method: "DELETE",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onRefresh();
    } catch (e) {
      update(id, { busy: null, localError: e instanceof Error ? e.message : t.cards.discardFailed });
    }
  }

  return (
    <div className="panel">
      <div className="section-label">
        {t.cards.candidateCount(candidates.length)}
      </div>
      {local.map((c) => {
        const disabled = !!c.busy;
        const pending = readPendingOperation(pendingCandidateAiKey(problem.id, c.id));
        const elapsedSeconds = pending ? Math.max(0, Math.floor((Date.now() - pending.startedAt) / 1000)) : 0;
        return (
          <div key={c.id} className={`candidate-card${c.aiStatus === "failed" ? " candidate-failed" : ""}`}>
            <div
              className="candidate-status"
              style={{
                color: c.aiStatus === "failed" ? "var(--danger)" : "var(--muted)",
              }}
            >
              {c.aiStatus === "failed" ? t.cards.failed : t.cards.candidate}
            </div>
            {c.errorMessage && <div className="err-banner" style={{ marginBottom: 8 }}>{c.errorMessage}</div>}

            <label className="field-label">
              Q
              <textarea
                className="textarea-card field-ta-sm"
                rows={2}
                value={c.question}
                disabled={disabled}
                onChange={(e) => update(c.id, { question: e.target.value })}
              />
            </label>
            <label className="field-label">
              A
              <textarea
                className="textarea-card field-ta-sm"
                rows={3}
                value={c.answer}
                disabled={disabled}
                onChange={(e) => update(c.id, { answer: e.target.value })}
              />
            </label>
            <div className="candidate-followup">
              <input
                className="followup-input"
                value={c.instruction}
                disabled={disabled}
                onChange={(e) => update(c.id, { instruction: e.target.value })}
                placeholder={t.cards.followupPlaceholder}
              />
              <div className="candidate-actions">
                <button
                  type="button"
                  className="btn-xs"
                  disabled={disabled || !c.question.trim() || !c.answer.trim() || !c.instruction.trim()}
                  onClick={() => runAi(c, c.instruction)}
                >
                  {c.busy === "followup" ? "…" : t.cards.apply}
                </button>
                <button
                  type="button"
                  className="btn-xs btn-xs-accent"
                  disabled={disabled || !c.question.trim() || !c.answer.trim()}
                  onClick={() => confirm(c.id, c.question, c.answer)}
                >
                  {c.busy === "confirm" ? "…" : t.cards.confirm}
                </button>
                <button type="button" className="btn-xs btn-xs-danger" disabled={!!c.busy} onClick={() => discard(c.id)}>
                  ×
                </button>
              </div>
              {c.busy === "followup" && (
                <div className="operation-timer">
                  {t.cards.applying} {formatElapsedSeconds(elapsedSeconds)} / {formatElapsedSeconds(CARD_GENERATION_TARGET_SECONDS)}
                </div>
              )}
            </div>
            {c.localError && <div className="err-banner" style={{ marginTop: 6 }}>{c.localError}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ── CaptureView ── */

function CaptureView({
  slug,
  settings,
  onCaptured,
  onError,
}: {
  slug: string;
  settings: ExtSettings;
  onCaptured: () => void;
  onError: (msg: string) => void;
}) {
  const t = getExtText(settings);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CapturedProblem | null>(null);

  async function readPage() {
    setBusy(true);
    try {
      setPreview(await readActiveProblem());
    } catch (e) {
      onError(e instanceof Error ? e.message : t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  async function saveCapture() {
    if (!preview) return;
    setBusy(true);
    try {
      await saveCapturedProblem(settings, preview);
      onCaptured();
    } catch (e) {
      onError(e instanceof Error ? e.message : t.common.unknownError);
    } finally {
      setBusy(false);
    }
  }

  if (!preview) {
    return (
      <div className="panel">
        <span className="section-label">{t.capture.notInDeck}</span>
        <p className="popup-muted" style={{ marginTop: 0 }}>
          {t.capture.notCaptured(slug)}
        </p>
        <button type="button" onClick={readPage} disabled={busy} className="btn btn-primary" style={{ marginTop: 14 }}>
          {busy ? t.capture.reading : t.capture.captureThis}
        </button>
      </div>
    );
  }

  const accepted = preview.submissions.filter((s) => s.status === "Accepted").length;
  const failed = preview.submissions.length - accepted;
  return (
    <div className="panel">
      <div className="hero-row">
        <div style={{ minWidth: 0 }}>
          <h2 className="hero-title">
            {preview.leetcodeId != null && (
              <span className="problem-card-num">{preview.leetcodeId}. </span>
            )}
            {preview.title}
          </h2>
          <div className="hero-meta">
            {difficultyLabel(preview.difficulty, t)} · {preview.topicTags.slice(0, 4).join(", ")}
          </div>
        </div>
      </div>
      <p className="capture-meta" style={{ marginTop: 12 }}>
        {t.common.submissions(preview.submissions.length)}
        {preview.submissions.length > 0 && ` ${t.common.acceptedFailed(accepted, failed)}`}
      </p>
      <div className="capture-actions" style={{ marginTop: 16 }}>
        <button type="button" onClick={saveCapture} disabled={busy} className="btn btn-primary">
          {busy ? t.capture.saving : t.capture.add}
        </button>
        <button type="button" onClick={() => setPreview(null)} disabled={busy} className="btn btn-secondary">
          {t.capture.back}
        </button>
      </div>
    </div>
  );
}

/* ── SettingsTab ── */

function SettingsInfoTip({ label, align = "center" }: { label: string; align?: "center" | "left" | "right" }) {
  return (
    <span className="settings-info-tip" data-align={align} tabIndex={0} role="img" aria-label={label}>
      i
      <span className="settings-info-tooltip" role="tooltip">
        {label}
      </span>
    </span>
  );
}

function SettingsTitle({
  children,
  info,
  as = "span",
  id,
}: {
  children: React.ReactNode;
  info?: string;
  as?: "span" | "strong";
  id?: string;
}) {
  const TitleTag = as;
  return (
    <div className="settings-title">
      <TitleTag id={id} className="settings-title-text">
        {children}
      </TitleTag>
      {info ? <SettingsInfoTip label={info} align="left" /> : null}
    </div>
  );
}

function SettingsTab({
  settings,
  theme,
  onThemeChange,
  onSave,
}: {
  settings: ExtSettings;
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
  onSave: (next: Partial<ExtSettings>) => void;
}) {
  const t = getExtText(settings);
  const [base, setBase] = useState(settings.apiBaseUrl);
  const [token, setToken] = useState(settings.apiToken);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testState, setTestState] = useState<{ kind: "idle" | "loading" | "success" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });

  const normalizedBase = base.trim().replace(/\/+$/, "");

  async function testConnection() {
    if (!normalizedBase || !token.trim()) {
      setTestState({ kind: "error", message: t.settings.required });
      return;
    }

    setTestState({ kind: "loading", message: t.settings.checking });
    try {
      const res = await fetch(`${normalizedBase}/api/me`, {
        headers: token.trim() ? { "x-ankify-token": token.trim() } : {},
      });
      const data = (await res.json().catch(() => null)) as { user?: { email?: string }; error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error || `Connection failed (${res.status})`);
      }
      setTestState({ kind: "success", message: t.settings.connectedAs(data?.user?.email ?? t.settings.thisUser) });
    } catch (error) {
      setTestState({ kind: "error", message: error instanceof Error ? error.message : t.settings.failed });
    }
  }

  return (
    <div className="settings-stack">
      <section className="settings-module panel" aria-labelledby="settings-appearance">
        <div className="settings-module-head">
          <SettingsTitle as="strong" id="settings-appearance">
            {t.settings.appearance}
          </SettingsTitle>
        </div>
        <div className="settings-preference-list">
          <div className="settings-preference-row">
            <div className="settings-preference-copy">
              <SettingsTitle>{t.language.label}</SettingsTitle>
            </div>
            <div className="theme-control language-control" aria-label={t.language.label}>
              {(["en", "zh"] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  data-active={settings.language === language}
                  onClick={() => onSave({ language })}
                  aria-pressed={settings.language === language}
                >
                  {t.language[language]}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-preference-row">
            <div className="settings-preference-copy">
              <SettingsTitle>{t.theme.label}</SettingsTitle>
            </div>
            <div className="theme-control settings-theme-control" aria-label={t.theme.label}>
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-active={theme === option.value}
                  onClick={() => onThemeChange(option.value)}
                  aria-pressed={theme === option.value}
                >
                  {t.theme[option.key]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-module panel" aria-labelledby="settings-review-guard">
        <div className="settings-module-head">
          <SettingsTitle as="strong" id="settings-review-guard">
            {t.settings.reviewGuard}
          </SettingsTitle>
        </div>
        <div className="settings-preference-list">
          <div className="settings-preference-row">
            <div className="settings-preference-copy">
              <SettingsTitle info={t.settings.resetCodeHelp}>{t.settings.resetCode}</SettingsTitle>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.resetCodeOnProblemOpen}
                onChange={(e) => onSave({ resetCodeOnProblemOpen: e.target.checked })}
                aria-label={t.settings.resetCode}
              />
              <span aria-hidden="true" />
            </label>
          </div>
        </div>
      </section>

      <section className="settings-module panel" aria-labelledby="settings-connection">
        <div className="settings-module-head">
          <SettingsTitle as="strong" id="settings-connection" info={t.settings.connectionHelp}>
            {t.settings.connection}
          </SettingsTitle>
        </div>
        <div className="settings-field-group">
          <label>
            <span className="settings-field-label">{t.settings.apiBaseUrl}</span>
            <input type="text" value={base} onChange={(e) => setBase(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label>
            <span className="settings-field-label">{t.settings.apiToken}</span>
            <input
              name="ankify-extension-api-token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              style={token ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
            />
          </label>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave({ apiBaseUrl: normalizedBase, apiToken: token.trim() });
              setBase(normalizedBase);
              setToken(token.trim());
              setSavedFlash(true);
              setTimeout(() => setSavedFlash(false), 2000);
            }}
          >
            {t.settings.saveConnection}
          </button>
          <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={testState.kind === "loading"}>
            {testState.kind === "loading" ? t.settings.testing : t.settings.testConnection}
          </button>
          {savedFlash ? <p className="popup-muted">{t.settings.saved}</p> : null}
        </div>
        {testState.message ? (
          <p className={`connection-status connection-status-${testState.kind}`}>{testState.message}</p>
        ) : null}
      </section>
    </div>
  );
}
