# Pre-commit audit: paid AI credits

Branch `feat/paid-ai-credits` (base `main` @ `3f9e792`), audited 2026-09-28.
Nothing was committed, pushed, or deployed. No live Stripe credentials, real
payments, Production databases, or Production Stripe resources were used.

Status labels: **PASS** = executed and passed; **FAIL** = executed and failed;
**BLOCKED** = could not run (missing credentials/environment); **NOT TESTED** =
not attempted.

## 1. Executive summary

The audit found **one P0 and three P1 defects** in the uncommitted feature,
plus four P2 and two P3 issues. All ten are fixed with regression tests. The main ones:

- **P0**: a payment refunded before fulfillment (out-of-order webhooks) would
  still grant credits, because fulfillment trusted the webhook payload.
- **P1**:
  - test-mode Stripe keys were accepted on Production, so test cards could buy
    real credits;
  - a failed refund inside a caller's transaction could record a refund without
    restoring the credit;
  - job/run transitions and their refunds were not atomic.

Test count went from 74 (base) and 87 (branch before the audit) to **135**. All
automated gates pass. The ledger, idempotency, refund, and fulfillment
invariants are enforced by SQL constraints and single transactions and are
tested against a real migrated SQLite database. Stripe behavior is verified only
offline: real SDK signature code, stubbed API calls. **Real card/Link payments
and real webhook delivery remain unverified**, so the feature is not
production-ready.

## 2. Initial baseline

| Check | Result |
| --- | --- |
| Branch / state | `feat/paid-ai-credits`, 25 modified + 8 untracked paths, nothing staged |
| `main` worktree: `pnpm test` | PASS, 18 files / **74** tests |
| `main` worktree: `pnpm lint` | PASS, 0 errors / **7 warnings** (`no-location-assign-relative-destination` in problems-client, review-client, settings/form, nav) |
| Branch: `pnpm typecheck` | PASS (6 packages) |
| Branch: `pnpm lint` | PASS, same 7 warnings (one shifted 693→695 by a 2-line insertion). None new. |
| Branch: `pnpm test` | PASS, 21 files / **87** tests. The previous report said "12 new DB tests"; the true count was 13 new tests (74 + 13). |
| Branch: `pnpm build` | PASS (earlier session) |

## 3. Confirmed defects

| ID | Sev | Defect | Root cause | Files |
| --- | --- | --- | --- | --- |
| D1 | P0 | Credits granted for a refunded payment when `charge.refunded` is processed before a successful completion event (e.g. the completion webhook failed first and was retried later) | Fulfillment used the webhook payload / Session status only; `payment_status` stays `paid` after refunds, and the earlier refund event found no purchase to revoke | `server/billing/credits.ts`, `app/api/billing/webhook/route.ts` |
| D2 | P1 | Test-mode keys accepted on Production (free test cards buy real credits); live keys accepted by `next dev` / Preview at runtime | `readBillingConfig()` checked presence only; env check only guarded Preview | `server/billing/config.ts`, `scripts/check-vercel-env.mjs` |
| D3 | P1 | A refund failing midway inside a caller's transaction wrote the `refund` ledger row without restoring the credit; the credit could then never be refunded | `refundHostedCredit(…, tx)` ran directly in the outer transaction; `refundHostedCreditSafely` swallowed the error, so the partial write committed | `server/ai-credits.ts` |
| D4 | P1 | Crash window between a terminal transition and its refund (cancel, fail queued, fail running, fail Coach run) → orphaned charge | Transition and refund were separate autocommit statements | `server/ai-generation/jobs.ts`, `server/agent/store.ts` |
| D5 | P2 | Stored Stripe Customer id not scoped to test/live mode; switching keys makes every checkout fail ("No such customer") | Single `stripeCustomerId` setting | `server/billing/credits.ts` |
| D6 | P2 | Stripe/DB errors in the webhook escaped as unhandled exceptions | No error boundary in the handler | `server/billing/webhook.ts` (new) |
| D7 | P2 | Success return showed "Payment received…" for unknown or other users' sessions and passed arbitrary `session_id` strings to Stripe | Notice mapped all non-success to "pending"; no id validation | `settings/page.tsx`, `server/billing/credits.ts`, `lib/i18n.ts` |
| D8 | P2 | Credits section hidden for users holding a paid balance if the hosted key is later removed; "Free credits 0 of 0" shown with no allowance | Visibility tied to starter config / purchases only | `settings/page.tsx`, `settings/credits-form.tsx` |
| D9 | P3 | `CLAUDE.md` described synchronous generation, "no background jobs", wrong `src/lib` paths; `AGENTS.md` diverged | Docs not updated with the architecture | `CLAUDE.md`, `AGENTS.md` |
| D10 | P3 | Server modules using `@/` could not be imported by Vitest, so job/agent lifecycles were untestable; the branch's concurrency test poisoned the shared local connection for later tests | No Vitest alias; local libSQL lock leak after `SQLITE_BUSY` | `vitest.config.ts` (new), tests |

