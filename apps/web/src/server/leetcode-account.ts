import type { LeetcodeAccountDto, LeetcodeProfileDto } from "@ankify/contracts";
import { getDb, schema } from "@ankify/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { leetcodeGraphql } from "./leetcode-graphql";

/**
 * Linked LeetCode account: the username plus a cached copy of that user's
 * public profile. Everything here comes from LeetCode's public GraphQL — no
 * LeetCode session is ever sent or stored. The full solved list needs the
 * user's own login, so the extension reads it and posts only the slugs.
 */

const KEY = "leetcode-account";
/** Full solved list, pushed by the extension from the user's LeetCode login. */
const SOLVED_KEY = "leetcode-solved";
/** Refetch at most this often; the page falls back to the cache on failure. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type StoredAccount = {
  username: string;
  linkedAt: number;
  fetchedAt: number | null;
  profile: LeetcodeProfileDto | null;
};

export type LinkLeetcodeError = "invalid_profile" | "unsupported_site" | "user_not_found" | "leetcode_unavailable";

/** Accepts a bare username, `@name`, or a leetcode.com profile URL
 *  (`/u/name/` or the legacy `/name/`). leetcode.cn is a separate site. */
export function parseLeetcodeProfile(input: string): { username: string } | { error: LinkLeetcodeError } {
  const raw = input.trim().replace(/^@/, "");
  if (!raw) return { error: "invalid_profile" };

  if (!/[/.]/.test(raw) || !/leetcode\./i.test(raw)) {
    return USERNAME_RE.test(raw) ? { username: raw } : { error: "invalid_profile" };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "invalid_profile" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "leetcode.cn") return { error: "unsupported_site" };
  if (host !== "leetcode.com") return { error: "invalid_profile" };

  const parts = url.pathname.split("/").filter(Boolean);
  const candidate = parts[0] === "u" || parts[0] === "profile" ? parts[1] : parts.length === 1 ? parts[0] : undefined;
  return candidate && USERNAME_RE.test(candidate) ? { username: candidate } : { error: "invalid_profile" };
}

const PROFILE_QUERY = `query ankifyProfile($username: String!) {
  matchedUser(username: $username) {
    username
    profile { userAvatar ranking }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    userCalendar { streak totalActiveDays }
  }
  recentAcSubmissionList(username: $username, limit: 20) { title titleSlug timestamp }
}`;

const profileResponseSchema = z.object({
  data: z
    .object({
      matchedUser: z
        .object({
          username: z.string(),
          profile: z.object({ userAvatar: z.string().nullable(), ranking: z.number().nullable() }).nullable(),
          submitStatsGlobal: z.object({
            acSubmissionNum: z.array(z.object({ difficulty: z.string(), count: z.number() })),
          }),
          userCalendar: z.object({ streak: z.number(), totalActiveDays: z.number() }).nullable(),
        })
        .nullable(),
      recentAcSubmissionList: z
        .array(z.object({ title: z.string(), titleSlug: z.string(), timestamp: z.string() }))
        .nullable(),
    })
    .nullable(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/** null when LeetCode says the user doesn't exist; throws when LeetCode is
 *  unreachable or answers in a shape we don't recognise. */
export async function fetchLeetcodeProfile(username: string): Promise<LeetcodeProfileDto | null> {
  const parsed = profileResponseSchema.parse(await leetcodeGraphql(PROFILE_QUERY, { username }));
  const user = parsed.data?.matchedUser;
  if (!user) {
    if (parsed.errors?.some((error) => /does not exist/i.test(error.message))) return null;
    throw new Error(`leetcode_graphql: ${parsed.errors?.map((error) => error.message).join("; ") ?? "no data"}`);
  }

  const solvedBy = (difficulty: string) =>
    user.submitStatsGlobal.acSubmissionNum.find((row) => row.difficulty === difficulty)?.count ?? 0;
  return {
    username: user.username,
    avatarUrl: user.profile?.userAvatar || null,
    ranking: user.profile?.ranking ?? null,
    solved: { all: solvedBy("All"), easy: solvedBy("Easy"), medium: solvedBy("Medium"), hard: solvedBy("Hard") },
    streak: user.userCalendar?.streak ?? 0,
    activeDays: user.userCalendar?.totalActiveDays ?? 0,
    recentAccepted: (parsed.data?.recentAcSubmissionList ?? []).map((row) => ({
      slug: row.titleSlug,
      title: row.title,
      acceptedAt: new Date(Number(row.timestamp) * 1000).toISOString(),
    })),
  };
}

async function readAccount(userId: string): Promise<StoredAccount | null> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, KEY)));
  const value = row?.value as Partial<StoredAccount> | undefined;
  if (!value || typeof value.username !== "string") return null;
  return {
    username: value.username,
    linkedAt: typeof value.linkedAt === "number" ? value.linkedAt : Date.now(),
    fetchedAt: typeof value.fetchedAt === "number" ? value.fetchedAt : null,
    profile: value.profile ?? null,
  };
}

