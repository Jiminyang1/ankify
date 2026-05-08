import type { Config } from "drizzle-kit";
import { loadDbEnv } from "./src/client";

// Honour ANKIFY_PROFILE=production to point drizzle-kit at Turso; default
// targets local SQLite via LOCAL_DB_PATH (set by loadDbEnv when missing).
loadDbEnv();

const url = process.env.TURSO_DATABASE_URL ?? `file:${process.env.LOCAL_DB_PATH ?? "./local.db"}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    ...(authToken ? { authToken } : {}),
  },
} satisfies Config;
