# Coach-led practice (design)

Status: stages 1 and 2 implemented (2026-10-05) in the extension; stage 3 (web review and cleanup) and stage 4 not yet. This doc describes how studying
a problem moves into the Study Coach chat in the extension's side panel, and
what replaces the separate Quiz and Cards screens.

## Version 2: weakness-driven practice (2026-10-05; weak spots built, practice and web profile next)

Decided with Jimin after trying stage 2. It replaces the stage 2 practice
flow; the docs (stage 1), sessions, grading, and rating code stay.

**Idea.** Cards, notes, submissions, and practice results are raw material
the Coach reads; the user shouldn't be handed them first. The Coach's job is
diagnosis: for each problem, *where do you go wrong*, and across problems,
*which kinds of mistakes do you keep making*. Practice then targets those.

### Three layers

1. **Raw material** (behind the book icon): Notes, Cards, submissions with
   failing tests, past practice answers, Coach conversations.
2. **Per-problem weaknesses** (Coach-maintained): each is one specific
   mistake ("`dp` initialized to 0, so `amount = 0` returned 1"), with one
   **category**, its **evidence** (submission ids, practice answers,
   conversation turns), and a status (`active`, `resolved`, `dismissed`).
3. **Weakness profile** (computed, never stored): categories ranked by active
   weaknesses, with counts, recent trend, and the problems involved.

### Categories: a fixed list, extendable

Built in (keys are stable, names are translated):

| Key | Name |
| --- | --- |
| `approach_choice` | Picking the approach (greedy vs DP, BFS vs DFS...) |
| `efficiency` | Right idea, too slow (missing memoization, repeated work) |
| `state_definition` | Defining the state or subproblem |
| `transition_order` | Transitions and loop order |
| `init_sentinel` | Initial values and sentinels |
| `boundary_index` | Indices and off-by-one |
| `edge_cases` | Special inputs (empty, single, duplicates, negatives) |
| `complexity` | Judging time and space complexity |
| `data_structure` | Choosing or using a data structure |
| `invariant` | Invariants and why it's correct |
| `overflow_precision` | Overflow and precision |
| `implementation_slip` | Implementation slips |
| `problem_reading` | Misreading the problem |

The Coach may propose a new category when none fits; it's added to the
user's list only after they approve (a proposal, like doc edits).

### Recording: automatic, with evidence, deletable

- The Coach records a weakness with `record_weakness` (category, one-line
  detail, evidence). No approval step: the chat shows a small line ("Noted:
  initial values, Coin Change") with **Remove**.
- Code rules: evidence must resolve (a submission of this problem, a practice
  answer, or a run in this conversation); at most 3 new weaknesses per turn;
  a near-duplicate of an active weakness on the same problem bumps its count
  and evidence instead of adding a row.
- A weakness is **resolved** after it's answered correctly in 2 later practice
  sessions (code rule), or when the user marks it. A resolved one that recurs
  becomes active again.

### When the Coach analyzes (no surprise AI spend)

- **Analyze my attempts** on a problem: one turn that reads all submissions
  and notes and records the weaknesses it finds (the first time a problem is
  studied).
- During conversation and practice, whenever a mistake is diagnosed.
- Not on every failed submission automatically: that would spend AI the user
  didn't ask for.

### Practice: talk it through

1. Code picks 2 to 3 **targets**: this problem's active weaknesses (most
   recent first), then the user's top active categories that apply to this
   problem, then (if still short) its approach and complexity.
2. The Coach asks about each target in its own words, open-ended ("How should
   `dp` be initialized here, and why?"). The user answers in text.
3. The Coach grades each answer with a tool (`grade_answer`: target,
   `correct | partial | missed`, one-line reason). Code turns the grades into
   a score and the suggested rating (same table as stage 2).
4. Summary: grades, the suggested rating on the four buttons, and the
   weakness changes (resolved, recurring, newly found).

Cost: about one model call per answer plus the summary, so 4 to 5 calls a
session; each is a starter credit for users without their own key.

The stage 2 multiple-choice generator stays available as a hint when the user
says they don't know ("show me options").

### Where it shows

- **Side panel**: the top of a problem's chat pins *This problem's weak
  spots* (active weaknesses as category chips with their detail). The Coach
  cites the profile in conversation ("this is your 6th initial-value slip").
- **Web**: a *Weak spots* section on Analysis: categories ranked, trend, and
  the problems behind each, linking to them.

### Data

- `weaknesses`: id, user, problem, category key, detail, evidence (JSON),
  status, hit count, first and last seen, resolved at.
- `weakness_categories`: the user's approved custom categories (key, name,
  description).
