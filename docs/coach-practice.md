# Coach-led practice (design)

Status: stages 1 and 2 implemented (2026-10-05) in the extension; version 3 (below) built 2026-10-10 in its first, smaller scope; stage 3 (the web app follows the extension) built 2026-10-11; the signal point and the technique-first question ([product-main-line.md](./product-main-line.md), step 3) built 2026-10-30; stage 4 not yet. This doc describes how studying
a problem moves into the Study Coach chat in the extension's side panel, and
what replaces the separate Quiz and Cards screens.

## Stage 3: the web app follows the extension (2026-10-11)

Decided with Jimin after v3 shipped: the web had kept its own review (Quiz,
card rows, autosaved notes) while the extension moved to docs and practice.

- **One copy of a card**: the web reads and writes the Cards doc; card rows
  are legacy (only older extension builds and the export read them).
  Migration `0024_cards_doc_sync` appended ready rows written after 0019.
- **One way to review**: the review page's Quiz tab is gone. Its workspace is
  Docs (Notes / Cards / Solutions), Weak spots, and Submissions; practice runs
  in the Coach panel next to it, and a finished practice preselects its
  suggested rating in the rating bar. The problem page has the same Docs and
  Weak spots panels.
- **One Coach**: the web sidebar has what the extension's composer has:
  Practice, the model and thinking menu, Stop, the practice tray (points,
  "I did say that", End, rating), and removable weak spots.
- **Weak spots across problems** show on Analysis, ranked by category with
  the problems behind each.
- Quiz and AI card candidate APIs stay for extension builds before 0.3.0.

## Version 3: practice judged against a solutions doc (designed 2026-10-06, first scope built 2026-10-10)

Decided with Jimin after trying talk-through practice: the Coach graded the
first reply and moved on even when half the answer was missing. Version 2's
practice let one chat model judge the answer, choose the next move, grade,
and talk. Version 3 splits those jobs. (The interim fix, commit 44dd28c,
added a `follow_up` tool; version 3 removed it.)

The design was reviewed on 2026-10-10 by a second model with the sources
checked; the changes it led to are folded in below, and the scope was cut to
what tests the core idea: does a separate judge plus a code-owned grade stop
premature grading?

**Research behind it** (checked 2026-10-10).
- AutoTutor (mean gain 0.81 SD over 10 experiments, against reading
  controls, with human-written expectations): each question has
  *expectations* (key points) and likely misconceptions; replies are checked
  against them, and missing ones get "what else?" → hint → prompt → telling.
- Bridge (Wang et al., NAACL 2024): deciding the error type, the strategy, and
  the intention *before* writing the reply made GPT-4's replies 76% more
  preferred, and random decisions 97% less. The gain came from *expert*
  decisions; GPT-4 was poor at making them itself. So the decisions here come
  from code, not from a model.
- Splitting long-horizon control from dialogue beat one LLM doing both
  (78–82% vs 3–23% curriculum success, simulated students, same model in both
  roles). Tutors also agree with wrong answers about 1 in 7 times under
  pressure, so the judge is a separate call the user isn't talking to.
- LLM grading agrees with humans on binary checks and drifts on fine rubrics:
  the judge ticks yes/no per point, never scores.
- Reference quality matters more than judge size: a small judge with a good
  reference beat GPT-4o with a synthetic one, and a reference flips judge
  decisions. So the effort goes into the Solutions doc, and the judge runs at
  the lightest setting.
- Anki: Again for a failed or partial recall ("be strict"); Hard means
  recalled with effort. A hint doesn't hurt learning much, but it voids the
  measurement, so a content hint means missed.
- Feedback after errors must include the correct answer (Pashler et al.
  2005); right/wrong alone works about as well as none.
- Khanmigo: the checker looks only at what the student did (half the answer
  giveaways); plain text beats JSON for context, so the Coach's instruction is
  plain text.

### The solutions doc (third problem doc)

Next to Notes and Cards, each problem has **Solutions**
(`problems.solutions_md`, `solutions_version`): markdown the user reads and
edits behind the book icon. One `##` section per approach, named for its
technique, `(mine)` on the user's own, its key points as bullets, the first
of them its **signal**, and a `Complexity:` line (`parseSolutions()` in
`packages/core/src/problem-docs.ts`):

