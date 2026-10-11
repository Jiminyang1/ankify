import {
  CARDS_DOC_MAX_CHARS,
  NOTES_DOC_MAX_CHARS,
  SOLUTIONS_DOC_MAX_CHARS,
  applyCardsEdit,
  applyNotesEdit,
  notesSections,
  parseCards,
  parseSolutions,
  type DocEditError,
} from "@ankify/core";
import { docEditTarget, type DocEdit, type ProblemDocTarget, type ProblemDocsDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq, inArray } from "drizzle-orm";

/** The problem's Notes, Cards, and Solutions docs (docs/coach-practice.md).
 *  Every write checks the doc's version, so a stale editor tab or Coach
 *  proposal can't overwrite newer text. */

export type DocWriteError = DocEditError | "problem_not_found" | "version_conflict";
export type DocWriteResult = { ok: true; docs: ProblemDocsDto } | { ok: false; error: DocWriteError };

type DocRow = {
  id: string;
  notes: string | null;
  notesVersion: number;
  cardsMd: string | null;
  cardsVersion: number;
  solutionsMd: string | null;
  solutionsVersion: number;
};

async function loadRow(userId: string, problemId: string): Promise<DocRow | null> {
  const [row] = await getDb()
    .select({
      id: schema.problems.id,
      notes: schema.problems.notes,
      notesVersion: schema.problems.notesVersion,
      cardsMd: schema.problems.cardsMd,
      cardsVersion: schema.problems.cardsVersion,
      solutionsMd: schema.problems.solutionsMd,
      solutionsVersion: schema.problems.solutionsVersion,
    })
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  return row ?? null;
}

export function toProblemDocsDto(row: DocRow): ProblemDocsDto {
  const notes = row.notes ?? "";
  const cards = row.cardsMd ?? "";
  const solutions = row.solutionsMd ?? "";
  const parsed = parseCards(cards);
  const parsedSolutions = parseSolutions(solutions);
  return {
    problemId: row.id,
    notes: { markdown: notes, version: row.notesVersion, sections: notesSections(notes) },
    cards: { markdown: cards, version: row.cardsVersion, cards: parsed.cards, issues: parsed.issues },
    solutions: {
      markdown: solutions,
      version: row.solutionsVersion,
      approaches: parsedSolutions.approaches,
      issues: parsedSolutions.issues,
    },
  };
}

export async function loadProblemDocs(userId: string, problemId: string): Promise<ProblemDocsDto | null> {
  const row = await loadRow(userId, problemId);
  return row ? toProblemDocsDto(row) : null;
}

/** Replaces one doc, as long as nobody changed it since `expectedVersion`. */
async function writeDoc(
  userId: string,
  row: DocRow,
  target: ProblemDocTarget,
  markdown: string,
  expectedVersion: number,
): Promise<DocWriteResult> {
  const versionColumn = {
    notes: schema.problems.notesVersion,
    cards: schema.problems.cardsVersion,
    solutions: schema.problems.solutionsVersion,
  }[target];
  const nextVersion = expectedVersion + 1;
  const updated = await getDb()
    .update(schema.problems)
    .set(
      target === "notes"
        ? { notes: markdown, notesVersion: nextVersion, updatedAt: new Date() }
        : target === "cards"
          ? { cardsMd: markdown, cardsVersion: nextVersion, updatedAt: new Date() }
          : { solutionsMd: markdown, solutionsVersion: nextVersion, updatedAt: new Date() },
    )
    .where(
      and(
        eq(schema.problems.id, row.id),
        eq(schema.problems.userId, userId),
        eq(versionColumn, expectedVersion),
      ),
    )
    .returning({ id: schema.problems.id });
  if (updated.length === 0) return { ok: false, error: "version_conflict" };
  return {
    ok: true,
    docs: toProblemDocsDto(
      target === "notes"
        ? { ...row, notes: markdown, notesVersion: nextVersion }
        : target === "cards"
          ? { ...row, cardsMd: markdown, cardsVersion: nextVersion }
          : { ...row, solutionsMd: markdown, solutionsVersion: nextVersion },
    ),
  };
}

/** The user's own edit from the docs editor. Drafts may have parse issues
 *  (an empty answer while typing), but not exceed the size limits. */
export async function saveProblemDoc(
  userId: string,
  problemId: string,
  target: ProblemDocTarget,
  markdown: string,
  expectedVersion: number,
): Promise<DocWriteResult> {
  const row = await loadRow(userId, problemId);
  if (!row) return { ok: false, error: "problem_not_found" };
  if (target === "notes" && markdown.length > NOTES_DOC_MAX_CHARS) return { ok: false, error: "too_long" };
  // A session in progress keeps the copy it started with; edits apply next time.
  if (target === "solutions" && markdown.length > SOLUTIONS_DOC_MAX_CHARS) return { ok: false, error: "too_long" };
  if (target === "cards") {
    if (markdown.length > CARDS_DOC_MAX_CHARS) return { ok: false, error: "too_long" };
    if (parseCards(markdown).issues.some((issue) => issue.kind === "too_many_cards")) {
      return { ok: false, error: "too_many_cards" };
    }
  }
  return writeDoc(userId, row, target, markdown, expectedVersion);
}

/** Checks an edit against the current doc without writing it, so the Coach's
 *  proposals fail when proposed instead of when applied. */
export async function previewProblemDocEdit(
  userId: string,
  problemId: string,
  edit: DocEdit,
): Promise<{ ok: true; baseVersion: number } | { ok: false; error: DocWriteError }> {
  const row = await loadRow(userId, problemId);
  if (!row) return { ok: false, error: "problem_not_found" };
  const target = docEditTarget(edit);
  const result = applyEdit(row, edit);
  if (!result.ok) return result;
  return { ok: true, baseVersion: target === "notes" ? row.notesVersion : row.cardsVersion };
}

/** Applies a Coach proposal the user approved. Fails with version_conflict
 *  when the doc changed after the proposal was made. */
export async function applyProblemDocEdit(
  userId: string,
  problemId: string,
  edit: DocEdit,
  baseVersion: number,
): Promise<DocWriteResult> {
  const row = await loadRow(userId, problemId);
  if (!row) return { ok: false, error: "problem_not_found" };
  const target = docEditTarget(edit);
  const current = target === "notes" ? row.notesVersion : row.cardsVersion;
  if (current !== baseVersion) return { ok: false, error: "version_conflict" };
  const result = applyEdit(row, edit);
  if (!result.ok) return result;
  return writeDoc(userId, row, target, result.markdown, baseVersion);
}

function applyEdit(row: DocRow, edit: DocEdit) {
  switch (edit.op) {
    case "append_section":
    case "replace_section":
      return applyNotesEdit(row.notes, edit);
    case "add_card":
    case "update_card":
    case "remove_card":
      return applyCardsEdit(row.cardsMd, edit);
  }
}

export const DOC_WRITE_STATUS: Record<DocWriteError, number> = {
  problem_not_found: 404,
  version_conflict: 409,
  card_not_found: 409,
  duplicate_prompt: 400,
  invalid_prompt: 400,
  empty_answer: 400,
  invalid_section: 400,
  too_many_cards: 400,
  too_long: 400,
};


/** Cards per problem, counted from each problem's Cards doc. */
export async function countDocCards(userId: string, problemIds: string[]): Promise<Map<string, number>> {
  if (problemIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: schema.problems.id, cardsMd: schema.problems.cardsMd })
    .from(schema.problems)
    .where(and(eq(schema.problems.userId, userId), inArray(schema.problems.id, problemIds)));
  return new Map(rows.map((row) => [row.id, parseCards(row.cardsMd).cards.length]));
}
