# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. `AGENTS.md` carries the same guidance for other coding agents; keep the two in sync.

## Commands

```bash
pnpm install                # install deps (pnpm workspaces; pnpm 10, Node 22)
cp .env.example .env.local  # local SQLite: Better Auth/Google + encryption secret; leave TURSO_* empty

pnpm dev                    # apply local migrations, then Next.js on :3000 (LOCAL profile)
pnpm dev:all                # same, plus the extension in watch mode
pnpm dev:ext                # Chrome extension build in watch mode
pnpm dev:qa                 # isolated QA DB + local AI worker; sign in at /api/qa/login
pnpm dev:demo               # English demo deck on the QA DB (README/landing screenshots)

pnpm db:generate            # drizzle-kit generate after editing packages/db/src/schema.ts
pnpm db:migrate             # apply migrations to local SQLite (packages/db/local.db)
pnpm db:studio              # drizzle-kit studio against local SQLite
pnpm db:backup              # dump Production Turso into backups/ (requires .env.production.local)
pnpm db:release             # backup + migrate Production; follow docs/DEPLOYMENT.md first

pnpm typecheck              # tsc --noEmit across all packages
pnpm lint                   # eslint (5 known warnings in pre-existing code)
pnpm test                   # vitest from the repo root (DB tests use throwaway SQLite files)
ANKIFY_EXTENSION_API_ORIGIN=https://ankify-pi.vercel.app pnpm build
                            # production build; a bare Production extension build fails closed
pnpm release:check          # typecheck + lint + test + build + manifest check + audit
```

Root scripts delegate to workspace packages via pnpm filters. `ANKIFY_PROFILE`
selects the env file for CLI tools (`local` default, `qa`, `preview`,
`production`); only `:prod`/`db:backup`/`db:release` scripts touch Production
Turso. Production runtime reads Vercel env vars, never local files.

## Architecture

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before non-trivial changes. It
is the single source of truth for the monorepo layout, data model, auth, FSRS
scheduling, asynchronous AI jobs (Vercel Queues, leases, retries), Study Coach,
and hosted AI keys. Paid AI credits (Stripe) are documented in
[docs/PAID_AI_CREDITS.md](docs/PAID_AI_CREDITS.md); deployment and Production
data ownership in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

In one paragraph: `apps/web` (Next.js 16 App Router, logic in `src/server/`),
`apps/extension` (Chrome MV3), `packages/db` (Drizzle + Turso/SQLite),
`packages/core` (FSRS, types), `packages/contracts` (Zod schemas + DTOs), and
`packages/api-client` (AI-job client). Card and quiz generation run as durable
`ai_jobs` through a Vercel Queue; Study Coach streams tool-using agent turns.

## Rules that matter when editing

- **Scope every query by `userId`**, including raw SQL. Server pages call
  `requirePageUser()`; API routes call `getRequestUser()` or
  `getRequestSessionUser()` (settings, account, billing). `proxy.ts` is not an
  auth check.
- **Contracts at the edge**: validate requests with `@ankify/contracts` schemas
  and return DTOs, never raw Drizzle rows. Browser code never imports `@ankify/db`.
- **Schema changes** go through `pnpm db:generate` and a committed migration;
  never edit applied migrations. Apply migrations before deploying code that
  needs them.
- **AI work is asynchronous**: create an `ai_jobs` command (`POST /api/ai-jobs`)
  instead of calling a model inside a request. Commit results together with the
  terminal job state in one transaction.
- **Hosted AI credits**: any new AI entry point that can run on the hosted key
  (`source: "starter"`) must call `spendHostedCredit()` inside the same
  transaction that creates its job/run, and refund on failure with
  `refundHostedCredit()`. A user's own key never spends credits.
- **Billing**: prices and pack sizes are server-side only
  (`server/billing/config.ts`); credits are granted only by
  `fulfillCheckoutSession*()` from the authoritative Stripe Session, never from a
  redirect or event payload. Never use live Stripe keys outside Production.
- **Agent writes are user-gated**: Coach may read and navigate, but card/quiz
  generation is a proposal that runs only after approval.
- **FSRS is problem-level**; only manual ratings change the schedule.
  `review_events` is append-only (undo stamps `undoneAt`).
- **Tests**: DB tests use `createTestDb()` from `apps/web/src/server/test-db.ts`;
  keep deliberate-concurrency tests in their own `*.concurrency.test.ts` file.

## UI Conventions

