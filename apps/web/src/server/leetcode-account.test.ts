import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLeetcodeProfile, parseLeetcodeProfile, preferredLeetcodeSite } from "./leetcode-account";

/** Answers shaped like leetcode.cn's live responses (2026-11-01). */
function stubLeetcodeCn(main: unknown, activity: unknown) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const body = String(url).endsWith("/noj-go/") ? activity : main;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const cnProfile = {
  data: {
    userProfilePublicProfile: {
      siteRanking: 2,
      profile: { userSlug: "endlesscheng", userAvatar: "https://assets.leetcode.cn/a.png" },
    },
    userProfileUserQuestionProgress: {
      numAcceptedQuestions: [
        { difficulty: "EASY", count: 1095 },
        { difficulty: "MEDIUM", count: 2336 },
        { difficulty: "HARD", count: 1057 },
      ],
    },
  },
};
const cnActivity = {
  data: {
    userCalendar: { streak: 366, totalActiveDays: 366 },
    recentACSubmissions: [
      {
        submitTime: 1793588805,
        question: { title: "Path Sum II", translatedTitle: "路径总和 II", titleSlug: "path-sum-ii" },
      },
    ],
  },
};

describe("fetchLeetcodeProfile on leetcode.cn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the profile from both endpoints", async () => {
    const fetchMock = stubLeetcodeCn(cnProfile, cnActivity);
    await expect(fetchLeetcodeProfile("endlesscheng", "cn")).resolves.toEqual({
      username: "endlesscheng",
      avatarUrl: "https://assets.leetcode.cn/a.png",
      ranking: 2,
      solved: { all: 4488, easy: 1095, medium: 2336, hard: 1057 },
      streak: 366,
      activeDays: 366,
      recentAccepted: [
        { slug: "path-sum-ii", title: "路径总和 II", acceptedAt: new Date(1793588805 * 1000).toISOString() },
      ],
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      "https://leetcode.cn/graphql/",
      "https://leetcode.cn/graphql/noj-go/",
    ]);
  });

  it("is null for a user who doesn't exist", async () => {
    stubLeetcodeCn(
      { data: { userProfilePublicProfile: null, userProfileUserQuestionProgress: { numAcceptedQuestions: [] } } },
      { errors: [{ message: "must not be null", path: ["userCalendar"] }], data: null },
    );
    await expect(fetchLeetcodeProfile("nobody", "cn")).resolves.toBeNull();
  });

  it("keeps the profile when the activity endpoint fails", async () => {
    stubLeetcodeCn(cnProfile, { errors: [{ message: "nope" }], data: null });
    const profile = await fetchLeetcodeProfile("endlesscheng", "cn");
    expect(profile).toMatchObject({ username: "endlesscheng", streak: 0, recentAccepted: [] });
    expect(profile?.solved.all).toBe(4488);
  });
});

describe("preferredLeetcodeSite", () => {
  it("is leetcode.cn only when that's the only site linked", () => {
    expect(preferredLeetcodeSite([])).toBe("com");
    expect(preferredLeetcodeSite([{ site: "com" }])).toBe("com");
    expect(preferredLeetcodeSite([{ site: "cn" }])).toBe("cn");
    expect(preferredLeetcodeSite([{ site: "com" }, { site: "cn" }])).toBe("com");
  });
});

describe("parseLeetcodeProfile", () => {
  it.each([
    ["Jimmy_Y", "Jimmy_Y"],
    ["@Jimmy_Y", "Jimmy_Y"],
    ["https://leetcode.com/u/Jimmy_Y/", "Jimmy_Y"],
    ["leetcode.com/u/Jimmy_Y", "Jimmy_Y"],
    ["https://www.leetcode.com/u/Jimmy_Y/?tab=solutions", "Jimmy_Y"],
    ["https://leetcode.com/Jimmy_Y/", "Jimmy_Y"],
    ["john.doe", "john.doe"],
    ["_private", "_private"],
  ])("reads %s on leetcode.com", (input, username) => {
    expect(parseLeetcodeProfile(input)).toEqual({ username, site: "com" });
  });

  it.each([
    ["https://leetcode.cn/u/endlesscheng/", "endlesscheng"],
    ["leetcode.cn/u/endlesscheng", "endlesscheng"],
    ["https://www.leetcode.cn/u/endlesscheng/?tab=solutions", "endlesscheng"],
    ["https://leetcode-cn.com/u/endlesscheng/", "endlesscheng"],
    ["https://leetcode.cn/endlesscheng/", "endlesscheng"],
  ])("reads %s on leetcode.cn", (input, username) => {
    expect(parseLeetcodeProfile(input)).toEqual({ username, site: "cn" });
  });

  it.each([
    ["", "invalid_profile"],
    ["https://github.com/Jimmy_Y", "invalid_profile"],
    ["https://leetcode.com/problems/two-sum/", "invalid_profile"],
    ["https://leetcode.com/u/", "invalid_profile"],
    ["https://leetcode.cn/problems/two-sum/", "invalid_profile"],
    ["has space", "invalid_profile"],
  ])("rejects %s", (input, error) => {
    expect(parseLeetcodeProfile(input)).toEqual({ error });
  });
});
