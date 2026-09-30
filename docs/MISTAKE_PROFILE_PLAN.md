# Mistake Profile

Helps users see the *recurring causes* of their failures across LeetCode
problems, instead of isolated wrong submissions or topic-level statistics. The
user stays in control: they record a mistake, categorize it, link it to
evidence, and act on the pattern. Everything works without AI or paid credits.
Architecture context: [ARCHITECTURE.md](ARCHITECTURE.md). The daily practice
feed built on top of this profile: [DAILY_FEED_PLAN.md](DAILY_FEED_PLAN.md).

**User value:** "I repeatedly mishandle DFS return values and base cases" is
actionable; "I missed seven Tree questions" is not.

## Status

| Area | Status |
| --- | --- |
| PR1: manual logging (schema, API, record dialog, entry points, export) | Implemented on `feat/mistake-profile`; DB and contract tests |
| Session evidence and profile aggregation ([extension-first](EXTENSION_FIRST_REFACTOR_PLAN.md) Phase 4A) | Implemented: session source and evidence (migration `0022`), improvements, `GET /api/mistakes/profile`; core, DB, and route tests |
| PR2: profile dashboard | Planned as an extension-first Phase 6A web surface, over `GET /api/mistakes/profile` |
| PR3: optional AI category suggestions | Planned; only after PR1-2 usage data |
| Daily practice feed | Engine implemented and tested; app wiring planned ([DAILY_FEED_PLAN.md](DAILY_FEED_PLAN.md)) |

**Non-goals:** AI diagnoses presented as fact; a second scheduler; changing
FSRS ratings or due dates from mistake data; running user code on ankify
servers; a knowledge graph; automatically classifying historical submissions.

## Existing data this builds on

Verified against `packages/db/src/schema.ts` on the billing branch:

| Source | What exists | How the profile uses it |
| --- | --- | --- |
| `quiz_sessions.items_json` | Every quiz item has a `scope`: `approach`, `invariant`, `edge_case`, `complexity`, `implementation`, `mistake_review` | The mistake taxonomy reuses these IDs, so quiz accuracy per dimension is a free signal with a real denominator |
| `quiz_sessions.answers_json` | `{ itemId, selectedIndex, correct, answeredAt }` per item | "Log as mistake" on a wrong answer, prefilled from the item's scope |
| `submissions` | Status, code, `failed_testcase`, `expected_output`, `actual_output`, `error_message` | Linked as evidence; never copied. Status is a symptom, not a cause |
| `review_events` | `self_recall_rated` with `fsrs_rating`, unique `(user_id, request_id)`, `undone_at` | "What went wrong?" after an Again/Hard rating links to the rating's event |
| `problems.topic_tags` | English LeetCode tag names | Topic filter; topic weakness in the feed |
| `problems.similar_slugs` | Slugs only (the extension drops title/difficulty) | The feed needs richer data; see [DAILY_FEED_PLAN.md](DAILY_FEED_PLAN.md) |

## Taxonomy

One small, stable set of IDs, shared with quiz item scopes. The canonical list
is `SKILL_DIMENSIONS` in `packages/core/src/skills.ts`, mirrored by
`skillDimensionEnum` in `@ankify/contracts` (a test keeps them equal).

| ID | Label | Boundary |
| --- | --- | --- |
| `approach` | Approach choice | Picked an unsuitable technique; distinct from implementing a good one badly |
| `invariant` | State / invariant | Wrong DP state, recursion contract, or loop invariant |
| `edge_case` | Edge case / initialization | Empty input, boundaries, base cases, initial values |
| `complexity` | Complexity | TLE/MLE traced to a cost decision |
| `implementation` | Implementation | Indexing, return values, scope, pointer/null handling |
| `conceptual` | Concept | Doesn't know what a technique guarantees |
| `other` | Other | Evidence is thin or nothing fits |

- Quiz scope `mistake_review` maps to no dimension (it describes a question
  about a past mistake, not a skill), via `quizScopeToDimension()`.
- One **primary** category per record, so overview counts never double-count.
  Up to 8 free-form secondary tags are kept for later refinement (e.g.
  `dfs_return_contract`, `off_by_one`).
- A LeetCode status (`Wrong Answer`, `Runtime Error`, `TLE`) never becomes a
  category automatically.

## Recording a mistake

Logging friction is the main risk: an empty profile is useless. Capture happens
at the moment of failure and takes one tap; detail is optional.

