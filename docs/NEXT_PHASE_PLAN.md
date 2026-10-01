# Next phase plan: post-refactor QA fixes, AI-first mistakes, LeetCode-native look, QA passes

## Context

The extension-first refactor (Phases 0–7, `docs/EXTENSION_FIRST_REFACTOR_PLAN.md`) is nearly done. The owner's manual QA found several problems:
- submission tracking that doesn't update live;
- a "Rate later" rating that comes back;
- the popup and the panel disagreeing on state;
- misleading "Can't reach ankify" errors;
- unreliable offline test steps;
- leftover features nobody needs: editor reset and "Skill handled well";
- a cramped problem page;
- manual mistake entry that adds friction;
- automatic analysis that can't be tested;
- suggestions that can't be tested.

`docs/temp.md` lists four task briefs. This plan turns them into gated, ordered phases based on the actual code.

**Meta-task.** After approval, the first step is to:
1. write this plan to `docs/NEXT_PHASE_PLAN.md`;
2. delete `docs/temp.md`;
3. commit.

Then execute the phases in order.

**Working rules** (from `CLAUDE.md` and auto-memory):
- Branch `refactor/extension-first`.
- One commit per passing checkpoint; never push.
- Record each checkpoint in `docs/EXTENSION_FIRST_CHECKPOINTS.md`.
- Keep `docs/TEST_GUIDE.md` (git-ignored) current.
- Rebuild `apps/extension/dist-local` after every fix the owner will test.
- Gate before each commit: `pnpm test`, `typecheck`, `lint` (≤5 warnings), `test:e2e`, `build`, `extension:check-manifest`.

Path shorthand:
- EXT = `apps/extension/src`
- WEB = `apps/web/src`
- CORE = `packages/core/src`

## Owner decisions (2026-10-01)

- **Improvement signal.** "Skill handled well" is retired. Improvement in category X is now *derived*: a later accepted session on a problem with a confirmed X mistake, where that session has no confirmed X mistake, counts as "pass" evidence. Historical `practice_improvements` rows are kept in the DB and in export, but stop counting.
- **Automatic analysis.** It is on by default once the user has saved their own key, and there is **no per-user daily limit**. Excessive use is still prevented by:
  - eligibility rules;
  - one automatic job per (session, evidence digest);
  - `MAX_ACTIVE_JOBS_PER_USER`;
  - no retry on auth errors.

---

## Phase 1: Tracking and review-state correctness (fix first)

### 1.1 Real-time submission tracking

Root causes found:
- Ticks poll only when the tab is visible **and focused** (`EXT/content/index.ts:65`, `page-session.ts:247`). Finish forces a poll (`page-session.ts:370`).
- Submissions still being judged are silently skipped (`submission-poller.ts:38`).
- When an observation report is queued, the panel view is never updated (`page-session.ts:201`).
- A failed poll backs off for 30 s to 5 min.
- When a session starts from the popup in an already-open tab, that tab is never told (`router.ts:110-116`, and `index.ts:55` returns early for the same slug).

Changes:
- **Gating.** Require visibility only, not focus. LeetCode's submit result often takes focus away.
- **Submit burst.** Listen for clicks on LeetCode's Submit button and for Ctrl/Cmd+Enter in the content script. Then poll every 2 s for about 45 s. Keep the 15 s baseline tick and its backoff.
- **Judging submissions.**
  - The poller reports "judging" submissions as local *pending* items and does not send them to the server.
  - Keep re-polling while any item is still judging.
  - Report each submission to the server once, when it has a verdict.
- **Panel state.** Extend the panel view with a local list of submissions, each in one of four states:
  - `detected`
  - `judging`
  - `verdict` (Accepted / failed)
  - `synced` / `queued`

  The panel merges the server's `evidence` with this local list, keyed by `leetcodeSubmissionId`. While a report is queued, it shows the local entries ("2 submissions · 1 waiting to sync") instead of "No submissions yet".
- **Ambiguous submissions.** Show the `pendingDetails` and `ambiguous` counts the server already sends (`dto.ts:43-61`).
- **Fix for popup-started sessions.** Covered in 1.3: the background tells the tab, and the tab refreshes and starts tracking.
- **Files:**
  - `EXT/content/submission-poller.ts`
  - `page-session.ts`
  - `index.ts`
  - `panel.ts`
  - `shared/i18n.ts`
  - `leetcode-client.ts` (expose the judging status)
