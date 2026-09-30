/**
 * Estimates foreground activity for a tracked session without reading any
 * input: time is "observed" while the tracker runs and "active" while the page
 * is visible and focused. Each interval is attributed to the state it began
 * in, and gaps longer than `maxGapMs` (sleep, a suspended tab) are excluded
 * entirely rather than guessed. The result is an estimate, never solving time.
 */
export const MAX_OBSERVED_GAP_MS = 2 * 60_000;

export function createActivityMeter(deps: { now: () => number; isActive: () => boolean; maxGapMs?: number }) {
  const maxGapMs = deps.maxGapMs ?? MAX_OBSERVED_GAP_MS;
  let lastAt = deps.now();
  let lastActive = deps.isActive();
  let activeMs = 0;
  let observedMs = 0;

  return {
    /** Closes the interval since the previous sample, crediting it to the state
     *  recorded then, and records the current state. Call on every tick and in
     *  visibility/focus handlers (where the new state is already in effect). */
    sample() {
      const at = deps.now();
      const elapsed = at - lastAt;
      if (elapsed > 0 && elapsed <= maxGapMs) {
        observedMs += elapsed;
        if (lastActive) activeMs += elapsed;
      }
      lastAt = at;
      lastActive = deps.isActive();
    },
    /** Returns the time accumulated since the previous call and resets it. */
    take() {
      const delta = { activeMs: Math.round(activeMs), observedMs: Math.round(observedMs) };
      activeMs = 0;
      observedMs = 0;
      return delta;
    },
  };
}
