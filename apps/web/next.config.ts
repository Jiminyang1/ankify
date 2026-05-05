import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "@ankify/db/env";

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, "../..");

loadEnvFile(resolve(repoRoot, ".env"));
loadEnvFile(resolve(repoRoot, ".env.local"), true);

if (!process.env.TURSO_DATABASE_URL && !process.env.LOCAL_DB_PATH) {
  process.env.LOCAL_DB_PATH = resolve(repoRoot, "packages/db/local.db");
}
const config: NextConfig = {
  transpilePackages: ["@ankify/core", "@ankify/db"],
};

export default config;