- **Tests:**
  - `page-session.test.ts` and `tracking.test.ts`: visibility without focus, submit burst, judging → verdict, the queued report showing local entries, dedup by submission id.
  - e2e `sessions.spec.ts`: the submit count updates within a few seconds without Finish. This uses the fixture's `submit()`; add a "judging first" mode to `tests/e2e/leetcode-fixture.ts`.

### 1.2 Mandatory rating; Finish freezes the session

Existing code:
- `ratingDisposition` already has the values `pending`, `deferred`, `dismissed` and `expired`.
- Expiry is computed when the session is read (`CORE/practice-session.ts:82`), 24 h after completion (`commands.ts:335`).
- The server accepts observations up to 60 s after `completedAt` (`END_GRACE_MS`, `CORE/practice-session.ts:32,149`).
- No migration is needed.

Changes:
- **Remove "Rate later":**
  - the panel button (`panel.ts:423`) and the popup button (`App.tsx:272,421`);
  - the `defer` path in `sessions.ts:172-176`.
  - The server's `defer_rating` command now answers `rating_defer_retired` (409). Outbox operations still waiting are dropped through the existing 4xx rejection list.
  - Existing `deferred` rows are treated as `pending`. They already appear as `pendingRating` (`queries.ts:41`, `review-overview.ts:55`).
- **After Finish,** the panel and the popup show only Again / Hard / Good / Easy plus "Skip rating" (`dismiss_rating`).
  - Closing either surface changes nothing: the server still holds `pending`.
  - Reopening restores the rating screen, because both surfaces read `pendingRating`.
- **Expiry at 24 h.** Already covered by the effective `expired` disposition. Verify that `startSession`'s `rating_pending` block (`commands.ts:210-218`) uses the *effective* disposition, so an expired rating no longer blocks a start. Verify that `expired` never touches FSRS. Add tests for both.
- **Finish freezes the session.**
  - When an observation arrives for a completed session, the server accepts it only for submissions **submitted at or before `completedAt` + 5 s of clock skew**. It also accepts verdict updates to an observation it already has.
  - `END_GRACE_MS` drops from 60 s to 5 s in `classifyObservation`. A delayed verdict for an earlier submission still updates its record, because the check uses the submit time.
  - The client already stops tracking at Finish. The forced poll at Finish keeps catching submissions made just before Finish.
- **Rating idempotency across surfaces.**
  - The server's guards already prevent a second FSRS update: disposition check, `self_recall_rated` existence check, revision compare-and-set, and a unique index.
  - Make a duplicate rating harmless in the UI. When a rating gets `rating_not_pending`, both surfaces refresh and show the stored result instead of an error. Today `decideRating` errors do not refresh (`page-session.ts:421`).
  - Disable the rating buttons while a rating request is in flight.
- **Files:**
  - `CORE/practice-session.ts`
  - `WEB/server/practice-sessions/commands.ts`
  - `queries.ts`
  - `scheduling.ts`
  - `EXT/content/{panel,page-session}.ts`
  - `EXT/popup/App.tsx`
  - `EXT/background/sessions.ts`
  - contracts error enum
- **Tests:**
  - core `practice-session.test.ts`: the grace boundary, expiry.
  - `practice-sessions.test.ts`: an expired rating doesn't block a start or touch FSRS, defer is rejected, a legacy `deferred` row can still be rated.
  - Add rating cases to `rate.concurrency.test.ts`.
  - e2e: rewrite the deferred-rating spec in `sessions.spec.ts` as "close popup → reopen → rating still required".

### 1.3 Popup ↔ panel synchronization

Root cause: the background never broadcasts anything. The content script only handles `open_panel` (`EXT/content/index.ts:90-95`). The popup has no listener (`App.tsx:148-178`).

Design:
- No new store; the server stays authoritative.
- After any state-changing message succeeds or is queued (start, finish, rate, skip, observation, outbox flush result, account change), the background bumps a small signal: `chrome.storage.local["ankify.sessionSignal"] = { sessionId, revision, at }`.
- The content script and the popup both subscribe with `chrome.storage.onChanged` and call their existing `refresh()`.
  - A signal is ignored if its revision is not newer than the revision on screen (the session `revision` column is already in the DTO).
  - Refreshes are debounced to 250 ms.
