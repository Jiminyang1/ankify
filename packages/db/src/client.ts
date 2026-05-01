import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function buildClient(): Client {
  const remoteUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (remoteUrl) {
    return createClient({ url: remoteUrl, authToken });
  }

  const localPath = process.env.LOCAL_DB_PATH ?? "./local.db";
  return createClient({ url: `file:${localPath}` });
}

export function getDb() {
  if (!_db) {
    _db = drizzle(buildClient(), { schema });
  }
  return _db;
}

export type DB = ReturnType<typeof getDb>;
export { schema };
