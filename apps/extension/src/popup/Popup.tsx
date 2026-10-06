import { useCallback, useEffect, useRef, useState } from "react";
import type { FsrsRating } from "@ankify/core";
import type {
  AuthUserDto as AuthAccount,
  CaptureProblemInput,
  CaptureResultDto as CaptureResult,
  CardDto as ApiCard,
  FsrsPreviewsDto as Previews,
  ProblemDto as ApiProblem,
  ProblemLookupPayloadDto,
  QueueProblemDto as QueueProblem,
  ReviewQueuePayloadDto as QueueResponse,
} from "@ankify/contracts";
import type { BackgroundRequest, ContentResponse, EditorReadFailure, ExtSettings, PanelEvent, SolvedSyncState } from "../shared/messages";
import { encodeCapturePayload } from "../shared/capture-payload";
import {
  getSettings,
  getSolvedSyncState,
  setSettings,
} from "../shared/storage";
import { AUTH_REQUIRED_EVENT, apiFetch } from "./api";
import { CoachTab } from "./CoachTab";
import { DocsPanel } from "./DocsPanel";
import { PopupMarkdown } from "./PopupMarkdown";

type ThemePreference = "system" | "light" | "dark";
type Language = ExtSettings["language"];

type State =
  | { kind: "detecting" }
  | { kind: "off-page" }
  | { kind: "loading"; slug: string }
  | { kind: "not-saved"; slug: string }
  | { kind: "captured"; problem: ApiProblem; cards: ApiCard[]; candidates: ApiCard[]; previews: Previews }
  | { kind: "error"; msg: string };

type AuthState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; account: AuthAccount };

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

type PanelView = "auto" | "today" | "settings" | "docs";