- Practice sessions gain `targets_json` and per-target grades; `recall_json`
  and `check_json` stay for old sessions.

## Summary (stages 1 and 2)

- Each problem keeps two markdown documents: **Notes** (your understanding)
  and **Cards** (prompts worth recalling). They are the problem's memory.
  You edit them directly; the Coach edits them only through proposals you approve.
- Studying happens in the **Coach chat**. A review is a **Practice** session
  shown inline in the chat: a few of your cards, then a few fresh questions,
  then a suggested rating. The Quiz and Cards tabs go away.
- **Rules live in code, creativity in the model.** The model chooses wording
  and teaching; the server decides what a session contains, which cards
  appear, what a valid question is, how it is graded, and what rating is
  suggested. The rating itself is always your click.

## Principles

1. **The docs are the source of truth.** Anything worth keeping about a
   problem ends up in Notes or Cards. Chat is transient; docs persist.
2. **Cards are shown verbatim.** The model never rewrites, paraphrases, or
   invents a card during practice.
3. **Generated questions are grounded and cited.** Every question names the
   material it tests; the server rejects questions whose source doesn't exist.
4. **The schedule changes only when you rate.** The Coach can suggest, never
   rate. (Already a Coach rule.)
5. **No surprise AI spend.** Nothing calls a model until you click something.
   A practice session costs at most two model calls.
6. **Typed widgets, not model-written HTML.** The model calls tools; the chat
   renders a small fixed set of components.

## Concepts

### Notes doc

Free-form markdown, stored where `problems.notes` lives today. The Coach uses
a light section convention so its proposals can target a section instead of
rewriting the doc. Sections appear only when something goes in them:

```markdown
## Approach
## Key insight
## Pitfalls
## Complexity
## My attempts
```

You can write anything anywhere; the convention is for the Coach.

### Cards doc

Markdown where each `##` heading is a prompt and the text under it, up to the
next `##`, is the answer. Text before the first heading is ignored, which
leaves room for a note to yourself.

```markdown
## Why check the map before inserting?
Inserting first lets a number pair with itself: [3,2,4], target 6 returns [0,0].

## Time and space?
O(n) and O(n): one pass, one hash map.
```

- A card's **key** is a hash of its normalized prompt (trimmed, lowercased,
  whitespace collapsed). Editing the answer keeps the key; rewording the
  prompt makes it a new card.
- Limits: 30 cards and 20,000 characters per problem. The parser reports
  problems (an empty answer, a duplicate prompt) instead of guessing.
- Parsing is a pure function in `packages/core` (`parseCards()`), shared by
  server, extension, and web.

### Cards vs check questions

| | Card (recall) | Check question |
| --- | --- | --- |
| Source | Your Cards doc, verbatim | Generated per session, grounded in the problem |
| Repeats | Yes, every session it's selected | Never repeats a recent question |
| Graded by | You: reveal, then "got it" or "missed" | The server: it holds the answer |
| Purpose | Keep what you already know | Find gaps you don't know you have |

A check question you miss can become a card (by proposal), so the Cards doc
gradually collects exactly what you struggle with.

## Practice protocol

### Shape (fixed by code)

1. **Recall:** up to 3 cards from the Cards doc.
2. **Check:** 3 multiple-choice questions.
3. **Summary:** results, a suggested rating, and the four rating buttons.
4. **Debrief:** one Coach reply explaining misses, with at most 3 doc proposals.

A problem with no cards gets check questions only. Its debrief is where the
first cards get proposed.

### Card selection (deterministic)

Per-card stats live in `problems.card_stats` (JSON keyed by card key:
`lastShownAt`, `lastResult`, `missCount`). Order:

1. cards missed last time they were shown;
2. cards never shown;
3. the rest, least recently shown first.

Take the first 3. Ties break by order in the doc. No model is involved.

### Check questions (model-generated, server-validated)

Generated by an AI job (`practice_check`) that starts the moment the session
starts. Recall runs first, so the generation time is mostly hidden. The job
reuses the quiz pipeline (`ai-generation/quiz.ts`, `quiz-prompt.ts`) with
these inputs:

