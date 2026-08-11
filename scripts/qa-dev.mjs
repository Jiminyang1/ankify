import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = new Set(process.argv.slice(2));

function command(commandArgs, options = {}) {
  return spawn(pnpm, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
}

function run(commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = command(commandArgs);
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `${pnpm} ${commandArgs.join(" ")} exited with ${signal ?? code}`,
        ),
      );
    });
  });
}

await run(["db:migrate:qa"]);
await run(["--filter", "@ankify/web", "qa:seed"]);

if (args.has("--reset-only")) {
  process.exit(0);
}

const children = [
  command(["--filter", "@ankify/web", "dev"]),
  command(["--filter", "@ankify/web", "qa:worker"]),
];
if (args.has("--extension")) {
  children.push(command(["--filter", "@ankify/extension", "dev"]));
}

console.log("\nQA ready after the web server starts:");
console.log("  http://localhost:3000/api/qa/login");
console.log("  pnpm qa:reset restores the same fixtures and keeps AI settings.\n");

let stopping = false;
let exitCode = 0;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

await Promise.race(
  children.map(
    (child) =>
      new Promise((resolveChild) => {
        child.once("exit", (code) => {
          if (!stopping) {
            exitCode = code ?? 1;
            stop();
          }
          resolveChild();
        });
      }),
  ),
);

await Promise.all(
  children.map(
    (child) =>
      new Promise((resolveChild) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolveChild();
          return;
        }
        child.once("exit", resolveChild);
      }),
  ),
);

process.exitCode = exitCode;
