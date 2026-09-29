# Daily Practice Feed

A short, deterministic set of practice items each day (default 3) that targets
the user's weak skill dimensions from the [Mistake Profile](MISTAKE_PROFILE_PLAN.md).
No LLM is involved: items come from the user's own deck, quiz questions they
missed before, and unseen LeetCode problems similar to ones they struggled
with. Architecture context: [ARCHITECTURE.md](ARCHITECTURE.md).

**Principle.** FSRS already reschedules the exact problem the user failed. The
feed trains the *pattern* on other problems and quiz items, and **never writes
FSRS state**: its outcomes only feed the weakness model.

## Status

| Area | Status |
| --- | --- |
| Engine: `planDailyFeed()` in `packages/core/src/daily-feed/` (pure, tested) | In progress on `feat/mistake-profile` |
| Persistence (`feed_items`), settings, API, Today UI | Planned |
| Capturing `similarQuestions` title/difficulty/paid flag | Planned (needed for `new_problem`) |

## Item kinds

| Kind | What the user does | Cost |
| --- | --- | --- |
| `quiz_retry` | Answers a previously **missed** quiz item again (choices shuffled) whose scope maps to the target dimension | None; reuses stored items |
| `problem_drill` | Works an owned problem with a dimension-specific prompt, reveals notes, self-reports `clean` / `shaky` / `failed` | None |
| `new_problem` | Opens an unseen, free similar question on LeetCode; self-reports the outcome; capturing it adds it to the deck | None |

Drill prompts (static, translated): **approach** "name the approach and why it
fits"; **invariant** "write the state, recursion contract, or loop invariant";
**edge_case** "list the inputs that break it" (plus the stored failed test
case, if any); **complexity** "state time and space and the dominant cost";
**implementation** "re-solve on LeetCode without your old code";
**conceptual** "explain what the technique guarantees"; no dimension: "recall
the full solution, then check your notes".

## 1. Evidence

Each piece of evidence becomes a fail or pass weight, multiplied by a decay of
`0.5^(age / 21 days)`; evidence older than 90 days is ignored.

| Evidence | Fail | Pass | Dimension |
| --- | --- | --- | --- |
| Confirmed mistake record (x0.25 once resolved) | 3 | - | its category |
| Quiz answer | wrong 1 | right 1 | `quizScopeToDimension(scope)`; `mistake_review` counts for topics only |
| Feed outcome | `failed` 2, `shaky` 1, quiz `incorrect` 1 | `clean` 2, quiz `correct` 1 | the item's dimension |
| FSRS rating (not undone) | Again 1.5, Hard 0.5 | Good/Easy 0.75 | none; topics only |

Raw submission statuses are **not** evidence: they are symptoms, and retries
inflate them.

## 2. Weakness model

For each dimension `d`, `F_d` and `S_d` are the summed fail and pass weights.

```
p̄   = clamp((ΣF + 1) / (ΣF + ΣS + 2), 0.15, 0.60)   # user's overall failure rate
p_d = (F_d + 3·p̄) / (F_d + S_d + 3)                 # Beta posterior mean, prior strength 3
c_d = F_d / (F_d + 2)                                # how much failure evidence exists
w_d = p_d · c_d                                      # weakness
```

- **Weak** when `w_d ≥ 0.25`. **Hysteresis:** a dimension served as weak in
  the last 14 days stays weak until `w_d < 0.15`, so it doesn't flap.
- **Recovered**: weak within the last 30 days, not weak now.
- **Topic weakness** `u_t` uses the same formula over all evidence on problems
  tagged `t` (its own `p̄` over all evidence).
