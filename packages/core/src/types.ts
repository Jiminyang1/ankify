export type LeetCodeDifficulty = "Easy" | "Medium" | "Hard";

export type SubmissionStatus =
  | "Accepted"
  | "Wrong Answer"
  | "Time Limit Exceeded"
  | "Memory Limit Exceeded"
  | "Runtime Error"
  | "Compile Error"
  | "Other";

export type AiProvider = "anthropic" | "openai" | "deepseek" | "";

export interface AiProviderSettings {
  provider: AiProvider;
  model: string;
}

/* FSRS rating: 1=Again, 2=Hard, 3=Good, 4=Easy */
export type FsrsRating = 1 | 2 | 3 | 4;