const EXT_I18N = {
  en: {
    nav: { today: "Today", problem: "Problem", settings: "Settings" },
    common: {
      back: "Back",
      navigation: "Primary navigation",
      cancel: "Cancel",
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
      previous: "Previous",
      next: "Next",
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
      workspace: "Review workspace",
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
      confirmReset: "Delete history",
      resetting: "Deleting...",
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
      manage: "Manage cards",
      add: "Add a card",
      savedCount: (count: number) => `${count} saved card${count === 1 ? "" : "s"}`,
      noSaved: "No saved cards yet.",
      question: "Question",
      answer: "Answer",
      showQuestion: "Show question",
      showAnswer: "Show answer",
      flipHint: "Tap, Enter, or Space",
      flipBackHint: "Tap to show the question",
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
      autoHint: "It's added automatically the next time you submit here, pass or fail. Submissions from before you opened this page don't count, so browsing old problems never fills your queue.",
      addNow: "Add now",
      helperUnavailable:
        "ankify can't reach this LeetCode tab yet. Chrome only adds the extension to pages opened or refreshed after it loads, so refresh this tab.",
      refreshTab: "Refresh LeetCode tab",
      reading: "Reading...",
      captureThis: "Capture this problem",
      saving: "Saving...",
    },
    notes: {
      title: "Notes",
      saving: "Saving...",
      saved: "Saved",
      placeholder: "What tripped you up, key insights, alternative approaches...",
    },
    docs: {
      title: "Docs",
      notes: "Notes",
      cards: "Cards",
      edit: "Edit",
      save: "Save",
      cancel: "Cancel",
      reload: "Load latest",
      emptyNotes: "No notes yet. Write your approach and pitfalls here, or ask the Coach to draft them.",
      emptyCards: "No cards yet. Add questions worth recalling, or ask the Coach to suggest some.",
      cardsFormat: "Each line starting with ## is a question; the text under it is the answer.",
      conflict: "This doc changed since you opened it. Load the latest, then edit again.",
      loadFailed: "Couldn't load this problem's docs.",
      saveFailed: "Couldn't save. Try again.",
      issueEmptyAnswer: (prompt: string) => `"${prompt}" has no answer yet, so it isn't a card.`,
      issueDuplicate: (prompt: string) => `"${prompt}" appears twice; only the first counts.`,
      issueTooMany: (limit: number) => `Only the first ${limit} cards are used.`,
      issueTooLong: (limit: number) => `Cards are limited to ${limit} characters.`,
    },
    coach: {
      weakSpots: {
        title: "Weak spots on this problem",
        analyze: "Analyze my attempts",
        analyzePrompt: "Analyze my attempts on this problem and find where I tend to go wrong.",
        empty: "No weak spots recorded yet. The Coach can read your submissions and find them.",
        remove: "Remove",
        resolved: (count: number) => `${count} resolved`,
        timesSeen: (count: number) => `${count} times`,
        noted: (detail: string) => `Noted a weak spot: ${detail}`,
      },
      practice: {
        title: "Practice",
        talkHint: "Answer the Coach's questions in the chat below.",
        talkScore: (correct: number, partial: number, total: number) =>
          `${correct} of ${total} right${partial ? `, ${partial} partly` : ""}`,
        core: { approach: "The approach", complexity: "Complexity" },
        grades: { correct: "Right", partial: "Partly", missed: "Missed", skipped: "Skipped" },
        end: "End",
        endConfirm: "End this practice? What you've answered still counts; the rest are skipped.",
        endNow: "End practice",
        keepGoing: "Keep going",
        endedEarly: "ended early",
        abandoned: "Practice ended. Nothing was answered, so nothing changed.",
        followingUp: "Following up on what was missing",
        showDetails: "Show practice details",
        hideDetails: "Hide practice details",
        close: "Close",
        startMessage: "Let's practice this problem.",
        progress: (done: number, total: number) => `${done} of ${total}`,
        showAnswer: "Show answer",
        gotIt: "Got it",
        missed: "Missed it",
        preparing: "Preparing your questions",
        noQuestions: (reason: string) => `No AI questions this time: ${reason}`,
        next: "Next",
        correct: "Correct",
        incorrect: "Not quite. The answer:",
        score: (points: number, total: number) => `${points} of ${total} right`,
        suggestedTag: "suggested",
        rate: "Rate this review",
        rated: (rating: string) => `Rated ${rating}.`,
        ratings: ["Again", "Hard", "Good", "Easy"] as [string, string, string, string],
        loadFailed: "Couldn't load this practice session.",
        actionFailed: "That didn't save. Try again.",
      },
      startPractice: "Practice",
      rateDirectly: "Rate",
      dueForReview: "Due for review",
      practiceFinished: (points: number, total: number) => `Practice finished: ${points} of ${total}. Go over what I missed.`,
      title: "Study Coach",
      showChat: "Show chat",
      hideChat: "Hide chat",
      intro:
        "Ask about the problem you're on. With Code on (below), the Coach also sees what's in LeetCode's editor right now, so it can point at the bug instead of guessing.",
      placeholder: "Ask the Study Coach",
      send: "Send",
      stop: "Stop",
      newChat: "New chat",
      history: "Past conversations",
      modelMenu: "Model and thinking for the next replies",
      modelHeading: "Model",
      thinkingHeading: "Thinking",
      fromSettings: "Settings",
      reasoningLevel: (level: string) =>
        ({ default: "Auto", off: "Off", none: "None", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" })[
          level
        ] ?? level,
      noHistory: "No conversations yet.",
      untitled: "Untitled conversation",
      includeCode: "Include my code",
      codeLabel: "Code",
      onProblem: (title: string) => `On ${title}`,
      notSaved: "Not saved in ankify",
      offPage: "Open a LeetCode problem to talk about it, or ask about your reviews.",
      thinking: "Thinking",
      quick: {
        failing: "Why is my code failing?",
        hint: "Give me a hint, not the answer",
        history: "What did I get wrong on this before?",
      },
      approve: "Approve",
      apply: "Apply",
      applied: "Applied.",
      dismiss: "Dismiss",
      dismissed: "Dismissed.",
      jobRunning: "Generating",
      jobDone: "Done. Find it in the Problem tab.",
      jobFailed: "Generation failed.",
      openReview: "Open review in ankify",
      openProblem: "Open in ankify",
      noCode: (reason: EditorReadFailure) =>
        `Sent without your code: ${
          {
            no_receiver: "ankify isn't running in this LeetCode tab yet. Reload the tab.",
            no_page_script: "ankify's editor reader didn't answer in this tab. Reload the tab; if it keeps happening, reload ankify in chrome://extensions too.",
            no_monaco: "LeetCode's code editor isn't on this page.",
            no_code_model: "LeetCode's editor has no code open.",
          }[reason]
        } (${reason})`,
      loadFailed: "Couldn't load the Study Coach.",
      sendFailed: "Couldn't reach the Study Coach. Try again.",
    },
    settings: {
      appearance: "Appearance",
      appearanceHelp: "Language and theme for this extension.",
      languageHelp: "Changes only the extension interface. New AI cards and quizzes use the Generation language saved in web Settings.",
      themeHelp: "Popup color mode",
      connection: "Connection",
      connectionHelp: "The extension securely reuses your ankify web login session. No API token is needed.",
      reviewGuard: "Review guard",
      reviewGuardHelp: "Keeps LeetCode problem pages clean while reviewing.",
      resetCode: "Reset code on problem pages",
      resetCodeHelp: "When any LeetCode problem opens, restore the default starter code once.",
      leetcodeSync: "LeetCode sync",
      autoCapture: "Collect problems when you submit",
      autoCaptureHelp:
        "The first time you submit on a problem that isn't in ankify, pass or fail, it's added automatically and comes up for review the next day. New submissions on collected problems always sync.",
      solvedSynced: (count: number, when: string) => `Solved list synced ${when}: ${count} problems.`,
      solvedNever: "Your LeetCode solved list syncs once a day when you open a problem page.",
      solvedFailed: (error: string) => `Last sync failed (${error}).`,
      syncNow: "Sync now",
      syncing: "Syncing",
      syncOpenLeetcode: "Open or refresh a LeetCode problem page, then sync. It syncs every problem you've solved at once.",
      syncLeetcodeSignedOut: "Sign in to LeetCode first, then sync.",
      testConnection: "Test connection",
      testing: "Testing...",
      checking: "Checking connection...",
      connectedAs: (email: string) => `Connected as ${email}.`,
      thisUser: "this user",
      failed: "Connection failed.",
      signIn: "Continue with Google",
      signingIn: "Waiting for Google sign-in...",
      signInTitle: "Sign in to ankify",
      signInBody: "Use the same Google account as the ankify web app. If you are already signed in, connection is automatic.",
      refreshSession: "Check again",
      manageAccount: "Open web account",
      loginTimedOut: "Sign-in was not completed. Finish signing in on the web, then check again.",
    },
  },
  zh: {
    nav: { today: "今日", problem: "题目", settings: "设置" },
    common: {
      back: "返回",
      navigation: "主导航",
      cancel: "取消",
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
      previous: "上一张",
      next: "下一张",
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
      workspace: "复习工作区",
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
      confirmReset: "删除历史",
      resetting: "删除中...",
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
      manage: "管理卡片",
      add: "添加卡片",
      savedCount: (count: number) => `${count} 张已保存卡片`,
      noSaved: "还没有已保存卡片。",
      question: "问题",
      answer: "答案",
      showQuestion: "显示问题",
      showAnswer: "显示答案",
      flipHint: "点击，或按 Enter / 空格",
      flipBackHint: "点击返回问题",
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
      autoHint: "下次在这里提交时（不管通过没通过）会自动收录。打开页面之前的提交不算，所以翻看以前做过的题不会塞满复习队列。",
      addNow: "现在收录",
      helperUnavailable: "ankify 还连不上这个 LeetCode 页面。Chrome 只会把扩展加到它加载之后打开或刷新的页面里，刷新一下这个页面就好。",
      refreshTab: "刷新 LeetCode 页面",
      reading: "读取中...",
      captureThis: "捕获这道题",
      saving: "保存中...",
    },
    notes: { title: "笔记", saving: "保存中...", saved: "已保存", placeholder: "哪里卡住了、关键洞察、其他解法..." },
    docs: {
      title: "文档",
      notes: "笔记",
      cards: "卡片",
      edit: "编辑",
      save: "保存",
      cancel: "取消",
      reload: "加载最新",
      emptyNotes: "还没有笔记。在这里写下思路和易错点，或者让教练帮你起草。",
      emptyCards: "还没有卡片。加几个值得记住的问题，或者让教练建议一些。",
      cardsFormat: "以 ## 开头的一行是问题，下面的文字是答案。",
      conflict: "你打开之后这个文档被改过了。先加载最新版本，再编辑。",
      loadFailed: "加载这道题的文档失败。",
      saveFailed: "保存失败，请重试。",
      issueEmptyAnswer: (prompt: string) => `「${prompt}」还没有答案，暂时不算一张卡片。`,
      issueDuplicate: (prompt: string) => `「${prompt}」出现了两次，只算第一个。`,
      issueTooMany: (limit: number) => `只使用前 ${limit} 张卡片。`,
      issueTooLong: (limit: number) => `卡片文档最多 ${limit} 个字符。`,
    },
    coach: {
      weakSpots: {
        title: "这题的弱点",
        analyze: "分析我的提交",
        analyzePrompt: "分析我在这道题上的提交，找出我容易出错的地方。",
        empty: "还没有记录弱点。教练可以读你的提交，帮你找出来。",
        remove: "删除",
        resolved: (count: number) => `已解决 ${count}`,
        timesSeen: (count: number) => `出现 ${count} 次`,
        noted: (detail: string) => `已记下弱点：${detail}`,
      },
      practice: {
        title: "练习",
        talkHint: "在下面的聊天里回答教练的问题。",
        talkScore: (correct: number, partial: number, total: number) =>
          `答对 ${correct} / ${total}${partial ? `，部分对 ${partial}` : ""}`,
        core: { approach: "解题思路", complexity: "复杂度" },
        grades: { correct: "对", partial: "部分对", missed: "没答上", skipped: "跳过" },
        end: "结束",
        endConfirm: "结束这次练习？已经答过的照样算，没答的跳过。",
        endNow: "结束练习",
        keepGoing: "继续练",
        endedEarly: "提前结束",
        abandoned: "练习已结束。一题都没答，所以什么都没变。",
        followingUp: "还在追问没答到的部分",
        showDetails: "展开练习详情",
        hideDetails: "收起练习详情",
        close: "关闭",
        startMessage: "开始练习这道题。",
        progress: (done: number, total: number) => `${done} / ${total}`,
        showAnswer: "显示答案",
        gotIt: "记得",
        missed: "没想起来",
        preparing: "正在准备题目",
        noQuestions: (reason: string) => `这次没有 AI 题目：${reason}`,
        next: "下一题",
        correct: "答对了",
        incorrect: "不对。正确答案：",
        score: (points: number, total: number) => `答对 ${points} / ${total}`,
        suggestedTag: "建议",
        rate: "给这次复习评分",
        rated: (rating: string) => `已评分：${rating}。`,
        ratings: ["重来", "困难", "良好", "简单"] as [string, string, string, string],
        loadFailed: "练习加载失败。",
        actionFailed: "没保存上，请重试。",
      },
      startPractice: "练习",
      rateDirectly: "评分",
      dueForReview: "该复习了",
      practiceFinished: (points: number, total: number) => `练习完成：${points} / ${total}。帮我过一下错的地方。`,
      title: "学习教练",
      showChat: "展开对话",
      hideChat: "收起对话",
      intro: "问问你正在做的这道题。打开下方的「代码」后，教练还能看到 LeetCode 编辑器里现在的代码，直接指出问题在哪。",
      placeholder: "问学习教练",
      send: "发送",
      stop: "停止",
      newChat: "新对话",
      history: "历史对话",
      modelMenu: "接下来回复用的模型和思考强度",
      modelHeading: "模型",
      thinkingHeading: "思考强度",
      fromSettings: "设置里的",
      reasoningLevel: (level: string) =>
        ({ default: "自动", off: "关闭", none: "无", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高" })[level] ??
        level,
      noHistory: "还没有对话。",
      untitled: "未命名对话",
      includeCode: "附上我的代码",
      codeLabel: "代码",
      onProblem: (title: string) => `当前题目：${title}`,
      notSaved: "还没存进 ankify",
      offPage: "打开一道 LeetCode 题就能聊这道题，也可以问复习安排。",
      thinking: "思考中",
      quick: {
        failing: "我的代码哪里错了？",
        hint: "给我一点提示，别直接给答案",
        history: "我以前这题错在哪？",
      },
      approve: "同意",
      apply: "应用",
      applied: "已应用。",
      dismiss: "不用了",
      dismissed: "已忽略。",
      jobRunning: "生成中",
      jobDone: "好了，在「题目」页里看。",
      jobFailed: "生成失败。",
      openReview: "在 ankify 里打开复习",
      openProblem: "在 ankify 里打开",
      noCode: (reason: EditorReadFailure) =>
        `这次没附上代码：${
          {
            no_receiver: "ankify 还没在这个 LeetCode 页面里运行，刷新一下页面。",
            no_page_script: "这个页面里 ankify 的编辑器读取没响应。刷新页面；还不行的话，也在 chrome://extensions 里重新加载 ankify。",
            no_monaco: "这个页面上没有 LeetCode 的代码编辑器。",
            no_code_model: "LeetCode 编辑器里没有打开的代码。",
          }[reason]
        }（${reason}）`,
      loadFailed: "学习教练加载失败。",
      sendFailed: "连不上学习教练，请重试。",
    },
    settings: {
      appearance: "外观",
      appearanceHelp: "扩展里的语言和主题。",
      languageHelp: "只改变扩展界面；新生成的 AI 卡片和测验使用 Web Settings 中保存的“生成内容语言”。",
      themeHelp: "弹窗颜色模式",
      connection: "连接",
      connectionHelp: "扩展会安全复用 ankify 网页登录会话，不再需要 API token。",
      reviewGuard: "复习保护",
      reviewGuardHelp: "复习时保持 LeetCode 题目页干净。",
      resetCode: "打开题目时重置代码",
      resetCodeHelp: "进入任意 LeetCode 题目页时，自动恢复一次默认代码模板。",
      leetcodeSync: "LeetCode 同步",
      autoCapture: "提交后自动收录",
      autoCaptureHelp: "在还没收录的题上第一次提交（不管通过没通过），就自动收录这道题，第二天安排复习。已收录题目的新提交会一直自动同步。",
      solvedSynced: (count: number, when: string) => `已同步做题记录（${when}）：共 ${count} 道。`,
      solvedNever: "打开 LeetCode 题目页时，每天自动同步一次你的做题记录。",
      solvedFailed: (error: string) => `上次同步失败（${error}）。`,
      syncNow: "立即同步",
      syncing: "同步中",
      syncOpenLeetcode: "请先打开（或刷新）一道 LeetCode 题目页，再同步。会一次同步你做过的全部题目。",
      syncLeetcodeSignedOut: "请先登录 LeetCode，再同步。",
      testConnection: "测试连接",
      testing: "测试中...",
      checking: "正在检查连接...",
      connectedAs: (email: string) => `已连接为 ${email}。`,
      thisUser: "此用户",
      failed: "连接失败。",
      signIn: "使用 Google 继续",
      signingIn: "等待 Google 登录...",
      signInTitle: "登录 ankify",
      signInBody: "请使用与 ankify 网页相同的 Google 账号；如果网页已经登录，扩展会自动连接。",
      refreshSession: "重新检查",
      manageAccount: "打开网页账号",
      loginTimedOut: "登录尚未完成。请先在网页完成登录，然后重新检查。",
    },
  },
} as const;

function getExtText(settings: ExtSettings) {
  return EXT_I18N[settings.language === "zh" ? "zh" : "en"];
}

/** Chevron for glyph-only controls. A drawn icon scales with the button and
 *  keeps its weight consistent, which a text arrow character does not. */
function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <path d={direction === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
    </svg>
  );
}

/** Check mark for the inline "submit rating" control. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function getRatingButtons(t: ReturnType<typeof getExtText>): { rating: FsrsRating; label: string; hint: string }[] {
  return [
    { rating: 1, label: t.rating.again, hint: t.rating.hints.again },
    { rating: 2, label: t.rating.hard, hint: t.rating.hints.hard },
    { rating: 3, label: t.rating.good, hint: t.rating.hints.good },
    { rating: 4, label: t.rating.easy, hint: t.rating.hints.easy },
  ];
}

function difficultyLabel(difficulty: ApiProblem["difficulty"] | CaptureProblemInput["difficulty"], t: ReturnType<typeof getExtText>) {
  return t.difficulty[difficulty];
}

function fsrsLabel(state: ApiProblem["fsrsState"], t: ReturnType<typeof getExtText>) {
  return t.fsrs[state];
}

const THEME_OPTIONS: { value: ThemePreference; key: "system" | "light" | "dark" }[] = [
  { value: "system", key: "system" },
  { value: "light", key: "light" },
  { value: "dark", key: "dark" },
];

/* ── helpers ── */

function jsonHeaders(settings: ExtSettings): HeadersInit {
  void settings;
  return { "content-type": "application/json" };
}

function authHeaders(settings: ExtSettings): HeadersInit {
  void settings;
  return {};
}

async function loadSessionAccount(apiBaseUrl: string): Promise<AuthAccount | null> {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Connection failed (${response.status})`);
  const data = (await response.json()) as { user?: AuthAccount };
  return data.user ?? null;
}

async function markExtensionConnected(apiBaseUrl: string) {
  const base = apiBaseUrl.replace(/\/+$/, "");
  await fetch(`${base}/api/onboarding`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "extension_connected" }),
  });
}

function isMissingContentScriptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection") ||
    message.includes("Extension context invalidated")
  );
}

async function readActiveProblem(settings: ExtSettings): Promise<CaptureProblemInput> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  let resp: ContentResponse;
  try {
    resp = (await chrome.tabs.sendMessage(tab.id, {
      type: "capture_current_problem",
    })) as ContentResponse;
  } catch (error) {
    if (isMissingContentScriptError(error)) {
      throw new Error(getExtText(settings).capture.helperUnavailable);
    }
    throw error;
  }
  if (resp.type !== "captured") {
    throw new Error(resp.type === "error" ? resp.message : "Unexpected response");
  }
  return resp.data;
}

async function saveCapturedProblem(settings: ExtSettings, problem: CaptureProblemInput): Promise<CaptureResult> {
  const res = await apiFetch(settings, "/api/capture", {
    method: "POST",
    headers: jsonHeaders(settings),
    body: encodeCapturePayload(problem),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `HTTP ${res.status}`);
  }
  // Tell the background worker so open tabs drop their "uncaptured" badge.
  const badgeMsg: BackgroundRequest = { type: "capture_badge_captured", slug: problem.leetcodeSlug };
  try {
    void chrome.runtime.sendMessage(badgeMsg).catch(() => {});
  } catch {
    /* background unavailable — the next content-script check reconciles */
  }
  return (await res.json()) as CaptureResult;
}

function apiErrorMessage(json: { error?: string; message?: string } | null, fallback: string) {
  return json?.message ?? json?.error ?? fallback;
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
): Promise<ProblemLookupPayloadDto | "not_captured"> {
  const res = await apiFetch(settings, `/api/problems/by-slug/${encodeURIComponent(slug)}`, {
    headers: authHeaders(settings),
    cache: "no-store",
  });
  if (res.status === 404) return "not_captured";
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ProblemLookupPayloadDto;
}

/* ── Popup ── */

export function Popup() {
  const [state, setState] = useState<State>({ kind: "detecting" });
  const [sticky, setSticky] = useState<Sticky | null>(null);
  const [settings, setLocalSettings] = useState<ExtSettings | null>(null);
  const [authState, setAuthState] = useState<AuthState>({ kind: "loading" });
  /** "auto" shows the problem in the active tab, or Today when there is none. */
  const [view, setView] = useState<PanelView>("auto");
  const [coachExpanded, setCoachExpanded] = useState(false);
  /** Bumps when the Coach applies a doc edit, so the Docs tab reloads. */
  const [docsRevision, setDocsRevision] = useState(0);
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

  const refreshSession = useCallback(async () => {
    if (!settings?.apiBaseUrl) {
      setAuthState({ kind: "signed-out" });
      return;
    }
    setAuthState({ kind: "loading" });
    try {
      const account = await loadSessionAccount(settings.apiBaseUrl);
      if (account) void markExtensionConnected(settings.apiBaseUrl).catch(() => {});
      setAuthState(account ? { kind: "signed-in", account } : { kind: "signed-out" });
    } catch {
      setAuthState({ kind: "signed-out" });
    }
  }, [settings?.apiBaseUrl]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const requireAuth = () => setAuthState({ kind: "signed-out" });
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuth);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuth);
  }, []);

  // Tracks the slug we last initiated a detect for. Auto-triggered detects
  // (tab activation / URL update) skip when the slug hasn't changed so the
  // popup doesn't tear itself down to the "detecting" / "loading" placeholder
  // mid-action. The user-facing Refresh button passes `force: true` to bypass.
  const currentSlugRef = useRef<string | null>(null);
  const hasDetectedOnceRef = useRef(false);

  const detect = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!settings || authState.kind !== "signed-in") return;
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
      const sameSlug = hasDetectedOnceRef.current && slug === currentSlugRef.current;
      if (!force && sameSlug) {
        return;
      }
      hasDetectedOnceRef.current = true;
      currentSlugRef.current = slug;

      if (!slug) {
        setState({ kind: "off-page" });
        return;
      }

      // Refreshing the problem already on screen revalidates in place: a
      // loading placeholder would unmount the workspace (and its quiz or card
      // form), and some of those refresh again when they mount.
      if (!sameSlug) setState({ kind: "loading", slug });
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
    [settings, authState.kind],
  );

  useEffect(() => {
    if (settings && authState.kind === "signed-in") void detect();
  }, [settings, authState.kind, detect]);

  /* Side Panel persists across tab changes — re-detect on tab swap or real
   * URL change. We deliberately ignore `info.status === "complete"` because
   * LeetCode's SPA fires it on every internal load even when the slug is
   * unchanged, and the slug-equality guard inside `detect()` would skip the
   * work anyway — listening to `info.url` keeps the listener noise low too. */
  useEffect(() => {
    if (!settings || authState.kind !== "signed-in") return;
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
  }, [settings, authState.kind, detect]);

  // The background collected the open problem on a submission: show it.
  useEffect(() => {
    const onMessage = (message: PanelEvent) => {
      if (message?.type === "problem_collected" && message.slug === currentSlugRef.current) {
        void detect({ force: true });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [detect]);

  const captured = state.kind === "captured" ? state : null;
  const text = settings ? getExtText(settings) : EXT_I18N.en;
  const pageSlug =
    state.kind === "loading" || state.kind === "not-saved"
      ? state.slug
      : state.kind === "captured"
        ? state.problem.leetcodeSlug
        : null;
  const dueCount = useDueCount(settings, authState.kind === "signed-in");

  // Moving to another problem brings the panel back to it.
  useEffect(() => {
    setView((current) => (current === "settings" ? current : "auto"));
  }, [pageSlug]);

  // Jump back to the LeetCode tab where the sticky problem was last seen.
  // Hooks must run before the loading / signed-out early returns so the hook
  // order stays stable while the session state changes.
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

  if (!settings || authState.kind === "loading") {
    return (
      <div className="popup-shell">
        <main className="popup-main">
          <div className="panel">
            <p className="popup-muted">{text.settings.checking}</p>
          </div>
        </main>
      </div>
    );
  }

  if (authState.kind === "signed-out") {
    return (
      <SignInGate
        settings={settings}
        onAuthenticated={(account) => setAuthState({ kind: "signed-in", account })}
        onRefresh={() => void refreshSession()}
      />
    );
  }

  const showSettings = view === "settings";
  const headerProblem = captured ?? (state.kind === "off-page" ? sticky : null);
  const showDocs = view === "docs" && headerProblem != null;
  const showToday = !showSettings && !showDocs && (view === "today" || (state.kind === "off-page" && !sticky));
  // On a problem the Coach chat is the main area; elsewhere it docks below.
  const problemView = !showSettings && !showDocs && !showToday;
  const canReturnToProblem = (view === "today" || showDocs) && (state.kind !== "off-page" || sticky != null);
  const ratingPanel =
    headerProblem && isDue(headerProblem.problem.fsrsDue) ? (
      <QuickRate
        problemId={headerProblem.problem.id}
        previews={headerProblem.previews}
        settings={settings}
        onRated={() => void detect({ force: true })}
      />
    ) : null;

  return (
    <div className="popup-shell">
      <header className="panel-bar">
        <div className="panel-bar-main">
          {showSettings || canReturnToProblem ? (
            <button
              type="button"
              className="panel-bar-icon"
              aria-label={text.common.back}
              title={text.common.back}
              onClick={() => setView("auto")}
            >
              <ChevronIcon direction="left" />
            </button>
          ) : null}
          {showSettings ? (
            <h1 className="panel-bar-title">{text.nav.settings}</h1>
          ) : showDocs ? (
            <h1 className="panel-bar-title">{headerProblem!.problem.title}</h1>
          ) : showToday ? (
            <h1 className="panel-bar-title">{text.nav.today}</h1>
          ) : headerProblem ? (
            <ProblemHeading problem={headerProblem.problem} settings={settings} />
          ) : (
            <h1 className="panel-bar-title">{pageSlug ?? text.nav.problem}</h1>
          )}
        </div>
        <div className="panel-bar-actions">
          {problemView && headerProblem && (
            <button
              type="button"
              className="panel-bar-icon"
              aria-label={text.docs.title}
              title={text.docs.title}
              onClick={() => setView("docs")}
            >
              <BookIcon />
            </button>
          )}
          {problemView && headerProblem && (
            <a
              href={`${settings.apiBaseUrl}/problems/${headerProblem.problem.id}`}
              target="_blank"
              rel="noreferrer"
              className="panel-bar-icon"
              title={text.problem.openWeb}
              aria-label={text.problem.openWeb}
            >
              <ExternalIcon />
            </a>
          )}
          {!showSettings && !showToday && !showDocs && (
            <button
              type="button"
              className="panel-bar-icon"
              aria-label={text.nav.today}
              title={text.nav.today}
              onClick={() => setView("today")}
            >
              <ListIcon />
              {dueCount > 0 && <span className="panel-bar-count">{dueCount}</span>}
            </button>
          )}
          {!showSettings && (
            <button
              type="button"
              className="panel-bar-icon"
              aria-label={text.nav.settings}
              title={text.nav.settings}
              onClick={() => setView("settings")}
            >
              <GearIcon />
            </button>
          )}
        </div>
      </header>

      <main
        className={`popup-main scroll-area${problemView ? " is-strip" : ""}${
          showToday && coachExpanded ? " is-covered" : ""
        }`}
      >
        {showSettings ? (
          <SettingsTab
            settings={settings}
            account={authState.account}
            theme={theme}
            onThemeChange={setThemePreference}
            onSave={saveLocalSettings}
          />
        ) : showDocs ? (
          <div className="content-card">
            <DocsPanel settings={settings} problemId={headerProblem!.problem.id} revision={docsRevision} copy={text.docs} />
          </div>
        ) : showToday ? (
          <TodayTab settings={settings} onJumpToProblem={() => setView("auto")} />
        ) : (
          <ProblemTab
            state={state}
            settings={settings}
            captured={captured}
            sticky={sticky}
            onJumpToSticky={jumpToSticky}
            onRefresh={() => detect({ force: true })}
            onError={(msg) => setState({ kind: "error", msg })}
          />
        )}
      </main>

      {(problemView || showToday) && (
        <CoachTab
          settings={settings}
          saved={
            captured
              ? {
                  slug: captured.problem.leetcodeSlug,
                  problemId: captured.problem.id,
                  title: captured.problem.title,
                  due: isDue(captured.problem.fsrsDue),
                }
              : null
          }
          copy={text.coach}
          mode={problemView ? "full" : "dock"}
          expanded={problemView || coachExpanded}
          onExpandedChange={setCoachExpanded}
          ratingPanel={ratingPanel}
          onDocsChanged={() => setDocsRevision((revision) => revision + 1)}
          onProblemChanged={() => void detect({ force: true })}
        />
      )}
    </div>
  );
}

/** Problem title and status, shown in the top bar. */
function ProblemHeading({ problem, settings }: { problem: ApiProblem; settings: ExtSettings }) {
  const t = getExtText(settings);
  const due = isDue(problem.fsrsDue);
  return (
    <div className="problem-card-info">
      <h1 className="problem-card-title">
        {problem.leetcodeId != null && <span className="problem-card-num">{problem.leetcodeId}. </span>}
        {problem.title}
      </h1>
      <div className="problem-card-tags">
        <span className={`pill pill-${problem.difficulty.toLowerCase()}`}>{difficultyLabel(problem.difficulty, t)}</span>
        {due ? (
          <span className="pill pill-due">{t.common.due}</span>
        ) : (
          <span className="problem-card-next">
            {t.problem.next} {formatInterval(problem.fsrsDue)}
          </span>
        )}
      </div>
    </div>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4h7M6 8h7M6 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="3" cy="4" r="1" fill="currentColor" />
      <circle cx="3" cy="8" r="1" fill="currentColor" />
      <circle cx="3" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.2c1.8-.6 3.6-.4 5.5.8 1.9-1.2 3.7-1.4 5.5-.8v9.3c-1.8-.6-3.6-.4-5.5.8-1.9-1.2-3.7-1.4-5.5-.8V3.2ZM8 4v9.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Reviews left today, for the Today button's badge. */
function useDueCount(settings: ExtSettings | null, signedIn: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!settings || !signedIn) return;
    const load = async () => {
      try {
        const res = await apiFetch(settings, "/api/review/queue?limit=1", { cache: "no-store" });
        if (res.ok) setCount(((await res.json()) as QueueResponse).queue.remaining);
      } catch {
        /* the badge just stays as it was */
      }
    };
    void load();
    window.addEventListener("focus", load);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.removeEventListener("focus", load);
      window.clearInterval(timer);
    };
  }, [settings, signedIn]);
  return count;
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
      const res = await apiFetch(settings, "/api/review/queue?limit=20", {
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

/** Reloads the active LeetCode tab so the extension's content script loads,
 *  then waits a moment for the page to come up. */
async function refreshLeetcodeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (tab?.id == null) return;
  await chrome.tabs.reload(tab.id).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2_500));
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
  onRefresh: () => Promise<void> | void;
  onError: (msg: string) => void;
}) {
  const t = getExtText(settings);

  // When the active tab has no slug but we have a sticky pin from earlier,
  // keep showing that problem instead of the bare "off-page" placeholder.
  const isStickyView = state.kind === "off-page" && sticky !== null;
  const displayCaptured = captured ?? (isStickyView ? sticky : null);

  if (state.kind === "detecting") return <p className="popup-muted">{t.problem.connecting}</p>;
  if (state.kind === "loading") return <p className="popup-muted">{t.problem.syncing(state.slug)}</p>;

  if (state.kind === "error") {
    // The tab predates the extension: refreshing it is the fix, so offer it.
    const needsTabRefresh = state.msg === t.capture.helperUnavailable;
    return (
      <div className="stack">
        <div className="err-banner">{state.msg}</div>
        <button
          type="button"
          onClick={() => (needsTabRefresh ? void refreshLeetcodeTab().then(() => onRefresh()) : void onRefresh())}
          className="btn btn-primary"
        >
          {needsTabRefresh ? t.capture.refreshTab : t.common.retry}
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

  // The Coach chat below is the problem view; only a pinned problem from
  // another tab needs a note here.
  if (!isStickyView) return null;
  return (
    <div className="sticky-banner">
      <span className="sticky-banner-text">{t.problem.activeTabNotOn(displayCaptured.problem.title)}</span>
      <button type="button" className="btn btn-primary btn-inline" onClick={onJumpToSticky}>
        {t.problem.openIt}
      </button>
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
  const requestIdRef = useRef<string | null>(null);

  async function submit() {
    requestIdRef.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(settings, "/api/review/rate", {
        method: "POST",
        headers: jsonHeaders(settings),
        body: JSON.stringify({ problemId, rating, requestId: requestIdRef.current }),
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
      requestIdRef.current = null;
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
          {busy ? <span className="btn-spinner" /> : <CheckIcon />}
        </button>
      </div>

      {error && <div className="err-banner" style={{ marginTop: 8 }}>{error}</div>}
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
  onCaptured: () => Promise<void> | void;
  onError: (msg: string) => void;
}) {
  const t = getExtText(settings);
  const [phase, setPhase] = useState<"idle" | "reading" | "saving">("idle");
  const busy = phase !== "idle";

  async function captureNow() {
    setPhase("reading");
    try {
      const problem = await readActiveProblem(settings);
      if (problem.leetcodeSlug !== slug) {
        throw new Error(`Active tab is ${problem.leetcodeSlug}, not ${slug}.`);
      }
      setPhase("saving");
      await saveCapturedProblem(settings, problem);
      await onCaptured();
      setPhase("idle");
    } catch (e) {
      setPhase("idle");
      onError(e instanceof Error ? e.message : t.common.unknownError);
    }
  }

  return (
    <div className="panel">
      <span className="section-label">{t.capture.notInDeck}</span>
      <p className="popup-muted" style={{ marginTop: 0 }}>
        {settings.autoCapture ? t.capture.autoHint : t.capture.notCaptured(slug)}
      </p>
      <button
        type="button"
        onClick={captureNow}
        disabled={busy}
        className={settings.autoCapture ? "btn btn-secondary" : "btn btn-primary"}
        style={{ marginTop: 14 }}
      >
        {busy && <span className="btn-spinner" />}
        {phase === "reading"
          ? t.capture.reading
          : phase === "saving"
            ? t.capture.saving
            : settings.autoCapture
              ? t.capture.addNow
              : t.capture.captureThis}
      </button>
    </div>
  );
}

/* ── SettingsTab ── */

function SignInGate({
  settings,
  onAuthenticated,
  onRefresh,
}: {
  settings: ExtSettings;
  onAuthenticated: (account: AuthAccount) => void;
  onRefresh: () => void;
}) {
  const t = getExtText(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, "");

  async function beginSignIn() {
    setError(null);
    setBusy(true);

    try {
      const loginUrl = `${apiBaseUrl}/login?next=${encodeURIComponent("/extension-connected")}`;
      const loginTab = await chrome.tabs.create({ url: loginUrl });

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const account = await loadSessionAccount(apiBaseUrl).catch(() => null);
        if (account) {
          void markExtensionConnected(apiBaseUrl).catch(() => {});
          if (loginTab.id != null) {
            // The session cookie can become visible a moment before the OAuth
            // callback finishes navigating. Give the confirmation page a short
            // window to load so the extension can close only its own auth tab.
            for (let navigationAttempt = 0; navigationAttempt < 20; navigationAttempt += 1) {
              const current = await chrome.tabs.get(loginTab.id).catch(() => null);
              if (!current) break;
              if (current.url?.startsWith(`${apiBaseUrl}/extension-connected`)) {
                await chrome.tabs.remove(loginTab.id).catch(() => {});
                break;
              }
              await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
          }
          onAuthenticated(account);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      setError(t.settings.loginTimedOut);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : t.settings.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="popup-shell">
      <main className="popup-main">
        <div className="panel auth-gate">
          <div className="auth-gate-mark" aria-hidden="true">A</div>
          <h1>{t.settings.signInTitle}</h1>
          <p className="popup-muted">{t.settings.signInBody}</p>
          <div className="settings-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void beginSignIn()}>
              {busy ? t.settings.signingIn : t.settings.signIn}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onRefresh}>
              {t.settings.refreshSession}
            </button>
          </div>
          {error ? <p className="connection-status connection-status-error">{error}</p> : null}
        </div>
      </main>
    </div>
  );
}

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
  account,
  theme,
  onThemeChange,
  onSave,
}: {
  settings: ExtSettings;
  account: AuthAccount;
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
  onSave: (next: Partial<ExtSettings>) => void;
}) {
  const t = getExtText(settings);
  const [testState, setTestState] = useState<{ kind: "idle" | "loading" | "success" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });
  const apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, "");
  const [solvedSync, setSolvedSync] = useState<SolvedSyncState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    void getSolvedSyncState().then(setSolvedSync);
  }, []);

  async function syncSolvedNow() {
    setSyncing(true);
    setSyncError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error(t.settings.syncOpenLeetcode);
      let resp: ContentResponse;
      try {
        resp = (await chrome.tabs.sendMessage(tab.id, { type: "sync_solved_now" })) as ContentResponse;
      } catch (error) {
        throw isMissingContentScriptError(error) ? new Error(t.settings.syncOpenLeetcode) : error;
      }
      if (resp.type === "solved_synced") {
        setSolvedSync(resp.result);
      } else {
        const message = resp.type === "error" ? resp.message : "Unexpected response";
        throw new Error(message === "leetcode_signed_out" ? t.settings.syncLeetcodeSignedOut : message);
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }

  const solvedSyncText = syncError
    ? syncError
    : !solvedSync
      ? t.settings.solvedNever
      : solvedSync.ok
        ? t.settings.solvedSynced(
            solvedSync.count,
            new Date(solvedSync.at).toLocaleString(settings.language === "zh" ? "zh-CN" : "en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            }),
          )
        : t.settings.solvedFailed(solvedSync.error);
  const solvedSyncKind = syncError || (solvedSync && !solvedSync.ok) ? "error" : solvedSync ? "success" : "loading";

  async function testConnection() {
    setTestState({ kind: "loading", message: t.settings.checking });
    try {
      const res = await fetch(`${apiBaseUrl}/api/me`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as { user?: { email?: string }; error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error || `Connection failed (${res.status})`);
      }
      setTestState({
        kind: "success",
        message: t.settings.connectedAs(data?.user?.email ?? t.settings.thisUser),
      });
    } catch (error) {
      setTestState({ kind: "error", message: error instanceof Error ? error.message : t.settings.failed });
    }
  }

  const connectionStatus =
    testState.kind === "loading"
      ? testState.message
      : testState.kind === "error"
        ? testState.message
        : testState.kind === "success"
          ? testState.message
          : t.settings.connectedAs(account.email);
  const connectionStatusKind =
    testState.kind === "loading"
      ? "loading"
      : testState.kind === "error"
        ? "error"
        : "success";

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
              <SettingsTitle info={t.settings.languageHelp}>{t.language.label}</SettingsTitle>
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

      <section className="settings-module panel" aria-labelledby="settings-leetcode-sync">
        <div className="settings-module-head">
          <SettingsTitle as="strong" id="settings-leetcode-sync">
            {t.settings.leetcodeSync}
          </SettingsTitle>
        </div>
        <div className="settings-preference-list">
          <div className="settings-preference-row">
            <div className="settings-preference-copy">
              <SettingsTitle info={t.settings.autoCaptureHelp}>{t.settings.autoCapture}</SettingsTitle>
            </div>
            <label className="settings-switch">
              <input
                type="checkbox"
                checked={settings.autoCapture}
                onChange={(e) => onSave({ autoCapture: e.target.checked })}
                aria-label={t.settings.autoCapture}
              />
              <span aria-hidden="true" />
            </label>
          </div>
        </div>
        <p className={`connection-status connection-status-${solvedSyncKind}`}>{solvedSyncText}</p>
        <div className="settings-actions">
          <button type="button" className="btn btn-secondary" onClick={syncSolvedNow} disabled={syncing}>
            {syncing && <span className="btn-spinner" />}
            {syncing ? t.settings.syncing : t.settings.syncNow}
          </button>
        </div>
      </section>

      <section className="settings-module panel" aria-labelledby="settings-connection">
        <div className="settings-module-head">
          <SettingsTitle as="strong" id="settings-connection" info={t.settings.connectionHelp}>
            {t.settings.connection}
          </SettingsTitle>
        </div>
        <p className={`connection-status connection-status-${connectionStatusKind}`}>
          {connectionStatus}
        </p>
        <div className="settings-actions">
          <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={testState.kind === "loading"}>
            {testState.kind === "loading" ? t.settings.testing : t.settings.testConnection}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void chrome.tabs.create({ url: `${settings.apiBaseUrl.replace(/\/+$/, "")}/settings` })}
          >
            {t.settings.manageAccount}
          </button>
        </div>
      </section>
    </div>
  );
}
