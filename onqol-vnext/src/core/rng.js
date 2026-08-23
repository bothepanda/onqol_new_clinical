/**
 * Seeded randomness.
 *
 * Every stochastic decision in ON QOL - which phenotype, which age, which lab
 * value inside a reviewed range, whether a probabilistic complication fires -
 * goes through one of these streams. Nothing calls Math.random().
 *
 * NAMED STREAMS. A generator drawn from `rng.stream("labs")` is independent of
 * `rng.stream("complications")`. That matters for replay stability: adding a
 * new draw to patient generation must not shift the complication rolls of an
 * existing seed, or every stored replay silently becomes a different case.
 */

const UINT32 = 0x100000000;

/** FNV-1a. Small, stable across engines, and enough to key a PRNG. */
export function hashSeed(text) {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: one 32-bit state word, uniform output, trivially reproducible. */
function mulberry32(state) {
  let a = state >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/** A single independent stream of draws. */
export function createStream(seedText) {
  const next = mulberry32(hashSeed(seedText));

  const stream = {
    /** Uniform in [0, 1). */
    float: () => next(),
    /** Uniform integer in [min, max] inclusive. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** Uniform in [min, max], rounded to `decimals`. */
    range: (min, max, decimals = 1) => {
      const raw = min + next() * (max - min);
      const factor = 10 ** decimals;
      return Math.round(raw * factor) / factor;
    },
    /**
     * A value inside `[min, max]` biased toward the centre. Used where a
     * reviewed envelope is wide but the extremes are genuinely uncommon, so a
     * uniform draw would over-represent them.
     */
    centred: (min, max, decimals = 1) => {
      const mid = (next() + next() + next()) / 3;
      const raw = min + mid * (max - min);
      const factor = 10 ** decimals;
      return Math.round(raw * factor) / factor;
    },
    pick: (items) => items[Math.floor(next() * items.length)],
    /** True with probability `p`. */
    chance: (p) => next() < p,
    /** Weighted pick over `[{ weight, value }]`. */
    weighted: (entries) => {
      const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
      let target = next() * total;
      for (const entry of entries) {
        target -= entry.weight;
        if (target <= 0) return entry.value;
      }
      return entries[entries.length - 1].value;
    },
  };

  return stream;
}

/**
 * A seed with named sub-streams.
 *
 * @param {string} seedText session seed, e.g. "app-2026-08-22-7f3a"
 */
export function createRng(seedText) {
  const streams = new Map();
  return {
    seed: seedText,
    stream(name) {
      if (!streams.has(name)) streams.set(name, createStream(`${seedText}::${name}`));
      return streams.get(name);
    },
  };
}
