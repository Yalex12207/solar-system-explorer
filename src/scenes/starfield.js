/**
 * Deep-space backdrop.
 *
 * Three star layers at different distances, each drifting at its own rate, produce a
 * genuine sense of depth as the camera moves: near stars slide quickly and faintly,
 * far stars barely shift. Stars also twinkle on individual phases, which is what
 * separates "space" from "a texture of dots".
 *
 * Everything is one draw call per layer. Budgets come from the quality preset, and the
 * whole group rotates too slowly to read as motion — it just stops the sky feeling
 * pinned to the camera.
 */

import * as THREE from 'three';
import { getNebulaTexture, starSpriteTexture, getNebulaPatchTexture } from '../utils/textures.js';
import { createRandom } from '../utils/noise.js';

/**
 * Star colour distribution, biased toward the cool end. Real skies are mostly faint
 * white-blue with a few warm standouts; a uniform rainbow reads as decoration.
 */
const STAR_TINTS = [
  [0.74, 0.82, 1.0],
  [0.82, 0.88, 1.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.97, 0.9],
  [1.0, 0.9, 0.76],
  [1.0, 0.82, 0.68],
];

/**
 * One star layer.
 *
 * @param {object} options
 * @param {number} options.count     stars in this layer
 * @param {number} options.radius    shell radius in scene units
 * @param {number} options.spread    shell thickness as a fraction of radius
 * @param {[number,number]} options.sizeRange  point size range
 * @param {number} options.brightness  overall dimming, 0–1
 * @param {number} options.twinkle   twinkle amplitude, 0 disables
 * @param {number} options.seed      deterministic layout
 */
function createStarLayer({
  count,
  radius,
  spread = 0.18,
  sizeRange = [1, 3],
  brightness = 1,
  twinkle = 0.35,
  seed = 1,
}) {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  const [minSize, maxSize] = sizeRange;
  const inner = radius * (1 - spread);

  for (let i = 0; i < count; i += 1) {
    // Uniform direction on the sphere, then a shell distance.
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const distance = inner + random() * (radius - inner);
    positions[i * 3] = Math.cos(theta) * r * distance;
    positions[i * 3 + 1] = u * distance;
    positions[i * 3 + 2] = Math.sin(theta) * r * distance;

    const tint = STAR_TINTS[Math.floor(Math.pow(random(), 1.4) * STAR_TINTS.length)];
    // Cubed random: mostly faint stars with a few bright ones, as in a real sky.
    const magnitude = 0.28 + Math.pow(random(), 2.6) * 0.85;
    colors[i * 3] = tint[0] * magnitude * brightness;
    colors[i * 3 + 1] = tint[1] * magnitude * brightness;
    colors[i * 3 + 2] = tint[2] * magnitude * brightness;

    sizes[i] = minSize + Math.pow(random(), 2.2) * (maxSize - minSize);
    phases[i] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: starSpriteTexture() },
      uPixelRatio: { value: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1) },
      uTime: { value: 0 },
      uTwinkle: { value: twinkle },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float phase;
      varying vec3 vColor;
      varying float vTwinkle;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uTwinkle;

      void main() {
        vColor = color;
        // Each star breathes on its own phase, so the sky never pulses in unison.
        vTwinkle = 1.0 - uTwinkle * 0.5 * (1.0 - sin(uTime * 0.9 + phase));

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // Distance-based sizing keeps near stars larger than far ones.
        gl_PointSize = size * uPixelRatio * (320.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vColor;
      varying float vTwinkle;

      void main() {
        // .a carries the soft radial falloff, .r the hot core.
        vec4 sprite = texture2D(uMap, gl_PointCoord);
        float alpha = sprite.a * vTwinkle;
        if (alpha < 0.015) discard;
        // Add a small white core so bright stars read as points of light, not blobs.
        vec3 colour = vColor + vec3(sprite.r * 0.35);
        gl_FragColor = vec4(colour, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, geometry, material, radius };
}

/**
 * True when the user has asked the platform to reduce motion.
 *
 * CSS handles the DOM animations; the canvas has to check for itself, or the starfield
 * twinkle and the Sun's convection would keep moving for exactly the people who asked
 * for stillness.
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Build the full backdrop.
 *
 * @param {object} options
 * @param {number} options.count   total stars across all layers
 * @param {number} options.radius  reference radius (the far shell)
 * @param {boolean} options.nebula include the nebula wash and patch sprites
 * @param {boolean} options.twinkle enable per-star twinkle
 * @param {boolean} options.motion  allow slow layer drift (off under reduced motion)
 */
export function createStarfield({ count = 6000, radius = 900, nebula = true, twinkle = true, motion = true } = {}) {
  const group = new THREE.Group();
  group.name = 'Starfield';

  // Layer budgets: most stars live far away and stay tiny.
  const farCount = Math.round(count * 0.56);
  const midCount = Math.round(count * 0.31);
  const nearCount = Math.max(0, count - farCount - midCount);

  const layers = [];

  // ——— far shell: the bulk of the sky, faint and dense ———
  layers.push(
    createStarLayer({
      count: farCount,
      radius: radius * 1.15,
      spread: 0.12,
      sizeRange: [0.8, 2.1],
      brightness: 0.72,
      twinkle: twinkle ? 0.3 : 0,
      seed: 1337,
    }),
  );

  // ——— mid shell: the readable constellation layer ———
  layers.push(
    createStarLayer({
      count: midCount,
      radius: radius * 0.78,
      spread: 0.2,
      sizeRange: [1.2, 3.4],
      brightness: 1,
      twinkle: twinkle ? 0.42 : 0,
      seed: 90210,
    }),
  );

  // ——— near shell: sparse, brighter, slides fastest for parallax ———
  layers.push(
    createStarLayer({
      count: nearCount,
      radius: radius * 0.42,
      spread: 0.26,
      sizeRange: [1.8, 5.2],
      brightness: 1.18,
      twinkle: twinkle ? 0.55 : 0,
      seed: 5150,
    }),
  );

  if (nebula) {
    // A very dim wash behind everything. Kept near-black: it should register as
    // depth, never as a coloured backdrop.
    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.65, 32, 24),
      new THREE.MeshBasicMaterial({
        map: getNebulaTexture(),
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
        opacity: 0.85,
      }),
    );
    backdrop.name = 'NebulaWash';
    group.add(backdrop);
    layers.push({ points: backdrop, uniformDrift: 0 });
  }

  for (const layer of layers) group.add(layer.points);

  return { group, layers, nebula, motion };
}