- **Where a dimension hurts**: `π_d(t)` is the share of `d`'s fail weight on
  topic `t` (a problem's weight is split evenly across its tags).

Worked values (fresh evidence, used as test fixtures):

| Situation | `w_d` | Result |
| --- | --- | --- |
| One confirmed mistake, no other evidence | 0.48 | weak |
| One wrong answer in a 5-item quiz (other 4 right) | 0.155 | not weak |
| Two wrong edge_case answers in a 5-item quiz (other 3 right) | 0.33 | weak |
| One invariant mistake 21 days old, then two `clean` invariant drills | 0.126 | recovered (below 0.15) |

## 3. Handling several weak types at once

Each day has `N` slots (setting `dailyItems`, 0-5, default 3; 0 turns the feed
off). Slots are distributed across **types**: every weak dimension, plus one
**check-up** type.

1. **Shares.** Weak dimensions split `0.85` in proportion to `w_d`; with two or
   more, each share is clamped to [0.15, 0.6] of that split (water-filling, so
   one type can't take everything and none is starved). Check-up gets `0.15`,
   or everything when nothing is weak.
2. **Check-up** serves, in order: recovered dimensions (least recently checked
   first) to confirm the fix held; one exploration pick, the dimension with the
   least evidence (never `other`), so the profile isn't limited to what the user
   chose to log; then topic-weak drills (`u_t ≥ 0.25`) as a cold start. If none
   applies and nothing is weak, the feed is empty and the UI invites the user
   to log a mistake or take a quiz.
3. **Deficit round-robin.** Over a 14-day window, `served_x` is the number of
   slots type `x` received (skipped items count). With `T = Σ served_x + N`,
   `deficit_x = share_x · T − served_x`. Each slot goes to the type with the
   largest deficit, which then drops by 1. Ties are broken by a seeded hash.
   Over days, allocation converges to the shares.
4. **Per-day cap.** While another type still has a candidate, no type gets more
   than `max(1, N − 1)` slots in a day, so practice is interleaved rather than
   blocked.
5. **Kind mix.** The same deficit routine picks the kind for each slot: drill
   0.5, quiz retry 0.25, new problem 0.25 (0 when `includeNewProblems` is off),
   at most one new problem per day, new problems only for weak dimensions. An
   unavailable kind falls back to the next; a type with no candidate at all
   yields its slot to the next type.

Example with `w_invariant = 0.48`, `w_edge_case = 0.33`, `N = 3`, no history:
shares 0.50 / 0.35 / check-up 0.15. Day 1 serves invariant, edge_case,
invariant; day 2 serves edge_case, invariant, check-up. With `N = 1` and three
weak types they rotate by weight, each at least about weekly.

## 4. Candidates and scoring

Eligibility for owned problems (drills and quiz retries): not archived; **not
due now or within 3 days** (the scheduled review shouldn't be made artificially
easy); no FSRS review in the last 2 days; not in the feed during the last 7
days. One item per problem per day.

| Kind | Candidates | Score |
| --- | --- | --- |
| `problem_drill` (weak) | Problems with `affinity_d > 0` or `direct_d > 0` | `2·affinity_d(p) + direct_d(p) + (1 − R_p) + 0.5·max_t u_t + 0.25·min(lapses, 4)/4 + 0.1·jitter` |
| `problem_drill` (check-up) | Any eligible problem; for topic check-ups, problems with that tag | `(1 − R_p) + 0.25·min(lapses, 4)/4 + 0.1·jitter` |
| `quiz_retry` | Missed items of the dimension, missed ≥ 2 days ago, not since answered correctly in a feed, not fed in 7 days | `decay(age of miss) + (1 − R_p)` |
| `new_problem` | Free similar questions of problems with `direct_d > 0` or one of `d`'s top-3 topics; not owned; not fed in 30 days | `direct_d(parent) + affinity_d(parent) ± 0.5` difficulty fit (+ same or easier than parent, − harder) |

`affinity_d(p) = Σ π_d(t)` over `p`'s tags; `direct_d(p) = x / (x + 1)` of
`p`'s own decayed `d` fail weight; `R_p` is FSRS retrievability now; `jitter` is
a seeded hash per problem.

## 5. Determinism, ordering, explanations

- All randomness is a hash of `userId`, the user's local `dateKey` (review time
  zone), and the item key, so the same inputs always yield the same feed.
- The feed is generated on the first load of the day and **frozen for that
  day**; later evidence affects tomorrow.
- Order: quiz retries first (warm-up), then drills, then the new problem;
  dimensions are interleaved inside each group.
- Every item carries reason codes rendered through i18n, e.g.
  `recorded_mistakes {count, topic}`, `quiz_accuracy {correct, total}`,
  `missed_quiz {missedAt}`, `similar_to {title}`, `forgetting_risk`,
  `checkup`, `explore`, `topic_lapses`.

All constants live in `FEED_PARAMS` (`packages/core/src/daily-feed/params.ts`).

## 6. Persistence, API, and UI (planned)

- **`feed_items`**: `id`, `user_id`, `date_key`, `slot`, `lane`
  (`weak`/`checkup`), `kind`, `dimension`, `problem_id` (cascade),
  `target_slug`/`target_title`/`target_difficulty` (new problems),
  `quiz_session_id` (set null) + `quiz_item_id`, `reason_json`, `status`
  (`pending`/`done`/`skipped`), `outcome`, `created_at`, `completed_at`.
  Unique `(user_id, date_key, slot)`; generation inserts with
  `onConflictDoNothing` then re-selects, so concurrent loads agree. Included in
  the account export.
- **Settings** key `feed`: `{ dailyItems, includeNewProblems }`.
- **Server**: `server/feed/today.ts:getOrCreateTodayFeed(userId)` maps DB rows
  to engine input (thin adapter) and is used by the Today page and
  `GET /api/feed`; `PATCH /api/feed/:id` records an outcome or skip. A `failed`
  drill offers "Record mistake?" prefilled with the dimension (mistake source
  `feed_item`).
- **Capture**: `captureProblemSchema` gains optional
  `similarQuestions: {slug, title, difficulty, paidOnly}[]`, stored in a new
  `problems.similar_questions` column; `similarSlugs` stays for older extension
  builds, whose rows fall back to a humanized slug with unknown difficulty.
- **UI**: a "Daily practice" section on `/today` below the due queue, one
  `<Surface>` per item with a dimension pill, reason line, prompt, and outcome
  buttons; later the extension popup's Today tab.

## Tests

`packages/core/src/daily-feed/*.test.ts`: the worked weakness values and
hysteresis; share clamping; a 28-day simulation with two and three weak types
(served shares within ±10 % of targets, no weak type unserved for more than 7
days, per-day cap respected); `N = 1` rotation; cold start and empty feed;
every eligibility exclusion; same seed and input give the same output; kind
fallbacks.
