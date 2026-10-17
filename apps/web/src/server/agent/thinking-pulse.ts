/** About how often a long think shows it's still going. */
export const THINKING_PULSE_INTERVAL_MS = 2_000;

/**
 * Turns the model's reasoning stream into a liveness signal: a pulse on a
 * step's first reasoning delta, then at most one per interval while it keeps
 * reasoning. Only the timing leaves; the reasoning text is never read.
 */
export function createThinkingPulse(
  emit: () => void,
  { intervalMs = THINKING_PULSE_INTERVAL_MS, now = Date.now }: { intervalMs?: number; now?: () => number } = {},
) {
  let lastAt: number | null = null;

  return {
    /** A new step pulses on its first reasoning delta again. */
    startStep() {
      lastAt = null;
    },
    reasoning() {
      const at = now();
      if (lastAt !== null && at - lastAt < intervalMs) return;
      lastAt = at;
      emit();
    },
  };
}
