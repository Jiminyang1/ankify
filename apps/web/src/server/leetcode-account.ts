import type { LeetcodeAccountDto, LeetcodeProfileDto } from "@ankify/contracts";
import { LEETCODE_SITES, leetcodeSiteOfHost, type LeetcodeSite } from "@ankify/core";
import { getDb, schema } from "@ankify/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { leetcodeGraphql } from "./leetcode-graphql";

/**
 * Linked LeetCode account: the username plus a cached copy of that user's
 * public profile. Everything here comes from LeetCode's public GraphQL — no
 * LeetCode session is ever sent or stored. The full solved list needs the
 * user's own login, so the extension reads it and posts only the slugs.
 *
 * leetcode.com and leetcode.cn are separate accounts, each with its own row, so
 * someone who uses both keeps both. A plan problem counts as solved if either
 * says so, because a slug names the same problem on both sites.
 */

const ACCOUNT_KEY: Record<LeetcodeSite, string> = { com: "leetcode-account", cn: "leetcode-account-cn" };
/** Full solved list, pushed by the extension from the user's LeetCode login. */
const SOLVED_KEY: Record<LeetcodeSite, string> = { com: "leetcode-solved", cn: "leetcode-solved-cn" };
/** Refetch at most this often; the page falls back to the cache on failure. */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

type StoredAccount = {
  site: LeetcodeSite;
  username: string;
  linkedAt: number;
  fetchedAt: number | null;
  profile: LeetcodeProfileDto | null;
};

export type LinkLeetcodeError = "invalid_profile" | "user_not_found" | "leetcode_unavailable";

/** Accepts a bare username or `@name` (leetcode.com), or a profile URL on either
 *  site (`/u/name/` or the legacy `/name/`). */
export function parseLeetcodeProfile(
  input: string,
): { username: string; site: LeetcodeSite } | { error: LinkLeetcodeError } {
  const raw = input.trim().replace(/^@/, "");
  if (!raw) return { error: "invalid_profile" };

  if (!/[/.]/.test(raw) || !/leetcode(-cn)?\./i.test(raw)) {
    return USERNAME_RE.test(raw) ? { username: raw, site: "com" } : { error: "invalid_profile" };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "invalid_profile" };
  }
  const site = leetcodeSiteOfHost(url.hostname);
  if (!site) return { error: "invalid_profile" };

  const parts = url.pathname.split("/").filter(Boolean);
  const candidate = parts[0] === "u" || parts[0] === "profile" ? parts[1] : parts.length === 1 ? parts[0] : undefined;
  return candidate && USERNAME_RE.test(candidate) ? { username: candidate, site } : { error: "invalid_profile" };
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

const CN_PROFILE_QUERY = `query ankifyProfile($username: String!) {
  userProfilePublicProfile(userSlug: $username) {
    siteRanking
    profile { userSlug userAvatar }
  }
  userProfileUserQuestionProgress(userSlug: $username) {
    numAcceptedQuestions { difficulty count }
  }
}`;

const CN_ACTIVITY_QUERY = `query ankifyActivity($username: String!) {
  userCalendar(userSlug: $username) { streak totalActiveDays }
  recentACSubmissions(userSlug: $username) {
    submitTime
    question { title translatedTitle titleSlug }
  }
}`;

const cnProfileResponseSchema = z.object({
  data: z.object({
    userProfilePublicProfile: z
      .object({
        siteRanking: z.number().nullable(),
        profile: z.object({ userSlug: z.string(), userAvatar: z.string().nullable() }),
      })
      .nullable(),
    userProfileUserQuestionProgress: z
      .object({ numAcceptedQuestions: z.array(z.object({ difficulty: z.string(), count: z.number() })) })
      .nullable(),
  }),
});

const cnActivityResponseSchema = z.object({
  data: z.object({
    userCalendar: z.object({ streak: z.number(), totalActiveDays: z.number() }),
    recentACSubmissions: z.array(
      z.object({
        submitTime: z.number(),
        question: z.object({ title: z.string(), translatedTitle: z.string().nullable(), titleSlug: z.string() }),
      }),
    ),
  }),
});

/** leetcode.cn has no `matchedUser`: the profile and solved counts live on its
 *  main endpoint, the streak and recent accepted on the other. Those two are
 *  extras, so a failure there still links the account. */