## 4. Fixes applied

- **D1**:
  - `fulfillCheckoutSessionById()` always re-reads the Session with
    `expand: ["payment_intent.latest_charge"]` and ignores the event payload.
  - A payment whose charge is already fully refunded is inserted as a
    `refunded` purchase with no credits (a tombstone), so no later event can
    grant it.
  - The webhook and the success page share this one function.
- **D2**:
  - `readBillingConfig()` derives the key mode (`sk_`/`rk_`, `live`/`test`).
  - Live keys are refused unless `NODE_ENV=production` and the deployment is
    not a declared Preview.
  - Test keys are refused when `ANKIFY_DEPLOYMENT_ENV=production`.
  - `check-vercel-env.mjs` rejects a test key on Production, a live key on
    Preview, and non-secret key formats.
- **D3**: `refundHostedCredit()` always runs in `(tx ?? db).transaction()`,
  which is a savepoint when nested.
- **D4**: each transition and its refund now share one transaction. A refund SQL
  error still lets the transition commit and is logged. The reconciliation query
  is documented in PAID_AI_CREDITS.md and exercised by a test.
- **D5**: Customers are stored as `billing.customers.{test,live}`, with a
  mode-scoped idempotency key.
- **D6**: `handleStripeWebhook()` returns 400 for signature errors, 500 for
  handler errors (so Stripe retries), and 200 otherwise; the route is a thin
  wrapper.
- **D7**:
  - Only `cs_(test|live)_…` ids are sent to Stripe.
  - Sessions that belong to other users show no notice.
  - The "pending" wording no longer claims the payment was received.
- **D8**: the section is also shown when `paidBalance > 0`; the free-credit
  line is hidden when the allowance is 0.
- **D9**: new canonical `docs/ARCHITECTURE.md`. `CLAUDE.md` and `AGENTS.md`
  rewritten as one shared guide (identical bodies) that links to it.
- **D10**:
  - Added root `vitest.config.ts` mapping `@/` to `apps/web/src/`.
  - Added `createTestDb()` with `exec()` for failure-injection triggers.
  - Concurrency tests moved into isolated `*.concurrency.test.ts` files.

Mutation checks (manual, reverted): disabling the D1 refund check made the
out-of-order test fail, and replacing the purchase idempotency guard made 4
billing tests fail. Before the D3 fix, the refund-atomicity test failed (a
refund row existed without the credit).

## 5. Tests added (61 new tests; totals per file)

