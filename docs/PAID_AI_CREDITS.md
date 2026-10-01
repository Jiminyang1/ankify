# Paid AI credits

Users without their own AI key can run AI cards, quizzes, and Study Coach on
ankify's hosted AI key. Every account gets a free allowance (starter credits);
users can buy more as one-time **credit packs** through Stripe Checkout.
Architecture context: [ARCHITECTURE.md](ARCHITECTURE.md).

> **Suspended (extension-first Phase 6B):** new purchases, AI cards, quizzes,
> and Study Coach are off by default. `POST /api/billing/checkout` answers `410
> workflow_suspended`. The webhook, existing balances, the ledger, and refunds
> keep working, so purchases that are completing or refunded settle normally.
> An operator can re-enable checkout explicitly with
> `ANKIFY_ENABLED_LEGACY_WORKFLOWS=credit_checkout`.

## Policy

| Rule | Value |
| --- | --- |
| Free credits per new account | 20 (`ANKIFY_STARTER_AI_CREDITS`, default 20) |
| AI card (generate or follow-up) | 1 credit |
| Quiz (generate, regenerate, next batch) | 2 credits |
| Study Coach turn | 5 credits |
| Packs | $4.99 → 100 credits, $9.99 → 250, $19.99 → 600 |
| Refunds of money | **Never.** Purchases are final. |
| Account deletion | Forfeits all remaining credits after an explicit acknowledgement; purchase and credit records are kept |
| Failed generation (provider error, discarded result, cancelled before start) | Credits return automatically |
| Interrupted Study Coach reply | Not returned |
| User's own API key | Never spends credits |

## Status

| Area | Status |
| --- | --- |
| Credit spending, ledger, automatic returns on failure | Implemented, DB tests |
| Stripe Checkout + webhook fulfillment | Implemented; offline tests with the real Stripe SDK. Owner ran manual test-mode cases 1-7 below on 2026-09-28 (card, Link, event resend, declined, cancel, 3-D Secure, spending) and reported them passing; purchases of 100/250/600 were observed in the QA DB |
| Remaining manual cases (8+) and Preview run | Not yet run |
| Terms/privacy wording | Draft, **requires owner review** |

## Configuration

| Variable | Purpose |
| --- | --- |
| `ANKIFY_STARTER_AI_API_KEY` (+ `_PROVIDER`, `_MODEL`, `_CREDITS`) | Hosted AI key and free allowance. **Required** for paid credits: purchased credits run on this key. |
| `STRIPE_SECRET_KEY` | Stripe secret or (recommended) restricted key, `sk_`/`rk_` `test`/`live`. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the webhook endpoint for this deployment. |

Billing is **enabled** only when both Stripe variables and the hosted AI key are
set (`server/billing/config.ts:readBillingConfig()`); otherwise the checkout and
webhook routes return 404 `billing_disabled` and Settings shows no purchase
controls. Guards (runtime and `scripts/check-vercel-env.mjs`):

- live keys are refused outside `NODE_ENV=production` and on a declared Preview
  (`ANKIFY_DEPLOYMENT_ENV=preview`);
- test keys are refused on a declared Production deployment (test cards would
  otherwise buy real credits);
- the two Stripe variables must be set together.

Restricted key permissions needed: Checkout Sessions (write), Customers (write),
PaymentIntents and Charges (read). In the Stripe Dashboard, add a webhook
endpoint `https://<domain>/api/billing/webhook` for
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, and
`charge.refunded`, and enable Link (and any other methods) under Payment
methods. The code never passes `payment_method_types`.

Operational rule: do not remove `ANKIFY_STARTER_AI_API_KEY` while users hold
purchased credits; without it their balance cannot be spent.

## Packs and pricing

Defined in `apps/web/src/server/billing/config.ts` (`CREDIT_PACKS`); action
costs in `apps/web/src/server/ai-credits.ts` (`CREDIT_COST`). Checkout sends
inline `price_data` built from the pack table, so the client only names a
`packId` and cannot influence amount, currency, or credits.