```markdown
## Variable-size sliding window (mine)
- Signal: contiguous subarray, all values positive, sum at least target
- Grow the right end; once the sum reaches the target, shrink from the left
- All values are positive, so shrinking only lowers the sum: the left end never moves back
Complexity: O(n) time, O(1) space

## Prefix sums with binary search
- Signal: positive integers, so prefix sums strictly increase
...
```

- **The signal** (added 2026-10-30, [product-main-line.md](./product-main-line.md)
  "Recognizing the pattern") is what in the statement points to the
  technique: features of the input, its constraints, or what's asked, never
  the technique's name or the algorithm's steps. It's an ordinary point, so
  parsing didn't change; `isSignalPoint()` recognizes it by its label
  (`Signal:`, or `题眼：` in a Chinese doc; `信号：` also works) so the
  instructions can treat it specially. Docs written before it have no signal
  and are judged as before: the question still asks for the technique, but
  nothing checks that part until the user adds a signal by hand.
- **Per approach**, never one list per problem: the user may answer with any
  approach. The one in the user's Accepted code is marked as theirs; at most
  2 genuinely different others are added (boundary variants of one algorithm
  are one approach).
- **Written** the first time the problem is practiced
  (`server/practice-solutions.ts`), from the Accepted code, Notes, and the
  problem, at the user's reasoning level, and saved directly as the first
  version (the judge needs it right away). The problem's techniques from
  灵茶山艾府's catalog (`catalogTechniques()`, his "Other …" sections left
  out) go into the prompt as hints for naming the approaches, not as
  headings to copy; a problem outside the catalog gets its technique named
  by the writer. The user's own text is never overwritten. Without AI, or if
  it fails, the approach question falls back to the Coach grading it.
- **Points are ideas, not syntax**: after the signal, 2 to 4 per approach;
  the first is the core idea as someone would say it, then what's tracked,
  the transition, the easy mistake. Trivia (returning -1, output order), one
  language's details, and implementation advice belong in Notes. A point that's too specific fails
  learners who clearly know the solution. (Trying it showed this is the part
  that most needs care: the first prompts produced `while left <= right` and
  "return an empty array" as points.)
- **Weak-spot targets** don't need it: the weakness detail is their one point,
  covered when the user states the correct handling.
- A session **copies** the reference it's judged against into its targets, so
  a grade is always traceable to the text it was judged on, and editing the
  doc mid-session applies from the next one.
- During practice the panel shows progress per question ("2 of 4 points"),
  never the points themselves. Once a question settles, its points show as
  said or not.

### One reply, three steps

1. **Judge** (`server/practice-judge.ts`, a structured call at the lightest
   reasoning setting, run by the server before the Coach on every practice
   reply): which approach the replies follow (or a valid new one, too slow, or
   invalid), which of its points are covered (cumulative, yes/no each), a
   wrong claim in the latest reply, and whether the reply is an answer, blank,
   a misread question, a side question, a hint request, or giving up. It sees
   the problem, the reference, and the question's conversation: the Coach's
   lines tell it what was asked, and only the user's lines count as evidence.
   "skip" / "I don't know" need no call. One retry if the JSON doesn't fit.
2. **Code** (`advanceTalk()` in `packages/core/src/practice-talk.ts`, a state
   machine per question) decides the next move and the grade from the judge's
   ticks and the help given so far.
3. **Coach** gets one plain-text instruction for that move in
   `runtimeContext.practiceActive.instruction` (`server/practice-instructions.ts`)
   and phrases it. It never grades and never decides the flow. The Coach's
   reply is logged on the question so the next judge call knows what was
   asked.

If the judge fails, that question falls back to version 2: the Coach grades
it with `grade_answer` (still capped by the help given).

### Questions

The approach is always the first question: **which technique, and what in the
statement points to it**, then how they'd solve it **and what it costs**. It's
what the problem's review schedules, and recognizing the pattern is what the
review checks (someone who memorized the code can often describe the approach
but not say what points to it). It's one question, not two: the signal is the
approach's first point. Then up to 2 of this problem's active weak spots, most
recent first. (Version 2's cross-problem category targets are dropped: there's
no reference to judge them against.)

The signal needs care in three places:
- **The judge** covers it only when the learner names (or unmistakably
  identifies) that approach's technique *and* says what in the statement
  points to it; the technique alone, the algorithm alone, or a reason that
  fits almost any problem ("it's an array") doesn't cover it. Any valid
  approach counts, so a learner who picks the doc's second technique is
  checked against that one's signal.
