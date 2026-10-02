# ankify test guide (owner review only)

This file is tracked in git. It explains, in plain language, every feature the
extension-first refactor built, what it should do, and how to check it by hand.
Each section has **What it is**, **How to test**, and **Expected**.

If something behaves differently from "Expected", note the section number and
what you saw.

### What to re-check from your last QA round (2026-10-01)

| You reported | Fixed in | Verify in |
| --- | --- | --- |
| Panel said "No submission" until **Finish review** | Phase 1a | §1.2 "Submissions appear live" |
| A popup rating left the panel on its rating screen | Phase 1a | §1.3 "The popup and the panel stay in sync" |
| "Rate later" let ratings drift; finished reviews kept capturing | Phase 1b | §1.3 (rating rules) |
| No warning after signing out of LeetCode; "Can't reach ankify" after **Review early** | Phase 1c | §1.6 (first five rows) |
| DevTools Offline didn't test sync | Phase 1c | §1.7 (which context to cut) |
| Redundant **Reset editor** | Phase 2 | §1.5 |
| Confusing **Skill handled well** | Phase 2 | §4.2 |
| Unclear `/problems` headers (REPS…) | Phase 2 | §6.2 |
| Statement squeezed into half the screen | Phase 2 | §6.2 "Long statements" |
| Manual mistake entry was the main path | Phase 3 | §4.1 |
| Automatic analysis couldn't be tested locally | Phase 4 | §5.3, §5.4 |
| Suggestions couldn't be tested | Phase 5 | §3 |
| Visual refresh (LeetCode look) | Phase 6 | §9 |

### What to re-check from your second QA round (2026-10-01, evening)

| You reported | Cause | Verify in |
| --- | --- | --- |
| A rated review wasn't analyzed automatically; a new problem was | Automatic analysis skipped sessions accepted with no failed submission (your review was most likely one). Now every finished session with code is analyzed, first practice or review. | §5.3 |
| Closing the tab mid-session and reopening it showed **Continue here**, not **Interrupted** / **Resume** | The closed tab's 60-second lease was still running. Closing the tab now releases the session at once. | §1.6 row 2 |
| Signing out of LeetCode didn't change the panel | Likely cause (not yet confirmed on live LeetCode): leetcode.com keeps the `csrftoken` cookie after sign-out. The panel only called it signed out when that cookie was missing, a read was refused with 401/403, or the list came back null. Now, whenever a read fails or comes back empty, the panel asks LeetCode (`userStatus`) whether anyone is signed in. | §1.6 rows 4–6 |
| Couldn't sign back in to the demo after signing out | `/login` offered only Google (not set up for QA/demo), and signing out deleted the QA session. `/login` now has QA sign-in buttons, and they restore the session. | §0.1, §1.6 row 7 |

**Reload the extension** (§0.2) and **restart `pnpm dev:demo` / `pnpm dev:qa`** before re-testing.

---

## 0. Setup

### 0.1 Start the web app

Pick one:

| Command | When to use it |
| --- | --- |
| `pnpm dev:qa` | **Recommended for testing.** Separate QA database, seeded with sample problems, plus a local AI worker. Sign in at `http://localhost:3000/api/qa/login` (no Google needed), or with the **Sign in as the QA user** button on `/login`. |
| `pnpm dev:demo` | Same QA database filled with a polished English demo deck. Good for looking around and screenshots. |
| `pnpm dev` | Your normal local database with Google sign-in. |

Everything runs at `http://localhost:3000`.

**Signed out of QA or the demo?** `/login` shows **Sign in as the QA user** and **Sign in as the second QA account** instead of Google. Signing in again restores the account's session; no reseed, and your data stays. Restarting `pnpm dev:qa` or `pnpm dev:demo` also works, but it reseeds and wipes what you did.

### 0.2 Build and load the extension

1. Build it: `cd apps/extension && pnpm exec vite build --mode development --outDir dist-local`
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `apps/extension/dist-local`.
   - Do **not** choose `apps/extension/dist`. That folder may be a dev-server build that needs `localhost:5173` running, and it fails to load with a manifest or script error.
4. After rebuilding, click the circular **reload** icon on the ankify card in `chrome://extensions`.
5. **Reload any LeetCode tab that was already open.** Chrome only injects the extension into pages loaded after it started.

**Expected:** the extension loads with no errors, and its toolbar icon opens the popup.

### 0.3 Connect the extension to your account

1. Sign in on the web app first (`/api/qa/login` for QA).
2. Open the extension popup.

