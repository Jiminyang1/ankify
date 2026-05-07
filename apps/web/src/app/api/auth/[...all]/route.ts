import { toNextJsHandler } from "better-auth/next-js";
import { auth, ensureAuthConfigured } from "@/lib/auth";

export const runtime = "nodejs";

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler((req) => {
  ensureAuthConfigured();
  return auth.handler(req);
});
