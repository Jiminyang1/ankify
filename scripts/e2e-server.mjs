import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
};
let active;
let stopping = false;
function stop(signal) {
  stopping = true;
  active?.kill(signal);
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
  await run(process.execPath, [resolve(root, "apps/web/node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "4317"], resolve(root, "apps/web"));
} catch (error) {
  if (!stopping) {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
