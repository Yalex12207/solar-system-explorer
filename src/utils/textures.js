/**
 * Procedural texture factory.
 *
 * The project ships no bitmap assets: every surface is generated on the fly with
 * seeded value noise, so the app works fully offline, has no 404 texture paths,
 * and can never fail a texture load. Swap in real NASA imagery later by replacing
 * the returned THREE.Texture — the API is intentionally narrow.
 *
 * All colour maps are equirectangular (u = longitude, v = latitude).
 */

import * as THREE from 'three';
import { getNoise, lerp } from './noise.js';

/** Radial gradient sprite used for coronas, sun glow and selection halos. */
export function glowTexture(stops) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const list = stops || [
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,242,214,0.85)'],
    [0.42, 'rgba(255,186,90,0.3)'],
    [0.72, 'rgba(255,140,40,0.07)'],
    [1, 'rgba(255,120,0,0)'],
  ];
  for (const [offset, color] of list) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Soft round particle sprite for the star field. */
export function starSpriteTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.55, 'rgba(216,228,255,0.12)');
  gradient.addColorStop(1, 'rgba(180,200,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Build a colour ramp sampler from an ordered palette. */
function rampFrom(palette) {
  const stops = palette.map(hexToRgb);
  return (t) => {
    const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const scaled = clamped * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(scaled));
    const f = scaled - index;
    const a = stops[index];
    const b = stops[index + 1];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  };
}

function makeTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  return { canvas, ctx, image, data: image.data, width, height };
}

function finish({ canvas, ctx, image }, { bumpCanvas, repeatX = 1, anisotropy = 4 } = {}) {
  ctx.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.repeat.x = repeatX;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;

  let bumpMap = null;
  if (bumpCanvas) {
    bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.anisotropy = anisotropy;
    bumpMap.needsUpdate = true;
  }
  return { map, bumpMap };
}

