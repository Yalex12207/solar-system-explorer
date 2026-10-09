/**
 * Cosmic-scale representations: the Oort Cloud and the Milky Way.
 *
 * These are the two things the solar-system model cannot express. Both are drawn as point
 * clouds rather than meshes, for the same reason: neither is a surface. The Oort Cloud is
 * billions of separate bodies spread through a shell, and a galaxy is stars and dust with
 * almost nothing in between — a solid mesh would read as a wall and look wrong immediately.
 *
 * Performance discipline:
 *  - one `THREE.Points` draw call per layer, never one object per star;
 *  - budgets come from the quality preset, so a phone draws an order of magnitude less;
 *  - every layer is hidden outside its stage, so the cost is zero in normal use;
 *  - allocation happens once, at build time — nothing here allocates per frame.
 */

import * as THREE from 'three';
import { COSMIC_SCALE } from '../data/scale.js';
import { createRandom } from '../utils/noise.js';
import { starSpriteTexture } from '../utils/textures.js';

/** Star colours across a galactic disc: hot blue arms, warm old bulge. */
const ARM_TINTS = [
  [0.72, 0.82, 1.0],
  [0.86, 0.9, 1.0],
  [1.0, 0.97, 0.9],
  [1.0, 0.88, 0.72],
];
const BULGE_TINT = [1.0, 0.86, 0.62];

/**
 * The Oort Cloud: a detached shell of icy bodies from ~2,000 to ~200,000 AU.
 *
 * Drawn as a thick shell with a density falloff toward the centre, because the real Cloud
 * is a shell — not a ball — and the inner edge is one of the few structural facts we
 * actually know about it.
 */
