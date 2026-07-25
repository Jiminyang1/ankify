import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "@ankify/db";

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

function configuredExtensionOrigins() {
  const configured = (process.env.ANKIFY_EXTENSION_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.startsWith("chrome-extension://"));
  if (configured.length === 0 && process.env.NODE_ENV !== "production") {
    return ["chrome-extension://*"];
  }
  return configured;
}

/**
 * Public signup is the default. This kill switch is reserved for an incident
 * where new account creation must be paused without locking out existing users.
 */
export function isSignupEnabled() {
  const flag = (process.env.ANKIFY_DISABLE_SIGNUP ?? "").trim().toLowerCase();
  return !(flag === "true" || flag === "1" || flag === "yes");
}

export function ensureAuthConfigured() {
  requiredEnv("BETTER_AUTH_SECRET");
  requiredEnv("BETTER_AUTH_URL");
  requiredEnv("GOOGLE_CLIENT_ID");
  requiredEnv("GOOGLE_CLIENT_SECRET");
  requiredEnv("AI_KEY_ENCRYPTION_SECRET");
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
  session: {
    // Keep routine page/API authentication off the remote database for a
    // short window. Sensitive account/settings routes explicitly bypass this
    // cache through getRequestSessionUser().
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
  trustedOrigins: [configuredBaseUrl(), ...configuredExtensionOrigins()],
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
        before: async () => isSignupEnabled(),
      },
    },
  },
  plugins: [nextCookies()],
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

export async function getUserFromHeaders(
  inputHeaders: Headers,
  disableCookieCache = false,
): Promise<AuthUser | null> {
  ensureAuthConfigured();
  const result = await auth.api
    .getSession({
      headers: inputHeaders,
      query: { disableCookieCache },
    })
    .catch((error: unknown) => {
      if (isAuthFailure(error)) return null;
      throw error;
    });
  if (!result?.user?.email) return null;
  return result.user;
}

export async function getSessionUserFromHeaders(inputHeaders: Headers): Promise<AuthUser | null> {
  return getUserFromHeaders(inputHeaders, true);
}

const getCachedPageUser = cache(async () => getUserFromHeaders(await headers()));

export async function getOptionalPageUser() {
  return getCachedPageUser();
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
