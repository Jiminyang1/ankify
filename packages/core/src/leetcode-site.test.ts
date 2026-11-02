import { describe, expect, it } from "vitest";
import { leetcodeProblemUrl, leetcodeSiteOfHost, parseLeetcodeProblemUrl } from "./leetcode-site";

describe("leetcode sites", () => {
  it("names the site of a host", () => {
    expect(leetcodeSiteOfHost("leetcode.com")).toBe("com");
    expect(leetcodeSiteOfHost("www.leetcode.com")).toBe("com");
    expect(leetcodeSiteOfHost("LeetCode.cn")).toBe("cn");
    expect(leetcodeSiteOfHost("leetcode-cn.com")).toBe("cn");
    expect(leetcodeSiteOfHost("leetcode.com.evil.test")).toBeNull();
    expect(leetcodeSiteOfHost("example.com")).toBeNull();
  });

  it("reads the site and slug of a problem page", () => {
    expect(parseLeetcodeProblemUrl("https://leetcode.com/problems/two-sum/description/")).toEqual({
      site: "com",
      slug: "two-sum",
    });
    expect(parseLeetcodeProblemUrl("https://leetcode.cn/problems/cnHoX6/?envType=x")).toEqual({
      site: "cn",
      slug: "cnHoX6",
    });
    expect(parseLeetcodeProblemUrl("https://leetcode.cn/circle/discuss/abc/")).toBeNull();
    expect(parseLeetcodeProblemUrl("https://example.com/problems/two-sum/")).toBeNull();
    expect(parseLeetcodeProblemUrl("https://example.com/leetcode.com/problems/two-sum/")).toBeNull();
    expect(parseLeetcodeProblemUrl(undefined)).toBeNull();
  });

  it("builds a problem link on either site", () => {
    expect(leetcodeProblemUrl("two-sum", "com")).toBe("https://leetcode.com/problems/two-sum/");
    expect(leetcodeProblemUrl("cnHoX6", "cn")).toBe("https://leetcode.cn/problems/cnHoX6/");
  });
});
