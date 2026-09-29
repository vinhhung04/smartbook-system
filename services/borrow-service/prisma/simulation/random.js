// Seeded randomness for the behavioural simulation. Every random draw in
// prisma/simulation/ goes through an Rng created here - never the unseeded
// global Math PRNG - so the same seed reproduces the same population, events, dates, labels and
// (because ids come from their own seeded stream) the same primary keys.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a - turns a string (e.g. a book id) into a stable 32-bit seed, used for
// per-entity attributes that must not depend on generation order.
function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function sigmoid(z) {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function createRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Box-Muller.
    gaussian: (mean = 0, sd = 1) => {
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    exponential: (mean) => -Math.log(1 - next() * 0.999999) * mean,
    // Index drawn proportionally to non-negative weights.
    weightedIndex: (weights) => {
      let total = 0;
      for (const w of weights) total += w;
      if (total <= 0) return Math.floor(next() * weights.length);
      let r = next() * total;
      for (let i = 0; i < weights.length; i += 1) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    // Key drawn from a { key: weight } table (insertion order is part of the
    // reproducibility contract - tables live in config/personas).
    weightedKey: (table) => {
      const keys = Object.keys(table);
      return keys[rng.weightedIndex(keys.map((k) => table[k]))];
    },
    // Gamma(shape, 1) via Marsaglia-Tsang (shape >= 1) - used for mean-one
    // burstiness multipliers.
    gamma: (shape) => {
      const d = shape - 1 / 3;
      const c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x;
        let v;
        do {
          x = rng.gaussian();
          v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = next();
        if (u < 1 - 0.0331 * x ** 4) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
      }
    },
    // RFC 4122 v4-shaped UUID from the seeded stream (reproducible ids).
    uuid: () => {
      const hex = [];
      for (let i = 0; i < 16; i += 1) hex.push(Math.floor(next() * 256));
      hex[6] = (hex[6] & 0x0f) | 0x40;
      hex[8] = (hex[8] & 0x3f) | 0x80;
      const s = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
  };
  return rng;
}

module.exports = { mulberry32, hashString, sigmoid, clamp, createRng };
