# Session handoff: extension-first refactor

Written for a fresh agent with repo access and no conversation history. This is a handoff, not ground truth; verify against the code and `git`.

> **Update (2026-10-01): superseded in part.** The work in `docs/NEXT_PHASE_PLAN.md` is now done.
>
> - **Commits:** `520936b`, `590d9b5`, `07735ec`, `707e256`, `38e9d2c`, `cf098cc`, `a7aabdc`, `18972e8`, `9715c64`, `a3fc475` (OpenAI presets), and `3d4b17b` (second QA round), on `refactor/extension-first`. None are pushed.
> - **Read first:** the "Next phase" entries at the end of `docs/EXTENSION_FIRST_CHECKPOINTS.md`.
> - **Changes to the notes below:**
>   - "Rate later" is retired.
>   - Automatic analysis is on by default with the user's own key, with no daily cap.
>   - "Skill handled well" is retired in favor of derived clean reviews.
>   - The palette is LeetCode-native (`apps/extension/src/shared/theme-tokens.ts`).
>   - `pnpm test:visual` and `pnpm qa:provider-smoke` exist.
> - **Second QA round (2026-10-01, evening):** see "Second QA round fixes" at the end of the checkpoint log.
>   - Automatic analysis now covers every finished session with code, reviews included.
>   - Closing a tab releases its session (the `release` command).
>   - LeetCode sign-out is confirmed through `userStatus`.
>   - QA/demo sign-in works again after a sign-out.
>   - Its gate: 519 unit tests, typecheck, lint (5 warnings), 47 e2e, 7 visual, build, and manifest.
>   - Not verified live: the LeetCode sign-out warning on leetcode.com.
> - **Docs:** `docs/TEST_GUIDE.md` and this file are tracked in git from now on.
> - **Owner-only items still open:**
>   - re-testing the second QA round from TEST_GUIDE's table at the top;
>   - the live LeetCode probe and the theme, panel, and Submit checks;
>   - catalog generation;
>   - the Production decision on automatic analysis;
>   - OpenAI credit.

## 1. Objective

Carry out `docs/EXTENSION_FIRST_REFACTOR_PLAN.md` (Phases 0 to 7, each with a gate). Codex did Phase 0. Claude sessions completed Phases 1 to 6 and are partway through Phase 7. The end state: the daily workflow runs in the Chrome extension on LeetCode. It tracks practice sessions, applies session-based FSRS ratings, syncs durably, records session evidence, offers BYOK AI session analysis, suggests new problems, and adds web dashboard surfaces. Legacy card/quiz/Coach flows are suspended.

Owner's working rules (also in auto-memory):

- Work on branch `refactor/extension-first`.
- Commit once per checkpoint, and only after the full gate passes. **Never push.**
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Record each checkpoint in `docs/EXTENSION_FIRST_CHECKPOINTS.md`.
- Live LeetCode validation is manual: the owner runs `scripts/leetcode-live-probe.js` in a signed-in leetcode.com tab and pastes the report. That report is still pending.
- The owner tests by hand from `docs/TEST_GUIDE.md` (tracked in git since 2026-10-01). Update it whenever user-visible behavior changes.
- After a fix the owner will test, rebuild `apps/extension/dist-local` (see section 6) and tell them to reload the extension.

## 2. Architecture and context needed

Read `CLAUDE.md` (the rules) and `docs/ARCHITECTURE.md` (the source of truth, updated through Phase 7 documentation and Gemini) first.

- Monorepo:
  - `apps/web`: Next.js 16; server logic lives in `src/server/`.
  - `apps/extension`: MV3. Its parts are `background/` (the only API client, with an IndexedDB outbox), `content/` (page session plus a shadow-root panel), and `popup/`.
  - `packages/db`: Drizzle schema in `src/schema.ts` and migrations in `drizzle/`.
  - `packages/core`: pure rules (FSRS, `practice-session.ts`, `profile.ts`, `session-analysis.ts`).
  - `packages/contracts`: Zod schemas and DTOs.