**Expected:**
- If you're signed in on the web, the popup shows your data right away.
- If not, it shows **Connect ankify** with a **Sign in** button.
  - After signing in on the web, click **I've signed in** and the popup loads.
- There is no token to copy or paste.

---

## 1. Practice sessions on LeetCode (the core loop)

### 1.1 The in-page panel

**What it is:** a small ankify panel that sits on every LeetCode problem page
(`leetcode.com/problems/<slug>/`). Collapsed, it is a pill; click the pill to
expand it.

**How to test:** open a LeetCode problem you have never used with ankify (for
example LC 94).

**Expected:**
- The pill appears near the corner of the page and reads **New problem**.
- Expanding it shows **Not in your ankify deck yet.** and a **Start practice** button.
- The panel opens by itself when something needs your attention:
  - a due review,
  - a session in progress,
  - a rating waiting.
- For a problem that needs nothing, it stays collapsed.

If no pill appears, open the popup. The **This problem** section has **Open ankify panel**. If the tab predates the extension, the popup instead says *"ankify isn't running on this tab yet"* and offers **Reload page**.

### 1.2 First practice (initial learning)

**What it is:** the first time you practice a problem, ankify adds it to your
deck. Its first review is scheduled automatically, with **no rating needed**.

**How to test:**
1. On a new problem, click **Start practice**.
2. Submit a wrong answer, then a correct one.
3. Click **Finish**.

**Expected:**
- While the session runs, the panel shows:
  - **First practice in progress**;
  - an estimated active time (*"About N min active (estimate)"*);
  - a submission count such as *"2 submissions, 1 accepted"*.
- **Submissions appear live, without Finish, a refresh, or clicking back into the page:**
  - Right after you click LeetCode's **Submit** (or press Ctrl/Cmd+Enter), the panel checks LeetCode every 2 seconds for up to 45 seconds.
  - While LeetCode is still judging, the panel shows *"1 submission is being judged"* with a spinner.
  - Once the verdict is in (usually within a few seconds), the count updates: *"1 submission, 0 accepted"*.
  - If ankify can't be reached, the submission still counts and the panel adds *"1 submission saved here, waiting to sync"*. That line disappears once it syncs.
  - Without a detected Submit click (for example, if LeetCode changes its button), the regular check still runs every 15 seconds while the tab is visible.
- **Reproduce the original bug (should no longer happen):** start a review, submit on LeetCode, and keep watching the panel. Before the fix, it said *"No submissions yet"* until **Finish**. Now the count updates within a few seconds.
- An **Accepted** verdict does **not** end the session; you decide when you're done.
- After **Finish**, the problem is in your deck. The first review is set *First review after (hours)* later (Settings, default about a day).
- You are **not** asked to rate a first practice.
- If you finish without any Accepted submission, the panel warns: *"No Accepted submission seen yet. Finishing records the outcome as unconfirmed."*
- **End as unsuccessful** records a failed attempt; **Abandon session** throws the session away.

### 1.3 Due reviews

**What it is:** when FSRS says a problem is due, you solve it again on LeetCode.

**How to test (QA):** the seeded QA deck has due problems.
1. Open the popup; under **Due**, click **Open** on one. The LeetCode page opens and the review session **starts before the page loads**.
2. Alternatively, open a due problem directly; the panel shows **Due for review.** with **Start review**.

**Expected:**
- The panel shows **Review in progress**. Submissions are tracked as in 1.2.
- After **Finish**, the panel asks **How did the review go?** with four buttons, none preselected:
  - **Again**: could not solve it;
  - **Hard**: solved with real difficulty;
  - **Good**: solved with some thought;
  - **Easy**: solved quickly and cleanly.
- Choosing one schedules the next review (*"Next review in N days"*).
- **There is no "Later" button any more.** You rate right away or click **Skip rating**.
- **Skip rating** leaves the schedule unchanged; the review stays in the problem's history.
- **Closing the panel, the popup, the tab, or the browser does not skip.** Reopen the problem page or the popup and the same rating question is back. The popup's **Rate your reviews** section also lists it.
- **An unresolved rating lapses after 24 hours** (*"Rate … or it lapses."*). It then disappears; the review stays in history and the schedule is unchanged.
- **Only a rating changes the schedule.** Finishing alone never does. Rating twice (for example in the popup and the panel at the same time) applies once; the second one just shows the current state.
- **Finish freezes the session.** Submissions you make after **Finish** never join that session. A submission LeetCode was still judging when you clicked Finish still gets its verdict recorded (for up to a minute).