Each Session's `metadata` records `userId`, `packId`, and `credits` at purchase
time, so later pack edits never change what an earlier purchase grants. Inline
prices mean there are no Dashboard Price IDs to keep in sync; reconciliation is
by Session/PaymentIntent metadata (`packId`). Stripe creates the inline product
per Session, so the product catalog is not a report of pack sales.

## Data model

- `ai_credit_balances(user_id PK → user, balance ≥ 0)`: purchased balance. The
  `CHECK` constraint makes a negative balance impossible at the SQL level. It
  is deleted with the user.
- `ai_credit_ledger`: append-only record of every `spend`, `refund` (automatic
  return of credits for failed work), `purchase`, `stripe_refund`, `forfeit`,
  and `adjustment`, with the bucket (`starter` | `paid`), signed `delta`, and a
  reference (`ai_job`, `agent_run`, `checkout_session`, `account`). A unique
  index on `(reason, ref_type, ref_id, bucket)` makes each transition happen at
  most once per bucket (a split spend has one row per bucket).
- `credit_purchases`: one row per Checkout Session (unique
  `stripe_checkout_session_id`), with PaymentIntent id, pack, credits, amount,
  currency, and `paid | refunded` status.
- Ledger and purchases have **no foreign key to `user`**: they keep the former
  user id after account deletion, for accounting and payment disputes.
  Migrations: `0017_gray_boom_boom` creates the tables; `0018_elite_eternals`
  rebuilds the ledger and purchases without the foreign key; `0019_dear_masque`
  adds `bucket` to the ledger's unique index so a spend can be split.
- The QA and demo seeds recreate a fixed fixture user id, so they also clear
  that user's credit records on reset (`--keep-data` skips the reset).
- Free starter usage stays in `settings` (`starter-ai-usage`); Stripe Customer
  ids live in `settings` (`billing.customers.{test,live}`), one per Stripe mode.

## Spending and automatic returns

`server/ai-credits.ts`:

- `spendHostedCredit(tx, …)` runs inside the transaction that creates the AI
  job (`jobs.ts:createAiJob`) or Coach run (`agent/store.ts:beginAgentTurn`).
  Free credits are always used up first and purchased credits pay the rest:
  with 3 free credits left, a 5-credit Coach turn takes 3 free + 2 purchased.
  The purchased part is a conditional `UPDATE … WHERE balance >= part`, the
  free part a conditional UPSERT, and each bucket used gets its own `spend`
  ledger row. A second spend for the same job/run is refused. Any failure rolls
  everything back; a duplicate or losing request spends nothing. If free and
  purchased credits together fall short, nothing is spent and the request
  returns `starter_credits_exhausted` (HTTP 403; the code name is kept for
  existing clients).
- `refundHostedCredit()` returns each part of the original spend to the bucket
  it came from, at most once (unique ledger index). Inside a caller's
  transaction it runs as a savepoint.

| Event | Credits returned? |
| --- | --- |
| Job `failed` (non-retryable error, retries exhausted, queue publish failure) | Yes |
| Job `superseded` (card/quiz changed during generation; result discarded) | Yes |
| Job cancelled before any attempt started | Yes |
| Job cancelled after it started (provider may have been billed) | No |
| Coach run failed (provider error, timeout, other) | Yes |
| Coach run interrupted (reload, closing the tab, switching to/from Review) | No |
| Coach run left running by a crash, later marked interrupted | No |
| Retrying job (requeued) | Credits stay reserved until a terminal state |
| User's own key | Nothing was spent |

For users on hosted credits, Study Coach shows a per-message cost note, a
warning while a reply streams, and a browser leave-page confirmation. Closing
the Coach panel does not interrupt a reply.

Each return commits in the same transaction as its job/run transition. If the
return write itself fails, the transition still commits and
`[ai-credits] refund failed` is logged; find such spends with:

