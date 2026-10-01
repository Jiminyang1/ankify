import type {
  AgentNavigation,
  AgentPageContext,
  AgentProposal,
  AiJobCreateRequestInput,
  CaptureProblemInput,
  CaptureSubmissionInput,
  MistakeEvidence,
  MistakeSourceType,
  MistakeStatus,
  QuizAnswer,
  QuizItem,
  SkillDimensionId,
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
  kind: "read" | "navigation" | "proposal";
  toolName: string;
  status: "completed" | "pending" | "accepted" | "dismissed" | "failed";
  summary: string;
  navigation: AgentNavigation | null;
  proposal: AgentProposal | null;
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
  kind: "card" | "quiz" | "analysis";
  action: AiJobCreateRequestInput["action"];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "superseded";
  attempt: number;
  maxAttempts: number;
  resultCardId: string | null;
  resultQuizSessionId: string | null;
  resultAnalysisId: string | null;
  practiceSessionId: string | null;
  trigger: "manual" | "automatic" | null;
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
  /** `awaiting_initial`: first practice not finished; no review is scheduled. */
  enrollment: "enrolled" | "awaiting_initial";
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
  /** Already stored (same LeetCode submission id, or identical id-less content). */
  duplicateSubmissions: number;
  /** Duplicates whose missing details were filled in from this delivery. */
  enrichedSubmissions: number;
  /** Submission ids already stored under a different problem; never reassigned. */
  conflictingSubmissions: number;
  /** Not stored because the problem reached its submission cap. */
  capacityBlockedSubmissions: number;
};

export type MistakeRecordDto = {
  id: string;
  problemId: string;
  primaryCategory: SkillDimensionId;
  secondaryTags: string[];
  summary: string | null;
  nextStep: string | null;
  sourceType: MistakeSourceType;
  submissionId: string | null;
  quizSessionId: string | null;
  quizItemId: string | null;
  reviewEventId: string | null;
  practiceSessionId: string | null;
  evidence: MistakeEvidence[];
  /** The session analysis an AI candidate came from. */
  analysisId: string | null;
  status: MistakeStatus;
  origin: "user" | "ai_suggested";
  resolvedAt: string | null;
  confirmedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MistakeCreateResponseDto = {
  ok: true;
  mistake: MistakeRecordDto;
  /** A retry of the same `requestId`; nothing new was written. */
  idempotentReplay: boolean;
  /** The same source already had a record of this category; it is returned instead. */
  deduplicated: boolean;
};

export type MistakeListPayloadDto = {
  mistakes: MistakeRecordDto[];
  nextCursor: string | null;
};

export type MistakeProfileCategoryDto = {
  category: SkillDimensionId;
  /** 0-1: smoothed failure rate times confidence; `weak` from 0.25. */
  weakness: number;
  weak: boolean;
  /** Confirmed evidence from at least two contexts across two problems. */
  ready: boolean;
  contexts: number;
  problems: number;
  unresolved: number;
  resolved: number;
  /** Later accepted sessions on its problems without this mistake again. */
  cleanReviews: number;
  lastSeenAt: string | null;
  trend: { current: number; previous: number; periodDays: number };
  examples: { mistakeId: string; problemId: string; problemTitle: string; summary: string | null; createdAt: string; practiceSessionId: string | null }[];
};

export type MistakeProfileDto = {
  generatedAt: string;
  windowDays: number;
  halfLifeDays: number;
  readiness: {
    completedSessions: number;
    distinctProblems: number;
    /** Weakness targeting is personalized only past these minimums. */
    personalized: boolean;
    required: { sessions: number; problems: number };
  };
  categories: MistakeProfileCategoryDto[];
  /** Unconfirmed AI findings; never counted as weakness until confirmed. */
  candidates: { mistakeId: string; problemId: string; problemTitle: string; category: SkillDimensionId; summary: string | null; createdAt: string; practiceSessionId: string | null }[];
  topics: {
    topic: string;
    sessions: number;
    accepted: number;
    failed: number;
    firstTryAccepted: number;
    medianFailedBeforeAccepted: number | null;
    weakness: number;
  }[];
  signals: {
    sessions: { completed: number; accepted: number; failed: number; unknown: number; interrupted: number; abandoned: number };
    ratings: { again: number; hard: number; good: number; easy: number };
  };
  incomplete: { sessionsWithPartialCapture: number; ambiguousObservations: number };
};