/**
 * Distant nebula patches.
 *
 * A handful of large, extremely faint additive sprites placed far out. They are what
 * give the background a sense of scale and a hint of colour without becoming a
 * decorative gradient — each is at most a few percent luminance.
 */
export function createNebulaPatches({ radius = 1200, quality = 'balanced' } = {}) {
  const presets = {
    high: [
      { tint: 0x2a3f6e, scale: 620, opacity: 0.16, at: [-0.72, 0.3, -0.62] },
      { tint: 0x4a3352, scale: 520, opacity: 0.12, at: [0.68, -0.24, -0.7] },
      { tint: 0x1f4a55, scale: 700, opacity: 0.1, at: [0.35, 0.5, 0.78] },
      { tint: 0x3a2f4a, scale: 460, opacity: 0.09, at: [-0.4, -0.58, 0.72] },
    ],
    balanced: [
      { tint: 0x2a3f6e, scale: 640, opacity: 0.14, at: [-0.72, 0.3, -0.62] },
      { tint: 0x4a3352, scale: 540, opacity: 0.1, at: [0.68, -0.24, -0.7] },
      { tint: 0x1f4a55, scale: 700, opacity: 0.09, at: [0.35, 0.5, 0.78] },
    ],
    performance: [],
  };

  const list = presets[quality] ?? presets.balanced;
  const group = new THREE.Group();
  group.name = 'NebulaPatches';
  if (!list.length) return { group, patches: [] };

  const texture = getNebulaPatchTexture();
  const patches = list.map((preset) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: preset.tint,
        transparent: true,
        opacity: preset.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    const direction = new THREE.Vector3(...preset.at).normalize();
    sprite.position.copy(direction).multiplyScalar(radius);
    sprite.scale.setScalar(preset.scale);
    sprite.renderOrder = -3;
    group.add(sprite);
    return sprite;
  });

  return { group, patches };
}

/**
 * Faint dust motes drifting through the inner system — the "you are inside
 * something" cue. Count comes from the quality preset.
 */
export function createCoronalDust({ count = 600, innerRadius = 6, outerRadius = 62 } = {}) {
  if (count <= 0) return null;
  const random = createRandom(31337);
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = innerRadius + Math.pow(random(), 1.6) * (outerRadius - innerRadius);
    const height = (random() - 0.5) * 14 * (1 - (radius - innerRadius) / (outerRadius - innerRadius) + 0.25);
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = height;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    speeds[i] = 0.02 + random() * 0.06;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x9fb4d8,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'CoronalDust';
  points.frustumCulled = false;
  return { points, geometry, material, speeds, radius: outerRadius };
}

/** Baseline dust radius, used to scale rotation with distance from the Sun. */
const DUST_REFERENCE_RADIUS = 6;

/** Advance the dust belt: slow orbital drift, no per-frame allocations. */
export function updateCoronalDust(dust, delta) {
  if (!dust) return;
  const positions = dust.geometry.attributes.position;
  const array = positions.array;
  for (let i = 0; i < dust.speeds.length; i += 1) {
    const i3 = i * 3;
    // Keplerian shear: dust closer to the Sun sweeps past dust further out, which
    // reads as a real orbital disc rather than a rigidly spinning ring.
    const radius = Math.hypot(array[i3], array[i3 + 2]) || DUST_REFERENCE_RADIUS;
    const speed = dust.speeds[i] * delta * (DUST_REFERENCE_RADIUS / radius) ** 1.5;
    const cos = Math.cos(speed);
    const sin = Math.sin(speed);
    const x = array[i3];
    const z = array[i3 + 2];
    array[i3] = x * cos - z * sin;
    array[i3 + 2] = x * sin + z * cos;
  }
  positions.needsUpdate = true;
}

/**
 * Per-frame backdrop update: twinkle time plus slow differential layer rotation.
 * Kept allocation-free.
 */
export function updateStarfield(starfield, elapsed) {
  if (!starfield) return;
  const layers = starfield.layers || [];
  // Reduced motion: hold the drift and the twinkle phase, leave a static sky.
  const time = starfield.motion === false ? 0 : elapsed;
  let starLayerIndex = 0;
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (!layer.material || !layer.material.uniforms) {
      // The nebula wash has no material uniforms and never moves.
      continue;
    }
    layer.material.uniforms.uTime.value = time;
    // Distinct rotation per layer is what sells the depth; nearer shells turn faster.
    layer.points.rotation.y = time * (0.0022 / (starLayerIndex + 1));
    starLayerIndex += 1;
  }
}