async function writeAccount(userId: string, account: StoredAccount) {
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: KEY, value: account })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: account, updatedAt: new Date() },
    });
}

function toDto(account: StoredAccount): LeetcodeAccountDto {
  return {
    username: account.username,
    linkedAt: new Date(account.linkedAt).toISOString(),
    fetchedAt: account.fetchedAt ? new Date(account.fetchedAt).toISOString() : null,
    profile: account.profile,
  };
}

/** The linked account, refreshed from LeetCode when the cache is stale. A
 *  failed refresh keeps serving the cached profile rather than failing the page. */
export async function getLeetcodeAccount(userId: string): Promise<LeetcodeAccountDto | null> {
  const account = await readAccount(userId);
  if (!account) return null;
  if (account.fetchedAt && Date.now() - account.fetchedAt < REFRESH_AFTER_MS) return toDto(account);

  try {
    const profile = await fetchLeetcodeProfile(account.username);
    if (!profile) return toDto(account);
    const next = { ...account, profile, fetchedAt: Date.now() };
    await writeAccount(userId, next);
    return toDto(next);
  } catch (error) {
    console.warn("[leetcode] profile refresh failed", error);
    return toDto(account);
  }
}

export async function linkLeetcodeAccount(
  userId: string,
  input: string,
): Promise<{ account: LeetcodeAccountDto } | { error: LinkLeetcodeError }> {
  const parsed = parseLeetcodeProfile(input);
  if ("error" in parsed) return parsed;

  let profile: LeetcodeProfileDto | null;
  try {
    profile = await fetchLeetcodeProfile(parsed.username);
  } catch (error) {
    console.warn("[leetcode] link lookup failed", error);
    return { error: "leetcode_unavailable" };
  }
  if (!profile) return { error: "user_not_found" };

  // Store LeetCode's own casing so the profile link and later lookups match.
  const account: StoredAccount = { username: profile.username, linkedAt: Date.now(), fetchedAt: Date.now(), profile };
  await writeAccount(userId, account);
  return { account: toDto(account) };
}

export async function unlinkLeetcodeAccount(userId: string) {
  await getDb()
    .delete(schema.settings)
    .where(and(eq(schema.settings.userId, userId), inArray(schema.settings.key, [KEY, SOLVED_KEY])));
}

type StoredSolved = { username: string; slugs: string[]; syncedAt: number };

export type LeetcodeSolved = { username: string; slugs: string[]; syncedAt: string };

/** The extension's latest solved-list snapshot for the linked account. */
export async function getLeetcodeSolved(userId: string): Promise<LeetcodeSolved | null> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, SOLVED_KEY)));
  const value = row?.value as Partial<StoredSolved> | undefined;
  if (!value || typeof value.username !== "string" || !Array.isArray(value.slugs)) return null;
  return {
    username: value.username,
    slugs: value.slugs.filter((slug): slug is string => typeof slug === "string"),
    syncedAt: new Date(typeof value.syncedAt === "number" ? value.syncedAt : 0).toISOString(),
  };
}

/** Store the extension's solved list and link the LeetCode account it came
 *  from. The extension reads the username from the signed-in LeetCode
 *  session, so it replaces a different manually linked name. */
export async function saveLeetcodeSolved(
  userId: string,
  username: string,
  slugs: string[],
): Promise<{ username: string; count: number } | { error: LinkLeetcodeError }> {
  const parsed = parseLeetcodeProfile(username);
  if ("error" in parsed) return parsed;

  const current = await readAccount(userId);
  if (!current || current.username.toLowerCase() !== parsed.username.toLowerCase()) {
    let profile: LeetcodeProfileDto | null = null;
    try {
      profile = await fetchLeetcodeProfile(parsed.username);
    } catch (error) {
      // Link anyway; getLeetcodeAccount retries the profile on the next read.
      console.warn("[leetcode] profile lookup during solved sync failed", error);
    }
    await writeAccount(userId, {
      username: profile?.username ?? parsed.username,
      linkedAt: Date.now(),
      fetchedAt: profile ? Date.now() : null,
      profile,
    });
  }

  const value: StoredSolved = { username: parsed.username, slugs: [...new Set(slugs)], syncedAt: Date.now() };
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: SOLVED_KEY, value })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
  return { username: parsed.username, count: value.slugs.length };
}