- Practice sessions: `server/practice-sessions/*`. Finishing a session runs in one transaction in `commands.ts:runSessionCommand`.
- Mistake profile (4A):
  - `server/mistake-profile.ts` loads the inputs with user-scoped joins; `core/profile.ts:computeMistakeProfile` aggregates them. Nothing derived is stored.
  - Routes: `GET /api/mistakes/profile`, `POST/GET /api/mistakes/improvements`, and `DELETE /api/mistakes/improvements/[id]`.
- Session analysis (4B), under `apps/web/src/server/session-analysis/`:
  - `evidence.ts`: loads evidence, computes the digest, and builds the bounded prompt (32,000 characters, attempt labels S1 to S99).
  - `diff.ts`: line diffs used in the prompt.
  - `jobs.ts`: manual creation, `planAutomaticAnalysis` (runs inside the finish/improvement transactions), budgets, `redispatchStrandedJobs`, `isEstablishedPattern`.
  - `run.ts`: the runner. It checks for the user's own key (BYOK), makes the provider call with `maxRetries: 0`, and commits in one transaction: the analysis, its candidates, and the job state.
  - `queries.ts`: `getSessionAnalysisState`.
- Routes and wiring for analysis:
  - `POST /api/ai-jobs` accepts `{action:"session_analyze", practiceSessionId, requestId}`; see `ai-generation/start.ts`.
  - `GET /api/practice-sessions/[id]/analysis` returns the analysis state.
  - `GET /api/cron/ai-dispatch` (Bearer `CRON_SECRET`) re-sends stranded jobs. It is not scheduled in `vercel.json`.
  - `ai-generation/runner.ts` dispatches every action with an exhaustive `switch`.
- Flags:
  - `ANKIFY_DISABLED_WORKFLOWS` is the kill switch. `session_analysis` is now implemented, so it can be switched off there.
  - `ANKIFY_AUTOMATIC_ANALYSIS=enabled` makes automatic analysis available.
  - `ANKIFY_QA_AI_BASE_URL` is a fake-provider URL honored only in the QA profile.
- Extension analysis UI:
  - `background/analysis.ts` holds the client.
  - Protocol messages: `analysis_state`, `analysis_start`, `analysis_finding`.
  - `content/page-session.ts` owns the `AnalysisView` and polls every 4 seconds while a job runs.
  - `content/panel.ts:analysisBlock` renders it.
  - `PracticeSessionCurrentDto` has a new `recentCompleted` field (the latest session completed in the last 7 days).
- AI providers, in `server/ai.ts`:
  - `buildModel` handles `anthropic`, `openai`, and `google` natively, and `deepseek` through `OPENAI_COMPATIBLE_PRESETS`.
  - `providerCallOptions(settings, maxOutputTokens)` gives Gemini low thinking plus 4,000 tokens of headroom; `session-analysis/run.ts` uses it.
  - Model listing lives in `server/ai-models.ts`.
  - The provider list is repeated in several places; adding a provider touches all of them:
    - `aiProviderEnum` in contracts and `AiProvider` in core;
    - the DB schema text enums (no migration);
    - `starter-ai.ts` `PROVIDERS` and the seed guards;
    - the settings form and the onboarding card.
- Time zone: the device decides it.
  - The web `components/TimeZoneSync.tsx` posts the browser zone to `/api/settings` when it changes.
  - The extension background's `followDeviceTimeZone` does the same on overview.
  - Settings has no time-zone UI.
- Popup "This problem" section: open the panel, or reload a tab that predates the extension. The panel's `expand()` is driven from the popup.

## 3. Work completed