async function fetchLeetcodeCnProfile(username: string): Promise<LeetcodeProfileDto | null> {
  const [main, activity] = await Promise.all([
    leetcodeGraphql(CN_PROFILE_QUERY, { username }, "cn"),
    leetcodeGraphql(CN_ACTIVITY_QUERY, { username }, "cn-noj")
      .then((body) => cnActivityResponseSchema.parse(body).data)
      .catch((error: unknown) => {
        console.warn("[leetcode] leetcode.cn activity lookup failed", error);
        return null;
      }),
  ]);
  const { userProfilePublicProfile: user, userProfileUserQuestionProgress: progress } =
    cnProfileResponseSchema.parse(main).data;
  if (!user) return null;

  const solvedBy = (difficulty: string) =>
    progress?.numAcceptedQuestions.find((row) => row.difficulty === difficulty)?.count ?? 0;
  const [easy, medium, hard] = [solvedBy("EASY"), solvedBy("MEDIUM"), solvedBy("HARD")];
  return {
    username: user.profile.userSlug,
    avatarUrl: user.profile.userAvatar || null,
    ranking: user.siteRanking,
    solved: { all: easy + medium + hard, easy, medium, hard },
    streak: activity?.userCalendar.streak ?? 0,
    activeDays: activity?.userCalendar.totalActiveDays ?? 0,
    recentAccepted: (activity?.recentACSubmissions ?? []).map((row) => ({
      slug: row.question.titleSlug,
      title: row.question.translatedTitle || row.question.title,
      acceptedAt: new Date(row.submitTime * 1000).toISOString(),
    })),
  };
}

/** null when LeetCode says the user doesn't exist; throws when LeetCode is
 *  unreachable or answers in a shape we don't recognise. */
export async function fetchLeetcodeProfile(
  username: string,
  site: LeetcodeSite = "com",
): Promise<LeetcodeProfileDto | null> {
  if (site === "cn") return fetchLeetcodeCnProfile(username);
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

export type CachedLeetcodeAccount = Pick<StoredAccount, "site" | "username" | "profile">;

/** The linked accounts as last fetched, without refetching from LeetCode. */
export async function getCachedLeetcodeAccounts(userId: string): Promise<CachedLeetcodeAccount[]> {
  return readAccounts(userId);
}

/** Where problem links open for someone who hasn't said: leetcode.cn when
 *  that's the only site linked. */
export function preferredLeetcodeSite(accounts: readonly { site: LeetcodeSite }[]): LeetcodeSite {
  return accounts.length > 0 && accounts.every((account) => account.site === "cn") ? "cn" : "com";
}

export async function getPreferredLeetcodeSite(userId: string): Promise<LeetcodeSite> {
  return preferredLeetcodeSite(await readAccounts(userId));
}

async function readAccounts(userId: string): Promise<StoredAccount[]> {
  const rows = await getDb()
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), inArray(schema.settings.key, Object.values(ACCOUNT_KEY))));
  return LEETCODE_SITES.flatMap((site) => {
    const value = rows.find((row) => row.key === ACCOUNT_KEY[site])?.value as Partial<StoredAccount> | undefined;
    if (!value || typeof value.username !== "string") return [];
    return [
      {
        site,
        username: value.username,
        linkedAt: typeof value.linkedAt === "number" ? value.linkedAt : Date.now(),
        fetchedAt: typeof value.fetchedAt === "number" ? value.fetchedAt : null,
        profile: value.profile ?? null,
      },
    ];
  });
}

async function writeAccount(userId: string, { site, ...account }: StoredAccount) {
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: ACCOUNT_KEY[site], value: account })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value: account, updatedAt: new Date() },
    });
}

function toDto(account: StoredAccount): LeetcodeAccountDto {
  return {
    site: account.site,
    username: account.username,
    linkedAt: new Date(account.linkedAt).toISOString(),
    fetchedAt: account.fetchedAt ? new Date(account.fetchedAt).toISOString() : null,
    profile: account.profile,
  };
}

/** The linked accounts, each refreshed from LeetCode when its cache is stale. A
 *  failed refresh keeps serving the cached profile rather than failing the page. */
