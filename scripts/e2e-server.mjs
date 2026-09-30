import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "ankify-e2e-"));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// Explicit empty values take precedence over local env files. The disposable
// profile cannot reach Turso, hosted AI, a personal provider, or Stripe.
const env = {
  ...process.env,
  NODE_ENV: "development", ANKIFY_PROFILE: "qa", ANKIFY_E2E: "1", VERCEL: "",
  TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", LOCAL_DB_PATH: join(scratch, "qa.db"),
  BETTER_AUTH_URL: "http://localhost:4317",
  BETTER_AUTH_SECRET: "ankify-browser-tests-only-secret-32-characters",
  GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
  ANKIFY_EXTENSION_API_ORIGIN: "http://localhost:4317", ANKIFY_EXTENSION_ORIGINS: "",
  AI_KEY_ENCRYPTION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ANKIFY_STARTER_AI_API_KEY: "", ANKIFY_DISABLE_SIGNUP: "true",
  ANKIFY_QA_AI_PROVIDER: "", ANKIFY_QA_AI_MODEL: "", ANKIFY_QA_AI_API_KEY: "",
  ANKIFY_QA_AI_REASONING_MODE: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "",
  // Session analysis runs against the local fake provider below, and
  // automatic analysis is available so tests can switch it per user.
  ANKIFY_QA_AI_BASE_URL: "http://127.0.0.1:4318/v1", ANKIFY_AUTOMATIC_ANALYSIS: "enabled",
};

// A fake OpenAI-compatible provider: every chat completion returns the same
// session analysis. It is the only AI "provider" the browser tests can reach.
const FAKE_ANALYSIS = {
  summary: "The first attempts missed the empty string.",
  insufficientEvidence: false,
  findings: [
    { category: "edge_case", cause: "An empty input returned the wrong value.", nextStep: "Test the empty input first.", confidence: "medium", evidence: [{ attempt: "S1", startLine: null, endLine: null }] },
    { category: "complexity", cause: "The first version rescanned the string.", nextStep: null, confidence: "low", evidence: [{ attempt: "S2", startLine: null, endLine: null }] },
  ],
};
const fakeProvider = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      id: "fake-completion", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "fake",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(FAKE_ANALYSIS) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 80, total_tokens: 1080 },
    }));
  });
});
await new Promise((resolveListen) => fakeProvider.listen(4318, "127.0.0.1", resolveListen));
let worker;
let active;
let stopping = false;
function stop(signal) {
  stopping = true;
  active?.kill(signal);
  worker?.kill(signal);
  fakeProvider.close();
}
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

function run(command, args, cwd = root) {
  if (stopping) throw new Error("Browser test server stopped");
  return new Promise((resolveRun, reject) => {
    active = spawn(command, args, { cwd, env, stdio: "inherit" });
    active.once("error", reject);
    active.once("exit", (code, signal) => {
      active = undefined;
      if (code === 0 || stopping) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

try {
  await run(pnpm, ["db:migrate:qa"]);
  await run(pnpm, ["--filter", "@ankify/web", "qa:seed"]);
  await run(pnpm, ["--filter", "@ankify/extension", "exec", "vite", "build", "--mode", "development", "--outDir", "dist-e2e"]);
  // The QA worker processes queued AI jobs from the same database.
  worker = spawn(pnpm, ["--filter", "@ankify/web", "qa:worker"], { cwd: root, env, stdio: "inherit" });
  await run(process.execPath, [resolve(root, "apps/web/node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "4317"], resolve(root, "apps/web"));
} catch (error) {
  if (!stopping) {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  worker?.kill("SIGTERM");
  fakeProvider.close();
  rmSync(scratch, { recursive: true, force: true });
}
