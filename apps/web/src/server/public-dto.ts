import type { QuizSessionDto, SubmissionDto } from "@ankify/contracts";
import { schema, type QuizSession } from "@ankify/db";

type PublicQuizSessionRow = Pick<
  QuizSession,
  | "id"
  | "problemId"
  | "status"
  | "itemsJson"
  | "answersJson"
  | "score"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
>;

export const publicCardColumns = {
  id: schema.cards.id,
  version: schema.cards.version,
  aiStatus: schema.cards.aiStatus,
  errorMessage: schema.cards.errorMessage,
  question: schema.cards.question,
  answer: schema.cards.answer,
} as const;

export const publicSubmissionColumns = {
  id: schema.submissions.id,
  language: schema.submissions.language,
  code: schema.submissions.code,
  status: schema.submissions.status,
  runtimeMs: schema.submissions.runtimeMs,
  memoryKb: schema.submissions.memoryKb,
  failedTestcase: schema.submissions.failedTestcase,
  expectedOutput: schema.submissions.expectedOutput,
  actualOutput: schema.submissions.actualOutput,
  errorMessage: schema.submissions.errorMessage,
  submittedAt: schema.submissions.submittedAt,
} as const;

type PublicSubmissionRow = {
  [Key in keyof typeof publicSubmissionColumns]: (typeof schema.submissions.$inferSelect)[Key];
};

export function toSubmissionDto(submission: PublicSubmissionRow): SubmissionDto {
  return {
    ...submission,
    submittedAt: submission.submittedAt.toISOString(),
  };
}

export function toQuizSessionDto(session: PublicQuizSessionRow): QuizSessionDto {
  return {
    id: session.id,
    problemId: session.problemId,
    status: session.status,
    itemsJson: session.itemsJson,
    answersJson: session.answersJson,
    score: session.score,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}