| File | Tests | Covers |
| --- | --- | --- |
| `server/ai-credits.test.ts` | 8 | Bucket order; refunds to the same bucket, once; no-op for own-key work; rollback with the caller's transaction; SQL `CHECK` against negative balance; duplicate spend rejected; injected ledger failure consumes nothing; refund atomic as a savepoint |
| `server/ai-credits.concurrency.test.ts` | 1 | 6 simultaneous paid spends on balance 3: no overspend, ledger = successes (in-process simulation) |
| `server/ai-generation/jobs.credits.test.ts` | 15 | Job creation, duplicate `requestId`, dedup conflict, simulated dedup race (unique index), exhausted credits (no job), own key (no spend), queue publish failure refund, failed-queued refund once, cancel before vs after start, non-retryable worker failure, retry then exhaustion, success keeps credit, superseded refund, cancel racing generation, refund failure still fails the job and is reconcilable |
| `server/agent/store.credits.test.ts` | 5 | Per-turn spend tied to the run, own key, exhausted → whole turn rolled back, no spend for invalid/duplicate/busy turns, provider failure refunded once, interruption not refunded |
| `server/billing/credits.test.ts` | 15 | Signature verification (missing, invalid, re-serialized body, wrong secret, signed malformed body), unsupported events, duplicate and sibling events, authoritative Session over a forged payload, delayed async payment, Stripe API failure then retry, injected DB failure mid-fulfillment then retry, deleted user / mismatched owner / bad metadata, refund revocation once, late completion after refund, refund-before-fulfillment, partial/unknown refunds, pooled-balance refund behavior, success return ownership, redirect + webhook, input checks, Checkout Session params and per-mode Customer |
| `server/billing/fulfill.concurrency.test.ts` | 1 | Three webhook deliveries + redirect at once → one purchase, one grant |
| `server/billing/config.test.ts` | 6 | Enablement, live/test guards, key-mode detection, pack table sanity |
| `server/billing/migration.test.ts` | 1 | Upgrade from 0016 with existing user/starter usage/problem/job → 0017; data intact; FK and unique constraints live; re-run is a no-op |
| `app/api/billing/checkout/route.test.ts` | 6 | 401, 404 disabled, malformed / unknown pack / client-supplied price rejected, session user + server pack, generic 502 without secrets, 429 after 10/min (real DB limiter) |
| `lib/i18n.test.ts` | 2 | English/Chinese key parity; credit strings format in both |
| `proxy.test.ts` | +1 | Webhook public, checkout private |

Mocks used: queue publish (`dispatchAiJob`), the model call
(`generateAiCardDraft`), Stripe `checkout.sessions.retrieve/create` and
`customers.create`, and auth plus Stripe in the checkout route test. Webhook
signing and verification use the real Stripe SDK (`generateTestHeaderString` +
`constructEvent`). Every test asserts database state, not just calls.

## 6. Final command results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | PASS (6/6 packages) |
| `pnpm lint` | PASS, 0 errors, 7 pre-existing warnings |
| `pnpm test` | PASS, **28 files / 135 tests**, 0 failed, 0 skipped (run twice on the final tree, plus twice before the last refactor, without flakes) |
| `pnpm build` (CI env values, fresh migrated DB) | PASS; `/api/billing/checkout` and `/api/billing/webhook` built |
| `pnpm extension:check-manifest` | PASS |
| `pnpm db:generate` | PASS: "No schema changes" (schema and migration 0017 agree) |
| `pnpm audit --prod --audit-level=high` | PASS: 0 high; 1 low + 4 moderate, identical to `main` (vitest/esbuild/baseline-browser-mapping; none from `stripe`) |
| `scripts/check-vercel-env.mjs` Stripe rules (8 env combinations) | PASS |

## 7. Database and concurrency verification

| Invariant | How enforced | Status |
| --- | --- | --- |
| A. Balance never negative | SQL `CHECK (balance >= 0)`; `UPDATE … WHERE balance >= cost`; refunds clamp at 0 | PASS |
| B. Every spend has a ledger row | Same transaction as the counter update | PASS |
| C. Failed transaction consumes nothing | Spend inside the job/run transaction; injected failures | PASS |
| D. Duplicate operation not charged twice | Job idempotency/dedup unique indexes; ledger unique `(reason, ref_type, ref_id)` | PASS |
| E. Refund to the originating bucket | Refund reads the spend row's bucket | PASS |
| F. Refund at most once | Ledger unique index; savepoint atomicity | PASS |
| G. Free before paid | `spendHostedCredit` order | PASS |
| H. Own key never charged | `source === "user"` skips spending (jobs and Coach) | PASS |
| I. Concurrent spends cannot overspend | Conditional update + `CHECK` + `BEGIN IMMEDIATE` | PASS on local SQLite (simulated); Turso NOT TESTED |
| J. Purchase never granted twice | Unique `stripe_checkout_session_id`, grant in same transaction | PASS |
| K. Refunded purchase never fulfilled | Status-guarded revoke; refunded-at-fulfillment tombstone | PASS (offline) |
| L. No orphaned charge on failed work | Refund in the same transaction as the transition; reconciliation query | PASS (crash itself not simulated) |