- Also call `chrome.tabs.sendMessage({type:"session_changed"})` for the session's owning tab. That covers a popup-started session in an existing tab: the tab refreshes and starts tracking.
- `expand()` in `panel.ts:456-460` calls `refresh()`.
- If a refresh fails, the screen shows a small "Couldn't refresh — retrying" state instead of stale data.
- **Files:**
  - `EXT/background/{router,sessions,outbox,index}.ts`
  - `EXT/shared/protocol.ts`
  - `EXT/content/{index,page-session,panel}.ts`
  - `EXT/popup/App.tsx`
- **Tests:**
  - Unit test the signal emission (`sessions.test.ts`), and the ordering and debounce of signal handling (`page-session.test.ts`).
  - e2e: rate in the popup and the panel leaves the rating screen; rate in the panel and the popup updates; both show the same next due date.

### 1.4 LeetCode auth vs Ankify auth, specific errors

Known defects:
- `importHistory` reports a LeetCode read failure as `"offline"` (`EXT/content/index.ts:35-36`).
- `router.ts:47,104,175,182` collapses `server`, `rate_limited` and every non-auth failure into `offline`.
- The start screen never warns about a LeetCode sign-out (`page-session.ts:345` starts with an `unavailable` baseline).
- A thrown `chrome.runtime.sendMessage` (an orphaned content script after an extension reload, or the worker restarting) also shows as `offline`.

Changes:
- **Error taxonomy** in `protocol.ts`, each with its own i18n message:
  - `offline`: network or fetch exception.
  - `server_unavailable`: 5xx or 408.
  - `rate_limited`
  - `signed_out`: Ankify 401, which shows the sign-in view.
  - `leetcode_signed_out`
  - `leetcode_unreadable`
  - `extension_reloaded`: `sendMessage` threw with "Extension context invalidated". The fix is to reload the page.
- **Messaging retry.** The content script retries `sendMessage` once after 300 ms before reporting `extension_reloaded`, which covers a worker cold start.
- **LeetCode availability:**
  - Re-check it on `visibilitychange`, on each tick, and on the 401/403 paths.
  - Show a warning on the start screen and in the active session ("Sign in to LeetCode to track submissions").
  - The warning clears automatically once a poll succeeds. When that happens, the baseline is re-established and no submissions are lost: the `known` map and baseline are kept per session.
- **Reproduce the "Review early" failure after re-login.**
  - Script it first in e2e. Flip the fixture's `userStatus` and `csrftoken`, then start an early review.
  - If the failure comes from a stale owner token in `chrome.storage.session` or an orphaned script, fix that specific cause.
- **Tests:**
  - `router.test`, `page-session.test` and `index` unit tests for each error class.
  - e2e: sign out of LeetCode mid-session → warning → sign back in → tracking resumes; start Review early after re-login.

### 1.5 Offline verification

Fact: every Ankify API call goes through the background service worker (`EXT/background/api.ts`). Taking a LeetCode tab offline in DevTools only blocks LeetCode GraphQL, never Ankify sync.

Automated tests:
- Extend the existing outage helper (the "outage survives a worker restart" spec) to cut the network:
  - before start;
  - during the session;
  - during finish;
  - during rating;
  - then reconnect and auto-flush.
- Repeat that with duplicate delivery: replay the same operation id and confirm there is still one row.
- Close the popup and stop the service worker while operations wait.
- Switch accounts with operations waiting: use `/api/qa/login?account=second`; the waiting operations stay scoped to the first account and are never sent.
- Use the Playwright `context.route` abort on the API origin, which also covers the service worker. Confirm this when implementing; if it doesn't, use a server-side "QA outage" toggle that answers 503.
- Unit: add duplicate delivery and the account-switch race to `outbox.test.ts`.

Manual steps in TEST_GUIDE:
- "Open chrome://extensions → Ankify → *service worker* → Network → Offline (cuts sync)."
- "The LeetCode tab's DevTools only cuts LeetCode reads."
- Or stop the local dev server to simulate the backend being down.

**Gate 1:** all of the above, plus the full gate. Commit as two or three checkpoints:
1. 1.1 + 1.3
2. 1.2
3. 1.4 + 1.5

Update TEST_GUIDE §1 and give exact reproduction steps for each reported bug.

---

## Phase 2: Remove and simplify

- **2.1 Editor reset.**
  - Delete `EXT/content/reset-code.ts` and its wiring (`index.ts:7,77`, `panel.ts:348-353,436-439`).
  - Delete its strings (`i18n.ts:51-53`).
  - Grep for shared helpers before deleting `waitFor`.
