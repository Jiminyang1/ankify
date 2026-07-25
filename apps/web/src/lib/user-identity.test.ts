import { describe, expect, it } from "vitest";
import { getUserDisplayName, getUserFirstName } from "./user-identity";

describe("user identity display", () => {
  it("removes empty OAuth name placeholders", () => {
    expect(getUserDisplayName("jimin null", "jimin@example.com")).toBe("jimin");
    expect(getUserDisplayName("undefined Yang", "jimin@example.com")).toBe("Yang");
  });

  it("falls back to the email handle when the name is empty", () => {
    expect(getUserDisplayName(" null ", "jimin@example.com")).toBe("jimin");
  });

  it("uses the first clean name token for greetings", () => {
    expect(getUserFirstName("Jimin Yang", "jimin@example.com")).toBe("Jimin");
  });
});
