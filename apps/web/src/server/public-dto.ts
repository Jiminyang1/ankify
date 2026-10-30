import type { SubmissionDto } from "@ankify/contracts";
import { schema } from "@ankify/db";

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
