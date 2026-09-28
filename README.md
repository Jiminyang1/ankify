<div align="center">

# ankify

**Remember the reasoning behind every LeetCode problem you solve.**

ankify captures your problems, submissions, and failed test cases from LeetCode,<br>
then brings each one back with spaced repetition, AI quizzes built from your own mistakes, and a Study Coach that has read your code.

[**Open the web app**](https://ankify-pi.vercel.app) · [**Add to Chrome**](https://chromewebstore.google.com/detail/ankify/gcldkcaidjnkaagngppblefddapdpaeb) · [Self-host](docs/SELF_HOSTING.md)

<br>

![Reviewing Coin Change in ankify: answer a quiz built from a failed submission, open Study Coach, rate recall, and FSRS schedules the next review](images/hero-review-flow.gif)

</div>

---

## The problem

You solve a hard problem. A week later you remember *that* you solved it, but not *how*: the trick that made it click, the edge case that broke your first attempt, the complexity argument you skipped.

- **LeetCode** records what you solved, not what you still remember.
- **Anki** handles vocabulary well, but a pile of disconnected cards is a poor way to review algorithm problems.

ankify schedules the **whole problem**. When Coin Change is due, you get one focused session: the statement, your past submissions, your notes, a quiz generated for this session, and a coach who can explain what went wrong.

## How it works

| 1 · Solve | 2 · Capture | 3 · Review |
| --- | --- | --- |
| Work on LeetCode as usual. Accepted or not, every attempt counts. | One click in the Chrome extension saves the statement, all your submissions, and the exact failing test case with expected vs. actual output. | FSRS-6 brings the problem back just before you'd forget it. Review on the web or in the extension side panel next to LeetCode. |

---

## Features

### A quiz for each review, built from your own mistakes

Every review starts with five multiple-choice questions generated from *your* context: the statement, your failed submissions, your notes, and your saved cards. Each batch covers at least four different angles (approach, invariant, edge case, implementation) and always includes a complexity question. You can't pass by memorizing trivia.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/review-quiz-dark.png">
  <img alt="Review workspace: Coin Change statement on the left, an AI-generated quiz with explanation on the right, FSRS rating bar at the bottom" src="images/review-quiz-light.png">
</picture>

Answer with `A`–`D`, rate with `1`–`4`, submit with `Enter`. A missed question becomes a flashcard in one click. Your score suggests a rating, but you always decide. If you misclick, **Undo** restores the previous schedule.

### Study Coach: an AI tutor that has read your submissions

Study Coach sits beside any page. It uses tools to look up the problem, your submissions, notes, cards, quiz results, and your review queue, so it answers about *your* attempt instead of a generic solution.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/study-coach-dark.png">
  <img alt="Study Coach panel explaining why a greedy Coin Change submission failed on coins=[1,3,4], amount=6" src="images/study-coach-light.png">
</picture>

A real exchange from the screenshot above, lightly trimmed:

> **You:** Why did my first attempt fail?
>
> **Coach** *(reads your submissions)*: Your first attempt was the greedy one, about 6 weeks ago. You sorted coins descending and always took as many of the biggest coin as fit. That only works for "canonical" coin systems. It fails on `coins = [1,3,4], amount = 6`:
>
> - Greedy: take `4`, then `1`, then `1` → **3 coins**
> - Optimal: `3 + 3` → **2 coins**
>
> Your plain recursion was correct but exponential. It hit TLE on `[1,2,5] / 100` because it re-solves the same remaining amounts, which is exactly what your accepted bottom-up `dp` fixes.
>
> One check for you: why does `[1,2,5]` work with greedy but `[1,3,4]` doesn't?

Coach can jump to another problem or suggest a new card or quiz. Anything that writes data waits for your confirmation.

### Capture from the page you're already on

The extension reads the LeetCode page directly: title, statement, tags, and every accepted and failed submission. No copy-paste. If you have solved a problem but haven't saved it yet, the toolbar icon shows a gold `!`. Open the side panel to quiz, flip cards, and rate recall without leaving LeetCode.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/extension-side-panel-dark.png">
    <img width="640" alt="ankify Chrome side panel: today's due queue, and a Coin Change quiz question with its explanation and the rating bar" src="images/extension-side-panel-light.png">
  </picture>
</p>

### See what's about to slip

`/analysis` reads the same FSRS state that drives your schedule: average recall, lapse rate, a ranked list of the problems you're most likely to forget, stability buckets, and your review history.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/analysis-dark.png">
  <img alt="Analysis dashboard with memory score, lapse rate, needs-attention table, stability buckets, and a 30-day review activity chart" src="images/analysis-light.png">
</picture>

### And the rest

- **A daily queue with a limit.** Set how many problems you review per day. The Today page ranks what's due by urgency.
- **Flashcards that stay simple.** Each card is just a question and an answer. AI drafts are *candidates* until you confirm them.
- **Start on free AI credits, then bring your own model.** New accounts get free credits to try quizzes and Study Coach. After that, add your own Anthropic, OpenAI, or DeepSeek key. Keys are encrypted with AES-256-GCM before they reach the database, and your own key always takes priority.
- **English or 简体中文.** The interface and AI output each have their own language setting.
- **Your data stays yours.** Export everything as NDJSON or delete your account from Settings.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/today-dark.png">
  <img alt="Today page: six due problems, done-today counter, and the review queue ranked by urgency" src="images/today-light.png">
</picture>

---

## Get started

1. **Sign in** at [ankify-pi.vercel.app](https://ankify-pi.vercel.app) with Google.
2. **Try the AI features on free credits.** When they run out, add your own Anthropic, OpenAI, or DeepSeek key in Settings.
3. **Install the [Chrome extension](https://chromewebstore.google.com/detail/ankify/gcldkcaidjnkaagngppblefddapdpaeb).** It reuses your web login, so there's no token to paste.
4. **Open any LeetCode problem you've solved** and click *Capture*.

A captured problem is due right away. Open **Today** and start your first session.

## Built with

| Layer | Stack |
| --- | --- |
| Scheduling | [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs) FSRS-6. Each problem is scheduled as one item. Cards and quizzes support recall. |
| AI | Vercel AI SDK: a `ToolLoopAgent` for Study Coach, durable jobs for card and quiz generation |
| Web + API | Next.js 16 App Router, TypeScript, Tailwind |
| Extension | Chrome MV3, Vite, React |
| Data | Drizzle ORM on Turso / libSQL (SQLite locally). Every business table is scoped by `userId`. |
| Auth | Better Auth + Google OAuth. The extension shares the web session. |

## Self-hosting and development

Local setup, the QA and demo environments, database profiles, Vercel deployment, and release checks are covered in **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**. For how the system fits together, start with **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

```bash
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev          # http://localhost:3000
```

Want to look around without setting up Google OAuth? Run `pnpm dev:demo` and open `http://localhost:3000/api/qa/login`. The screenshots in this README come from that demo deck.

## License

[MIT](LICENSE)
