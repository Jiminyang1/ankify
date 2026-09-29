import type { SkillDimension } from "../skills";
import type { FeedParams } from "./params";

/** A slot recipient: one weak dimension, or the shared check-up type. */
export type FeedTypeKey = SkillDimension | "checkup";

function normalize<K>(weights: ReadonlyMap<K, number>): Map<K, number> {
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  const n = weights.size;
  return new Map([...weights].map(([key, value]) => [key, total > 0 ? value / total : 1 / n]));
}

/**
 * Proportional shares clamped to [floor, cap] by water-filling: values above
 * the cap are pinned first and their excess flows to the rest, then values
 * below the floor are pinned. Bounds widen to 1/n when they can't all hold.
 */
export function clampShares<K>(weights: ReadonlyMap<K, number>, floor: number, cap: number): Map<K, number> {
  const n = weights.size;
  if (n === 0) return new Map();
  const low = Math.min(floor, 1 / n);
  const high = Math.max(cap, 1 / n);
  const pinned = new Map<K, number>();

  const distribute = () => {
    const free = [...weights].filter(([key]) => !pinned.has(key));
    const remaining = 1 - [...pinned.values()].reduce((sum, value) => sum + value, 0);
    const freeTotal = free.reduce((sum, [, value]) => sum + value, 0);
    return new Map(
      free.map(([key, value]) => [key, freeTotal > 0 ? (remaining * value) / freeTotal : remaining / free.length]),
    );
  };

  for (const [bound, violates] of [
    [high, (share: number) => share > high + 1e-12],
    [low, (share: number) => share < low - 1e-12],
  ] as const) {
    for (let round = 0; round < n; round += 1) {
      const over = [...distribute()].filter(([, share]) => violates(share));
      if (over.length === 0) break;
      for (const [key] of over) pinned.set(key, bound);
    }
  }

  const free = distribute();
  return normalize(new Map([...weights.keys()].map((key) => [key, pinned.get(key) ?? free.get(key)!])));
}

/** Shares of every type for today: weak dimensions split `weakPoolShare` by
 *  weakness; check-up gets the rest, or everything when nothing is weak. */
export function typeShares(
  weakness: ReadonlyMap<SkillDimension, number>,
  params: FeedParams,
): Map<FeedTypeKey, number> {
  const shares = new Map<FeedTypeKey, number>();
  if (weakness.size === 0) {
    shares.set("checkup", 1);
    return shares;
  }
  const split = weakness.size >= 2 ? clampShares(weakness, params.shareFloor, params.shareCap) : normalize(weakness);
  for (const [dimension, share] of split) shares.set(dimension, share * params.weakPoolShare);
  shares.set("checkup", params.checkupShare);
  return shares;
}

/** `deficit_x = share_x · (Σ served + slots) − served_x`. */
export function deficits<K>(
  shares: ReadonlyMap<K, number>,
  served: ReadonlyMap<K, number>,
  slots: number,
): Map<K, number> {
  let total = slots;
  for (const key of shares.keys()) total += served.get(key) ?? 0;
  return new Map([...shares].map(([key, share]) => [key, share * total - (served.get(key) ?? 0)]));
}

/**
 * The type with the largest deficit among those not exhausted. While another
 * type still has room, types that already reached `perDayCap` today sit out.
 */
export function nextType<K>({
  deficit,
  servedToday,
  exhausted,
  perDayCap,
  tieBreak,
}: {
  deficit: ReadonlyMap<K, number>;
  servedToday: ReadonlyMap<K, number>;
  exhausted: ReadonlySet<K>;
  perDayCap: number;
  tieBreak: (key: K) => number;
}): K | null {
  const available = [...deficit.keys()].filter((key) => !exhausted.has(key));
  if (available.length === 0) return null;
  const underCap = available.filter((key) => (servedToday.get(key) ?? 0) < perDayCap);
  const pool = underCap.length > 0 ? underCap : available;
  return pool.reduce((best, key) => {
    const difference = deficit.get(key)! - deficit.get(best)!;
    if (Math.abs(difference) > 1e-9) return difference > 0 ? key : best;
    return tieBreak(key) > tieBreak(best) ? key : best;
  });
}