The web app and the extension popup share one typographic language. **Default everywhere is sans (`system-ui` stack); mono is a marked notation, not a default.**

**Use sans (do nothing - it's the default):**
- All prose, labels, buttons, headings, nav tabs, pills, hero titles, table cells, list items.
- Numeric columns and counters. **For digit alignment, use Tailwind `tabular-nums` (CSS `font-variant-numeric: tabular-nums`) - not `font-mono`.** Sans + `tabular-nums` aligns digits without flipping fonts.

**Use mono (Tailwind `font-mono` in web; `var(--font-mono)` in extension popup CSS) only for:**
1. Real code: `<pre>` blocks and inline `<code>` rendered by Markdown components, submission code displays.
2. Shell commands and env-path tokens inside copy: `<code>pnpm db:migrate</code>`, `<code>.env.local</code>`.
3. Identifier-shaped inputs: API key and model id. Slug displays (`two-sum`).
4. Programming-language labels rendered next to code (`python`, `cpp`).
5. The brand wordmark in `components/brand.tsx` - a deliberate logo choice, not body text. Nothing else may borrow it.

Anything else in `font-mono` is a bug - it splits the visual register and looks terminal-ish against the rest of the app.

**Extension popup CSS (`apps/extension/src/popup/popup.css`)** declares two font variables on `:root`:
- `--font-ui` - sans stack, the popup's default. Used by topbar, tabs, hero, pills, buttons, list items, today-stats, etc.
- `--font-mono` - mono stack. Used only by code, slug chips, and settings inputs for API URL/token.

If a new component needs a mono look, justify it against the four cases above; otherwise use the variable's default.

**Compose from `components/ui/`, don't re-roll it.** Every button-shaped control uses `<Button>` / `buttonClasses()` (`primary | secondary | ghost | danger` x `icon | sm | md | lg`); every bordered panel on surface color uses `<Surface>` (which owns the `rounded-xl` radius); every zero-state uses `<EmptyState>`; pending states use `<Spinner>` and `loading.tsx` files use `<Skeleton>`. Hand-writing `rounded-* border border-border bg-surface` or a bespoke accent button is how the three-different-paddings drift started. If a call site needs to override padding or radius, the size scale is missing a step - add it to the component instead.

Genuinely custom controls are the exception and stay raw: rating buttons, quiz answer choices, segmented tab triggers, full-width disclosure rows, and plain text links.

**Colors come from the semantic tokens** (`bg`, `surface`, `subtle`, `fg`, `muted`, `border`, `accent`, `accent-soft`, `success`, `warning`, `danger`, `easy`, `medium`, `hard`). A raw Tailwind palette class like `text-red-600` is a bug; use `text-danger`. `apps/extension/src/popup/popup.css` mirrors the same token names and values in all four theme blocks - change one side and you must change the other.

**Focus is never removed.** `globals.css` gives `button / a / input / textarea / select / [role=button]` a `:focus-visible` outline. If an element opts out, it must supply its own indicator - use `.focus-inset` for borderless full-panel editors where an offset ring would fall outside the panel.

**No arrow glyphs in buttons.** `->`, `→`, `←`, `»` inside a label look cheap; drop them from text buttons, and use a drawn SVG icon for glyph-only controls (see `ChevronIcon` / `CheckIcon` in the extension popup). An ellipsis as a pending state is the same problem - use the spinner.

**Editor to rendered-markdown parity.** Where a textarea coexists with a Markdown view of the same content, the textarea must use the same font/size/leading as the rendered output so the visual transition is invisible. Do not apply `font-mono` to such textareas - Markdown's own `<pre>`/`<code>` styles switch to mono locally.

## Terminology

- **problem** = a LeetCode problem stored in `problems`; the unit FSRS schedules.
- **card** = a flashcard with `question` (front) and `answer` (back).
- **candidate** = an AI-generated card draft, not yet confirmed.
- **quiz session** = a per-problem set of 5 multiple-choice questions plus user answers and score.
- **AI job** = a durable card/quiz generation command in `ai_jobs`, executed by the queue worker.
- **run** = one Study Coach turn inside an agent session.
- **hosted key** = the server-owned AI key (`ANKIFY_STARTER_AI_API_KEY`) used when a user has no key of their own.
- **starter credits** = the free lifetime allowance on the hosted key; **purchased credits** = paid balance from Stripe credit packs.
- **retrievability** = probability the user still remembers (0-1), computed by FSRS.
- **stability** = how well a memory is consolidated (days until retrievability drops to 90%).