```sql
-- Reconciliation: hosted-credit spends on failed work that were not returned.
SELECT l.user_id, l.ref_type, l.ref_id, l.bucket, l.delta
FROM ai_credit_ledger l
LEFT JOIN ai_credit_ledger r
  ON r.reason = 'refund' AND r.ref_type = l.ref_type AND r.ref_id = l.ref_id AND r.bucket = l.bucket
LEFT JOIN ai_jobs j ON l.ref_type = 'ai_job' AND j.id = l.ref_id
LEFT JOIN agent_runs a ON l.ref_type = 'agent_run' AND a.id = l.ref_id
WHERE l.reason = 'spend'
  AND r.id IS NULL
  AND (
    j.status IN ('failed', 'superseded')
    OR (j.status = 'cancelled' AND j.started_at IS NULL)
    OR (a.status = 'failed' AND a.error_code <> 'agent_interrupted')
  );
```

## Account deletion

`DELETE /api/account` (`server/account.ts`) runs in one transaction:

1. If the user holds purchased credits and the request lacks
   `acknowledgeCreditForfeit: true`, it returns 409
   `credit_forfeit_unacknowledged` with the current balance and changes nothing.
2. Otherwise it writes a `forfeit` ledger row (`-balance`, ref `account`),
   deletes the user (the balance row cascades), and keeps the ledger and
   purchase rows. Nothing can restore forfeited credits; a new sign-up with the
   same email starts at zero.

Settings shows the balance, a warning, and a required acknowledgement checkbox
before the delete button enables; the confirmation dialog repeats the forfeit.
If a purchase completes between page load and delete, the server returns 409
and the UI asks again with the new balance. A payment that completes after the
account is gone is logged (`checkout session not credited`) and not credited.

## Checkout and fulfillment

1. `POST /api/billing/checkout` `{ packId }`: fresh session auth, strict body
   validation, 10/min rate limit. Creates (once per mode) a Stripe Customer and
   a Checkout Session (`mode: payment`, `client_reference_id` = user id,
   metadata, success/cancel URLs on `BETTER_AUTH_URL`). Returns `{ url }`;
   Stripe errors return a generic 502.
2. The user pays on Stripe's hosted page (Link, cards, any enabled method).
3. Fulfillment happens in **both** places, through the same function:
   - `POST /api/billing/webhook` (`server/billing/webhook.ts`): verifies the
     signature over the raw body, then for `checkout.session.completed` and
     `checkout.session.async_payment_succeeded` calls
     `fulfillCheckoutSessionById()`.
   - The `/settings?billing=success&session_id=…` return calls the same
     function, restricted to the signed-in user's own Session.
4. `fulfillCheckoutSessionById()` re-reads the Session from Stripe (expanding
   `payment_intent.latest_charge`) and ignores the event payload. It grants only
   `mode=payment` + `payment_status=paid` Sessions whose metadata user matches
   `client_reference_id` and still exists. In one transaction it inserts the
   purchase (unique Session id), adds the balance, and writes the ledger row. If
   the charge is already fully refunded, it records the purchase as `refunded`
   without credits.
5. Webhook errors (Stripe API or DB) return 500 so Stripe retries; unsupported
   events return 200.

Idempotency: repeated deliveries, sibling events for the same Session, and the
redirect racing the webhook all converge on one purchase row and one grant.

## If a payment is refunded in Stripe anyway

Policy is no refunds, but Stripe can still reverse a payment (an operator
action, or a lost dispute). A full `charge.refunded` marks the purchase
`refunded` and removes up to its credits from the balance, never below zero,
with a `stripe_refund` ledger row; repeats are no-ops. Partial refunds are only
logged (`refund needs manual review`). Disputes (`charge.dispute.*`) are not
handled automatically.

## Known limitations