| Entry point | Behavior | Source link |
| --- | --- | --- |
| Review, after an **Again** or **Hard** rating | Dismissible "What went wrong?" chip strip for the rated problem. A chip saves a category-only record; "Add detail" opens the dialog | `review_event_id`, resolved server-side from the rating's `requestId` |
| Quiz, on a **wrong** answer | "Log as mistake", category prefilled from the item's scope | `quiz_session_id` + `quiz_item_id` |
| Submission list, on a **failed** submission | "Log mistake", nothing preselected (for TLE/MLE `complexity` is listed first) | `submission_id` |
| Problem detail | Mistakes section: list, edit, resolve, delete, add manually | none (`manual`) |

Records created by the user are `confirmed` immediately. The `candidate` state
exists only for future AI suggestions, which must be accepted, edited, or
dismissed before they count.

## Data model

`mistake_records` (migration `0020_new_zaran`):

| Column | Notes |
| --- | --- |
| `id`, `user_id` (cascade), `problem_id` (cascade) | Owner and problem |
| `primary_category` | A `SKILL_DIMENSIONS` value |
| `secondary_tags` | JSON `string[]`, at most 8 x 32 chars |
| `summary`, `next_step` | Optional user text, at most 2,000 / 1,000 chars |
| `source_type` | `manual`, `submission`, `quiz_answer`, `review`, `practice_session` (later: `feed_item`) |
| `submission_id`, `quiz_session_id`, `review_event_id` | FKs, `on delete set null` |
| `practice_session_id` | FK, `on delete set null` (migration `0022`). Set directly for a `practice_session` record, or derived server-side from a session-linked submission (automatic/confirmed association) or rating |
| `evidence` | JSON, at most 8 references to observed facts: `observation`, `submission`, `code_range` (submission + lines), `judge_output` (submission + field). Each must belong to the user and problem, and an observation to the record's session. Facts stay apart from the inferred `summary` |
| `quiz_item_id` | Item id inside `quiz_sessions.items_json` (sessions are archived, not deleted, so it stays valid) |
| `status` | `candidate`, `confirmed` (default), `dismissed` |
| `origin` | `user` (default), `ai_suggested` |
| `request_id` | Client idempotency key, unique per user |
| `resolved_at` | User marked the mistake as fixed; the feed then weights it at 25 % |
| `confirmed_at`, `dismissed_at`, `created_at`, `updated_at` | Timestamps |

Indexes: `(user_id, status, created_at)`, `(user_id, primary_category,
created_at)`, `(user_id, problem_id)`, unique `(user_id, request_id)`, and three
**partial unique** dedupe indexes, each only where the source is set and
`status <> 'dismissed'`:

- `(user_id, submission_id, primary_category)`
- `(user_id, quiz_session_id, quiz_item_id, primary_category)`
- `(user_id, review_event_id, primary_category)`
- `(user_id, practice_session_id, primary_category, origin)`, only for
  `source_type = 'practice_session'`: one live record made on the session per
  category from the user, and one from AI, which may coexist

**Dedupe rule.** A second record for the same source and category returns the
existing row (`deduplicated: true`); a dismissed record doesn't block a new
one. Records on different submissions of one session all stay visible.

**Counting rule.** The profile counts *contexts*, not records: a practice
session, or for records made before sessions existed, their own source (a
submission, quiz item, rating, or the record itself). Each (context, category)
counts once however many records, retries, or origins point at it, so a user's
record on a failed submission and a confirmed AI finding from the same session
count once.

`practice_improvements` (migration `0022`) holds the user's explicit
confirmation that a completed session handled a category well:
`(user_id, practice_session_id, category)` unique, idempotent per `request_id`,
cascading with the session. It is the only evidence that lowers a category's
weakness.

**Idempotency.** Same pattern as `POST /api/review/rate`: replaying a
`requestId` with the same payload returns the original record; a different
payload is `409 mistake_request_conflict`.

**Deletion and export.** Records are hard-deleted by the user (like cards),
cascade with their problem and with the account, and are included in the NDJSON
export as `mistake_record`. An undone review keeps its linked mistake: the
record is the user's own statement.

## API

All routes call `getRequestUser()`, validate with `@ankify/contracts`, return
`MistakeRecordDto`, and are scoped by `userId`. Every referenced id is checked
to belong to the same user **and** problem.

| Route | Purpose |
| --- | --- |
| `POST /api/mistakes` | Create a confirmed record, optionally linked to one source |
| `GET /api/mistakes?problemId=&category=&status=&cursor=&limit=` | Keyset-paginated list (`created_at desc, id desc`), default `status=confirmed` |
| `PATCH /api/mistakes/:id` | Edit category, tags, text; `resolved: true/false`; confirm/dismiss a candidate |
| `DELETE /api/mistakes/:id` | Delete |
| `GET /api/mistakes/profile` | The aggregated profile (below); `private, no-store` |
| `POST /api/mistakes/improvements` | Confirm an improvement for a completed session: `201`, replay/duplicate `200`, `404 session_not_found`, `409 session_not_completed` / `improvement_request_conflict` |
| `GET /api/mistakes/improvements?practiceSessionId=` | A session's improvements |
| `DELETE /api/mistakes/improvements/:id` | Withdraw one |