- **2.2 "Skill handled well":**
  - Remove `session-improvement.tsx` and the "Handled well" pills (`problems/[id]/page.tsx:98-120`).
  - Remove the `sessions.handledWell*` i18n keys.
  - Delete the POST/DELETE improvement routes, or make them return 410 Gone. Keep GET out too, because nothing calls it.
  - Remove `createImprovement`'s `improvement_test` trigger (`mistakes.ts:505-509`, `CORE/session-analysis.ts`).
  - Keep the table, the export (`account-export.ts:169-180`) and the migration fixture tests.
  - **Profile:** in `WEB/server/mistake-profile.ts`, replace the loaded improvements with *derived clean reviews*.
    - For each completed, accepted session on a problem that has a confirmed mistake in category X from an earlier context, where this session has no confirmed X record, count one `(session, X)` pass.
    - It keeps the same weight, `IMPROVEMENT_WEIGHT`, and decay.
    - Do it in a user-scoped SQL join so `computeMistakeProfile` keeps its pure input shape. Rename `improvements` to `cleanReviews`, and update the UI copy at `i18n.ts:605-606,1291`.
  - **Tests:** `profile.test.ts`, `mistake-profile.test.ts`, `problem-detail.test.ts`, the route tests (deleted or switched to 410), and `session-analysis.test.ts` (drop the improvement-trigger cases).
- **2.3 `/problems` headers** (`problems-client.tsx:366-455`, `i18n.ts:249-256,954-958`):

  | Old | New label | Notes |
  |---|---|---|
  | Title | Problem | |
  | Diff | Difficulty | |
  | Due | Next review | |
  | Reps | Reviews | Shows `fsrsReps`; the lapse count `↓n` becomes a separate **Forgotten** column with an `aria-label` |
  | Drills | (removed) | `cardTotal` is a legacy suspended feature; also remove the query at `problems-list.ts:120-136` |
  | State | Memory state | |

  Keep sorting, and add ZH equivalents. The table needs a horizontal-scroll wrapper only below `sm`.
- **2.4 Problem detail layout:**
  - In `problem-workspace.tsx:51`, drop `h-[42rem] max-h-[calc(100vh-3rem)] overflow-hidden`. The section grows with its content (`min-h-[28rem]`).
  - The body loses `overflow-y-auto`, so the page scrolls.
  - The tab bar becomes `sticky top-0` inside the section.
  - Tabs that need a bounded height (the code view or notes editor, if any) get their own `min-h` without a nested scroll.
  - Check the rail (`page.tsx:144`, `lg:sticky lg:top-6`) still works.
  - e2e: at 1920×1080 the statement's `scrollHeight` equals its `clientHeight` (no inner scroll), and the document has no horizontal overflow at 390 px.

**Gate 2**, one checkpoint commit.

---

## Phase 3: AI-first mistakes

Current state:
- `ai_suggested` candidates appear only on `/analysis` (`analysis/candidate-actions.tsx`, confirm or dismiss only) and in the extension's `findingBlock` (`panel.ts:258-289`), which can correct the category.
- Manual entry is the main action on the problem page (`mistake-list.tsx:158-164`, `record-mistake-dialog.tsx`, the per-submission `log-mistake-button.tsx`).

Changes:
- **Problem page Sessions tab** (`problems/[id]/page.tsx:90-125`). Each completed session shows its analysis state, using `getSessionAnalysisState`:
  - queued
  - analyzing
  - findings
  - "no clear mistake identified" (`insufficientEvidence` or empty findings)
  - failed
  - needs key

  Candidates show inline with **Confirm**, **Change category ▾** (a select that confirms with the new `primaryCategory`) and **Dismiss**. There is a "Re-analyze" button for stale or failed analyses.
- **`/analysis` candidates** get the same category correction (`candidate-actions.tsx`). Extract one shared `CandidateActions` component used on both pages.
- **Correction persistence.**
  - The existing PATCH applies `primaryCategory` + `status: confirmed`.
  - Store the original `suggestedCategory` in the record's existing `evidence` JSON, so no migration is needed. `updateMistake` (`mistakes.ts:358-422`) writes it on a category change.
  - The UI labels records "AI suggested" (candidate), "Confirmed" or "Corrected from X".
  - The profile counts confirmed records only, in their final category (already true, `profile.ts:180-186`).
