import type {
  AgentNavigation,
  AgentPageContext,
  AgentProposal,
  AiJobCreateRequestInput,
  CaptureProblemInput,
  CaptureSubmissionInput,
  QuizAnswer,
  QuizItem,
} from "./schemas";

/** What the Coach's model picker offers. With the server's starter key the
 *  model is fixed, so `models` is empty. */
export type CoachModelsDto = {
  source: "user" | "starter";
  provider: string;
  /** The Settings model and level, used when the panel picks nothing. */
  defaultModel: string;
  defaultReasoningLevel: string;
  models: { id: string; reasoningLevels: string[] }[];
};

export type AgentSessionDto = {
  id: string;
  title: string | null;
  status: "active" | "archived";
  runCount: number;
  contextRunCount: number;
  suggestNewSession: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentMessageDto = {
  id: string;
  sessionId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AgentRunDto = {
  id: string;
  sessionId: string;
  requestId: string;
  status: "running" | "succeeded" | "failed";
  context: AgentPageContext;
  errorCode: string | null;
  errorMessage: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: string;
  finishedAt: string | null;
};

export type AgentStepDto = {
  id: string;
  runId: string;
  sequence: number;
  kind: "read" | "navigation" | "proposal" | "practice" | "weakness";
  toolName: string;
  status: "completed" | "pending" | "accepted" | "dismissed" | "failed";
  summary: string;
  navigation: AgentNavigation | null;
  proposal: AgentProposal | null;
  /** Set on `practice` steps: the session the Coach started. */
  practiceSessionId: string | null;
  /** Set on `weakness` steps: the weakness the Coach recorded. */
  weaknessId: string | null;
  aiJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionSnapshotDto = {
  session: AgentSessionDto;
  messages: AgentMessageDto[];
  runs: AgentRunDto[];
  steps: AgentStepDto[];
};

export type AgentStreamEvent =
  | {
      type: "run_started";
      session: AgentSessionDto;
      run: AgentRunDto;
      message: AgentMessageDto;
    }
  | { type: "text_delta"; delta: string }
  /** The model is still thinking: a liveness pulse, about one every 2s. Never carries its reasoning. */
  | { type: "thinking" }
  | { type: "step"; step: AgentStepDto }
  | { type: "done"; session: AgentSessionDto; message: AgentMessageDto; run: AgentRunDto }
  /** A practice reply was judged; the session's progress before the Coach replies. */
  | { type: "practice"; session: PracticeSessionDto }
  | { type: "error"; run: AgentRunDto; message: string };

export type CardDto = {
  id: string;
  version: number;
  aiStatus: "candidate" | "failed" | "ready";
  errorMessage: string | null;
  question: string;
  answer: string;
};

export type SubmissionDto = {
  id: string;
  language: string;
  code: string;
  status: CaptureSubmissionInput["status"];
  runtimeMs: number | null;
  memoryKb: number | null;
  failedTestcase: string | null;
  expectedOutput: string | null;
  actualOutput: string | null;
  errorMessage: string | null;
  submittedAt: string;
};

export type QuizSessionDto = {
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

export type PublicAiJobDto = {
  id: string;
  problemId: string;
  kind: "card" | "quiz" | "practice";
  action: AiJobCreateRequestInput["action"];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "superseded";
  attempt: number;
  maxAttempts: number;
  resultCardId: string | null;
  resultQuizSessionId: string | null;
  targetCardId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProblemDto = {
  id: string;
  leetcodeSlug: string;
  leetcodeId: number | null;
  title: string;
  difficulty: CaptureProblemInput["difficulty"];
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsStability: number | null;
  notes: string | null;
};

export type ProblemListItemDto = {
  id: string;
  leetcodeSlug: string;
  leetcodeId: number | null;
  title: string;
  difficulty: CaptureProblemInput["difficulty"];
  topicTags: string[];
  fsrsDue: string | null;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsState: "new" | "learning" | "review" | "relearning";
  archivedAt: string | null;
  createdAt: string;
};

export type ProblemsListPayloadDto = {
  problems: ProblemListItemDto[];
  dueCount: number;
  serverNow: string;
  totalCount?: number;
  nextCursor: string | null;
};

export type QueueStatsDto = {
  dailyReviewLimit: number;
  doneToday: number;
  remaining: number;
  totalDue: number;
  dueCount: number;
};

export type QueueProblemDto = {
  id: string;
  leetcodeSlug: string;
  title: string;
  difficulty: CaptureProblemInput["difficulty"];
  url: string;
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsDue: string | null;
  fsrsStability: number | null;
  fsrsReps: number;
  fsrsLapses: number;
  /** Legacy: cards in the old Cards doc, which extension builds before the
   *  Cards doc moved into Notes (0.3.x) still show on Today. */
  cardCount: number;
};

export type ReviewQueuePayloadDto = {
  queue: QueueStatsDto;
  problems: QueueProblemDto[];
};

export type ReviewRateResponseDto = {
  ok: true;
  idempotentReplay: boolean;
  nextDue: string | null;
  queue: QueueStatsDto;
};

/** A name in both languages the app speaks. Pattern names come from
 *  灵茶山艾府's lists (zh) and ankify's own translations (en). */
export type LocalizedNameDto = { en: string; zh: string };

export type PatternStepDto = {
  slug: string;
  id: number;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  premium: boolean;
  /** Contest rating; null for problems that never appeared in a contest. */
  rating: number | null;
  tier: "core" | "advanced" | "extension";
  /** Set when the problem is in the deck. */
  problemId: string | null;
  /** Solved on LeetCode or in the deck. */
  done: boolean;
};

export type PatternRefDto = {
  key: string;
  name: LocalizedNameDto;
  topic: { key: string; name: LocalizedNameDto; sourceUrl: string };
};

export type ProblemPatternDto = PatternRefDto & {
  done: number;
  total: number;
  /** "Other" sections, where problems share no technique. */
  misc: boolean;
  /** Every problem in ladder order (core, advanced, extension). */
  steps: PatternStepDto[];
};

export type ProblemPatternsDto = {
  slug: string;
  patterns: ProblemPatternDto[];
};

export type ReviewUndoResponseDto = {
  ok: true;
  queue: QueueStatsDto;
};

export type FsrsPreviewsDto = Record<1 | 2 | 3 | 4, { due: string }>;

export type ProblemLookupPayloadDto = {
  problem: ProblemDto;
  cards: CardDto[];
  candidates: CardDto[];
  previews: FsrsPreviewsDto;
  queue: QueueStatsDto;
};

export type ReviewProblemDto = {
  id: string;
  leetcodeId: number | null;
  leetcodeSlug: string;
  title: string;
  difficulty: CaptureProblemInput["difficulty"];
  descriptionMd: string | null;
  topicTags: string[];
  fsrsDue: string | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsElapsedDays: number | null;
  fsrsScheduledDays: number | null;
  fsrsLearningSteps: number;
  fsrsReps: number;
  fsrsLapses: number;
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsLastReview: string | null;
};

export type ReviewPayloadDto = {
  problem: ReviewProblemDto | null;
  previews: FsrsPreviewsDto | null;
  previewedAt: string;
  queue: QueueStatsDto;
};

export type AuthUserDto = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

export type OnboardingProgressDto = {
  aiChoice: "not_started" | "configured" | "skipped";
  /** When the user first picked a study plan, in onboarding or on the Plan page. */
  planChosenAt?: string;
  extensionConnectedAt?: string;
  aiVerifiedAt?: string;
  firstCaptureAt?: string;
  firstReviewAt?: string;
  completedAt?: string;
  complete: boolean;
};

/** Today's Next part (web and extension): the current plan's first problem
 *  the user hasn't solved, in plan order, and the chapter it's in. */
export type PlanNextDto = {
  plan: {
    slug: string;
    name: string;
    /** 灵茶山艾府's post, for his lists; null for other plans. */
    sourceUrl: string | null;
    /** Problems solved on LeetCode or in review, of the plan's total. */
    done: number;
    total: number;
  };
  /** null once every problem in the plan is solved. */
  next: {
    chapter: { name: string; done: number; total: number };
    problem: { slug: string; leetcodeId: number; title: string; difficulty: "Easy" | "Medium" | "Hard" };
  } | null;
};

export type CaptureResultDto = {
  problemId: string;
  created: boolean;
  importedSubmissions: number;
  submissionLimitReached: boolean;
};

/** Public LeetCode profile data; no LeetCode login is involved. */
export type LeetcodeProfileDto = {
  username: string;
  avatarUrl: string | null;
  ranking: number | null;
  solved: { all: number; easy: number; medium: number; hard: number };
  streak: number;
  activeDays: number;
  /** LeetCode exposes only the latest 20 accepted submissions publicly. */
  recentAccepted: { slug: string; title: string; acceptedAt: string }[];
};

export type LeetcodeAccountDto = {
  username: string;
  linkedAt: string;
  fetchedAt: string | null;
  profile: LeetcodeProfileDto | null;
};

/** A problem's Notes and Solutions docs (docs/coach-practice.md). `cards` is
 *  legacy: the Cards doc moved into Notes (migration 0025), and only older
 *  extension builds (0.3.x, with a Cards tab) still read it. */
export type ProblemDocsDto = {
  problemId: string;
  notes: { markdown: string; version: number; sections: string[] };
  solutions: {
    markdown: string;
    version: number;
    approaches: { id: string; name: string; mine: boolean; points: string[]; complexity: string | null }[];
    issues: (
      | { kind: "no_points"; approach: string }
      | { kind: "too_many_points"; approach: string; limit: number }
      | { kind: "too_many_approaches"; limit: number }
      | { kind: "too_long"; limit: number }
    )[];
  };
  cards: {
    markdown: string;
    version: number;
    cards: { key: string; prompt: string; answer: string }[];
    issues: (
      | { kind: "empty_answer"; prompt: string }
      | { kind: "duplicate_prompt"; prompt: string }
      | { kind: "too_many_cards"; limit: number }
      | { kind: "too_long"; limit: number }
    )[];
  };
};

/** A practice session as the client sees it: check answers stay hidden until
 *  each question is answered. */
export type PracticeSessionDto = {
  id: string;
  problemId: string;
  status: "active" | "completed" | "abandoned";
  mode: "recall_check" | "talk";
  /** Ended by the user before everything was answered. */
  endedEarly: boolean;
  /** Talk-through targets with their grades (mode "talk"). */
  targets: {
    id: string;
    kind: "weakness" | "category" | "core";
    category: string | null;
    label: string;
    grade: { grade: "correct" | "partial" | "missed"; reason: string } | null;
    /** Times the Coach asked again on it (follow-ups, hints). */
    nudges: number;
    /** Judged against a reference (version 3); false when the Coach grades. */
    judged: boolean;
    /** Reference points covered so far, while it's open. */
    progress: { covered: number; total: number } | null;
    /** How it was settled: the help it needed caps the grade. */
    settledBy: "complete" | "new_approach" | "gave_up" | "not_recalled" | null;
    help: 0 | 1 | 2;
    /** Once settled: the approach it was judged against and each point. */
    review: { approach: string | null; points: { text: string; covered: boolean }[] } | null;
    /** "I did say that" can re-judge it (once). */
    canDispute: boolean;
  }[];
  recall: { key: string; prompt: string; answer: string; result: "got_it" | "missed" | null }[];
  check: {
    status: "pending" | "ready" | "failed" | "skipped";
    /** Why there are no questions, when failed or skipped. */
    message: string | null;
    items: {
      id: string;
      question: string;
      choices: string[];
      scope: string;
      source: { kind: "statement" | "notes" | "card" | "submission"; ref: string | null };
      answer: { choice: number; correct: boolean; answerIndex: number; explanation: string } | null;
    }[];
  };
  score: number | null;
  suggestedRating: 1 | 2 | 3 | 4 | null;
  createdAt: string;
  completedAt: string | null;
};

/** One specific mistake on a problem (docs/coach-practice.md, version 2). */
export type WeaknessDto = {
  id: string;
  problemId: string;
  category: string;
  /** Display name: built-in names are localized on the client; custom ones come from here. */
  categoryName: string | null;
  detail: string;
  evidence: { kind: "submission" | "practice" | "conversation"; ref: string; note?: string }[];
  status: "active" | "resolved" | "dismissed";
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

/** Weaknesses across problems, by category. */
export type WeaknessProfileDto = {
  categories: {
    category: string;
    categoryName: string | null;
    active: number;
    resolved: number;
    hits: number;
    recent: number;
    recentlyResolved: number;
    problems: { id: string; title: string; leetcodeSlug: string }[];
  }[];
  customCategories: { key: string; name: string; description: string }[];
};