Transaction semantics observed: libSQL opens every Drizzle transaction with
`BEGIN IMMEDIATE`, and nested transactions are savepoints. With the local file
driver, which is synchronous, concurrent in-process writers get `SQLITE_BUSY`
immediately (1 of 6 committed in the probe); a busy timeout does not help.
After such a failure the process's local connection can stay locked. This is a
local-driver issue: Production uses Turso over HTTP, a different code path that
was not exercised. Migration 0017: PASS on a fresh DB and PASS upgrading from
0016 with representative data.

## 8. Stripe Checkout and webhook verification

| Item | Status |
| --- | --- |
| Checkout requires fresh session auth; user from session | PASS (route test) |
| Body validation, unknown pack, client price injection rejected | PASS |
| Server-controlled amount/currency/credits; `mode: payment`; metadata; `client_reference_id`; URLs on `BETTER_AUTH_URL` | PASS (SDK params asserted) |
| No `payment_method_types` (dynamic methods incl. Link) | PASS (code review) |
| Billing disabled without full config | PASS (unit + HTTP smoke: 404 on both routes, no buy buttons) |
| Rate limit 10/min | PASS |
| Stripe failure → generic 502, no secret in body | PASS |
| Webhook raw-body signature verification | PASS (tests + HTTP smoke with signed payloads: 200 / 400 tampered / 500 on Stripe error) |
| Duplicate, sibling, out-of-order, delayed async, concurrent deliveries | PASS (offline) |
| Stripe API / DB failure mid-fulfillment, then retry | PASS (offline, trigger injection) |
| Deleted user / wrong owner | PASS |
| Real Checkout with card 4242 | BLOCKED (no Stripe test keys) |
| Real Link payment | BLOCKED |
| Real webhook delivery via `stripe listen` / Dashboard endpoint | BLOCKED |
| Real refund events from Stripe | BLOCKED |
| Browser UI interaction (clicking Buy, redirect round-trip) | NOT TESTED (server-rendered HTML checked with curl in English and Chinese; no browser automation run) |

## 9. Security findings

- Auth: checkout uses `getRequestSessionUser` (cookie cache bypassed); the
  webhook is public but signature-verified; `proxy.ts` makes only the webhook
  public (tested). PASS.
- IDOR: purchase history and export are scoped by `userId`; the success return
  refuses other users' sessions (tested). PASS.
- Replay: signed events are idempotent; the Stripe SDK enforces its default
  5-minute timestamp tolerance. PASS.
- Redirects: success/cancel URLs are built only from `BETTER_AUTH_URL`. PASS.
- Logging: billing logs carry only Stripe ids and result codes, and Stripe's
  own error text masks keys (`sk_test_****`). No card data ever reaches ankify.
  PASS.
- Mixed environments: fixed (D2, D5).
- Open / not fixed:
  - The webhook body is read without an app-level size cap (platform limit
    applies). P3.
  - Starter credits can be farmed with many Google accounts (pre-existing).
  - A paid Session that is "invalid" (e.g. the account was deleted before
    fulfillment) is acknowledged with 200 and only logged; the customer paid
    and needs a manual refund.
- **Retention conflict (decision needed)**: deleting an account cascade-deletes
  `credit_purchases` and `ai_credit_ledger`. The draft terms promise refund
  handling, and a later `charge.refunded` for a deleted account is only logged.
  Stripe keeps its records, but ankify loses its own audit trail. No retention
  policy was invented.

## 10. Documentation updates