- **Dedup check.**
  - `run.ts:165-173` already skips categories already recorded for the session.
  - Re-analysis replaces the *candidates* from the previous analysis: candidates from the previous job are dismissed in the same transaction. Confirmed records are never touched.
  - Add a test that analyzing twice never creates a second record.
- **Manual entry becomes secondary.**
  - Remove `log-mistake-button` from `submission-list.tsx:118`.
  - In the Mistakes tab, replace the primary "Record" button with a small text link, "Add manually".
  - The explanation field becomes optional (check `mistakeCreateSchema`).
- **Prompt.**
  - Make sure `evidence.ts` includes the failing test input, the expected and actual output, and the diff from the previous attempt.
  - Keep the rule "if evidence does not show a cause, return no findings + insufficientEvidence".
  - Add a fixture test: a failed submission with no diagnostic evidence gets no candidate.
- **Tests:**
  - `mistakes.test` (correction stores `suggestedCategory`)
  - `session-analysis.test` (re-analysis dismisses old candidates and creates no duplicates)
  - profile (dismissed and candidate records weigh nothing; a corrected record counts in its new category)
  - e2e `analysis.spec.ts`: confirm, correct and dismiss on the problem page.

**Gate 3**, a checkpoint commit.

---

## Phase 4: Automatic analysis that runs in development

Why it is tied to the recovery cron today:
- The job row is committed in the finish transaction. The queue `send` happens after the commit (`publishPlannedJob`, `jobs.ts:322-330`) and can fail.
- A manual job is recovered by the user's own polling (`redispatchStrandedJobs` from the analysis-state and overview routes).
- An automatic job has nobody polling, so `features.ts:56-64` gates it behind `ANKIFY_AUTOMATIC_ANALYSIS` until a cron exists.
- Locally, `dispatchAiJob` is a no-op under QA, and `qa-worker.ts` polls the DB directly. Recovery therefore doesn't matter locally; only the env flag blocks it.

Changes:
- **Decouple.**
  - `ANKIFY_AUTOMATIC_ANALYSIS` becomes a pure operator kill switch.
  - It is `enabled` in `.env.qa` and `.env.example` (local), and it stays an explicit Production decision documented in DEPLOYMENT.
  - Request-time recovery stays as it is.
  - Also redispatch the user's stranded jobs from the popup's overview flush, which already happens on every popup open.
  - The cron remains the backstop for Production.
- **Defaults** (owner decision):
  - `automatic` defaults to true when the user has their own key (`settings.ts:58-61`; resolve on read so existing users get it).
  - Remove `dailyAutomaticLimit` from the settings UI, the contracts and the budget check (`jobs.ts:221-235`, `settings/form.tsx:672-754`). The stored JSON key is ignored.
  - The manual limit (10/day) stays.
- **Eligibility** (`CORE/session-analysis.ts:34-45`, `automaticAnalysisTrigger`). Trigger when all of these hold:
  - the session is completed;
  - it has ≥1 failed submission with code (wrong answer, runtime error, TLE, MLE, or compile error);
  - the user has their own key;
  - it has not been analyzed with the same evidence digest, checked against the cache key.

  Other rules:
  - All-accepted sessions are skipped.
  - `pattern_recurrence` and `repeated_failures` become reasons recorded on the job, not gates.
  - The idempotency key changes from `auto:${sessionId}` to `auto:${sessionId}:${digest}`, so new evidence can re-trigger. Delayed verdicts that arrive after Finish could change the digest; plan again on the observation command too, only when the session is completed.
- **Reliability checks** (most exist; add tests where missing):
  - leases and reclaim (`ai-generation/jobs.ts:402-503`);
  - 3 attempts with 30 s and then 120 s backoff;
  - 401/403 → `ai_request_rejected`, not retried. Also classify auth errors that arrive without a numeric status by provider error name/code (`errors.ts:19-77`).
  - 429 → retry with `Retry-After`;
  - an invalid key → the session state shows "check your API key" plus a link to Settings;
  - `MAX_ACTIVE_JOBS_PER_USER` stays as the runaway guard.
  - The key stays encrypted server-side; nothing about the key reaches the extension.
- **UX:**
  - In the panel's `analysisBlock` and the web Sessions tab, Finish shows "Analysis queued" right away and never blocks.
  - The extension polls only while the panel is open.
  - Results stay visible later in the problem's sessions and on `/analysis`.
  - The "Analyze session" button stays for re-analysis.
