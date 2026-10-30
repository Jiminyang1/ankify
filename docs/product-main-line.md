# The main line (product)

Status: proposed 2026-10-29; step 1 (pull back) built the same day; step 2 (plan
first), step 3 (recognize the pattern), step 4a (Cards into Notes), step 4b
(legacy code removed), and step 4c (chapters and techniques on the problem,
"one more of this technique", frequent mistakes on the Plan page, Analysis
removed) built 2026-10-30, so every step is built. Decided with Jimin: study plans are the spine of the
product, and what a review checks is whether the user recognizes the pattern,
not whether they memorized one problem. The rest of this doc is the proposal
built on those two decisions.

## In one sentence

**Follow a plan, learn each pattern in it, and don't forget it.**

Every feature should say which step of that sentence it serves. A feature
that serves none of them is not on the main line.

## Why this doc

By October 2026 ankify had grown three products on top of each other, each
with its own entry points:

| Product | What it answers | Entry points today |
| --- | --- | --- |
| Learning new problems | What should I solve next? | 6 official plans, imported lists, 灵茶山艾府's route and 12 topic plans, the profile roadmap, Today's "next in your plan" line, "Ask Coach what's next", the Same pattern tab on `/review` and `/problems/[id]`, the suggestion after a Good/Easy rating, the extension's ladder icon |
| Not forgetting them | Which ones do I review today? | Today, Review, the rating bar, Undo |
| Notes and AI | What do I know about this problem? | Notes / Cards / Solutions docs; weak spots, their categories, custom categories, the cross-problem profile on Analysis; the Coach (chat, proposals, model menu, memory); practice (tray, judge, dispute); legacy Quiz and AI card candidates |

Two facts from the code and the data:

- **Nothing reads the Cards doc any more.** Practice v3 judges against the
  Solutions doc and the problem's weak spots. Only the `recall_check` mode
  reads Cards, and nothing starts that mode (`startPractice()` in
  `apps/web/src/server/practice.ts`).
- **The loop hasn't turned yet.** In the prod backup from 2026-10-11, users
  had captured 44 problems but rated a review only 16 times in total (3
  users). One problem had Notes, five had Cards (one user). That backup is
  from before practice v3 and the plans from 灵茶山艾府, and the sample is
  small, but the direction is clear: the more entry points, the fewer users
  reach a rating.

## Three layers

| Layer | Answers | Where it comes from |
| --- | --- | --- |
| **Plan** | In what order do I learn? | Top Interview 150, Top 100 Liked, LeetCode 75, 灵茶山艾府's Beginner Route and topic plans, or an imported list. The user picks one first. |
| **Pattern** | What have I learned? | The plan's own sections are its chapters (Sliding Window, Binary Search, ...). Each problem's techniques come from 灵茶山艾府's catalog (`@ankify/core/patterns`). |
| **Problem** | An example of a pattern | FSRS still schedules the problem, but the review asks about its pattern. |

The plan sets the order, the pattern is what the user is trying to learn, and
the problem is an example of it.

Two pattern names show on screen and they mean different things:
- **Chapter**: the section of the current plan a problem sits in. One per
  problem per plan. The roadmap is drawn by chapter.
- **Technique**: what the problem actually uses, from 灵茶山艾府's catalog
  (for example "variable-size sliding window"). A problem can have several.
  It shows on the problem and is what the review asks about.

Mistake types (the 13 weakness categories in `packages/core/src/weaknesses.ts`:
off-by-one, edge cases, complexity, ...) are a third, separate axis: *why* the
user got something wrong, not *what technique* it was. They stay as they are.

Vocabulary stays at solved / in review / due (decided with the profile
roadmap), plus chapter and technique. No mastery percentages, no FSRS terms.

## The user's path

1. **First visit: pick a plan.** This is a new first step in onboarding,
   before connecting the extension. The default stays as it is now
   (`ling:route` for Chinese, Top Interview 150 for English). Once the
   extension syncs the LeetCode solved list, the roadmap shows where the user
   already is.
2. **Every day, Today has two parts:**
   - **Review**: the due problems. Keeps the patterns already learned.
   - **Next**: the plan's next unsolved problem and its chapter progress.
     Learns a new pattern. Today this is one line at the bottom of the page;
     it becomes the second part, after the reviews.
3. **Solve it on LeetCode.** The extension collects it on the first new
   submission (unchanged), and it shows under its chapter on the roadmap.
4. **When it's due, review it by talking it through** (practice is the
   default way to review; rating without practice stays as a shortcut):
   1. Which technique is it, and what in the statement tells you?
   2. How would you solve it, and what does it cost?
   3. Up to two of the problem's weak spots.
   4. The suggested rating is preselected; the user confirms it.