export function createOortCloud({ quality = 'balanced', radius = COSMIC_SCALE.oort.renderRadius } = {}) {
  const preset = COSMIC_SCALE.oort;
  const count = preset.count[quality] ?? preset.count.balanced;
  const random = createRandom(20250214);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    // Uniform on a sphere, then radius biased outward so the shell reads as a shell.
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - u * u);
    const t = Math.pow(random(), 1.7);
    const r = preset.inner + (preset.outer - preset.inner) * t;

    positions[i * 3] = Math.cos(theta) * ring * r * radius;
    positions[i * 3 + 1] = u * r * radius * 0.72;
    positions[i * 3 + 2] = Math.sin(theta) * ring * r * radius;

    // Icy bodies are faint and slightly blue-white. The floor is set from the Galaxy's own
    // point brightness: at this distance the shell has to read as a haze of individual
    // bodies rather than as scattered dust, so it is brighter than physical instinct suggests.
    const brightness = (0.62 + Math.pow(random(), 1.8) * 0.62) * (0.7 + 0.3 * t);
    colors[i * 3] = 0.8 * brightness;
    colors[i * 3 + 1] = 0.87 * brightness;
    colors[i * 3 + 2] = 1.0 * brightness;
    sizes[i] = 2.0 + Math.pow(random(), 3) * 4.6;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: starSpriteTexture() },
      uPixelRatio: { value: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1) },
      uOpacity: { value: 0 },
      uScale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      varying vec3 vColor;
      uniform float uPixelRatio;
      uniform float uScale;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale * uPixelRatio * (340.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec3 vColor;
      void main() {
        float alpha = texture2D(uMap, gl_PointCoord).a * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'OortCloud';
  points.frustumCulled = false;
  points.visible = false;

  return { points, geometry, material, radius, count, meanSize: meanSize(geometry) };
}

/**
 * The Milky Way: a four-armed logarithmic spiral with a central bulge.
 *
 * Stars are placed along the arm curves with a Gaussian scatter — that is what makes a
 * spiral galaxy read as a spiral rather than as a pinwheel of lines. A dust layer is added
 * on the same curves, dimmer and warmer, which is what gives a real galaxy its mottled,
 * partly-obscured texture.
 */
export function createMilkyWay({ quality = 'balanced' } = {}) {
  const preset = COSMIC_SCALE.galaxy;
  const starCount = preset.starCount[quality] ?? preset.starCount.balanced;
  const dustCount = preset.dustCount[quality] ?? preset.dustCount.balanced;
  const group = new THREE.Group();
  group.name = 'MilkyWay';
  group.visible = false;

  const { discRadius, thickness, arms, winding, bulge } = preset;

  const buildSpiral = ({ count, seed, warm }) => {
    const random = createRandom(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      // A share of the population belongs to the bulge rather than to the arms.
      const inBulge = random() < bulge * 1.6;
      let radius;
      let angle;

      if (inBulge) {
        // Dense, roughly spherical centre.
        radius = Math.pow(random(), 1.8) * discRadius * bulge * 1.5;
        angle = random() * Math.PI * 2;
      } else {
        // Logarithmic spiral: r = a·e^(bθ). Radius drives the angle, so the arms wind
        // outward instead of being drawn as separate curves.
        radius = discRadius * (0.12 + Math.pow(random(), 0.72) * 0.88);
        const arm = Math.floor(random() * arms);
        const base = (arm / arms) * Math.PI * 2;
        angle = base + Math.log(Math.max(0.08, radius / discRadius) * 8.4) / winding;
        // Scatter across the arm's width, and fractionally in angle so the arm has body.
        angle += (random() - 0.5) * 0.34;
        radius += (random() - 0.5) * discRadius * 0.035;
      }

      const jitter = inBulge ? 0.16 : 0.05;
      positions[i * 3] = Math.cos(angle) * radius + (random() - 0.5) * jitter * discRadius;
      positions[i * 3 + 1] = (random() - 0.5) * thickness * discRadius * (inBulge ? 4.2 : 1);
      positions[i * 3 + 2] = Math.sin(angle) * radius + (random() - 0.5) * jitter * discRadius;

      const tint = inBulge || warm ? BULGE_TINT : ARM_TINTS[Math.floor(random() * ARM_TINTS.length)];
      // Disc stars are brightest in the inner third, as in a real surface-brightness profile.
      const falloff = 1 - 0.55 * Math.min(1, radius / discRadius);
      const brightness = (0.24 + Math.pow(random(), 2.4) * 0.8) * falloff;
      colors[i * 3] = tint[0] * brightness;
      colors[i * 3 + 1] = tint[1] * brightness;
      colors[i * 3 + 2] = tint[2] * brightness;
      sizes[i] = warm ? 1.6 + Math.pow(random(), 3) * 5.5 : 0.9 + Math.pow(random(), 3) * 3.6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: starSpriteTexture() },
        uPixelRatio: { value: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1) },
        uOpacity: { value: 0 },
        uScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        uniform float uPixelRatio;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          // The galaxy is framed from far outside it, so the point size is scaled with the
          // disc rather than left in screen space — otherwise every star is a pixel and the
          // structure disappears.
          gl_PointSize = size * uScale * uPixelRatio * (340.0 / max(1.0, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec3 vColor;
        void main() {
          float alpha = texture2D(uMap, gl_PointCoord).a * uOpacity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { points, geometry, material, meanSize: meanSize(geometry) };
  };

  const stars = buildSpiral({ count: starCount, seed: 52850, warm: false });
  const dust = buildSpiral({ count: dustCount, seed: 26000, warm: true });
  group.add(stars.points);
  group.add(dust.points);

  return { group, stars, dust, discRadius, starCount, dustCount };
}

/**
 * The Solar System's location marker.
 *
 * Placed at `sunMarker.radialFraction` of the disc radius — 26,000 of 52,850 light-years —
 * on the Orion Arm's angle. The fraction is the measured one; only the angle is a chosen
 * point on the arm, and the UI says "Orion Arm" rather than implying a surveyed position.
 */
export function createSunMarker({ radius = COSMIC_SCALE.galaxy.discRadius } = {}) {
  const { radialFraction, armAngle } = COSMIC_SCALE.sunMarker;
  const group = new THREE.Group();
  group.name = 'SunMarker';
  group.visible = false;

  const r = radius * radialFraction;
  group.position.set(Math.cos(armAngle) * r, 0, Math.sin(armAngle) * r);

  // A glowing pin: a soft halo, a crisp ring, and a centre dot.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: starSpriteTexture(),
      color: 0xffd9a0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }),
  );
  halo.scale.setScalar(radius * 0.5);
  group.add(halo);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.118, radius * 0.132, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffe6bd,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const dot = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: starSpriteTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }),
  );
  dot.scale.setScalar(radius * 0.06);
  group.add(dot);

  return { group, halo, ring, dot, radius: r };
}

/**
 * Build every cosmic layer into one root, hidden by default.
 *
 * Returns the root plus the parts the scene fades between stages.
 */
export function createCosmicLayers({ quality = 'balanced' } = {}) {
  const root = new THREE.Group();
  root.name = 'CosmicLayers';
  root.visible = false;

  const oort = createOortCloud({ quality });
  root.add(oort.points);

  const galaxy = createMilkyWay({ quality });
  root.add(galaxy.group);

  const marker = createSunMarker();
  root.add(marker.group);

  return { root, oort, galaxy, marker, quality };
}