**You must rate or skip before the next review:**
1. Finish a review of problem A and close the tab without rating.
2. Open a different due problem B and click **Start review**.
3. **Expected:** the review doesn't start. The panel shows *"Rate your review of A first"* with the four grades and **Skip rating**, and no Start button.
4. Rate or skip it. **Expected:** *"Done. You can start this review now."* Then **Start review** starts B.
- From the popup, opening a due review while another rating waits shows *"Rate or skip your finished review above first."*
- **Practice without reviewing** and first practices are never blocked.

**The popup and the panel stay in sync (no refresh needed):**
- Finish a review in the panel; the open popup shows it under **Rate your reviews** within a second or two.
- Rate it **Good** in the popup; the panel leaves its rating screen by itself and shows *"Next review …"*.
- The other way round: rate in the panel, and the popup's card disappears.
- **Reproduce the original bug (should no longer happen):** rating in the popup used to leave the panel on the rating screen until the page was refreshed.

### 1.4 Practice that isn't a review

**What it is:** practicing a problem that's in your deck but not due.

**How to test:** open a deck problem that isn't due.

**Expected:**
- The panel shows *"Next review …"* with **Practice without reviewing** and **Review early**.
- **Practice without reviewing** tracks the session but never asks for a rating and never moves the schedule.
- **Review early** behaves like a due review, with a rating at the end.

### 1.5 Other panel tools

- **Reset editor to default code is gone.** Use LeetCode's own reset button; the panel no longer offers one.
- **Import past submissions** pulls your previous LeetCode submissions for this problem.
  - Expected: *"Imported N submissions."* or *"No new submissions to import."*

### 1.6 Edge cases worth poking

| Try this | Expected |
| --- | --- |
| Open the same problem in two tabs during a session | The second tab says *"This session is open in another tab."* and offers **Continue here**. |
| Close the tab mid-session, then reopen the problem (right away or later) | *"This session was interrupted."* with **Resume**, in the panel and the popup, within a second or two of closing. **No *Continue here***: that is only for a second tab while the first is still open. Resume continues the same session, with its submissions. (Only after a browser crash, with no time to release, can *Continue here* show for up to a minute.) |
| Leave a session open for more than a day | It's stale: *"This session is more than a day old. Start a new one."* |
| Sign out of LeetCode during a session (in this tab or another), then come back to the problem tab | Within a few seconds: *"Sign in to LeetCode so submissions can be tracked."* **This was the reported bug** (the panel stayed unchanged). If it still doesn't appear, run `scripts/leetcode-live-probe.js` while signed out and send the `submissions` part of the report. |
| Sign back in to LeetCode, return to the problem, and submit | The warning clears and the submission is counted. No *"Can't reach ankify"* appears. |
| After signing out and back in to LeetCode, click **Review early** on a problem that isn't due | The review starts (*"Review in progress"*). **This was the reported bug**; it should no longer show *"Can't reach ankify"*. If it still does, note the exact message. |
| Let your ankify session expire (sign out on the web) during a session | Within about 15 seconds the panel shows *"Sign in to ankify to track this problem."* Its **Sign in** opens `/login`. On QA/demo, click **Sign in as the QA user** there. Return to the tab and the session is back. |
| Reload the extension at `chrome://extensions` while a problem tab is open, then use the panel | *"The ankify extension was updated or reloaded. Reload this page to continue."* with **Reload page**, not a connection error. |
| Start a new review while a finished one still awaits its rating | The panel shows that review's rating first (see 1.3); there is no "Start anyway". |

### 1.7 Testing offline behavior (read this before using DevTools)

**Which context to cut.** All ankify traffic goes through the extension's **service worker**, not the LeetCode tab. DevTools → Network → **Offline** on a LeetCode tab only blocks LeetCode itself (the panel then warns that LeetCode can't be read); ankify sync keeps working. To simulate ankify being unreachable, do one of these:

- **Recommended:** stop the local server (`Ctrl+C` in the `pnpm dev:qa` terminal), then start it again later. This is exactly "ankify is down".
- Or cut the worker's network: `chrome://extensions` → ankify → **Inspect views: service worker** → in *that* DevTools window, Network → **Offline**. Untick it to come back.
- Turning the whole computer's Wi-Fi off also works, but it cuts LeetCode too.

**What to check (each with ankify cut as above):**