- **Testing with real providers.** Add `apps/web/scripts/provider-smoke.ts` (`pnpm qa:provider-smoke`). It reads keys from **`.env.smoke.local`** (git-ignored), with these variables:
  - `SMOKE_DEEPSEEK_API_KEY`
  - `SMOKE_OPENAI_API_KEY`
  - `SMOKE_ANTHROPIC_API_KEY`
  - `SMOKE_GOOGLE_API_KEY`

  It then:
  - runs one fixture session through `run.ts`'s provider call for each provider whose key is present;
  - validates the output schema;
  - checks that a deliberately bad key is classified as not-retryable;
  - prints only provider, model, latency and pass/fail. It never prints the key, the request headers or the raw response.

  The owner creates that file locally; keys are never pasted into chat or committed. Add `.env.smoke.local` to `.gitignore`. The deterministic fake provider stays in e2e.
- **Tests:**
  - `session-analysis.test`: eligibility matrix; digest idempotency; duplicate triggers create one job; no daily cap; auth not retried; recovery of an expired lease.
  - e2e `analysis.spec.ts`: finish a failed session, close the tab, and the analysis is done on the problem page.

**Gate 4**, a checkpoint commit. Update DEPLOYMENT, ARCHITECTURE (the analysis section) and TEST_GUIDE §5.

---

## Phase 5: Testable suggestions

What the code requires:
- Candidates come only from `suggestion_candidates` (written by `recordSimilarQuestions` when a LeetCode problem is captured or started, `problem-upsert.ts:61`) plus the global catalog.
- The catalog is empty: `catalog.json` has `generatedAt: null`, and the `scripts/leetcode-catalog.js` script is run by hand.
- `qa-seed.ts` writes only `similarSlugs`. It writes no candidates and no `attempt_history`. So `dev:qa` and `dev:demo` always show "no candidates".
- Exclusions:
  - every `problems` row, archived ones included;
  - `attempt_history`;
  - suggestions from the last 30 days;
  - pending suggestions;
  - paid-only problems;
  - unverified candidates.
- Limit: 20 per day.
- A fresh account gets suggestions after its first captured problem that has similar questions, or after a catalog exists.

Changes:
- **QA seed fixture** in `qa-seed.ts`:
  - 3 practiced problems with `similarQuestions`;
  - about 8 `suggestion_candidates` rows (`source: similar_question`, verified, a mix of difficulties, one paid-only, and one that collides with an existing problem so the exclusion shows);
  - `attempt_history` rows (one `user_marked`, one accepted);
  - confirmed mistakes in 2 categories, so the personalized lane fires.
  - `demo-seed.ts` gets an English equivalent.
- **Small committed test catalog** `WEB/server/suggestions/catalog.qa.json`, loaded only under the QA profile. The planner tags it as `source: catalog` so the UI never presents it as personalized or similarity-based.
  - The Production catalog stays an owner task: document the steps in DEPLOYMENT.
- **Empty pool.** Check that the popup, `/suggestions` and `/today` all show a clear "No new problem to suggest yet: practice a problem with related questions" state.
- **Tests:**
  - `planning`/`suggestions.test`: seeded fixture → personalized pick; exclusions; daily limit of 20; dedup.
  - e2e `suggestions.spec.ts` runs against the seed instead of ad-hoc capture, and also covers the empty second account.
- Document the prerequisites in ARCHITECTURE and TEST_GUIDE §3.

**Gate 5**, a checkpoint commit. Rewrite TEST_GUIDE fully at the end of Phases 1–5.

---

## Phase 6: LeetCode-native visual refresh (no logic, contract or schema changes)

**Tokens.** Refine the palette in three places that must stay in sync:
- `WEB/app/globals.css` (3 theme blocks);
- `EXT/popup/popup.css` (4 blocks);
- `EXT/content/panel-styles.ts`.

| Token | Light | Dark |
|---|---|---|
| `accent` | `#FFA116` | `#FFA116` |
| `bg` | `#F7F7F8` | `#1A1A1A` |
| `surface` | `#FFFFFF` | `#262626` |
| `success` | `#2CBB5D` | `#2CBB5D` |
| `danger` | restrained red | restrained red |
| `easy` / `medium` / `hard` | LeetCode's teal/amber/red | same |

- Neutral borders and muted text are tuned per theme to AA contrast.
- Accent text on light backgrounds uses a darker amber so it meets AA.