- **Naming the gap** never names the clue: the Coach asks what in the problem
  made them think of that approach. Its **hint** points at one clue from the
  statement without naming the technique.
- **Nothing recalled** gets the smallest hint toward the signal first, since
  it's the first point.

### Moves and grades

The grade answers one question: did the user recall it themselves?

| Help given so far | Example | Best grade |
| --- | --- | --- |
| None, or content-free nudges | "Anything else?" "Why does that work?" "Can it be faster?" | correct |
| Naming the missing part without its content | "Why doesn't `*` need enumerating?" | partial |
| A hint with content, or a counterexample | "Try amount = 0" | missed |
| Explaining it | | missed |

("Can it be faster?" does reveal that something faster exists; it's still
counted as content-free.)

Four moves, plus re-asking:
- **Probe** (free): one "anything else?" per question, and one "can it be
  faster?" for a working but too-slow approach.
- **Name the gap**: the first missing point, by name, not content.
- **Hint**: a named gap still missing gets the smallest hint with content; a
  wrong claim gets a counterexample (and, if it's a specific mistake, a weak
  spot); asking for a hint gets one; nothing recalled gets the smallest hint
  toward their own approach.
- **Settle**: every point covered and no wrong claim settles at the cap
  above, with a one-line confirmation; a valid approach the doc doesn't have
  settles too (mentioning it can be added to the doc). Still missing after its
  hint, after 3 nudges, or giving up settles as missed with the full answer.
- **Re-ask**: a side question is answered without giving the target away; a
  misread question is restated. Neither costs anything.

### Rating

Grades score as before (correct 1, partial 0.5), but the approach question
caps the suggestion: partial at most Good, missed at most Hard, and Again
with any other miss.

### "I did say that"

A settled question that isn't correct can be re-judged once
(`POST /api/practice/:id/dispute`): the judge reads every reply again, at the
user's reasoning level, and says which reply first stated each point. The
grade only goes up, capped by the help given before those replies. A finished
session is scored again, and a weak spot it covered is replayed from the
state the session started from (`results_json.weaknessBefore`).

### Cost

One extra lightweight call per practice reply (about 1 s with DeepSeek's
fast model) and one call to write the doc the first time a problem is
practiced. Neither spends a starter credit: the Coach turn around them
already does.

### Checking the judge

`pnpm eval:judge` runs the judge on hand-labeled replies
(`server/practice-judge.cases.ts`: complete, paraphrased, code only, half, a
wrong idea, brute force, vague, a narrowed follow-up, side question, giving
up, Chinese answers to an English doc, answers built over several replies,
other approaches, weak spots). On 2026-10-10, DeepSeek's fast model at the
lightest setting agreed on 73 of 74 calls (points precision and recall 1.00,
p50 0.8 s). Add a case whenever a real session shows a misjudgment.

Signal cases (2026-10-30, Minimum Size Subarray Sum with signals, English and
Chinese docs): a correct signal, a partial clue, the signal alone, the
technique with no signal, the technique alone, a generic reason, a wrong
technique, the signal after the gap was named, the signal after a hint, the
other approach's signal, and a Chinese answer and a Chinese doc. The signal
after a hint is labeled "either way": with a content hint given, the grade is
missed whether the judge ticks it or not (`advanceTalk()` settles any question
with that much help as missed); after only a named gap the tick decides
partial vs missed, so it must count. Over 50 cases x 4 runs with DeepSeek's
fast model, the judge prompt before the signal rule credited a signal it
shouldn't have 6 times (points exact 177/184); with it, 184/184, reply type
200/200, misconception 168/168, approach 139/140, and the older 38 cases
agreed on every call. (The rule also says misunderstanding the problem itself
is an answer with a misconception, not a misread question: "sort the numbers"
for a subarray problem had been read as a misread.)

### Not built yet

- Point stats and "next practice asks the most-missed points first".
- Proposals after practice: add an approach the user described, reword a
  disputed point, turn a missed point into a card.

## Version 2: weakness-driven practice (2026-10-05; weak spots and talk-through practice built, web profile next)

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

- **Analyze my attempts** on a problem: the server runs one structured call over
  the failed submissions and records each finding through the same checks,
  then the Coach explains them. (A chat model asked to record via a tool
  sometimes explained the mistakes without recording them.)
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
