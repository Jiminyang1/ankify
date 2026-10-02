import { describe, expect, it } from "vitest";
import { formatRelative } from "./utils";

describe("formatRelative", () => {
  it("reads the clock it is given, so the server render and hydration agree", () => {
    const due = "2026-10-01T12:00:00.000Z";
    const serverNow = Date.parse("2026-10-01T12:00:30.000Z");
    // Seconds later, the client's own clock would say "1m ago"; with the server's snapshot it matches.
    expect(formatRelative(due, serverNow)).toBe("now");
    expect(formatRelative(due, serverNow + 60_000)).toBe("2m ago");
    expect(formatRelative("2026-10-04T12:00:00.000Z", serverNow)).toBe("in 3d");
    expect(formatRelative(null, serverNow)).toBe("—");
  });
});