**Other rules:**
- Smaller radii, close to LeetCode's ~8 px.
- No shadows except the floating panel.
- Denser spacing.
- Keep the sans/mono rules from `CLAUDE.md`.

**Order:**
1. **Embedded panel.** It follows LeetCode's theme by watching `document.documentElement`'s `dark` class / `color-scheme` with a MutationObserver. It sets `data-theme` on the shadow host and falls back to `prefers-color-scheme`. Confirm the signal against live leetcode.com through the probe. Styles stay inside the shadow root (`:host { all: initial }` already). The collapsed pill stays compact and must clear LeetCode's console and submit bar; check positions at three viewport widths. The rating buttons get distinct borders and labels, not color alone.
2. **Popup.** Same tokens; fixed width; scrolls inside.
3. **Web.** Apply the tokens through `components/ui` (Button, Surface, Pill, tabs, tables). Pages: `/today`, `/problems`, problem detail, `/analysis`, `/suggestions`, settings.

Also delete the dead `ThemeToggle.tsx` and `LanguageToggle.tsx` (the remaining Phase 7 dead-code item).

Inspect each step with Chrome DevTools MCP in light and dark at 1440 and 390 widths.

**Gate 6**, checkpoint commits: one for the panel and popup, one for web.

---

## Phase 7: Functional QA pass (temp.md brief 3)

Actively run and debug, never weaken assertions.

1. Fill gaps in unit and e2e coverage against brief 3's matrix:
   - submission tracking;
   - rating lifecycle and FSRS exactly once;
   - cross-surface sync;
   - auth and offline;
   - AI analysis;
   - profile;
   - suggestions.

   Most of these were added in Phases 1–5; audit for anything missing.
2. Run the full gate. For each failure:
   - reproduce it;
   - find the root cause;
   - fix it;
   - add a regression test;
   - rerun the related suites.
3. Real-browser pass with Chrome DevTools MCP on `pnpm dev:qa` with `dist-local`, walking the whole flow on the **LeetCode fixture**. Live LeetCode stays a manual owner step: no submissions to the owner's account.
4. Write a report in the checkpoint log. Mark which checks used mocks or fixtures and which used real services.

## Phase 8: Visual QA pass (temp.md brief 4)

- Add `@axe-core/playwright` (one dev dependency) and an `a11y.spec.ts` that runs over the main web pages, the popup and the panel host.
- Add `tests/e2e/visual.spec.ts` using Playwright's `toHaveScreenshot`:
  - deterministic seed;
  - animations disabled;
  - fixed viewports: 1920×1080, 1440×900, 1280×800, 768×1024, 390×844, and the popup size;
  - light and dark.
  - States: panel collapsed, expanded, active, pending rating, completed; popup full and empty; each web page.
- Baselines are reviewed by eye before they are committed, and run on a separate `pnpm test:visual` so font differences don't make the main gate flaky.
- Debug each defect by fixing the shared token or component first.
- Write a final report in the checkpoint log.

---

## Verification (each phase)

- **Full gate:**
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test:e2e`
  - `ANKIFY_EXTENSION_API_ORIGIN=… pnpm build`
  - `pnpm extension:check-manifest`

  Read each step's log, not only its exit code.
- **Manual:**
  - Rebuild `dist-local` (`cd apps/extension && pnpm exec vite build --mode development --outDir dist-local`).
  - Run `pnpm dev:qa`, then go through the updated TEST_GUIDE sections.
- **Real providers:** `pnpm qa:provider-smoke` once `.env.smoke.local` exists.
- **Live LeetCode:** the owner runs `scripts/leetcode-live-probe.js` and checks the panel theme signal.
- Never report unexecuted checks as passed. Fixture or mock results are labeled as such.

## Risks and notes

- The submit-button selector and the LeetCode dark-mode signal depend on LeetCode's DOM. Each needs a fallback (the 15 s tick; `prefers-color-scheme`) and live-probe confirmation.
- With no daily cap on automatic analysis, a user's key could be spent on many failed sessions. The eligibility rule (needs a failed submission with code) and digest idempotency keep it to at most one call set per evidence state. Flag it in the Settings copy.
- Shrinking `END_GRACE_MS` depends on LeetCode's clock and the server clock agreeing to within 5 s. The server-side unit tests cover the boundary.
- No migrations are planned. The only stored-data changes are the derived profile and `suggestedCategory` in the existing `evidence` JSON.