AI session analysis (extension-first Phase 4B) is BYOK-only and creates
`ai_suggested` candidates; nothing is ever classified in the background unless
the user opts in.

## Profile aggregation

`computeMistakeProfile()` in `packages/core/src/profile.ts` is pure;
`server/mistake-profile.ts` loads its inputs with user-scoped joins over the
90-day window and computes on every read. Nothing derived is stored, so Undo,
dismissal, resolution, and deletion can never leave a stale score. (The
extension-first plan proposed a `practice_evidence` table for normalized
inputs; computing on read replaced it, see the checkpoint log.)

- **Weakness** reuses the daily feed's decay and smoothing (21-day half-life,
  90-day window, same thresholds). A context of only resolved records weighs
  25 %; confirmed improvements subtract.
- **Candidates**: unconfirmed AI findings are listed separately and never
  weigh.
- **Readiness**: personalized targeting needs three completed sessions across
  two problems; a category needs confirmed evidence from two contexts across
  two problems.
- **Topic signals**: per topic, sessions with their Accepted, failed, and
  first-try counts and the median failures before Accepted; a session's
  rating (Again/Hard fail, Good/Easy pass) outranks its observed outcome.
  Success is session/topic evidence, never mastery of a category. Undone
  ratings drop out; the observed outcome remains. Interrupted and abandoned
  sessions, unknown outcomes, and missing evidence are never failures.
- **Incomplete evidence** (partial capture, ambiguous observations) is counted
  and labeled; raw counts are never presented as success rates.

## Profile dashboard (PR2)

Lives as a section of `/analysis`, not a new nav item, reusing
`analysis/charts.tsx`, `<Surface>`, `<EmptyState>`, and `<Pill>`. Decks hold
hundreds of problems, so aggregation happens in TypeScript after a user-scoped
select, the way `loadAnalysis()` computes risk, instead of `json_each` SQL.

Two clearly separated tiers:

1. **Recorded mistakes** (confirmed records only): occurrences and distinct
   problems per category, trend vs. the previous period, representative
   examples linking to their evidence, filters by topic, period (7/30/90/all
   days, default 30), category, and source. Percentages state their
   denominator ("share of your recorded mistakes").
2. **Signals** (no logging needed): quiz accuracy per dimension ("edge cases
   7/12 correct, last 90 days") and lapses/Again ratings per topic. Fewer than
   5 answers shows "insufficient data". This tier corrects the main weakness of
   a count-only profile: counts mostly measure how much someone logs.

Every category offers **Review affected problems**, linking into the normal
review UI without touching FSRS state or the daily limit. The empty state asks
the user to log their next mistake; it never invents insights.

## Security and privacy

- Every query, including aggregates, is scoped by `user_id`; foreign ids are
  re-checked for ownership inside the create transaction (no IDOR).
- Free text and tags are length-bounded; lists are paginated (max 50).
- Code and notes are linked, never copied, and never logged.
- An AI suggestion (later) sends only the minimum evidence, is labeled as AI,
  and never auto-confirms.

## Delivery

| PR | Scope |
| --- | --- |
| PR1 | Migration, contracts, `server/mistakes.ts`, routes, record dialog and chip strip, the four entry points, en/zh strings, export, DB tests |
| PR2 | Dashboard with both tiers, drill-down, review links, empty/low-data states |
| PR3 | Optional AI suggestions with candidate accept/edit/dismiss (extension-first Phase 4B); feed source |
| PR4 | Subcategories and concept tags, Study Coach read tool `read_mistake_profile` (confirmed records only, no new credit path) |

## Tests

- **DB (`createTestDb()`)**: create per source; forged or cross-user problem,
  submission, quiz item, and review ids rejected; request replay and conflict;
  dedupe and dismissed-then-recreate; scoped pagination; owner-only
  PATCH/DELETE; problem and account cascades; export.
- **Contracts**: schema bounds; `skillDimensionEnum` equals `SKILL_DIMENSIONS`.
- **Manual (QA profile)**: record from each entry point without an AI key,
  edit, resolve, delete, and find the record in the export; Chinese and
  English; keyboard only.

## Metrics and open questions

Track records per active reviewer, entry point used, resolve rate, and
category-to-review clicks. More logging is not worse learning. Open: whether
users want custom categories; how much historical failed-submission evidence is
reliable; when an AI suggestion is worth its cost.