**Fully completed and committed:** Phases 0 to 3, **4A** (`8da210e`), **4B** (`2048edb`), **5.1** (`7cf8343`: migration `0024` candidates, attempt history and coverage, similar-question metadata, deletion history, the catalog generator with an empty catalog) **5.2** (`dbaa73b`: `planSuggestion()` in `packages/core/src/suggestions/`) **5.3** (`19171ea`: migration `0025` suggestions, `/api/suggestions`, the actions, and `/api/attempt-history`) and **5.4** (`4af0c68`: the popup suggestion card, suggestion start, and the page's metadata refresh on `set_baseline`). **Phase 5 passes**; its exceptions are recorded in the checkpoint log (empty catalog, no LeetCode history reads yet, pending live probe). Phase 6A so far: **6A.1** Settings (`6c8a73a`), **6A.2** `/suggestions` (`2130cc2`), **6A.3** the mistake profile on `/analysis` (`7d044cb`, which also fixed the QA worker dying on `SQLITE_BUSY`) **6A.4** the `/today` dashboard (`0dc707e`) and **6A.5** problem history (`9bf7b8d`, which also switched local SQLite to WAL to end cross-process `SQLITE_BUSY` flakes in the browser harness). **Phase 6A passes.** **6B.1** (`c213f5c`: Coach, card/quiz generation and credit sales suspended server-side, re-enabled only with `ANKIFY_ENABLED_LEGACY_WORKFLOWS`) and **6B.2** (`122aa33`: legacy web UI retired, `/review` redirects, onboarding and landing copy rewritten, `flexlayout-react` removed, the lint cap now 5). **Phase 6 passes.** Phase 7 so far:

- `890de4e`: the panel is findable.
  - popup "This problem" section;
  - due auto-open;
  - "New problem" pill;
  - gear icon opens settings.
- `b2830a6`: README, SELF_HOSTING, and CLAUDE.md/AGENTS.md rewritten for the extension-first product.
- `a07ce70`:
  - DeepSeek analysis fixed: the JSON schema is now in the system prompt for `json_object` mode;
  - time zone follows the device;
  - generation language defaults to English;
  - problem-page actions stacked;
  - Vercel Analytics only on Vercel.
- `c68769d`:
  - Google Gemini provider;
  - Settings time-zone row removed; the section is now "Language".

Details are in the checkpoint log.

4A delivered:

- `mistake_records.practice_session_id` and `evidence`.
- A new `practice_improvements` table, migration `0022_m2_session_evidence`.
- The session summary on the session detail.
- The profile API and the export of improvements.

4B delivered BYOK session analysis (migration `0023_m2_session_analysis`):

- the `session_analyze` job;
- `session_analyses` cache;
- automatic analysis planned in the finish/improvement transactions;
- budgets;
- `dispatched_at` plus `redispatchStrandedJobs` (from the overview route, the analysis-state route, and `/api/cron/ai-dispatch`);
- the extension panel UI;
- the fake-provider e2e harness.

The DEPLOYMENT, MISTAKE_PROFILE_PLAN and `.env.example` docs are updated.

The session that finished 4B also fixed:

- the `session_analysis` kill switch now fails queued jobs before any provider call (`run.ts`);
- panel polling continues through a failed read and resumes on page activation (`page-session.ts`);
- the protected-history migration test now migrates over a populated `ai_jobs` table.

**In progress:** the rest of Phase 7: dead-code cleanup and the final validation entry. This file is tracked in git (since 2026-10-01); update it at the end of each session.

## 4. Decisions and constraints

- Session dedup index `mistake_records_session_dedup_unique`:
  - Scope: only `source_type='practice_session'` records, per origin. Every visible record survives; scoring counts each context once.
  - Why: an earlier version merged separate submission notes.
- Constant JSON defaults (`'[]'`) on added columns. SQLite rejects expression defaults when adding a column to a table that has rows.
- No `practice_evidence` table. The profile is computed on read. This deliberate deviation from the plan is recorded in the checkpoint log.
- Analysis:
  - **BYOK only.** The key is checked at job creation and again before execution; there is no hosted fallback and no credit spend.
  - The hosted key may share the same provider and model, so never use `assertJobConfiguration` or `getActiveModel` for analysis.
  - Invalid model output fails the job at once (`ai_output_invalid`), with no retry and no repair.
  - One provider call per attempt, 3 attempts at most.
- Caching and ids:
  - Cache key: (user, session, digest, `ANALYZER_VERSION`, provider, model). Staleness is computed on read.
  - Candidate ids follow `ai_${jobId}_${category}`, and `finding.mistakeId` links each finding to its candidate.
  - A category already recorded for the session gets no new candidate.
- Budgets:
  - Manual: 10 per local day. Automatic: the user's limit.
  - Counted: active jobs, plus jobs with `attempt > 0`. Cache hits and jobs cancelled or unpublished before any attempt are not counted.
- Automatic analysis:
  - At most one automatic job per session (idempotency key `auto:${sessionId}`).
  - It stays unavailable until the operator sets `ANKIFY_AUTOMATIC_ANALYSIS=enabled` after verifying the recovery cron.
  - Don't add a cron to `vercel.json` until the Vercel tier is verified: a Hobby plan fails the deploy if a cron runs more than once a day.
- Publish failures:
  - Manual: the job fails with `queue_publish_failed` and the user gets a 503.
  - Automatic: the job stays queued with `dispatched_at` null, and recovery sends it later.
- Scope rules:
  - Never edit applied migrations. `0021` to `0025` are not applied to Preview or Production. `packages/db/local.db` is at `0020`; `pnpm dev` applies the rest, and the QA DB has them all.
- AI SDK: `@ai-sdk/google` is pinned to the exact version `4.0.50`. Later releases target a newer `@ai-sdk/provider` spec than `ai@7.0.58`, and fail typecheck (`LanguageModelV4` not assignable).
  - Don't touch Production data.
  - Follow the UI conventions in `CLAUDE.md`: semantic tokens, a visible focus ring, spinners instead of ellipses.

## 5. Verification status

The last full gate ran at `c68769d` (2026-10-01). It used `gate.sh` in the session scratchpad, which may be gone. Its steps, in order, stopping at the first failure:

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:e2e`
- `pnpm build`, with the dummy environment from the checkpoint log
- `pnpm extension:check-manifest`

Check each step's log, not only its exit code. Results:

- `pnpm test`: 494 tests.
- `pnpm typecheck`: passes.
- `pnpm lint`: 5 warnings.
- `pnpm test:e2e`: 28 tests, but only on the second run. The first run after the dependency install had 6 timeouts; see the checkpoint log.
- Build and manifest check: pass.

Not verified:

- No real provider has run an analysis except the owner's DeepSeek key.
- Gemini is untested with a real key. Only unit tests with mocked fetch exist (`server/ai-google.test.ts`).
- The live LeetCode probe report is still pending.

## 6. Repository state

- Branch: `refactor/extension-first`. At the 2026-10-01 evening update, HEAD was `3d4b17b`, followed by the docs commit that tracks this file and TEST_GUIDE. Nothing is pushed.
- Phase 7 commits so far: `890de4e`, `b2830a6`, `a07ce70`, `c68769d`.
- `docs/TEST_GUIDE.md` is the owner's manual test guide, tracked in git; keep it current when behavior changes.
- `apps/extension/dist-local` is the gitignored development build the owner loads in Chrome. Rebuild it with `cd apps/extension && pnpm exec vite build --mode development --outDir dist-local`.

## 7. Remaining work, in order

1. Phase 7 dead-code cleanup:
   - unused i18n `agent`/`quiz` groups;
   - `LanguageToggle` and `ThemeToggle`;
   - the unused `components/ui` primitives.
2. The final Phase 7 checkpoint entry and the release manifest check.
3. Owner-only items:
   - the live LeetCode probe;
   - catalog generation;
   - the Vercel cron;
   - screenshots;
   - the M4 cleanup decision;
   - a rating-Undo UI (the server supports undo).

## 8. Known issues and risks

- Automatic dispatch recovery on Production depends on request-time recovery until a cron is added to `vercel.json`.
- `@ai-sdk/google` is pinned to `4.0.50`. Upgrade it together with `ai` and the other `@ai-sdk/*` packages.
- The time zone syncs from the device (web `TimeZoneSync`, extension overview). Settings no longer shows it.
- The e2e QA settings persist across specs.

## 9. Recommended next action

Do the Phase 7 dead-code cleanup as one gated commit, then write the final checkpoint entry.

## 10. Continuation instructions

- Inspect `git status`, `git diff` and the files named here before editing. Verify these claims against the code.
- Work phase by phase:
  - follow `CLAUDE.md` and the plan;
  - run the relevant tests after each meaningful change and the full gate before each checkpoint commit;
  - never push.
- Keep this file and `docs/EXTENSION_FIRST_CHECKPOINTS.md` updated as work progresses.
