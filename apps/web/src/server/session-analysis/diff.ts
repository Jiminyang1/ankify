/** Lines beyond which a diff is not computed (the caller shows full code). */
const MAX_DIFF_LINES = 1_000;
const CONTEXT = 2;

/**
 * A unified line diff from `before` to `after` with two lines of context, or
 * null when either side is too long to diff cheaply. Hunk headers use the
 * usual `@@ -a,b +c,d @@` positions, so lines can be cited in `after`.
 */
export function unifiedLineDiff(before: string, after: string): string | null {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;

  // LCS table over lines, filled from the end so the walk below goes forward.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  type Op = { kind: " " | "-" | "+"; text: string; aLine: number; bLine: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]!, aLine: i + 1, bLine: j + 1 });
      i += 1;
      j += 1;
    } else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
      // Deletions before additions, as in conventional unified diffs.
      ops.push({ kind: "-", text: a[i]!, aLine: i + 1, bLine: j });
      i += 1;
    } else {
      ops.push({ kind: "+", text: b[j]!, aLine: i, bLine: j + 1 });
      j += 1;
    }
  }

  const changed = ops.map((op, index) => (op.kind === " " ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return "";
  const hunks: string[] = [];
  let start = 0;
  while (start < changed.length) {
    let end = start;
    while (end + 1 < changed.length && changed[end + 1]! - changed[end]! <= CONTEXT * 2 + 1) end += 1;
    const from = Math.max(0, changed[start]! - CONTEXT);
    const to = Math.min(ops.length - 1, changed[end]! + CONTEXT);
    const slice = ops.slice(from, to + 1);
    const aCount = slice.filter((op) => op.kind !== "+").length;
    const bCount = slice.filter((op) => op.kind !== "-").length;
    const aStart = slice.find((op) => op.kind !== "+")?.aLine ?? slice[0]!.aLine;
    const bStart = slice.find((op) => op.kind !== "-")?.bLine ?? slice[0]!.bLine;
    hunks.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@\n${slice.map((op) => `${op.kind}${op.text}`).join("\n")}`);
    start = end + 1;
  }
  return hunks.join("\n");
}