- the statement, Notes doc, Cards doc, recent submissions with failure details;
- the check questions from the last 3 practice sessions (to avoid repeats).

Each item has the current quiz shape (`question`, 4 `choices`,
`correctAnswer`, `explanation`, `scope`) plus a **citation**:

| `source.kind` | `source.ref` | Validated by |
| --- | --- | --- |
| `statement` | none | always valid |
| `notes` | section heading | heading exists in Notes |
| `card` | card key | key exists in Cards |
| `submission` | LeetCode submission id | submission belongs to this problem |

The server rejects the whole batch and retries once (an ordinary job retry)
when any rule fails:

- a citation doesn't resolve;
- fewer than 3 distinct scopes;
- complexity isn't covered by either a check question or a card selected in
  this session;
- a question restates a selected card (normalized prompt overlap above a
  threshold) or one from the last 3 sessions;
- the user has a failed submission in the last 30 days and no question has
  scope `mistake_review` citing a submission.

If generation still fails, the session continues with recall only and the
summary says the questions couldn't be generated.

### Grading and the suggested rating

- Recall: "got it" = 1, "missed" = 0 (self-graded).
- Check: correct = 1, wrong = 0 (graded by the server; the client never
  receives `answerIndex` before answering).
- Score = points / items. Suggested rating:

| Score | Suggestion |
| --- | --- |
| below 0.4 | Again |
| 0.4 to below 0.67 | Hard |
| 0.67 to below 1 | Good |
| 1, with at least 4 items | Easy |
| 1, with fewer items | Good |

The rating buttons call the existing `POST /api/review/rate` with the
suggestion preselected. Undo works as today.

### Re-solving counts too

When a new Accepted lands on a **due** problem while the panel is open, the
chat shows a rating widget ("You solved it again", Good preselected) without
calling a model. Practice is the quick option; re-solving is the strong one.

## The chat

### Layout

- Top bar: the problem, the Today and Settings icons (as now).
- Main area: the Coach chat for this problem.
- **Docs** drawer: Notes and Cards, rendered markdown with an edit mode.
- The Quiz and Cards tabs are removed. Off a problem, Today stays the home
  screen and the chat continues to work for general questions.

### Entry points (no model call until clicked)

| Situation | Shown in the chat | On click |
| --- | --- | --- |
| Due problem opened | "Due for review" with **Start practice** | starts a session |
| Failed submission | "Want help with this failure?" | sends that question as a Coach turn |
| Accepted on a due problem | rating widget | rates |
| Problem with empty Notes | **Draft notes from my attempts** | one Coach turn that proposes Notes |

These chips are rendered by the client from page state and are not messages
in the conversation history.

### Widgets (new agent step kinds)

The Coach's tool calls become steps (`agent_steps`), as proposals already do.
New kinds and their components:

| Step kind | Component | Interaction |
| --- | --- | --- |
| `practice` | Practice card: recall flips, then questions, then summary | answers go to REST, not to the model |
| `proposal` with `action: "doc_edit"` | A preview of the proposed Notes or Cards change | **Apply** / **Dismiss** |
| `rating` | Four rating buttons with one preselected | rates through the review API |

Navigation and read steps stay as they are. The Coach can also start a
session itself (`start_practice`) when you ask in your own words ("quiz me").

### Debrief

When the summary is reached, the client sends a Coach turn with a **trigger**
instead of typed text: `{ type: "practice_completed", practiceSessionId }`.
The server loads the session's results into the turn. The chat shows it as a
one-line event ("Practice finished: 4 of 6"), not as a message you wrote.
Debrief rules (prompt and code):

- Explain each miss in one or two sentences, citing the same source.
- Propose at most 3 doc edits. A missed check question may become a card if
  no existing card covers it. A missed card doesn't get a duplicate; at most
  propose clarifying its answer.
- Don't restate correct answers.

## Coach tools

| Tool | Kind | Notes |
| --- | --- | --- |
| `get_problem_docs` | read | Notes and Cards with their versions, plus parse issues |
| `start_practice` | practice | no content parameters: the server builds the session |
| `propose_doc_edit` | proposal | see operations below; carries the doc version it was based on |
| existing read tools | read | queue, study plan, problem context, submissions |
| `open_problem` | navigation | unchanged |

