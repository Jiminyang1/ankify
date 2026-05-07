import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { apiKey } from "@better-auth/api-key";
import { getDb, schema } from "@ankify/db";

const API_KEY_HEADER = "x-ankify-token";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`${name} missing`);
  }
  return value ?? "";
}

function configuredBaseUrl() {
  return requiredEnv("BETTER_AUTH_URL") || "http://localhost:3000";
}

export function allowedEmails() {
  return (process.env.ANKIFY_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined) {
  const allowlist = allowedEmails();
  if (allowlist.length === 0) return process.env.NODE_ENV !== "production";
  return Boolean(email && allowlist.includes(email.toLowerCase()));
}

export function ensureAuthConfigured() {
  requiredEnv("BETTER_AUTH_SECRET");
  requiredEnv("BETTER_AUTH_URL");
  requiredEnv("GOOGLE_CLIENT_ID");
  requiredEnv("GOOGLE_CLIENT_SECRET");
  requiredEnv("AI_KEY_ENCRYPTION_SECRET");
  if (process.env.NODE_ENV === "production" && allowedEmails().length === 0) {
    throw new Error("ANKIFY_ALLOWED_EMAILS missing");
  }
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

export const auth = betterAuth({
  baseURL: configuredBaseUrl(),
  secret: process.env.BETTER_AUTH_SECRET || "dev-only-better-auth-secret",
  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema,
  }),
  trustedOrigins: [configuredBaseUrl()],
  socialProviders:
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {},
  databaseHooks: {
    user: {
      create: {
        before: async (nextUser) => isAllowedEmail(nextUser.email),
      },
    },
  },
  plugins: [
    apiKey({
      apiKeyHeaders: API_KEY_HEADER,
      references: "user",
      enableSessionForAPIKeys: true,
      defaultPrefix: "ank_",
      requireName: true,
      keyExpiration: {
        defaultExpiresIn: null,
        disableCustomExpiresTime: true,
      },
      rateLimit: {
        enabled: true,
        timeWindow: 24 * 60 * 60 * 1000,
        maxRequests: 1000,
      },
    }),
    nextCookies(),
  ],
});

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

function isAuthFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown; statusCode?: unknown }).status ??
    (error as Error & { status?: unknown; statusCode?: unknown }).statusCode;
  return status === "UNAUTHORIZED" || status === "FORBIDDEN" || status === 401 || status === 403;
}

export async function getUserFromHeaders(inputHeaders: Headers): Promise<AuthUser | null> {
  ensureAuthConfigured();
  const result = await auth.api
    .getSession({
      headers: inputHeaders,
      query: { disableCookieCache: true },
    })
    .catch((error: unknown) => {
      if (isAuthFailure(error)) return null;
      throw error;
    });
  if (!result?.user || !isAllowedEmail(result.user.email)) return null;
  return result.user;
}

export async function getSessionUserFromHeaders(inputHeaders: Headers): Promise<AuthUser | null> {
  if (inputHeaders.get(API_KEY_HEADER)) return null;
  return getUserFromHeaders(inputHeaders);
}

export async function getOptionalPageUser() {
  return getUserFromHeaders(await headers());
}

export async function requirePageUser() {
  const user = await getOptionalPageUser();
  if (!user) redirect("/login");
  return user;
}

export async function getRequestUser(req: Request) {
  return getUserFromHeaders(req.headers);
}

export async function getRequestSessionUser(req: Request) {
  return getSessionUserFromHeaders(req.headers);
}

export function unauthorizedResponse() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export { API_KEY_HEADER };
