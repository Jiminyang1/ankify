import { describe, expect, it } from "vitest";
import { parseLeetcodeProfile } from "./leetcode-account";

describe("parseLeetcodeProfile", () => {
  it.each([
    ["Jimmy_Y", "Jimmy_Y"],
    ["@Jimmy_Y", "Jimmy_Y"],
    ["https://leetcode.com/u/Jimmy_Y/", "Jimmy_Y"],
    ["leetcode.com/u/Jimmy_Y", "Jimmy_Y"],
    ["https://www.leetcode.com/u/Jimmy_Y/?tab=solutions", "Jimmy_Y"],
    ["https://leetcode.com/Jimmy_Y/", "Jimmy_Y"],
    ["john.doe", "john.doe"],
  ])("reads %s", (input, username) => {
    expect(parseLeetcodeProfile(input)).toEqual({ username });
  });

  it.each([
    ["", "invalid_profile"],
    ["https://github.com/Jimmy_Y", "invalid_profile"],
    ["https://leetcode.com/problems/two-sum/", "invalid_profile"],
    ["https://leetcode.com/u/", "invalid_profile"],
    ["https://leetcode.cn/u/jimmy/", "unsupported_site"],
    ["has space", "invalid_profile"],
  ])("rejects %s", (input, error) => {
    expect(parseLeetcodeProfile(input)).toEqual({ error });
  });
});