### What's next, at three levels

- **After a problem:** the next problem in the same chapter, in plan order.
- **After a chapter:** the next chapter. The finished chapter's problems keep
  coming back through review, mixed with other chapters'. Mixed review is
  the point: each problem first has to be recognized, which is the skill
  being trained. Interleaving problem types improves picking the right
  method compared with practicing one type in a block (Rohrer & Taylor 2007;
  Taylor & Rohrer 2010).
- **After a plan:** a focused plan on the user's weakest technique: the
  matching 灵茶山艾府 topic plan, or the DP / Graph Theory / Binary Search
  plan (`deepDivePlanFor()` already links three of these). "Weakest" means
  the technique whose problems are forgotten most in review.

Built 2026-10-30 (step 4c) for the second and third: Today's Next part adds the
chapter just finished (until the next one is started) with its go-deeper
problems, and once the plan is solved it suggests a focused plan with
"Switch to this plan". Techniques are counted by 灵茶山艾府's list they belong
to (the sum of lapses over deck problems), since his plans are one per list;
without lapses on any catalog problem it falls back to `deepDivePlanFor()` on
the chapter forgotten most, and without lapses at all it suggests nothing
(`focusPlanAfter()` in `@ankify/core/patterns`).

## Recognizing the pattern

The one new idea in this proposal: **the review's first question is "which
technique, and what tells you?"**, not "how would you solve it?".

Someone who memorized the code can describe the approach but often can't say
what in the problem points to it. That gap is the difference between
remembering a problem and having learned its pattern.

How it fits practice v3 ([coach-practice.md](./coach-practice.md)):
- Each approach in the Solutions doc gets a **signal** point: what in the
  statement points to this technique.

  ```markdown
  ## Variable-size sliding window (mine)
  - Signal: contiguous subarray, all values positive, sum ≥ target
  - The window only grows right and shrinks left, because sums only rise
  - Shrink while the sum still meets the target, recording the length
  Complexity: O(n) time, O(1) space
  ```

- The signal is the approach target's first point, not a separate question.
  The Coach's opening question asks for it; the judge ticks it like any other
  point. A problem with several techniques accepts any valid one, the same
  way the judge already accepts any listed approach.
- The Solutions writer (`server/practice-solutions.ts`) is asked for the
  signal, using the problem's techniques from the catalog when it has them.
- `pnpm eval:judge` needs new labeled cases: a correct signal, a technique
  named with no signal, a wrong technique, and a technique named only after
  a hint.

Built 2026-10-30 as described; the details are in
[coach-practice.md](./coach-practice.md) (the Solutions doc, Questions, and
Checking the judge). In a Chinese doc the label is `题眼：`. Docs written
before the signal keep working without one: the question still asks for the
technique, but only a signal the user adds is checked.

## Data we already have

灵茶山艾府's catalog covers most of the official plans, and many problems sit
under more than one technique:

| Plan | Problems | In the catalog | Under 2+ techniques | With a difficulty rating |
| --- | --- | --- | --- | --- |
| Top Interview 150 | 150 | 127 (84%) | 22 | 5 |
| Top 100 Liked | 100 | 93 (93%) | 21 | 2 |
| LeetCode 75 | 75 | 68 (90%) | 10 | 26 |
| Dynamic Programming | 46 | 45 (97%) | 13 | 11 |
| Graph Theory | 36 | 33 (91%) | 6 | 20 |
| Binary Search | 32 | 29 (90%) | 7 | 3 |

(Counted on 2026-10-29 from `study-plans.generated.ts` and
`patterns.generated.ts`.)

- **Multiple techniques:** shown on the problem; any one counts in review.
- **Difficulty:** the catalog's ratings are mostly for contest problems, so
  almost none of the classic plan problems have one. Inside a plan,
  difficulty is the plan's own order plus LeetCode's Easy / Medium / Hard.
  The ratings matter only past the plan, where 灵茶山艾府's ladders are
  rated and ordered.
- **Problems outside the catalog** (23 in Top Interview 150): fall back to
  the plan chapter, and the Solutions writer names the technique (already
  on the pattern lists backlog).

## Same pattern, re-anchored

Today, "Same pattern" is a second source of next problems that competes with
the plan: after a Good/Easy rating it suggests a problem from 灵茶山艾府's
lists even when the user follows Top Interview 150.

After:
- **"Next" has one source: the plan.**
- "One more of this technique" shows in two moments only:
  - when a chapter is finished, as "go deeper": the technique's next
    problems on 灵茶山艾府's ladder;
  - when a review is forgotten (Again), as one easier problem with the same
    technique.
