/**
 * Skill dimensions: the mistake-profile taxonomy. The first five IDs are the
 * quiz item scopes, so quiz accuracy per dimension needs no extra data.
 * `@ankify/contracts` mirrors this list as `skillDimensionEnum`.
 */
export const SKILL_DIMENSIONS = [
  "approach",
  "invariant",
  "edge_case",
  "complexity",
  "implementation",
  "conceptual",
  "other",
] as const;

export type SkillDimension = (typeof SKILL_DIMENSIONS)[number];

const SCOPE_DIMENSIONS: Readonly<Record<string, SkillDimension>> = {
  approach: "approach",
  invariant: "invariant",
  edge_case: "edge_case",
  complexity: "complexity",
  implementation: "implementation",
};

/**
 * Maps a quiz item scope to a skill dimension. `mistake_review` asks about a
 * past mistake rather than testing one skill, so it has no dimension.
 */
export function quizScopeToDimension(scope: string): SkillDimension | null {
  return SCOPE_DIMENSIONS[scope] ?? null;
}

export function isSkillDimension(value: unknown): value is SkillDimension {
  return typeof value === "string" && (SKILL_DIMENSIONS as readonly string[]).includes(value);
}
