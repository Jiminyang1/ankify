import type { CaptureProblemInput, CaptureSubmissionInput } from "@ankify/contracts";

/* Per-field caps mirror packages/contracts/src/schemas.ts captureProblemSchema. */
const CAPTURE_LIMITS = {
  descriptionMd: 200_000,
  code: 100_000,
  output: 20_000,
  errorMessage: 10_000,
  submissions: 20,
  requestBytes: 3_800_000,
} as const;

function clip(value: string | undefined, max: number): string | undefined {
  if (value == null) return value;
  return value.length > max ? value.slice(0, max) : value;
}

function trimSubmission(s: CaptureSubmissionInput): CaptureSubmissionInput {
  return {
    ...s,
    code: clip(s.code, CAPTURE_LIMITS.code) ?? "",
    failedTestcase: clip(s.failedTestcase, CAPTURE_LIMITS.output),
    expectedOutput: clip(s.expectedOutput, CAPTURE_LIMITS.output),
    actualOutput: clip(s.actualOutput, CAPTURE_LIMITS.output),
    errorMessage: clip(s.errorMessage, CAPTURE_LIMITS.errorMessage),
  };
}

/** Serialize under Vercel's 4.5 MB request cap, dropping the oldest
 *  submissions first so the newest (most relevant) ones survive. */
function encodeWithinLimit<T extends { submissions: CaptureSubmissionInput[] }>(payload: T): string {
  const encoder = new TextEncoder();
  let body = JSON.stringify(payload);
  while (payload.submissions.length > 0 && encoder.encode(body).byteLength > CAPTURE_LIMITS.requestBytes) {
    payload.submissions.pop();
    body = JSON.stringify(payload);
  }
  if (encoder.encode(body).byteLength > CAPTURE_LIMITS.requestBytes) {
    throw new Error("Capture payload is too large even without submissions.");
  }
  return body;
}

export function encodeCapturePayload(problem: CaptureProblemInput): string {
  return encodeWithinLimit({
    ...problem,
    descriptionMd: clip(problem.descriptionMd, CAPTURE_LIMITS.descriptionMd),
    submissions: problem.submissions.slice(0, CAPTURE_LIMITS.submissions).map(trimSubmission),
  });
}

/** Body for POST /api/problems/by-slug/:slug/submissions. */
export function encodeSubmissionSyncPayload(submissions: CaptureSubmissionInput[]): string {
  return encodeWithinLimit({ submissions: submissions.slice(0, CAPTURE_LIMITS.submissions).map(trimSubmission) });
}
