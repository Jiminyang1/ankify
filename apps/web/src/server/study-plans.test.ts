import { describe, expect, it } from "vitest";
import { parseLeetcodeListLink } from "./study-plans";

describe("parseLeetcodeListLink", () => {
  it.each([
    ["https://leetcode.com/problem-list/xoqag3yj/", "xoqag3yj"],
    ["leetcode.com/problem-list/xoqag3yj", "xoqag3yj"],
    ["https://www.leetcode.com/problem-list/xoqag3yj/?page=2", "xoqag3yj"],
    ["https://leetcode.com/list/xi4ci4ig", "xi4ci4ig"],
    ["xoqag3yj", "xoqag3yj"],
  ])("reads %s", (input, slug) => {
    expect(parseLeetcodeListLink(input)).toEqual({ slug });
  });

  it.each([
    ["", "invalid_link"],
    ["https://leetcode.com/problems/two-sum/", "invalid_link"],
    ["https://github.com/problem-list/xoqag3yj", "invalid_link"],
    ["https://leetcode.cn/problem-list/abc12345/", "unsupported_site"],
    ["not a link", "invalid_link"],
  ])("rejects %s", (input, error) => {
    expect(parseLeetcodeListLink(input)).toEqual({ error });
  });
});