- The suggestion after every rating, the Same pattern tab on `/review`, and
  the extension's ladder icon go away. The chapter dialog on the roadmap and
  the problem page keep the technique's ladder.
- Attribution to 灵茶山艾府, with the source link, stays on every surface that
  shows his lists or techniques.

Built 2026-10-30 (step 4c):
- **Forgot it:** a new rating of Again (on `/review`, the practice tray, and
  the extension) returns one easier problem with the same technique: the
  first problem not done on its ladder, core tier first, preferring one rated
  below the forgotten problem (`easierInTechnique()`). At most once per
  problem a day, with no mute setting. It shows as a small card with "Open on
  LeetCode".
- **Finished a chapter:** the chapter dialog on the Plan page shows "Go
  deeper" once every problem in it is solved: the next 3 problems on the
  ladder of the technique most of its problems use (`goDeeperInChapter()`).

## Surfaces after

**Web navigation** goes from 6 items to 4:

| Item | What it is |
| --- | --- |
| Today | Review + Next. The due badge moves here. Starting the review opens `/review`. |
| Plan (主页) | The roadmap by chapter, plan picker, the user's frequent mistakes per chapter, the LeetCode account. |
| Problems | Everything in the deck, including problems outside the current plan. |
| Settings | Unchanged. |

- `/review` stays as a page, entered from Today; it leaves the navigation.
- `/analysis` leaves the navigation. Its stability charts, burden forecast,
  and risk table are FSRS internals. The one useful part, weak spots across
  problems, moves to the Plan page per chapter. (Built in step 4c: each
  chapter dialog lists the user's active weak spots on its problems, the Plan
  page has "Your frequent mistakes", and `/analysis` is gone and redirects to
  the Plan page.)
- The problem page shows its chapter and techniques in the header. Its tabs
  lose Cards; Same pattern stays there as the technique's ladder.

**Extension side panel:** the ladder icon goes; the problem view shows the
chapter and techniques (one line under the title, for saved and unsaved
problems); Today gets the same Next part as the web.

## Docs: three to two

- **Solutions**: what the review judges against, now with a signal per
  approach.
- **Notes**: everything else. The Cards doc is appended to Notes by a
  migration, under a `## Cards` heading, and the Cards tab goes away. The
  card stays the user's own words; ankify no longer treats it as a separate
  thing to study.

Built 2026-10-30 (step 4a): migration `0025_cards_into_notes`, with the card
prompts one level down (`###`) so the cards stay one Notes section. The
Cards doc stays untouched for extension builds 0.3.x; details in
[coach-practice.md](./coach-practice.md) ("Cards fold into Notes").

## What gets removed

Users can't see these; removing them shrinks what has to be kept working:
- Legacy Quiz, AI card candidates, card rows, and their `ai_jobs` kinds
  (`quiz_*`, `card_*`). Extension builds from 0.3.0 on don't call them;
  remove once older builds are gone.
- `recall_check` practice mode and the `practice_check` job.
- Analysis's charts and dev reset (removed in step 4c, with the whole page).

Built 2026-10-30 (step 4b) for the first two: the code is gone, and with no
job kind left so is the AI job pipeline (Vercel Queues, `/api/ai-jobs`,
`@ankify/api-client`). The tables stay, unused, and the data export still
includes card rows and quiz sessions. A few read-only answers stay for the store extension (0.3.1);
details in [coach-practice.md](./coach-practice.md) ("Legacy code removed").

## Order of work

1. **Pull back.** Navigation to 4; Same pattern removed from after ratings,
   from `/review`, and from the extension's top bar; Analysis out of the
   navigation. Small, mostly deletion.
2. **Plan first.** Onboarding starts with picking a plan; Today gets its two
   parts; the extension's Today gets Next.
3. **Recognize the pattern.** The signal point in the Solutions writer, the
   Coach's opening question, the judge, and eval cases.
4. **Clean up.** Cards into Notes (migration; 4a, built), legacy code removed
   (4b, built), technique-anchored "one more" suggestions with chapters and
   techniques on the problem and mistakes per chapter (4c, built).

## How we'll know

Two numbers, weekly:
- **Not forgetting:** of the problems that came due, the share that got a
  rating (`self_recall_rated` events, not undone).
- **Learning:** problems in the current plan that moved from not started to
  solved.

## Open questions

- Problems in the deck but outside the current plan: only in Problems, or
  also a small "outside your plan" group on the Plan page?
- Switching plans keeps everything (status is per problem), but should Next
  ask before switching chapters mid-way?
- Should a Hard or Again on the technique point add the problem's technique
  to the user's weak spots, so that "weakest technique" has data before a
  plan ends?
