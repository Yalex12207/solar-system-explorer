/**
 * Deterministic value noise used by the procedural texture generator.
 *
 * Everything is seeded, so a given body always renders identically between
 * reloads — important for a project that ships no bitmap assets.
 */

/** mulberry32 — small, fast, good-enough PRNG. */
export function createRandom(seed = 1) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert any string into a stable 32-bit seed. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PERM_SIZE = 256;

class Noise {
  constructor(seed) {
    const random = createRandom(seed);
    const perm = new Uint8Array(PERM_SIZE * 2);
    const base = new Uint8Array(PERM_SIZE);
    for (let i = 0; i < PERM_SIZE; i += 1) base[i] = i;
    for (let i = PERM_SIZE - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }
    for (let i = 0; i < PERM_SIZE * 2; i += 1) perm[i] = base[i & (PERM_SIZE - 1)];
    this.perm = perm;
  }

  /** Gradient noise in 3D, output roughly in [-1, 1]. */
  noise3(x, y, z) {
    const p = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;

    const grad = (hash, gx, gy, gz) => {
      const h = p[hash & 255] & 15;
      const gxA = h & 1 ? -gx : gx;
      const gyA = h & 2 ? -gy : gy;
      const gzA = h & 4 ? -gz : gz;
      return gxA + gyA + gzA;
    };

    const x1 = lerp(grad(AA, fx, fy, fz), grad(BA, fx - 1, fy, fz), u);
    const x2 = lerp(grad(AB, fx, fy - 1, fz), grad(BB, fx - 1, fy - 1, fz), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(grad(AA + 1, fx, fy, fz - 1), grad(BA + 1, fx - 1, fy, fz - 1), u);
    const x4 = lerp(grad(AB + 1, fx, fy - 1, fz - 1), grad(BB + 1, fx - 1, fy - 1, fz - 1), u);
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w) * 0.62;
  }

  /** Fractal Brownian motion — stacked octaves of noise3. */
  fbm(x, y, z, octaves = 5, lacunarity = 2.03, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal — produces mountain-chain / filament structures. */
  ridged(x, y, z, octaves = 5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      const n = 1 - Math.abs(this.noise3(x * freq, y * freq, z * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return sum / norm;
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

const noiseCache = new Map();
/** Cached Noise instance per seed string so repeated builds stay cheap. */
export function getNoise(seedKey) {
  if (!noiseCache.has(seedKey)) noiseCache.set(seedKey, new Noise(hashSeed(seedKey)));
  return noiseCache.get(seedKey);
}

export { lerp };
