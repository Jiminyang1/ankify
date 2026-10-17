import { describe, expect, it } from "vitest";
import { createThinkingPulse } from "./thinking-pulse";

function setup() {
  let clock = 0;
  const pulses: number[] = [];
  const pulse = createThinkingPulse(() => pulses.push(clock), { intervalMs: 2_000, now: () => clock });
  return {
    pulse,
    pulses,
    at(ms: number) {
      clock = ms;
    },
  };
}

describe("createThinkingPulse", () => {
  it("pulses on the first reasoning delta, then about once per interval", () => {
    const { pulse, pulses, at } = setup();
    for (const ms of [0, 100, 500, 1_999, 2_000, 2_100, 3_999, 4_000, 7_500]) {
      at(ms);
      pulse.reasoning();
    }
    expect(pulses).toEqual([0, 2_000, 4_000, 7_500]);
  });

  it("pulses again on a new step's first reasoning delta", () => {
    const { pulse, pulses, at } = setup();
    at(0);
    pulse.reasoning();
    at(500);
    pulse.startStep();
    pulse.reasoning();
    at(600);
    pulse.reasoning();
    expect(pulses).toEqual([0, 500]);
  });

  it("stays quiet when the model never reasons", () => {
    const { pulse, pulses } = setup();
    pulse.startStep();
    pulse.startStep();
    expect(pulses).toEqual([]);
  });
});