- Manual cases 8+ and a Preview deployment run are still outstanding.
- Inline `price_data` pricing is used instead of Dashboard Price IDs.
- "Buy credits" is only in Settings; quiz, cards, Study Coach, and the extension
  show the "not enough credits" message (pointing to Settings) but no buy button.
- The Today onboarding card shows only free credits.
- Purchased credits are pooled per user; a Stripe-side refund removes up to that
  purchase's credits from the pooled balance.
- A Coach run interrupted before the provider was called is indistinguishable
  from one interrupted afterwards; neither returns credits.
- Concurrency guarantees rely on `BEGIN IMMEDIATE` transactions, conditional
  updates, unique indexes, and the balance `CHECK`. They are verified on local
  SQLite (where concurrent writers fail fast with `SQLITE_BUSY`), not on Turso.
- Legal terms and privacy wording are drafts requiring owner review (they now
  state: purchases final, forfeiture on deletion, per-action costs, record
  retention after deletion).

## Future improvements

- Buy-credits entry points in quiz, cards, Coach, extension, and onboarding.
- Show each action's cost next to its button.
- `charge.dispute.created` handling.
- Run the automated suite against a Turso branch database to verify concurrency.

## Tests

```bash
pnpm test                                               # everything
pnpm vitest run apps/web/src/server/ai-credits          # costs, spend/return, concurrency
pnpm vitest run apps/web/src/server/account.test.ts     # deletion and forfeit
pnpm vitest run apps/web/src/server/ai-generation/jobs.credits.test.ts
pnpm vitest run apps/web/src/server/agent/store.credits.test.ts
pnpm vitest run apps/web/src/server/billing apps/web/src/app/api/billing
```

The billing tests use a real Stripe SDK instance offline: webhooks are signed
with `stripe.webhooks.generateTestHeaderString` and verified by the SDK; only
`checkout.sessions.retrieve`, `customers.create`, and `checkout.sessions.create`
are stubbed. They are not a substitute for real test-mode verification.

## Manual Stripe test-mode verification

Run this locally in the QA profile with **test-mode or sandbox keys only**
(`sk_test_...` / `rk_test_...`). Live keys are refused by `next dev`, so a live
key simply leaves billing switched off.

### 1. One-time setup

1. Stripe Dashboard → **Test mode** (or `stripe sandbox create`). Developers →
   API keys → reveal the **secret key** (`sk_test_...`), or create a restricted
   key with Checkout Sessions *write*, Customers *write*, PaymentIntents *read*,
   Charges *read*. The publishable key (`pk_test_...`) is not used.
2. Settings → Payment methods (test mode): make sure **Link** and **Cards** are on.
3. Stripe CLI: `brew install stripe/stripe-cli/stripe`, then `stripe login`.
4. Create a new `.env.qa.local` in the repo root (gitignored, loaded after the
   committed `.env.qa`; do not copy `.env.example` or `.env.qa`):

   ```bash
   ANKIFY_STARTER_AI_API_KEY="<provider key>"   # real key with balance to test spending
   ANKIFY_STARTER_AI_PROVIDER="deepseek"
   ANKIFY_STARTER_AI_MODEL="deepseek-v4-flash"
   ANKIFY_STARTER_AI_CREDITS="3"                # small allowance so paid credits are used quickly

   STRIPE_SECRET_KEY="sk_test_..."
   STRIPE_WEBHOOK_SECRET="whsec_..."            # from `stripe listen`, below

   # Keep the QA account without its own key, so AI spends credits.
   ANKIFY_QA_AI_PROVIDER=""
   ANKIFY_QA_AI_MODEL=""
   ANKIFY_QA_AI_API_KEY=""
   ```

### 2. Start everything (three terminals)

1. `stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,charge.refunded --forward-to localhost:3000/api/billing/webhook`;
   copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
2. `pnpm dev:qa` (first run seeds the QA account). To restart without wiping
   purchases: `pnpm dev:qa --keep-data`. Env changes need a restart (Ctrl+C,
   then the same command).
