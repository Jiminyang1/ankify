import { describe, expect, it } from "vitest";
import { relativeTimeLabel } from "./time-labels";

const now = new Date("2026-09-26T12:00:00Z");
const offset = (ms: number) => new Date(now.getTime() + ms);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTimeLabel", () => {
  it("collapses tiny offsets to just now", () => {
    expect(relativeTimeLabel(offset(-20_000), now)).toBe("just now");
  });

  it("describes past times", () => {
    expect(relativeTimeLabel(offset(-1 * MINUTE), now)).toBe("1 minute ago");
    expect(relativeTimeLabel(offset(-3 * HOUR), now)).toBe("3 hours ago");
    expect(relativeTimeLabel(offset(-9 * DAY), now)).toBe("9 days ago");
    expect(relativeTimeLabel(offset(-40 * DAY), now)).toBe("about 6 weeks ago");
    expect(relativeTimeLabel(offset(-120 * DAY), now)).toBe("about 4 months ago");
    expect(relativeTimeLabel(offset(-800 * DAY), now)).toBe("about 2 years ago");
  });

  it("describes future times", () => {
    expect(relativeTimeLabel(offset(1 * DAY), now)).toBe("in 1 day");
    expect(relativeTimeLabel(offset(5 * HOUR), now)).toBe("in 5 hours");
  });
});
