import { describe, expect, it } from "vitest";
import { formatDateKeyInTimeZone, getZonedDayBounds, isValidTimeZone } from "./time-zone";

describe("IANA review-day boundaries", () => {
  it("uses Shanghai midnight rather than server midnight", () => {
    const bounds = getZonedDayBounds("Asia/Shanghai", new Date("2026-07-17T12:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-07-16T16:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-17T16:00:00.000Z");
  });

  it("handles the 23-hour DST start day", () => {
    const bounds = getZonedDayBounds("America/New_York", new Date("2026-03-08T16:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("handles the 25-hour DST end day", () => {
    const bounds = getZonedDayBounds("America/New_York", new Date("2026-11-01T16:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("groups events by the user's local calendar date", () => {
    const event = new Date("2026-07-16T16:30:00.000Z");
    expect(formatDateKeyInTimeZone(event, "Asia/Shanghai")).toBe("2026-07-17");
    expect(formatDateKeyInTimeZone(event, "UTC")).toBe("2026-07-16");
  });

  it("rejects invalid zones", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