| Moment | Expected while cut | Expected when back |
| --- | --- | --- |
| Before starting | **Start** shows *"Can't reach ankify. Check your connection."* and nothing starts. | **Start** works; only one session exists. |
| During a session (submit on LeetCode) | The count still updates, plus *"1 submission saved here, waiting to sync"*. After a heartbeat (≤15 s): *"Can't reach ankify right now. Submissions are saved here and sync when it's back."* | Within a few seconds of the next successful contact (opening the popup, or the panel's next check), the "waiting" lines disappear and the count stays the same. |
| Finishing | *"Finish saved. It syncs when ankify is reachable."* | The finish lands; for a review, the rating question appears. |
| Rating | *"Rating saved. It syncs when ankify is reachable."* | The schedule changes **once** (problem page timeline shows one rating). |
| Close the popup and the tab while something waits | Nothing is lost: it's in the extension's storage. | Opening the popup sends it. The service worker being stopped by Chrome doesn't matter. |
| Switch ankify accounts while something waits | The waiting work stays with the first account and is never sent as the second. | It syncs when the first account signs in again. |

Automated coverage: `tests/e2e/offline.spec.ts`, `sessions.spec.ts` (worker restart), `cutover.spec.ts` (account switch, browser restart, popup closing), and the outbox unit tests (retries, duplicate delivery, backoff).

---

## 2. The toolbar popup

**What it is:** your daily view inside the extension.

**Expected sections, top to bottom:**
1. **This problem**: shown when the current tab is a LeetCode problem.
   - **Open ankify panel**, or **Reload page** if the panel isn't running yet.
   - A **Notes** box for that problem that saves automatically (*Saving* → *Saved*).
2. **Rate your reviews**: finished reviews waiting for a rating, each with the four rating buttons.
3. **Due**: today's due problems, each with "Due today" or "N days overdue" and an **Open** button.
   - When empty: *"Nothing is due. Nice work."*
   - At the daily cap: *"You've reached today's review limit."*
4. **In progress / Interrupted** sessions, with **Abandon** or *"Finish it in its LeetCode tab."*
5. **Try something new**: today's suggestion (see §3).
6. **Coming up** and summary counts ("N reviews today", "N first practices").
7. **Sync status**: one of:
   - *"Everything is synced"*;
   - *"N changes waiting to sync"* with **Retry now**;
   - *"Offline"*.

**Gear icon (top bar):** opens the extension settings:
- Language (English or 中文);
- Theme (System, Light, Dark);
- the signed-in account and a **Manage account on the web** link;
- a sync section.

Changing theme or language takes effect immediately in the popup and the panel.

**Due auto-open:** opening a due problem from the popup starts the session before the page loads, so the panel opens already in progress.

---

## 3. Suggestions: new problems worth trying

**What it is:** ankify picks one problem a day that you have **never attempted**. Candidates come from the "similar questions" of problems you practiced. Once your mistake profile has enough history, picks target your weak categories.

**Where:** the popup's **Try something new** card and the web page `/suggestions`.

**How to test:**
1. Look at the suggestion and its explanation.
2. Click **Another suggestion**.
3. Click **Skip**.
4. Click **Already attempted**.
5. Click **Start practice** (popup) or **Open on LeetCode** (web).

**Expected:**
- Each suggestion explains why it was chosen, using only facts ankify knows. Examples:
  - *"Similar to Two Sum, which you practiced."*
  - *"Similar to X, where you confirmed a mistake (Edge cases)."*
  - *"General practice. A few more sessions will personalize suggestions."*
- A suggestion is **never** a problem already in your deck (archived ones included) or one you marked attempted.
- **Skip** and **Already attempted** remove it. **Already attempted** also stops it from ever coming back.
- At most 20 suggestions a day; after that: *"That's all the suggestions for today."*
- When there's nothing to suggest: *"No new problem to suggest yet. Problems you practice bring similar ones."*
  - Expect this on a fresh account (`/api/qa/login?account=second`): the global problem catalog is still empty, so suggestions only come from problems you've practiced.

**What the QA deck now contains for suggestions (`pnpm dev:qa` / `pnpm qa:reset`):**

The QA seed gives the main QA account three completed practice sessions (Two Sum, Binary Search, LRU Cache), each with a confirmed **Edge cases** mistake. That makes the profile personalized and Edge cases a recurring weakness. It also adds verified similar-question candidates:

| Candidate | Expected |
| --- | --- |
| 3Sum, Two Sum II, Search Insert Position, Find First and Last Position…, LFU Cache | Eligible |
| Two Sum III (paid only) | Never suggested |
| First Bad Version (already accepted on LeetCode, per attempt history) | Never suggested |
| Binary Search (already in the deck) | Never suggested |

**How to test with the QA deck:**
1. `pnpm qa:reset`, then sign in at `/api/qa/login`. This replaces the QA account's data.
2. Open the popup. **Try something new** shows one of the five eligible problems. The first is personalized: its explanation mentions **Edge cases** and *"Similar to …"*.
3. Use **Another suggestion** until it stops. You get the remaining eligible ones, never the three excluded, then no more.
4. **Skip**, **Already attempted**, and **Start practice** work as above. Also check the daily cap of 20 and that a skipped problem isn't suggested again today.
5. Sign in as the second QA account (`/api/qa/login?account=second`): the empty-state message above.

**Why recommendations couldn't be tested before:** the QA seed had no candidates, and the global catalog (`scripts/leetcode-catalog.js`, run in a signed-in leetcode.com tab) has never been generated. So a QA account only got suggestions after practicing a real LeetCode problem with similar questions. The global catalog is still an owner task: generating it needs a signed-in LeetCode session.
- Starting a suggested problem makes it a normal first practice (§1.2). The card then shows **In progress**, then **Solved** or **Not solved yet**.

---

## 4. Mistakes and the mistake profile

### 4.1 Mistakes come from AI analysis first (manual entry is a fallback)

**What it is:** when a session goes wrong, AI analysis of your submissions suggests *why* (§5). You confirm, correct, or dismiss each suggestion; you no longer have to write anything yourself. The categories are:

| Category | Meaning |
| --- | --- |
| Approach | Picked a technique that doesn't fit |
| State / invariant | Wrong DP state, recursion contract, or loop invariant |
| Edge cases | Empty input, boundaries, base cases, initial values |
| Complexity | Too slow or too much memory because of a cost decision |
| Implementation | Indexing, return values, scope, null handling |
| Concept | Didn't know what the technique guarantees |
| Other | Nothing above fits |

**How to test (AI-first):**
1. Finish a session with failed attempts and analyze it (§5.2), in the panel or on the web problem page → **Sessions** tab → that session's **Session analysis** box → **Analyze session**.
2. Each finding shows a category, the cause, and *"Next time: …"*, with a category menu, **Confirm**, and **Dismiss**.
3. To **correct** a misclassified finding, pick the right category in the menu, then **Confirm**.

**Expected:**
- A corrected finding shows the new category with *"Corrected from <suggested category>"*; the profile counts it in the **new** category only.
- A dismissed finding shows **Dismissed** and never counts.
- The problem's **Mistakes** tab lists open suggestions first, under **Suggested by analysis**, with the same controls. Below them are confirmed records labeled **From analysis** or **Recorded by you**, with *Corrected from …* where applicable.
- Analyzing the same session again (after new submissions) **replaces** its open suggestions instead of adding duplicates. Confirmed or dismissed ones are kept, and a confirmed category is never suggested twice.
- If the evidence doesn't show a cause, the analysis says so (*"The evidence doesn't show a clear cause."* or *"No clear mistake identified."*) and suggests nothing. A failed submission alone is never turned into a mistake.
- **Manual entry is secondary:** the Mistakes tab has a small **Add a mistake manually** link (the explanation fields are optional). The per-submission **Log mistake** button is gone.
- Confirmed records can still be edited, marked **Mark fixed** / **Not fixed yet**, or deleted.

### 4.2 Improvement is now automatic ("Handled well" is retired)

**What changed:** the **Skill handled well** control is gone from the problem's **Sessions** tab. Nothing needs confirming.

**How improvement works now:** a *clean review* lowers a category's weakness. It is a later session on a problem where that category was a confirmed mistake, with an Accepted outcome, not rated **Again**, and no record of that mistake this time.

**How to test:**
1. On a problem, confirm (or record) an **Edge cases** mistake for a session.
2. Later, practice or review the same problem again and get Accepted without recording that mistake.
3. **Expected:** `/analysis` → that category's line now says *"… 1 clean review since"* and its weakness bar is a little lower.

Old "handled well" confirmations stay in your data export, but no longer count.

### 4.3 The profile (`/analysis`, top section "Mistake profile")

**What it is:** your recurring causes of failure over the last 90 days, **counted once per practice session**. Five retries in one session count as one.

**Expected:**
- Until you have **3 completed sessions across 2 problems**, it says *"Not personalized yet: x/3 completed sessions across y/2 problems…"*.
- A category is **Recurring** once confirmed in **2+ sessions across 2+ problems**; otherwise it is **Needs more evidence**.
- Each row shows:
  - "N sessions across M problems";
  - unresolved and resolved counts, and clean reviews since (§4.2);
  - a trend, e.g. "3 in the last 30 days (1 the 30 before)".
- **Suggested by session analysis** lists AI findings (§5) waiting for **Confirm** / **Dismiss**. Only confirmed ones count.
- **Practice signals**: completed sessions, accepted or failed, rating counts, and a per-topic table (sessions, accepted, first-try, median failures before Accepted).

---

## 5. Session analysis with your own AI key

**What it is:** after a finished session, AI reads your attempts, the code diffs between them, and LeetCode's judge output. It then suggests which mistake categories explain the failure.

- It runs **only on your own API key**, never ankify's.
- Suggestions count toward your profile only after you confirm them.

### 5.1 Add your key (Settings → AI provider)

Providers:
- Anthropic, OpenAI, and DeepSeek;
- **Google Gemini** (new). Get a key at https://aistudio.google.com/apikey.

**How to test:**
1. Choose **Google Gemini**. The model suggestions are `gemini-3.8-flash`, `gemini-3.5-flash`, and `gemini-2.5-pro`.
2. Paste your key.
3. Click **Load from provider** / **Refresh** to fetch the live model list.
4. Click **Test connection**, then save.

**Expected:**
- The live list shows only Gemini models that can generate text, with no embedding models.
- **Test connection** reports *"Connected to …"* with a latency.
- A wrong key says *"API key was rejected by the provider."*
- The stored key is encrypted. Its field later stays blank with *"Leave blank to keep the current key."*
- **Generation mode** (Fast/Thinking) appears only for DeepSeek.
- **Remove** deletes the stored key after a confirmation.

### 5.2 Run an analysis

**How to test:**
1. Untick **Analyze finished sessions automatically** in Settings (otherwise it starts by itself, §5.3). Then finish a session.
2. In the panel's **Session analysis** block, click **Analyze session**. Or on the web: the problem page → **Sessions** tab → **Analyze session** under that session.

**Expected:**
- The block shows *Analyzing this session* with a spinner, and updates by itself every few seconds.
- When done you get one of:
  - findings, each with a category, explanation, *"Next time: …"* advice, and **Confirm** / **Dismiss**;
  - *"No mistakes found in this session."*;
  - *"The evidence doesn't show a clear cause."*
- Confirmed findings appear in the profile; dismissed ones don't.
- If more submissions arrive afterwards: *"New submissions arrived after this analysis."* with **Analyze again**.
- Without your own key: *"Add your own AI key in ankify settings to analyze sessions."* with **Open settings**.
- A session with no captured code: *"No submitted code was captured for this session."*
- At most **10 manual analyses per day**.
- Analyses are written in the **Generation language** from Settings (default English).
- **Retest with DeepSeek:** this used to fail with *"Your AI provider rejected the request"*. It should now work.

### 5.3 Automatic analysis (on by default with your own key)

**What changed:** you no longer click **Analyze session**. Once your own key is saved, **every finished session** is analyzed automatically, with no daily limit. That covers first practices and reviews, accepted on the first try or not. The only exception is a session with no captured code. Each session costs one call on your key, and costs another only if new submissions change it.

**How to test (`pnpm dev:qa`, which runs the local AI worker; no cron needed):**
1. Save your own key in Settings (§5.1). Settings → **Session analysis** shows **Analyze finished sessions automatically**, ticked.
2. Practice a problem: one Wrong Answer, then Accepted. Click **Finish**.
3. **Expected:**
   - The panel says *"Analysis queued. It runs on its own; you can keep practicing."* right away. Finishing never waits for it.
   - After about 15 seconds (a short pause so late verdicts are included) it shows *Analyzing this session*, then the findings.
   - You may close the LeetCode tab and the popup right after **Finish**. The result is waiting later on the problem page (**Sessions** tab), on the **Mistakes** tab, and on `/analysis`.
4. **A review works the same way (the reported bug):**
   - Start a due review, or click **Review early**. Solve it on the first try and click **Finish**.
   - The rating question and *"Analysis queued …"* appear together.
   - Rate it. The analysis keeps running and its result appears in the same panel.
5. A first practice **accepted on the first try** is analyzed too. Only a session with no captured code is skipped (it shows *"No submitted code was captured for this session."*).
6. Untick the setting → no finished session (practice or review) is analyzed unless you click **Analyze session**.
7. An operator can switch it off for everyone with `ANKIFY_AUTOMATIC_ANALYSIS=disabled`.

**Failure states to check:**

| Situation | Expected |
| --- | --- |
| No key saved | Nothing runs; *"Add your own AI key in Settings…"* |
| Wrong or revoked key | Fails once, with no retries: *"Your AI provider rejected the request. Check your key and model."* |
| Provider account out of credit (e.g. OpenAI `insufficient_quota`) | Fails once: *"Your AI provider account has no credit or quota left…"* |
| Provider overloaded (429/5xx) | Retries up to 3 times, respecting the provider's Retry-After |

### 5.4 Testing with your real API keys

Keys live in **`.env.smoke.local`** at the repo root (git-ignored; never paste keys into chat or commit them):

```
SMOKE_DEEPSEEK_API_KEY=...
SMOKE_OPENAI_API_KEY=...
SMOKE_ANTHROPIC_API_KEY=...
SMOKE_GOOGLE_API_KEY=...
# optional: SMOKE_OPENAI_MODEL=gpt-5.5 (defaults: deepseek-v4-flash, gpt-5.4-mini, claude-haiku-4-5-20251001, gemini-3.5-flash)
```

Run **`pnpm qa:provider-smoke`**. For each key it runs one fixture session through the real pipeline (job, worker, provider call, schema validation, commit) on a throwaway database. Then it checks that an invalid key fails at once. It prints only provider, model, result, and timing.

Last run (2026-10-01, after OpenAI credit was added):
- **DeepSeek, OpenAI, Anthropic, Gemini:** all PASS, and an invalid key is correctly rejected for all four.
- **OpenAI models:** `gpt-5.4-mini`, `gpt-5.5`, and `gpt-4o-mini` pass. The original `gpt-5` and `gpt-5-mini` answer `model_not_found` for this key, so Settings no longer suggests them. If you pick a model your key can't use, the analysis fails once with *"Your AI provider rejected the request. Check your key and model."*

---

## 6. Web app pages

### 6.1 `/today`: the dashboard

**Expected:**
- Counters: **Reviews today**, **First practices today**, **Overdue**, **Next 7 days**, **Awaiting first practice**.
- **Open next review on LeetCode** opens the most urgent due problem. With nothing due it reads **All caught up**.
- Banners for pending ratings ("Rate them in the extension popup") and open sessions.
- **Last 7 days**: sessions completed, accepted, failed.
- **Recent practice**: a list with kind (First practice, Review, Extra practice) and outcome.
- **Focus areas**: the recurring categories from your profile, with **View mistake profile**.
- The day's suggestion count, with **Open suggestions**.
- A new user sees an onboarding card for installing the extension and, optionally, adding an AI key. Gemini is in its provider list too.

### 6.2 `/problems` and `/problems/[id]`

**Expected:**
- The list supports search, a state filter, a tag filter, an archived view, and **Load more**.
- **Column names are spelled out:** Problem, Difficulty, Next review, Reviews, Times forgotten, Memory state. Hovering Reviews, Times forgotten, or Memory state explains it. Each is sortable except Memory state. The old "Drills" column (legacy cards) is gone.
- **Long statements:** open a problem with a long description on a large monitor. The statement runs down the page and you read it with the browser's normal scrollbar. There is no small inner scroll box, and nothing scrolls sideways on a phone-width window.
- The problem page header shows due date, review count, and last reviewed, plus **Open on LeetCode** / **Practice on LeetCode**.
- The header actions stack neatly with no overlap; this was fixed in the last commit.
- Tabs:
  - **Statement**;
  - **Submissions**: code and verdicts;
  - **Mistakes**: §4.1;
  - **Sessions**: every practice session with evidence, active minutes, and rating;
  - **History**: the scheduling timeline;
  - **Notes**: the same notes as the popup.
- **Archive** removes the problem from reviews but keeps its history; **Unarchive** puts it back.
- **Delete problem** is permanent, with confirmation.

### 6.3 `/analysis`

**Expected:**
- The mistake profile (§4.3) at the top, followed by the FSRS memory dashboard:
  - **Memory**: average recall;
  - **Lapse rate**;
  - **Next 7d**;
  - **Needs attention**: the problems most likely to be forgotten;
  - **Memory breakdown**: state and stability buckets;
  - **Review activity**: the last 30 days.

### 6.4 `/settings`

Sections and expected behavior:
- **Appearance**: web theme.
- **Language**:
  - *Interface language* changes the web UI in this browser.
  - *Generation language* sets the language of AI analyses. It defaults to English, with no "(default)" label.
  - **The time-zone row is gone.** See §7.
- **AI provider**: §5.1. Also a **Session analysis** sub-section.
- **Review schedule**:
  - **Daily review limit** (default 20): extra due problems roll over to tomorrow.
  - **First review after (hours)**: applies only to practice started after you change it.
- **Extension connection**: setup guide link.
- **Account & data**: **Export my data** downloads an NDJSON archive with no keys or secrets; **Delete account** requires typing your email.

### 6.5 Retired pages

| Try this | Expected |
| --- | --- |
| Visit `/review` | Redirects to `/today`, with a note that reviews now happen on LeetCode. |
| Study Coach, AI cards, quizzes, Buy credits | No longer shown anywhere. Old API calls to them get a "workflow suspended" (410) answer. |

---

## 7. Time zone follows your device

**What it is:** your time zone decides when "today" starts for due reviews, daily limits, and suggestions. ankify reads it silently from the browser, which needs no permission. Settings no longer shows or offers to change it.

**How to test:**
1. On macOS, change the system time zone (System Settings → General → Date & Time).
2. Reload any ankify web page, or open the extension popup.

**Expected:**
- The account's time zone updates to the new zone automatically, with no prompt.
- "Due today" and the daily counts follow the new local midnight.
- Settings shows no time-zone row.

---

## 8. Data safety and sync behavior

- **Offline-safe:** everything the extension records (starts, submissions, finishes, ratings) goes into a local outbox first and syncs when the server is reachable. Nothing is lost by closing the popup or going offline.
- **Account switch:** if you sign in as a different user, queued changes from the old account are **not** sent. The popup says *"N changes belong to another account and won't be sent."*
- **Undo-safe history:** ratings are append-only on the server; the schedule history keeps every event.

---

## 9. The LeetCode-native look

**What changed:** the panel, popup, and web app now use LeetCode's colors: dark `#1a1a1a`/`#262626` surfaces, light `#f7f8fa`/white, and LeetCode orange `#ffa116` for primary buttons. Text colors were chosen to stay readable. In light mode, orange *text* is a darker amber, because `#ffa116` on white is hard to read.

**How to test:**
1. **The panel follows LeetCode's theme, not your OS.** On a LeetCode problem page, switch LeetCode's own theme (avatar menu → Appearance, or the theme toggle). The ankify panel switches with it, without a reload. If it doesn't follow on real LeetCode, tell me what LeetCode's `<html>` element looks like in each theme (DevTools → Elements, the first line).
2. Compare the collapsed pill and the expanded card against LeetCode's own panels: similar surface color, 8 px corners, orange primary button, no heavy shadow.
3. **Rating buttons:** Again, Hard, Good, and Easy each have a colored left edge plus their name, so they are distinguishable without relying on color.
4. The expanded panel must not cover LeetCode's **Submit** / **Run** buttons or the result tabs at a normal window size. If it does on your screen, note the window size.
5. The popup and the web pages follow their own theme setting (System / Light / Dark). Check both themes on **Today**, **Problems**, a problem page, **Analysis**, **Suggestions**, and **Settings**.
6. Keyboard: Tab through a page; every focused control shows an orange outline.

**Automated checks (for reference):**
- `pnpm test:visual` compares screenshots of the panel (5 states), the popup (full and empty), and the six web pages, in light and dark, plus phone width. Baselines live in `tests/visual/__screenshots__`.
- `tests/e2e/a11y.spec.ts` (part of `pnpm test:e2e`) runs axe-core WCAG 2.1 AA checks, including color contrast, on all of them, plus a keyboard-focus check.

---

## 10. Known gaps (expected; not bugs)

- **Suggestion catalog:** the global catalog hasn't been generated (it needs your signed-in LeetCode session: `scripts/leetcode-catalog.js`). Fresh accounts only get suggestions after practicing problems with similar questions; the QA deck has a fixture (§3).
- **Live LeetCode:** submission tracking, the Submit-button detection, sign-out handling, and the theme signal are verified only against a local LeetCode fixture. Run `scripts/leetcode-live-probe.js` in a signed-in leetcode.com tab and send the report; then try §1.2, §1.6, and §9 on the real site.
- **Production automatic analysis:** on by default in this code. Decide before deploying (docs/DEPLOYMENT.md); set `ANKIFY_AUTOMATIC_ANALYSIS=disabled` to hold it.
- **No Undo button for a rating:** the server supports undo, but no UI exposes it yet.
