/**
 * Deterministic PRNG used to seed the procurement mock dataset.
 *
 * mulberry32 — small, fast, 32-bit period, good enough for fixtures
 * that need to be reproducible across runs (CI, dev, Playwright).
 *
 * NOT cryptographic. Do not use outside of seed data.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function randint(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function chance(rand: () => number, p: number): boolean {
  return rand() < p;
}
