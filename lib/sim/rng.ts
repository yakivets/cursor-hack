// Deterministic seeded RNG (mulberry32). Same seed → same stream forever.
// We use a u32 seed so it survives JSON round-trips through Redis cleanly.

/** Returns a function that yields uniform floats in [0, 1) on each call. */
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

export type Rng = () => number;

/** Inclusive integer in `[min, max]`. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

/** Float in `[min, max)`. */
export function randFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** True with probability p ∈ [0, 1]. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Pick one element uniformly. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick: empty array");
  return items[Math.floor(rng() * items.length)];
}