- New `docs/ARCHITECTURE.md`: the canonical architecture (monorepo, data,
  auth, FSRS, async jobs, Queue leases/retries, Study Coach, hosted keys,
  credits summary, rate limits, extension, testing).
- New `docs/PAID_AI_CREDITS.md`: status, configuration, packs, data model,
  spending/refund rules, reconciliation SQL, fulfillment, limitations, open
  decisions, tests, and the manual Stripe procedure.
- `CLAUDE.md` / `AGENTS.md`: rewritten with identical bodies (commands, editing
  rules, UI conventions, terminology, links to the canonical docs).
  Outdated sync-generation claims removed.
- `.env.example`, `docs/SELF_HOSTING.md`, `docs/DEPLOYMENT.md`: restricted
  keys, live/test rules, migration-before-deploy ordering, keeping the hosted
  key while balances exist.
- `docs/RELEASE_CHECKLIST.md`: Stripe test-mode step. `README.md`: link to the
  architecture doc.

## 11. Remaining risks and unverified scenarios

- Real payments (card and Link), real webhook delivery, and real refund and
  dispute events: BLOCKED.
- Turso concurrency and transaction behavior: NOT TESTED (local SQLite only).
- Process crash between transition and refund: covered by transaction design,
  not simulated.
- Partial refunds and disputes are manual; refund attribution is pooled
  (documented and tested as current behavior).
- A Coach interruption before any provider call is not refunded; crashed Coach
  runs are not refunded.
- Pack prices and per-action costs are provisional. Legal text needs owner
  review. Buy buttons exist only in Settings; the Today onboarding card shows
  free credits only.
- Inline `price_data` creates a Stripe product per Session; reporting relies on
  metadata.
- Paid credits become unusable if `ANKIFY_STARTER_AI_API_KEY` is removed
  (documented operational rule).

## 12. Manual Stripe test procedure

Follow "Manual Stripe test-mode verification" in
[PAID_AI_CREDITS.md](PAID_AI_CREDITS.md#manual-stripe-test-mode-verification)
(setup, then 16 cases: card 4242 → Link → event resend → declined card →
cancel → 3-D Secure → spend → forced-failure refund → Coach warnings →
interrupted reply → deletion blocked → full refund → partial refund → support
clear → deletion allowed → env-check negatives). Run it locally, then again on
Preview with a Preview webhook endpoint, before enabling live keys.

## 13. Recommended commit boundaries

1. `test: vitest @/ alias and throwaway-SQLite test helper`: `vitest.config.ts`,
   `apps/web/src/server/test-db.ts`.
2. `feat(credits): transactional hosted-credit ledger and refunds`: schema +
   migration 0017 (+ snapshot/journal), `ai-credits.ts`, `starter-ai.ts`,
   `ai-generation/{jobs,runner}.ts`, `agent/store.ts`, `api/agent/turns/route.ts`,
   and tests `ai-credits*.test.ts`, `jobs.credits.test.ts`,
   `store.credits.test.ts`, `billing/migration.test.ts`.
3. `feat(billing): Stripe Checkout credit packs and webhook fulfillment`:
   `stripe` dependency + lockfile, `server/billing/*` (non-test and tests),
   `api/billing/*`, `proxy.ts` (+ test), `rate-limit.ts`, contracts schema,
   `scripts/check-vercel-env.mjs`.
4. `feat(settings): AI credits UI, i18n, export, legal drafts`: settings
   page/form/credits-form, `lib/i18n.ts` (+ test), `account-export.ts`,
   privacy/terms content.
5. `docs: canonical architecture, paid credits guide, audit report`: `docs/*`,
   `CLAUDE.md`, `AGENTS.md`, `README.md`, `.env.example`.

## 14. Addendum: final credit policy (after the audit)

Owner decisions applied on 2026-09-28. They replace an interim "refund on
account closure via support" flow, which has been removed (no support tool, no
`ANKIFY_SUPPORT_EMAIL`).

