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
  | { type: "step"; step: AgentStepDto }
  | { type: "done"; session: AgentSessionDto; message: AgentMessageDto; run: AgentRunDto }
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
  cardTotal: number;
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
  extensionConnectedAt?: string;
  aiVerifiedAt?: string;
  firstCaptureAt?: string;
  firstReviewAt?: string;
  completedAt?: string;
  complete: boolean;
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

/** A problem's Notes and Cards docs (docs/coach-practice.md). */
export type ProblemDocsDto = {
  problemId: string;
  notes: { markdown: string; version: number; sections: string[] };
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
  /** Talk-through targets with their grades (mode "talk"). */
  targets: {
    id: string;
    kind: "weakness" | "category" | "core";
    category: string | null;
    label: string;
    grade: { grade: "correct" | "partial" | "missed"; reason: string } | null;
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
