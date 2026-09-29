/** 32-bit FNV-1a hash of a string. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG: small, fast, and good enough to decorrelate hashes. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stable number in [0, 1) for one key under one seed. Keyed rather than
 * sequential, so the result never depends on the order candidates are visited.
 */
export function unitHash(seed: string, key: string): number {
  return mulberry32(fnv1a32(`${seed}|${key}`))();
}