export async function getLeetcodeAccounts(userId: string): Promise<LeetcodeAccountDto[]> {
  const accounts = await readAccounts(userId);
  return Promise.all(
    accounts.map(async (account) => {
      if (account.fetchedAt && Date.now() - account.fetchedAt < REFRESH_AFTER_MS) return toDto(account);
      try {
        const profile = await fetchLeetcodeProfile(account.username, account.site);
        if (!profile) return toDto(account);
        const next = { ...account, profile, fetchedAt: Date.now() };
        await writeAccount(userId, next);
        return toDto(next);
      } catch (error) {
        console.warn("[leetcode] profile refresh failed", error);
        return toDto(account);
      }
    }),
  );
}

export async function linkLeetcodeAccount(
  userId: string,
  input: string,
): Promise<{ account: LeetcodeAccountDto } | { error: LinkLeetcodeError }> {
  const parsed = parseLeetcodeProfile(input);
  if ("error" in parsed) return parsed;

  let profile: LeetcodeProfileDto | null;
  try {
    profile = await fetchLeetcodeProfile(parsed.username, parsed.site);
  } catch (error) {
    console.warn("[leetcode] link lookup failed", error);
    return { error: "leetcode_unavailable" };
  }
  if (!profile) return { error: "user_not_found" };

  // Store LeetCode's own casing so the profile link and later lookups match.
  const account: StoredAccount = {
    site: parsed.site,
    username: profile.username,
    linkedAt: Date.now(),
    fetchedAt: Date.now(),
    profile,
  };
  await writeAccount(userId, account);
  return { account: toDto(account) };
}

export async function unlinkLeetcodeAccount(userId: string, site: LeetcodeSite) {
  await getDb()
    .delete(schema.settings)
    .where(and(eq(schema.settings.userId, userId), inArray(schema.settings.key, [ACCOUNT_KEY[site], SOLVED_KEY[site]])));
}

type StoredSolved = { username: string; slugs: string[]; syncedAt: number };

export type LeetcodeSolved = { site: LeetcodeSite; username: string; slugs: string[]; syncedAt: string };

/** The extension's latest solved-list snapshot from each site it has seen. */
export async function getLeetcodeSolved(userId: string): Promise<LeetcodeSolved[]> {
  const rows = await getDb()
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), inArray(schema.settings.key, Object.values(SOLVED_KEY))));
  return LEETCODE_SITES.flatMap((site) => {
    const value = rows.find((row) => row.key === SOLVED_KEY[site])?.value as Partial<StoredSolved> | undefined;
    if (!value || typeof value.username !== "string" || !Array.isArray(value.slugs)) return [];
    return [
      {
        site,
        username: value.username,
        slugs: value.slugs.filter((slug): slug is string => typeof slug === "string"),
        syncedAt: new Date(typeof value.syncedAt === "number" ? value.syncedAt : 0).toISOString(),
      },
    ];
  });
}

/** Store the extension's solved list and link the LeetCode account it came
 *  from. The extension reads the username from the signed-in LeetCode
 *  session, so it replaces a different manually linked name on that site. */
export async function saveLeetcodeSolved(
  userId: string,
  site: LeetcodeSite,
  username: string,
  slugs: string[],
): Promise<{ username: string; count: number } | { error: LinkLeetcodeError }> {
  if (!USERNAME_RE.test(username)) return { error: "invalid_profile" };

  const current = (await readAccounts(userId)).find((account) => account.site === site);
  if (!current || current.username.toLowerCase() !== username.toLowerCase()) {
    let profile: LeetcodeProfileDto | null = null;
    try {
      profile = await fetchLeetcodeProfile(username, site);
    } catch (error) {
      // Link anyway; getLeetcodeAccounts retries the profile on the next read.
      console.warn("[leetcode] profile lookup during solved sync failed", error);
    }
    await writeAccount(userId, {
      site,
      username: profile?.username ?? username,
      linkedAt: Date.now(),
      fetchedAt: profile ? Date.now() : null,
      profile,
    });
  }

  const value: StoredSolved = { username, slugs: [...new Set(slugs)], syncedAt: Date.now() };
  await getDb()
    .insert(schema.settings)
    .values({ userId, key: SOLVED_KEY[site], value })
    .onConflictDoUpdate({
      target: [schema.settings.userId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
  return { username, count: value.slugs.length };
}
