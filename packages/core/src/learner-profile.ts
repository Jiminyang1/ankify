/**
 * The learner profile: a markdown doc of durable facts about how the user
 * studies, one `##` section per topic and one `-` bullet per fact:
 *
 *   ## 写题语言
 *   - Java
 *
 *   ## 讲解方式
 *   - 先讲直觉，再讲严格证明
 *
 * The Coach reads it on every turn and adds or removes bullets; the user
 * edits the whole doc in Settings. Every write bumps its version. Edits are
 * line-based, so anything else the user writes is kept as is.
 * Problem-specific mistakes are weak spots, not profile facts.
 */

/** The whole doc goes into every Coach turn, so it stays small. */
export const MAX_LEARNER_PROFILE_LENGTH = 2_000;
export const MAX_LEARNER_FACT_LENGTH = 200;
export const MAX_LEARNER_SECTION_LENGTH = 40;

export type LearnerProfile = { markdown: string; version: number };

export type LearnerProfileEdit =
  /** Adds a bullet to `section` (created when missing), or rewrites the bullet `replace`. */
  | { op: "remember"; section: string; text: string; replace?: string }
  /** Removes a bullet; a section left empty goes too. */
  | { op: "forget"; section: string; text: string };

export type LearnerProfileEditResult =
  | { ok: true; markdown: string; changed: boolean }
  | { ok: false; error: "empty" | "too_long" | "not_found" | "full" };

const HEADING = /^##\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;

function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(text: string) {
  return oneLine(text).toLowerCase().replace(/[.。!！]+$/u, "");
}

/** Line range of a `##` section's body: [start, end). */
function findSection(lines: string[], section: string) {
  const want = normalize(section);
  const heading = lines.findIndex((line) => {
    const match = HEADING.exec(line);
    return match !== null && normalize(match[1]!) === want;
  });
  if (heading === -1) return null;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end]!)) end += 1;
  return { heading, start: heading + 1, end };
}

function findBullet(lines: string[], range: { start: number; end: number }, text: string) {
  const want = normalize(text);
  for (let i = range.start; i < range.end; i += 1) {
    const match = BULLET.exec(lines[i]!);
    if (match && normalize(match[1]!) === want) return i;
  }
  return -1;
}

function finish(lines: string[]) {
  const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return markdown ? `${markdown}\n` : "";
}

export function applyLearnerProfileEdit(markdown: string, edit: LearnerProfileEdit): LearnerProfileEditResult {
  const section = oneLine(edit.section).replace(/^#+\s*/, "");
  const text = oneLine(edit.text);
  if (!section || !text) return { ok: false, error: "empty" };
  if (section.length > MAX_LEARNER_SECTION_LENGTH || text.length > MAX_LEARNER_FACT_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const range = findSection(lines, section);

  if (edit.op === "forget") {
    const index = range ? findBullet(lines, range, text) : -1;
    if (!range || index === -1) return { ok: false, error: "not_found" };
    lines.splice(index, 1);
    const body = lines.slice(range.start, range.end - 1);
    if (body.every((line) => !line.trim())) lines.splice(range.heading, range.end - range.heading - 1);
    return { ok: true, markdown: finish(lines), changed: true };
  }

  if (edit.replace !== undefined) {
    const index = range ? findBullet(lines, range, edit.replace) : -1;
    if (!range || index === -1) return { ok: false, error: "not_found" };
    if (findBullet(lines, range, text) !== -1) {
      // The rewrite says what another bullet already says: fold into it.
      if (normalize(edit.replace) !== normalize(text)) lines.splice(index, 1);
    } else {
      lines[index] = lines[index]!.replace(BULLET, (whole, old: string) => whole.slice(0, whole.length - old.length) + text);
    }
  } else if (range) {
    if (findBullet(lines, range, text) !== -1) return { ok: true, markdown, changed: false };
    let last = range.end - 1;
    while (last >= range.start && !lines[last]!.trim()) last -= 1;
    lines.splice(Math.max(last, range.heading) + 1, 0, `- ${text}`);
  } else {
    while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
    if (lines.length > 0) lines.push("");
    lines.push(`## ${section}`, `- ${text}`);
  }

  const next = finish(lines);
  if (next.length > MAX_LEARNER_PROFILE_LENGTH && next.length > markdown.length) return { ok: false, error: "full" };
  return { ok: true, markdown: next, changed: next !== markdown };
}

/** Reads the stored settings value; anything malformed is an empty profile. */
export function parseLearnerProfile(value: unknown): LearnerProfile {
  const stored = value as { markdown?: unknown; version?: unknown } | null;
  return {
    markdown: typeof stored?.markdown === "string" ? stored.markdown : "",
    version: typeof stored?.version === "number" && Number.isInteger(stored.version) ? stored.version : 0,
  };
}