3. Optional DB viewer: `pnpm db:studio:qa`.
4. Open `http://localhost:3000/api/qa/login`, then `/settings#credits`. Expect
   "Free credits: 3 of 3 left", "Purchased credits: 0", and packs at $4.99,
   $9.99, $19.99.

### 3. Test cases

| # | Do | Expect |
| --- | --- | --- |
| 1 | Buy **100 credits · $4.99** with card `4242 4242 4242 4242`, any future date, any CVC/ZIP | Success notice; purchased = 100; one `credit_purchases` row, one `purchase` ledger row; `stripe listen` shows `[200]` |
| 2 | Buy again with **Link** (any email; one-time code `000000`) | Purchased = 200 |
| 3 | `stripe events resend <evt_id>` for #1 | Nothing changes |
| 4 | Declined card `4000 0000 0000 0002` | Declined; nothing changes |
| 5 | Cancel on Checkout | "Checkout was cancelled…"; nothing changes |
| 6 | 3-D Secure card `4000 0027 6000 3184` | Credits granted |
| 7 | Generate an AI card, then a quiz | Card uses 1 free credit (2 left); quiz uses 2 free credits (0 left). Next quiz takes 2 purchased credits |
| 7b | Give free credits back: `sqlite3 packages/db/qa.db "update settings set value=json_object('used',0) where user_id='ankify-qa-user' and key='starter-ai-usage';"`, reload Settings (3 of 3 left), send a Study Coach message (5 credits) | Free 0 left, purchased −2: the 3 free credits are used first. Ledger has `spend`/`starter`/−3 and `spend`/`paid`/−2 with the same `ref_id` |
| 8 | Ctrl+C, set `ANKIFY_STARTER_AI_MODEL="does-not-exist"`, `pnpm dev:qa --keep-data`, generate a quiz | "AI provider rejected the generation request"; balance back where it was; in the DB a `spend` −2 and a `refund` +2 row with the same `ref_id` (see [Case 8](#case-8-checking-the-refund)). Then restore the model and restart |
| 9 | Open Study Coach, send a message | Note "Each message uses 5 AI credits…"; during the reply a warning, and reload shows "Leave site?"; purchased −5 |
| 10 | Reload during a reply and confirm leaving | Run ends interrupted; no `refund` row; the 5 credits stay spent |
| 11 | Settings → Advanced account actions. **Don't click Delete in the dialog** (that is case 14) | Warning with your purchased balance and an unchecked acknowledgement; "Type qa@ankify.local to confirm" stays visible above the field while typing; Delete stays disabled until the box is checked and the email matches |
| 12 | Dashboard → fully refund payment #1 (simulates a forced reversal) | `charge.refunded [200]`; purchase #1 `refunded`; balance reduced by up to 100; one `stripe_refund` row |
| 13 | Partially refund a *different* payment (see [Case 13](#case-13-partial-refund)) | `charge.refunded [200]`; dev log `refund needs manual review` with `partial_ignored`; balance, purchase, and ledger unchanged |
| 14 | Check the box, type the email, delete, confirm | Account deleted; `credit_purchases` and `ai_credit_ledger` rows remain, plus a `forfeit` row. Then `pnpm qa:reset` (servers stopped) or `pnpm dev:qa` to get the QA account back |
| 15 | Run the Production env check with fake values (see [Case 15](#case-15-production-refuses-a-test-key)) | Test key: exactly one error, "Production must use a Stripe live-mode key"; live key: passes; live key on Preview: fails |

### Case 8: checking the refund

Settings lists purchases only, not the ledger, so check the refund in the
database (`pnpm db:studio:qa` → `ai_credit_ledger`, or):

```bash
sqlite3 -readonly packages/db/qa.db \
  "select reason, bucket, delta, ref_id from ai_credit_ledger where ref_type='ai_job' order by created_at desc limit 4;"
```

Expect `refund | … | 2` above `spend | … | -2` with the same `ref_id`. The
`bucket` is where the credits came from: `starter` if free credits remained,
`paid` after case 7 used them up. Either way the balance ends unchanged.

### Case 13: partial refund

Needs at least two purchases (cases 1 and 2); case 12 already used #1.

1. Stripe Dashboard, **test mode** → Transactions → open the purchase from
   case 2 (or 6), *not* the one refunded in case 12.
2. **Refund** → enter a partial amount, e.g. `1.00` (less than the total) →
   Refund.
3. Expect:
   - `stripe listen`: `charge.refunded` → `[200]`.
   - Dev server log: `[billing] refund needs manual review { chargeId: 'ch_…', result: 'partial_ignored' }`.
   - Settings: purchased credits unchanged; that purchase has no "Refunded"
     label (only the case-12 purchase does).
   - DB: no new `stripe_refund` row.

Why: a partial refund can't be mapped to a credit amount safely, so the app
only flags it for an operator. CLI alternative:
`stripe refunds create --payment-intent pi_… --amount 100` (amount in cents).

### Case 15: Production refuses a test key

`scripts/check-vercel-env.mjs` runs during every Vercel build. To test only the
Stripe rule, give it a complete set of fake values so nothing else fails.

**Step 1: create the fake env file** (none of it is secret). Paste this whole
block into the terminal:

```bash
cat > /tmp/prod-check.env <<'EOF'
VERCEL_ENV=production
ANKIFY_DEPLOYMENT_ENV=production
TURSO_DATABASE_URL=libsql://example.turso.io
TURSO_AUTH_TOKEN=x
BETTER_AUTH_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
BETTER_AUTH_URL=https://example.com
GOOGLE_CLIENT_ID=x
GOOGLE_CLIENT_SECRET=x
AI_KEY_ENCRYPTION_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ANKIFY_EXTENSION_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop
ANKIFY_STARTER_AI_API_KEY=k
STRIPE_WEBHOOK_SECRET=whsec_x
EOF
```

If a later command prints `node: /tmp/prod-check.env: not found`, this step
was skipped.

**Step 2: run the three checks** from the repo root (`env -i` keeps your real shell variables out):

```bash
env -i PATH="$PATH" STRIPE_SECRET_KEY=sk_test_x node --env-file=/tmp/prod-check.env scripts/check-vercel-env.mjs
# → "- Production must use a Stripe live-mode key: …", exit 1 (echo $?)

env -i PATH="$PATH" STRIPE_SECRET_KEY=sk_live_x node --env-file=/tmp/prod-check.env scripts/check-vercel-env.mjs
# → "✓ Vercel production environment validated …", exit 0

env -i PATH="$PATH" VERCEL_ENV=preview ANKIFY_DEPLOYMENT_ENV=preview STRIPE_SECRET_KEY=sk_live_x node --env-file=/tmp/prod-check.env scripts/check-vercel-env.mjs
# → "- Preview must use a Stripe test-mode key …", exit 1
```

The test-key run must show that single error; any other line means the check
failed for an unrelated reason. Command-line values win over the env file.

### 4. Troubleshooting

- **No pack buttons**: a Stripe variable is missing, the key is not a test key,
  or `ANKIFY_STARTER_AI_API_KEY` is empty. Restart after editing `.env.qa.local`.
- **"AI provider rejected the generation request"**: the provider returned a
  4xx, e.g. `402 Insufficient Balance` (top up the provider account), an
  invalid key, or an unknown model.
- **"Could not start checkout"**: see the dev server log `[billing] checkout failed`.
- **Paid but credits don't appear**: check `stripe listen` is running and the
  `whsec_` matches (`invalid_signature` / `webhook handling failed` in the
  log). Credits also arrive via the success redirect.
- Record results in `docs/PRE_COMMIT_AUDIT.md`, then repeat on Preview with a
  Dashboard webhook endpoint for the Preview URL.