/** Draw craters onto a 2D context — cheap way to add impact geology. */
function stampCraters(ctx, random, count, width, height, options = {}) {
  const { minR = 2, maxR = 16, tint = '255,255,255', strength = 0.16 } = options;
  for (let i = 0; i < count; i += 1) {
    const x = random() * width;
    const y = height * 0.08 + random() * height * 0.84;
    const r = minR + random() * (maxR - minR);
    const gradient = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    gradient.addColorStop(0, `rgba(${tint},${strength})`);
    gradient.addColorStop(0.62, `rgba(0,0,0,${strength * 0.75})`);
    gradient.addColorStop(0.88, `rgba(${tint},${strength * 0.5})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ————————————————————————————————————————————————————————————————
// Surface generators
// ————————————————————————————————————————————————————————————————

/**
 * Shared sphere-noise sampler: maps equirectangular UV onto the unit sphere so
 * every texture tiles seamlessly at the 0/1 longitude seam.
 */
function sphereSampler(u, v) {
  const theta = v * Math.PI;
  const phi = u * Math.PI * 2;
  const sinT = Math.sin(theta);
  return {
    x: Math.cos(phi) * sinT,
    y: Math.cos(theta),
    z: Math.sin(phi) * sinT,
  };
}

function rockySurface(config) {
  const {
    seed,
    palette,
    size = [1024, 512],
    scale = 3.2,
    octaves = 6,
    ridgeMix = 0.45,
    craters = 160,
    craterTint = '255,255,255',
    polar = null,
    roughness = 1,
  } = config;
  const [width, height] = size;
  const noise = getNoise(`${seed}-rock`);
  const ramp = rampFrom(palette);
  const buffer = makeTexture(width, height);
  const { data } = buffer;
  const bump = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const p = sphereSampler(u, v);
      const n = noise.fbm(p.x * scale, p.y * scale, p.z * scale, octaves);
      const r = noise.ridged(p.x * scale * 1.7, p.y * scale * 1.7, p.z * scale * 1.7, 4);
      let t = 0.5 + 0.5 * lerp(n, r * 2 - 1, ridgeMix);
      if (polar) {
        const lat = Math.abs(v - 0.5) * 2;
        const cap = Math.max(0, (lat - polar.start) / (1 - polar.start));
        t = lerp(t, polar.value, Math.min(1, cap * polar.strength));
      }
      const [rr, gg, bb] = ramp(t);
      const index = (y * width + x) * 4;
      data[index] = rr;
      data[index + 1] = gg;
      data[index + 2] = bb;
      data[index + 3] = 255;
      bump[y * width + x] = t * 255;
    }
  }

  const { ctx, canvas } = buffer;
  ctx.putImageData(buffer.image, 0, 0);

  // Craters: subtle radial stamps on top of the noise field.
  ctx.globalCompositeOperation = 'source-over';
  stampCraters(ctx, craterNoiseRandom(seed), craters, width, height, {
    tint: craterTint,
    strength: 0.2,
    minR: width / 220,
    maxR: width / 48,
  });
  if (roughness < 1) {
    ctx.fillStyle = `rgba(0,0,0,${(1 - roughness) * 0.2})`;
    ctx.fillRect(0, 0, width, height);
  }

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bumpCtx = bumpCanvas.getContext('2d');
  const bumpImage = bumpCtx.createImageData(width, height);
  for (let i = 0; i < bump.length; i += 1) {
    const index = i * 4;
    bumpImage.data[index] = bump[i];
    bumpImage.data[index + 1] = bump[i];
    bumpImage.data[index + 2] = bump[i];
    bumpImage.data[index + 3] = 255;
  }
  bumpCtx.putImageData(bumpImage, 0, 0);

  return finish(buffer, { bumpCanvas });
}

/** Tiny deterministic random generator for decoration passes. */
function craterNoiseRandom(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i += 1) a = (a * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function bandedGiant(config) {
  const {
    seed,
    palette,
    size = [1024, 512],
    bands = 12,
    turbulence = 0.6,
    detail = 3.4,
    spot = null,
    stormLatitude = 0.34,
  } = config;
  const [width, height] = size;
  const noise = getNoise(`${seed}-bands`);
  const warp = getNoise(`${seed}-warp`);
  const ramp = rampFrom(palette);
  const buffer = makeTexture(width, height);
  const { data } = buffer;

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const latitude = (v - 0.5) * Math.PI;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const p = sphereSampler(u, v);
      // Warp the latitude coordinate so bands ripple like real jet streams.
      const w = warp.fbm(p.x * 1.6, p.y * 2.4, p.z * 1.6, 4) * turbulence;
      const bandValue = Math.sin((latitude + w) * bands);
      const fine = noise.fbm(p.x * detail, p.y * detail * 2.2, p.z * detail, 5) * 0.5;
      /**
       * Band mixing.
       *
       * The oscillation used to span ±0.78 around the midpoint, so roughly half of the
       * surface sampled the palette's darkest entry and a gas giant came out dark
       * brown. The bands are compressed and biased upward here: bright zones dominate,
       * dark belts are the minority, which is how Jupiter actually looks.
       */
      let t = 0.62 + 0.5 * bandValue * 0.5 + fine * 0.26 + w * 0.05;

      if (spot) {
        const dx = (u - spot.u) * (u - spot.u);
        const dy = (v - (0.5 + stormLatitude * 0.5)) * (v - (0.5 + stormLatitude * 0.5));
        const d = Math.sqrt(dx / (spot.rx * spot.rx) + dy / (spot.ry * spot.ry));
        const swirl = 1 - Math.min(1, Math.pow(d, spot.falloff || 1.6));
        if (swirl > 0.001) {
          t = lerp(t, spot.value, swirl * 0.92);
        }
      }

      const [rr, gg, bb] = ramp(t <= 0 ? 0 : t >= 1 ? 1 : t);
      const index = (y * width + x) * 4;
      data[index] = rr;
      data[index + 1] = gg;
      data[index + 2] = bb;
      data[index + 3] = 255;
    }
  }
  return finish(buffer);
}

function earthSurface(config) {
  const { seed, size = [2048, 1024] } = config;
  const [width, height] = size;
  const land = getNoise(`${seed}-land`);
  const detail = getNoise(`${seed}-detail`);
  const buffer = makeTexture(width, height);
  const { data } = buffer;

  // A deliberately desaturated Earth: oversaturated greens read as a cartoon, while
  // real orbital imagery is muted teal-green over deep navy.
  const oceanDeep = [4, 16, 42];
  const oceanMid = [10, 40, 80];
  const shelf = [22, 80, 118];
  const beach = [168, 156, 116];
  const lowland = [54, 80, 52];
  const forest = [36, 62, 40];
  const highland = [98, 88, 64];
  const mountain = [128, 122, 112];
  const snow = [238, 242, 246];

  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const lat = Math.abs(v - 0.5) * 2;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const p = sphereSampler(u, v);

      /**
       * Continent mask.
       *
       * The land/sea decision uses only the *lowest* frequencies. Summing many octaves
       * here produced fragmented speckle that read as noise rather than landmasses;
       * large, coherent blobs plus a mild warp is what makes the shape recognisable.
       */
      const warp = detail.fbm(p.x * 2.4, p.y * 2.4, p.z * 2.4, 3) * 0.16;
      const base = land.fbm(p.x * 1.1 + warp, p.y * 1.1 - warp, p.z * 1.1, 4);
      // Sea level is tuned so roughly 30% of the surface is land, matching Earth.
      // A raw noise field of this scale is close to 50/50, which reads as a dry world.
      const continent = base * 1.25 + 0.05 * Math.cos(lat * 2.4) - 0.16;
      const index = (y * width + x) * 4;
      let color;

      if (continent > 0) {
        const elevation = Math.min(1, continent / 0.4);
        // Detail only breaks up the interior; it never decides land or sea.
        const biome = detail.fbm(p.x * 5.5, p.y * 5.5, p.z * 5.5, 4);
        const arid = 0.5 + 0.5 * detail.fbm(p.x * 1.9 + 40, p.y * 1.9, p.z * 1.9, 3);
        // Deserts near the tropics, green mid-latitudes, tundra toward the poles.
        const tropical = Math.exp(-Math.pow((lat - 0.3) / 0.19, 2));
        const polar = Math.max(0, (lat - 0.76) / 0.24);
        let green = mix(lowland, forest, Math.max(0, biome) * 0.95 + 0.15);
        green = mix(green, highland, Math.min(1, Math.max(0, elevation - 0.3) * 2.0));
        const desert = mix(beach, highland, arid * 0.8);
        color = mix(green, desert, Math.min(0.9, tropical * (0.3 + arid * 0.7)));
        if (elevation > 0.66) color = mix(color, mountain, Math.min(1, (elevation - 0.66) * 3));
        if (elevation > 0.82) color = mix(color, snow, Math.min(1, (elevation - 0.82) * 3.4));
        color = mix(color, snow, Math.min(1, polar * 1.4));
        // Fine grain: without it large landmasses read as flat colour fields.
        const grain = detail.fbm(p.x * 22, p.y * 22, p.z * 22, 3);
        const shade = 1 + grain * 0.14;
        color = [color[0] * shade, color[1] * shade, color[2] * shade];
        // Knock the saturation back: land on a real globe is far greyer than a map.
        const luminance = color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11;
        color = mix(color, [luminance, luminance, luminance], 0.22);
      } else {
        const depth = Math.min(1, -continent / 0.42);
        color = mix(shelf, oceanMid, Math.min(1, depth * 1.5));
        color = mix(color, oceanDeep, Math.max(0, depth - 0.32) * 1.6);
        // A brighter continental shelf immediately off the coast.
        if (depth < 0.06) color = mix(color, shelf, 0.7);
      }

      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = 255;
    }
  }

  const { ctx } = buffer;
  ctx.putImageData(buffer.image, 0, 0);

  // Polar ice caps with a soft, slightly broken edge.
  const iceCtx = ctx;
  const capGradient = (top) => {
    const grad = iceCtx.createLinearGradient(0, top ? 0 : height, 0, top ? height * 0.12 : height * 0.88);
    grad.addColorStop(0, 'rgba(248,252,255,0.98)');
    grad.addColorStop(0.55, 'rgba(240,248,255,0.72)');
    grad.addColorStop(1, 'rgba(240,248,255,0)');
    return grad;
  };
  iceCtx.fillStyle = capGradient(true);
  iceCtx.fillRect(0, 0, width, height * 0.12);
  iceCtx.fillStyle = capGradient(false);
  iceCtx.fillRect(0, height * 0.88, width, height * 0.12);

  // No specular map is emitted: the Earth shader derives ocean gloss from the
  // colour map's blue channel, which avoids a second full-resolution texture.
  return finish(buffer);
}

/**
 * Solar photosphere.
 *
 * Isotropic turbulence rather than latitude bands: a banded map reads as molten rock
 * once it is wrapped on a star. Structure is deliberately low-contrast because the
 * live granulation shader supplies the visible detail and the two must not fight.
 */
function sunPhotosphere({ seed, palette, size = [1024, 512] }) {
  const [width, height] = size;
  const noise = getNoise(`${seed}-turb`);
  const buffer = makeTexture(width, height);
  const { data } = buffer;
  const ramp = rampFrom(palette);

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const p = sphereSampler(u, v);
      // Two isotropic scales; nearly no latitude dependence.
      const coarse = noise.fbm(p.x * 4.2, p.y * 4.2, p.z * 4.2, 5);
      const fine = noise.ridged(p.x * 11.0, p.y * 11.0, p.z * 11.0, 4);
      const t = Math.min(1, Math.max(0, 0.62 + coarse * 0.28 + (fine - 0.5) * 0.22));
      const [r, g, b] = ramp(t);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return finish(buffer).map;
}

/** Cloud layer with alpha: white fbm wisps over transparent space. */
function cloudLayer(seed, size = [1024, 512]) {
  const [width, height] = size;
  const noise = getNoise(`${seed}-clouds`);
  const swirl = getNoise(`${seed}-swirl`);
  const buffer = makeTexture(width, height);
  const { data } = buffer;
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const p = sphereSampler(u, v);

      // Warp the sample position so systems curl instead of sitting as round blobs.
      const warp = swirl.fbm(p.x * 1.7, p.y * 2.6, p.z * 1.7, 3) * 0.45;
      const n = noise.fbm(p.x * 2.6 + warp, p.y * 4.4, p.z * 2.6 - warp, 6);

      // Zonal banding: Earth's weather organises into latitude belts, with clear air
      // in the subtropics. The multiplier sharpens cloud edges rather than hazing.
      const band = 0.5 + 0.5 * Math.sin(p.y * Math.PI * 6.5 + n * 2.2);
      const subtropical = Math.exp(-Math.pow((Math.abs(p.y) - 0.42) / 0.16, 2));
      let alpha = n * 1.15 + band * 0.4 - 0.34 - subtropical * 0.22;
      // Contrast curve: clouds should have edges, not gradients.
      alpha = alpha <= 0 ? 0 : Math.pow(alpha, 0.85);

      const index = (y * width + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.min(240, alpha * 340);
    }
  }
  const texture = finish(buffer);
  return texture.map;
}

/** Night-side city lights: sparse warm dots concentrated on land. */
function cityLights(seed, size = [1024, 512]) {
  const [width, height] = size;
  const land = getNoise(`${seed}-land`);
  const dots = getNoise(`${seed}-dots`);
  const random = craterNoiseRandom(`${seed}-city`);
  const buffer = makeTexture(width, height);
  const { data } = buffer;
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const lat = Math.abs(v - 0.5) * 2;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const p = sphereSampler(u, v);
      // Must match the continent mask in `earthSurface`, or lights appear at sea.
      const warp = dots.fbm(p.x * 2.4, p.y * 2.4, p.z * 2.4, 3) * 0.16;
      const continent = land.fbm(p.x * 1.1 + warp, p.y * 1.1 - warp, p.z * 1.1, 4) * 1.25 + 0.05 * Math.cos(lat * 2.4) - 0.16;
      const index = (y * width + x) * 4;
      let intensity = 0;
      if (continent > 0) {
        const spark = Math.pow(Math.max(0, dots.fbm(p.x * 22, p.y * 22, p.z * 22, 3)), 3.2);
        const coast = 1 - Math.min(1, Math.abs(continent - 0.04) * 5);
        const habitability = (1 - lat) * (0.4 + coast * 0.85);
        intensity = Math.min(1, spark * 2.6 * habitability);
      }
      data[index] = 255 * intensity;
      data[index + 1] = 214 * intensity;
      data[index + 2] = 150 * intensity;
      data[index + 3] = 255;
    }
  }
  const texture = finish(buffer);
  return texture.map;
}

/**
 * Ring system: a 1×N strip where u runs across the radius.
 *
 * Colour is written fully opaque (alpha 255) and the ring's optical depth is
 * encoded in luminance plus a modest alpha modulation. Keeping the base alpha high
 * matters: a low-alpha canvas texture sampled through an sRGB pipeline loses most
 * of its intensity, which turned the rings into grey sludge.
 */
function ringTexture(palette, seed) {
  const width = 1024;
  const height = 8;
  const random = craterNoiseRandom(`${seed}-ring`);
  const noise = getNoise(`${seed}-ring`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const ramp = rampFrom(palette);

  for (let x = 0; x < width; x += 1) {
    const t = x / (width - 1);
    // Two noise scales: broad ring bands plus fine ringlet structure.
    const broad = noise.fbm(t * 18, 0.4, 0.9, 5) * 0.5 + 0.5;
    const fine = noise.fbm(t * 140, 3.1, 5.7, 4) * 0.5 + 0.5;

    // Named divisions: Maxwell-ish gap, the Cassini division and the Encke gap.
    const gapMaxwell = Math.exp(-Math.pow((t - 0.14) / 0.02, 2));
    const gapCassini = Math.exp(-Math.pow((t - 0.46) / 0.018, 2));
    const gapEncke = Math.exp(-Math.pow((t - 0.79) / 0.012, 2));
    const gaps = Math.max(gapMaxwell * 0.95, gapCassini * 0.98, gapEncke * 0.85);

    // The C ring (inner) is thinner and dimmer than the dense B ring.
    const cRing = 1 - Math.min(1, Math.abs(t - 0.1) / 0.14);
    let depth = 0.86 + broad * 0.2 + fine * 0.14 - cRing * 0.28 - gaps * 0.7;
    depth *= Math.min(1, Math.max(0.25, t * 6));
    depth *= Math.min(1, Math.max(0.15, (1 - t) * 5));
    depth = Math.min(1, Math.max(0.05, depth));

    const [hueR, hueG, hueB] = ramp(Math.min(1, Math.max(0, 0.3 + broad * 0.7)));
    const jitter = 0.96 + random() * 0.08;
    // Albedo of icy ring particles. Kept below 1 deliberately: the sheet is drawn with
    // `toneMapped: false` plus an additive luminance pass, so an authored albedo near
    // white clipped the sunlit face to a flat blown-out wedge.
    const albedo = (0.6 + depth * 0.26) * jitter;
    const r = Math.min(255, (hueR * 0.22 + 255 * 0.78) * albedo);
    const g = Math.min(255, (hueG * 0.22 + 255 * 0.78) * albedo);
    const b = Math.min(255, (hueB * 0.22 + 255 * 0.78) * albedo);

    ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},255)`;
    ctx.fillRect(x, 0, 1, height);
  }

  // Store the optical depth separately in the alpha channel, but never below 0.35
  // so the sheet keeps its presence at grazing angles.
  const image = ctx.getImageData(0, 0, width, height);
  for (let x = 0; x < width; x += 1) {
    const t = x / (width - 1);
    const broad = noise.fbm(t * 18, 0.4, 0.9, 5) * 0.5 + 0.5;
    const fine = noise.fbm(t * 140, 3.1, 5.7, 4) * 0.5 + 0.5;
    const gapCassini = Math.exp(-Math.pow((t - 0.46) / 0.018, 2));
    const gapEncke = Math.exp(-Math.pow((t - 0.79) / 0.012, 2));
    const gapMaxwell = Math.exp(-Math.pow((t - 0.14) / 0.02, 2));
    let alpha = 0.66 + broad * 0.2 + fine * 0.14;
    alpha *= 1 - Math.max(gapCassini, gapEncke) * 0.85;
    alpha *= 1 - gapMaxwell * 0.7;
    alpha *= Math.min(1, Math.max(0.25, t * 7));
    alpha *= Math.min(1, Math.max(0.2, (1 - t) * 5));
    for (let y = 0; y < height; y += 1) {
      image.data[(y * width + x) * 4 + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Backdrop nebula: large, very dim, non-repeating colour field. */
function nebulaTexture() {
  const width = 1024;
  const height = 512;
  const noise = getNoise('nebula');
  const buffer = makeTexture(width, height);
  const { data } = buffer;
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const p = sphereSampler(u, v);
      const n = noise.fbm(p.x * 1.9, p.y * 1.9, p.z * 1.9, 6);
      const filament = noise.ridged(p.x * 3.4, p.y * 3.4, p.z * 3.4, 4);
      const band = Math.exp(-Math.pow((v - 0.46) / 0.16, 2));
      const intensity = Math.max(0, n * 0.8 + filament * 0.5 - 0.5) * band;
      // Cool indigo with a warm core, matching the UI accent colours.
      const r = 26 * intensity + 8;
      const g = 34 * intensity + 10;
      const b = 78 * intensity + 22;
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  const texture = finish(buffer);
  texture.map.wrapT = THREE.ClampToEdgeWrapping;
  return texture.map;
}

// ————————————————————————————————————————————————————————————————
// Public API
// ————————————————————————————————————————————————————————————————

/**
 * Build the full texture set for a body definition.
 * @returns {{map: THREE.Texture, bumpMap?: THREE.Texture,
 *            clouds?: THREE.Texture, lights?: THREE.Texture, ring?: THREE.Texture}}
 */
export function createBodyTextures(render, id, quality = 'balanced') {
  const highDetail = quality === 'high';
  const size = highDetail ? [2048, 1024] : quality === 'balanced' ? [1024, 512] : [512, 256];
  const surface = render.surface;
  const palette = render.palette;
  const out = {};

  switch (surface) {
    case 'sun': {
      // The photosphere must NOT use the banded giant generator: latitude bands read
      // as molten rock on a star. This is near-isotropic turbulence, with only a hint
      // of structure, and the live shader in bodies.js adds the granulation drift.
      out.map = sunPhotosphere({ seed: `${id}-photo`, palette, size });
      break;
    }
    case 'earth': {
      const built = earthSurface({ seed: id, size: [highDetail ? 2048 : 1024, highDetail ? 1024 : 512] });
      out.map = built.map;
      out.clouds = cloudLayer(`${id}-cloud`, [highDetail ? 2048 : 1024, highDetail ? 1024 : 512]);
      out.lights = cityLights(id, [highDetail ? 1024 : 512, highDetail ? 512 : 256]);
      break;
    }
    case 'mars': {
      const built = rockySurface({
        seed: id,
        palette,
        size,
        scale: 4.1,
        craters: 220,
        craterTint: '255,214,180',
        polar: { start: 0.86, value: 1, strength: 1.4 },
        roughness: 0.94,
      });
      out.map = built.map;
      out.bumpMap = built.bumpMap;
      break;
    }
    case 'venus': {
      const built = bandedGiant({
        seed: id,
        palette,
        size,
        bands: 7,
        turbulence: 1.9,
        detail: 3.1,
      });
      out.map = built.map;
      break;
    }
    case 'jupiter': {
      const built = bandedGiant({
        seed: id,
        palette,
        size: [highDetail ? 2048 : 1024, highDetail ? 1024 : 512],
        bands: render.bands || 14,
        // Data-driven so the belt coherence can be tuned per planet rather than being
        // hardcoded here (Jupiter's belts must stay zonal, Saturn's may curl).
        turbulence: render.turbulence ?? 0.95,
        detail: 4.6,
        spot: { u: 0.31, rx: 0.075, ry: 0.045, value: 0.86, falloff: 1.5 },
        stormLatitude: -0.36,
      });
      out.map = built.map;
      break;
    }
    case 'saturn':
    case 'uranus':
    case 'neptune': {
      const built = bandedGiant({
        seed: id,
        palette,
        size,
        bands: render.bands || 10,
        turbulence: render.turbulence ?? (surface === 'saturn' ? 0.55 : 0.32),
        detail: surface === 'saturn' ? 3.2 : 2.4,
      });
      out.map = built.map;
      break;
    }
    case 'moon': {
      const built = rockySurface({
        seed: id,
        palette,
        size,
        scale: 5.4,
        craters: 420,
        craterTint: '255,255,255',
        ridgeMix: 0.2,
      });
      out.map = built.map;
      out.bumpMap = built.bumpMap;
      break;
    }
    case 'io': {
      const built = rockySurface({
        seed: id,
        palette,
        size,
        scale: 6.1,
        craters: 90,
        ridgeMix: 0.62,
        craterTint: '255,236,190',
      });
      out.map = built.map;
      out.bumpMap = built.bumpMap;
      break;
    }
    case 'europa': {
      const built = rockySurface({
        seed: id,
        palette,
        size,
        scale: 7.6,
        craters: 30,
        ridgeMix: 0.7,
        craterTint: '180,150,120',
        roughness: 0.7,
      });
      out.map = built.map;
      out.bumpMap = built.bumpMap;
      break;
    }
    case 'rocky':
    case 'ganymede':
    case 'callisto':
    case 'generic-ice':
    default: {
      const craters = surface === 'callisto' ? 460 : surface === 'ganymede' ? 260 : 180;
      const built = rockySurface({
        seed: id,
        palette,
        size,
        scale: surface === 'callisto' ? 6.4 : 4.6,
        craters,
        ridgeMix: surface === 'ganymede' ? 0.55 : 0.35,
      });
      out.map = built.map;
      out.bumpMap = built.bumpMap;
      break;
    }
  }

  if (render.ring) {
    out.ring = ringTexture(render.ring.palette, id);
  }
  return out;
}

let nebulaCache = null;
/** Shared nebula backdrop (built once per session). */
export function getNebulaTexture() {
  if (!nebulaCache) nebulaCache = nebulaTexture();
  return nebulaCache;
}

/**
 * A single nebula cloud for the distant patch sprites.
 *
 * Fractal noise masked by a very soft radial falloff so the sprite has no visible
 * edge, with the alpha carrying the density and the red channel a slightly hotter
 * core. Used additively at a few percent opacity — it reads as distance, not paint.
 */
function nebulaPatchTexture() {
  const width = 512;
  const height = 512;
  const noise = getNoise('nebula-patch');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const { data } = image;

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      // Falloff in normalised disc space keeps the cloud circular and edgeless.
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const radius = Math.hypot(dx, dy);
      const falloff = Math.pow(Math.max(0, 1 - radius), 2.4);

      const n = noise.fbm(u * 3.4, v * 3.4, 0.5, 6);
      const filaments = noise.ridged(u * 5.6, v * 5.6, 1.5, 4);
      // Only the positive half of the noise contributes, so gaps stay truly empty.
      const density = Math.max(0, n * 0.8 + filaments * 0.5 - 0.28);
      const intensity = Math.min(1, density * falloff * 1.7);

      const index = (y * width + x) * 4;
      // Violet-blue base with a paler core; the sprite tint multiplies this.
      data[index] = 180 * intensity;
      data[index + 1] = 190 * intensity;
      data[index + 2] = 235 * intensity;
      data[index + 3] = intensity * 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

let nebulaPatchCache = null;
/** Shared nebula patch sprite (built once per session). */
export function getNebulaPatchTexture() {
  if (!nebulaPatchCache) nebulaPatchCache = nebulaPatchTexture();
  return nebulaPatchCache;
}

export { nebulaPatchTexture, stampCraters };