`propose_card_draft` and `propose_quiz_generation` are removed with the old
Cards and Quiz UI.

### Doc edit operations

| Target | Operation | Fields |
| --- | --- | --- |
| Notes | `append_section` | `section`, `markdown` (creates the section if missing) |
| Notes | `replace_section` | `section`, `markdown` |
| Cards | `add_card` | `prompt`, `answer` |
| Cards | `update_card` | `key`, `prompt?`, `answer?` |
| Cards | `remove_card` | `key` |

Applying checks the doc's version. If you edited the doc since the proposal,
Apply fails with "Notes changed since this suggestion" and the Coach can be
asked again. Proposals that would exceed the size limits are rejected when
proposed, not when applied.

### Prompt rules (additions)

- Ground claims about the user's work in tools; cite submissions by attempt.
- Never present practice content in prose: use `start_practice`.
- At most one doc proposal per ordinary reply, three in a debrief.
- Never propose an edit the user didn't motivate (a miss, a diagnosed bug,
  an explicit request).

## Data model

- `problems.notes` stays; add `problems.notes_version` (integer).
- Add `problems.cards_md` (text), `problems.cards_version` (integer), and
  `problems.card_stats` (JSON).
- New table `practice_sessions`:
  - identity and ownership: `id`, `user_id`, `problem_id`, `agent_run_id`;
  - lifecycle: `status` (`active | completed | abandoned`), `created_at`,
    `completed_at`;
  - content: `recall_json` (card keys plus the prompt and answer text as shown),
    `check_job_id`, `check_json`;
  - outcome: `results_json`, `score`, `suggested_rating`.
- `agent_steps.kind` gains `practice` and `rating`; doc edits reuse the
  `proposal` kind with `proposal_json.action = "doc_edit"` (edit + base version).
- `ai_jobs.action` gains `practice_check`.
- `agentTurnRequestSchema` gains an optional `trigger`; `message` becomes
  optional when a trigger is present.

All user-owned, all scoped by `user_id`, all cascading from the problem.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/problems/[id]/docs` | Notes and Cards with versions and parse issues |
| `PUT /api/problems/[id]/docs` | direct edit by the user, with `expectedVersion` |
| `POST /api/problems/[id]/practice` | start a session (from a chip or the Coach tool) |
| `GET /api/practice/[id]` | session state; check items without answers until answered |
| `POST /api/practice/[id]/recall` | `{ cardKey, result }` |
| `POST /api/practice/[id]/check` | `{ itemId, choice }` returns correctness and explanation |
| `POST /api/agent/steps/[id]/approve` | applies a `doc_edit` proposal (existing route) |

## Cost

Per practice session:
- one check-generation job;
- one debrief turn.

That's 2 starter credits for users without their own key. Recall, grading, the
summary, and rating cost nothing. Opening a problem and the entry chips cost
nothing until clicked.

## Migration

1. **Cards to markdown.** For each problem, write its `ready` cards into
   `cards_md` in creation order (`## question` / answer). Candidate and failed
   cards are dropped, since Coach proposals replace candidates. Keep the
   `cards` table read-only for one release, then remove it.
2. **Quiz history.** Old quiz sessions stay read-only as history; new check
   questions use the last practice sessions for de-duplication, falling back
   to old quiz sessions for problems with no practice yet.
3. **Web app.** `/review` keeps working on the old flow until the web chat
   gets the same widgets. The problem page shows the two docs (read and edit)
   from stage 1.

## Stages

1. **Docs.** `cards_md`, versions, parser, docs API, Docs drawer in the
   panel, `get_problem_docs` and `propose_doc_edit` with Apply. The Coach can
   already maintain Notes and Cards.
2. **Practice.** `practice_sessions`, card selection, `practice_check` job with
   validation, the practice widget, summary and rating, the debrief trigger,
   entry chips. Quiz and Cards tabs removed from the panel.
3. **Migration and cleanup.** Convert card rows, retire the old card and quiz
   endpoints the panel no longer uses, move web review onto the same model.
4. **Re-solve rating** and **Draft notes from my attempts**.

## Open questions

- Should some cards ask you to *write* something (the loop, the invariant),
  graded by the Coach? That's a third item type and a model call per item.
- Should "missed" recall cards ever be auto-promoted into Notes Pitfalls?
- Daily limit: does a practice session count toward the review limit, or only
  the rating that follows it (today's behavior)?
