import { loadDbEnv } from "@ankify/db/client";
import { isProviderId } from "../src/server/ai/providers/registry";
import { buildModel } from "../src/server/ai";
import type { CallReasoning } from "../src/server/ai/call-options";
import { judgeReply } from "../src/server/practice-judge";
import { JUDGE_CASES, type JudgeCase } from "../src/server/practice-judge.cases";

/**
 * Runs the practice judge on the hand-labeled cases and reports agreement
 * (docs/coach-practice.md, version 3). Uses the QA model unless
 * ANKIFY_EVAL_AI_PROVIDER / _MODEL / _API_KEY are set.
 *
 *   pnpm eval:judge                  # lightest reasoning, as in practice
 *   pnpm eval:judge -- --reasoning user --runs 2 --only coins
 */

loadDbEnv();

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};
const reasoning = (flag("reasoning") ?? "lightest") as CallReasoning;
const runs = Number(flag("runs") ?? 1);
const only = flag("only");

const provider = process.env.ANKIFY_EVAL_AI_PROVIDER ?? process.env.ANKIFY_QA_AI_PROVIDER;
const modelId = process.env.ANKIFY_EVAL_AI_MODEL ?? process.env.ANKIFY_QA_AI_MODEL;
const apiKey = process.env.ANKIFY_EVAL_AI_API_KEY ?? process.env.ANKIFY_QA_AI_API_KEY;
if (!provider || !modelId || !apiKey || !isProviderId(provider)) {
  throw new Error("Set ANKIFY_EVAL_AI_PROVIDER, ANKIFY_EVAL_AI_MODEL, and ANKIFY_EVAL_AI_API_KEY (or the QA ones).");
}
const settings = {
  provider,
  model: modelId,
  reasoningLevel: "default",
  apiKey,
  source: "user" as const,
};
const model = buildModel(settings);

type Outcome = {
  id: string;
  ms: number;
  error?: string;
  reply: boolean;
  approach: boolean | null;
  status: boolean | null;
  misconception: boolean | null;
  points: { exact: boolean; tp: number; fp: number; fn: number } | null;
  got: string;
};

function score(testCase: JudgeCase, got: Awaited<ReturnType<typeof judgeReply>>, ms: number): Outcome {
  const expected = testCase.expected;
  const statuses = expected.approachStatus === undefined ? null : [expected.approachStatus].flat();
  let points: Outcome["points"] = null;
  if (expected.covered) {
    const must = new Set(expected.covered);
    const maybe = new Set(expected.maybe ?? []);
    // Points only count against the approach the label names.
    const approachMatches =
      expected.approachId === undefined || expected.approachId === null || got.approachId === expected.approachId ||
      testCase.input.reference.approaches.length === 1;
    const credited = new Set(approachMatches ? got.covered : []);
    const tp = [...must].filter((id) => credited.has(id)).length;
    const fn = must.size - tp;
    const fp = [...credited].filter((id) => !must.has(id) && !maybe.has(id)).length;
    points = { exact: fn === 0 && fp === 0, tp, fp, fn };
  }
  return {
    id: testCase.id,
    ms,
    reply: got.reply === expected.reply,
    approach: expected.approachId === undefined ? null : got.approachId === expected.approachId,
    status: statuses ? statuses.includes(got.approachStatus) : null,
    misconception: expected.misconception === undefined ? null : Boolean(got.misconception) === expected.misconception,
    points,
    got: `${got.reply} ${got.approachId ?? "-"} ${got.approachStatus} [${got.covered.join(",")}]${got.misconception ? ` misconception: ${got.misconception}` : ""}`,
  };
}

async function runCase(testCase: JudgeCase): Promise<Outcome> {
  const started = Date.now();
  try {
    const got = await judgeReply({ model, settings, reasoning }, testCase.input);
    return score(testCase, got, Date.now() - started);
  } catch (error) {
    return {
      id: testCase.id,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      reply: false,
      approach: null,
      status: null,
      misconception: null,
      points: null,
      got: "",
    };
  }
}

async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]!);
      }
    }),
  );
  return results;
}

async function main() {
  const cases = JUDGE_CASES.filter((testCase) => !only || testCase.id.includes(only));
  console.log(`Judge eval: ${cases.length} cases x ${runs} run(s), ${provider}/${modelId}, reasoning ${reasoning}\n`);
  const outcomes: Outcome[] = [];
  for (let run = 0; run < runs; run++) outcomes.push(...(await pool(cases, 4, runCase)));

  const mark = (value: boolean | null) => (value === null ? " " : value ? "." : "x");
  for (const outcome of outcomes) {
    const flags = [outcome.reply, outcome.approach, outcome.status, outcome.misconception, outcome.points?.exact ?? null]
      .map(mark)
      .join("");
    const bad = outcome.error || flags.includes("x");
    console.log(`${bad ? "!" : " "} [${flags}] ${outcome.id.padEnd(24)} ${String(outcome.ms).padStart(6)}ms  ${outcome.error ?? outcome.got}`);
  }

  const rate = (values: (boolean | null)[]) => {
    const scored = values.filter((value): value is boolean => value !== null);
    return scored.length ? `${scored.filter(Boolean).length}/${scored.length}` : "-";
  };
  const tp = outcomes.reduce((sum, o) => sum + (o.points?.tp ?? 0), 0);
  const fp = outcomes.reduce((sum, o) => sum + (o.points?.fp ?? 0), 0);
  const fn = outcomes.reduce((sum, o) => sum + (o.points?.fn ?? 0), 0);
  const latencies = outcomes.filter((o) => !o.error && o.ms > 50).map((o) => o.ms).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * p))] ?? 0;
  console.log(`
  flags: reply, approach, status, misconception, points ("." agrees, "x" disagrees, blank not labeled)
  reply type     ${rate(outcomes.map((o) => o.reply))}
  approach       ${rate(outcomes.map((o) => o.approach))}
  status         ${rate(outcomes.map((o) => o.status))}
  misconception  ${rate(outcomes.map((o) => o.misconception))}
  points exact   ${rate(outcomes.map((o) => o.points?.exact ?? null))}
  points         precision ${(tp / Math.max(1, tp + fp)).toFixed(2)}, recall ${(tp / Math.max(1, tp + fn)).toFixed(2)} (${fp} extra, ${fn} missed)
  errors         ${outcomes.filter((o) => o.error).length}
  latency        p50 ${pct(0.5)}ms, p90 ${pct(0.9)}ms (model calls only)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