/** Smooth 0→1 ramp, used for every layer fade so the transitions share one feel. */
function ramp(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Point-size factor that keeps a distant layer visible.
 *
 * The layer shaders size points as `size * uScale * (340 / -mvPosition.z)`, so the on-screen
 * size collapses as the camera pulls back. That is right for the solar-system starfield,
 * where "further away is smaller" is the intended cue — but wrong for the Galaxy or the Oort
 * shell, which are framed from hundreds or thousands of units out. At those distances the
 * expression evaluated to about a pixel and a half, the rasteriser clamped every point to a
 * single pixel, and the layers rendered as near-invisible dust despite being correctly
 * built, scaled and lit.
 *
 * Since each of these layers is always framed at roughly the same apparent size, their point
 * size is expressed in *pixels* instead. Inverting the shader's expression for a camera
 * looking at the layer's centre:
 *
 *   pixels = size * uScale * 340 / distance
 *   uScale = pixels * distance / (size * 340)
 *
 * @param {number} baseSize       the average value in the geometry's `size` attribute
 * @param {number} desiredPixels  target on-screen size
 * @param {number} distance       camera distance to the layer's centre
 */
export function pointSizeFactor(baseSize, desiredPixels, distance) {
  return (desiredPixels * Math.max(1, distance)) / (Math.max(0.01, baseSize) * 340);
}

/** Mean of a geometry's `size` attribute, used to normalise the point-size factor. */
function meanSize(geometry) {
  const attribute = geometry.attributes?.size;
  if (!attribute || attribute.count === 0) return 1;
  let total = 0;
  // Sampling is plenty: the attribute is a smooth random distribution.
  const stride = Math.max(1, Math.floor(attribute.count / 64));
  let samples = 0;
  for (let i = 0; i < attribute.count; i += stride) {
    total += attribute.getX(i);
    samples += 1;
  }
  return samples > 0 ? total / samples : 1;
}

/**
 * Update cosmic-layer visibility and opacity for the current stage.
 *
 * @param {object} layers  from `createCosmicLayers`
 * @param {object} options
 * @param {string} options.stage       current cosmic stage id
 * @param {number} options.transition   0 when settled in a stage, 1 at the start of a move
 * @param {number} options.distance    camera separation, for the point-size calculation
 * @param {object} [options.camera]     camera, for its field of view
 * @param {number} [options.viewportHeight]
 * @param {number} [options.layerScale] world scale applied to the cosmic root
 */
export function updateCosmicLayers(layers, { stage, transition = 0, distance = 1 } = {}) {
  if (!layers) return;
  const settled = 1 - ramp(transition);

  const showOort = stage === 'oort-cloud';
  const showGalaxy = stage === 'milky-way';
  const wantsAny = showOort || showGalaxy;
  layers.root.visible = wantsAny;
  if (!wantsAny) return;

  layers.oort.points.visible = showOort;
  layers.oort.material.uniforms.uOpacity.value = showOort ? ramp(settled) : 0;
  if (showOort) {
    layers.oort.material.uniforms.uScale.value = pointSizeFactor(layers.oort.meanSize, 3.0, distance);
  }

  layers.galaxy.group.visible = showGalaxy;
  const galaxyOpacity = showGalaxy ? ramp(settled) : 0;
  const starFactor = pointSizeFactor(layers.galaxy.stars.meanSize, 2.2, distance);
  const dustFactor = pointSizeFactor(layers.galaxy.dust.meanSize, 3.0, distance);
  layers.galaxy.stars.material.uniforms.uOpacity.value = galaxyOpacity * 0.72;
  layers.galaxy.stars.material.uniforms.uScale.value = starFactor;
  // The dust is a haze, so it is weighted well below the stars it obscures.
  layers.galaxy.dust.material.uniforms.uOpacity.value = galaxyOpacity * 0.3;
  layers.galaxy.dust.material.uniforms.uScale.value = dustFactor;
  layers.marker.group.visible = showGalaxy;

  // The marker only earns its label once the galaxy has settled.
  const markerOpacity = showGalaxy ? ramp((settled - 0.55) / 0.45) : 0;
  layers.marker.halo.material.opacity = markerOpacity * 0.9;
  layers.marker.ring.material.opacity = markerOpacity;
  layers.marker.dot.material.opacity = markerOpacity;
}

/** Dispose every cosmic layer. */
export function disposeCosmicLayers(layers) {
  if (!layers) return;
  const kill = (material) => material?.dispose?.();
  const killGeometry = (geometry) => geometry?.dispose?.();
  killGeometry(layers.oort.geometry);
  kill(layers.oort.material);
  for (const layer of [layers.galaxy.stars, layers.galaxy.dust]) {
    killGeometry(layer.geometry);
    kill(layer.material);
  }
  layers.marker.halo.material.map?.dispose?.();
  kill(layers.marker.halo.material);
  kill(layers.marker.ring.material);
  killGeometry(layers.marker.ring.geometry);
  kill(layers.marker.dot.material);
  layers.root.clear();
}