- **Costs and prices**: AI card 1 credit, quiz 2, Study Coach turn 5, for free
  and purchased credits alike (`CREDIT_COST`). Free credits are used up first
  and purchased credits pay the rest, so one cost can be split (changed from
  "one bucket per cost" on 2026-09-29). Free allowance 20. Packs $4.99/100, $9.99/250, $19.99/600.
- **No money refunds.** Automatic credit returns for failed work are kept
  (owner choice); interrupted Coach replies are not returned. Users on hosted
  credits see a per-message cost note, a streaming warning, and a leave-page
  prompt in Study Coach.
- **Deletion forfeits credits.** `DELETE /api/account` requires
  `acknowledgeCreditForfeit: true` when a purchased balance exists (else 409
  `credit_forfeit_unacknowledged`); Settings shows a warning and a required
  acknowledgement checkbox. The forfeit is written to the ledger; the ledger
  and purchase rows no longer have a foreign key to `user` and survive deletion.
  This is migration `0018_elite_eternals.sql` (rebuilds both tables, keeping
  every row) on top of the original `0017_gray_boom_boom.sql`. An interim
  attempt that rewrote 0017 in place broke `pnpm dev:qa` on databases that had
  already applied it ("table ai_credit_balances already exists"); 0017 was
  restored byte-for-byte in SQL and timestamp, verified against the owner's QA
  database.
  The retention conflict from section 9 is resolved this way. Terms and privacy
  drafts updated (purchases final, forfeiture, costs, record retention without
  email/name/study data).
- Chinese UI now counts credits in 点 instead of 次, since one action can cost
  several credits.

Manual Stripe test-mode results reported by the owner: cases 1-7 (card, Link,
event resend, declined card, cancel, 3-D Secure, spending) passed; the QA DB
showed purchases of 100, 250, and 600 credits, each granted once, and
automatic returns for a failed quiz and a failed Coach turn. **Real Stripe
payment verification: PARTIAL (local test mode).** A DeepSeek `402
Insufficient Balance` (empty provider account) caused "AI provider rejected the
generation request"; not a code defect.

Startup regression (reproduced, fixed, and re-run on a copy of the owner's
QA database): `pnpm db:migrate:qa` applies 0018 and keeps 3 purchases, 10
ledger rows, and the balance; `qa:seed` (plain `pnpm dev:qa`) resets the
fixture account including its credit records; `pnpm dev:qa --keep-data`
starts. Over HTTP: pack prices render; a real test-mode Checkout Session is
created; a quiz run charges 2 free credits and succeeds; a Coach turn charges 5
purchased credits; with an invalid model the quiz (2) and Coach turn (5) are
returned; deletion returns 409 without acknowledgement and 200 with it,
removing the balance while keeping purchases, with ledger totals reconciling
to zero. New tests: `billing/migration-0018.test.ts` (upgrade from 0017 with
data) and the 0016 upgrade test now asserts final constraints.

Verification: `server/account.test.ts` (5 tests: no-credit deletion, refusal
without acknowledgement, forfeit with retained records, fresh sign-up starts at
zero, missing account); new cost tests in `ai-credits.test.ts` (per-action
costs and bucket choice, full-cost returns, no splitting); concurrency, Coach,
config, route, checkout, and migration tests updated for the new costs, prices,
and retention.

## 15. Final readiness assessment

Ready to **commit** and open a PR. Before enabling live keys: finish manual
cases 8-15 in `docs/PAID_AI_CREDITS.md`, run the plan once on Preview, and have
the owner review the terms and privacy drafts.

**Automated checks:** PASS

**Database correctness:** PARTIAL (all invariants PASS on SQLite; Turso concurrency not tested)

**Stripe mocked integration:** PASS

**Real Stripe payment verification:** PARTIAL (local test-mode cases 1-7 passed per owner; Preview not run)

**Documentation:** COMPLETE

**Known blockers:** None in code. Provider account needs balance for AI tests.

**Remaining manual actions:** Manual cases 8-15, Preview run with a Dashboard webhook endpoint, legal review.

**Recommended next step:** Top up the DeepSeek account and run manual cases 8-15.
