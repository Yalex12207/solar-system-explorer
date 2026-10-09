/**
 * Body mesh factories.
 *
 * Each function returns plain objects (`{ group, mesh, ... }`) with no knowledge
 * of React or of the UI — the scene composes them and the store reads their ids.
 * Materials are created here and disposed in `disposeObject3D` (see utils/three.js)
 * so the WebGL context can be torn down cleanly.
 */

import * as THREE from 'three';
import { createBodyTextures, glowTexture } from './textures.js';
import { SCALE, renderRadius } from '../data/scale.js';

/** Scratch vector used to derive the sun direction for every shaded body. */
const SUN_DIRECTION = new THREE.Vector3();

/** Spherical atlases always look best with maximum anisotropy. */
function applyAnisotropy(texture, maxAnisotropy) {
  if (texture) {
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
  }
}

/**
 * The Sun: an unlit emissive shell, a temperature-graded corona and the system's
 * only shadow-casting light.
 */
/**
 * The Sun: an animated photosphere, a chromosphere shell, a corona and the system's
 * only shadow-casting light.
 *
 * The surface is a custom shader rather than a plain textured map: two noise octaves
 * scrolling at slightly different rates give real granulation drift and limb
 * darkening, which is what makes the Sun read as a body rather than a bright ball.
 * Cost is a few extra ALU ops on one sphere, and it is skipped entirely on the
 * performance tier.
 */
export function createSun({ quality, radius = SCALE.sunRadius, maxAnisotropy = 8 }) {
  const group = new THREE.Group();
  group.name = 'Sun';

  const textures = createBodyTextures(
    // White-hot core grading out to amber: a star reads as *white* light with warm
    // granulation, and a mostly-orange palette makes it look molten rather than hot.
    { surface: 'sun', palette: ['#FFFDF4', '#FFF3C0', '#FFC65E', '#F08A22'] },
    'sun',
    quality,
  );
  applyAnisotropy(textures.map, maxAnisotropy);

  const animated = quality !== 'performance';
  const segments = quality === 'high' ? 96 : quality === 'performance' ? 40 : 64;

  const material = animated
    ? new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: textures.map },
          uTime: { value: 0 },
          uTint: { value: new THREE.Color(0xfff4dd) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vView = normalize(-viewPosition.xyz);
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform vec3 uTint;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;

          // Cheap value noise: enough for granulation, far cheaper than a full fbm.
          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }

          /**
           * Granulation sampled on a circle rather than in UV space.
           *
           * The texture is strongly banded in latitude (see the banded generator), so
           * sampling noise in raw UV inherits those bands and the Sun looks like a
           * molten rock. Projecting the sphere normal onto a plane gives isotropic
           * cells that tile seamlessly at the seam.
           */
          float granulationAt(vec3 n, float t, float scale) {
            vec2 planar = n.xy * scale + vec2(t * 0.09, t * 0.031);
            vec2 crossPlane = n.zy * scale + vec2(t * -0.052, t * 0.017);
            return noise(planar) * 0.62 + noise(crossPlane) * 0.38;
          }

          void main() {
            vec3 normal = normalize(vNormal);
            float t = uTime;

            float fine = granulationAt(normal, t, 26.0);
            float coarse = granulationAt(normal, t * 0.4, 5.5);
            float granulation = fine * 0.62 + coarse * 0.38;

            vec3 base = texture2D(uMap, vUv).rgb * uTint;
            // Narrow modulation only: the Sun must stay bright and restrained, so the
            // granulation tints the surface rather than darkening it.
            vec3 colour = base * (0.9 + granulation * 0.2);
            // Warm the granulation lanes slightly instead of adding orange everywhere.
            colour += vec3(1.0, 0.76, 0.4) * pow(granulation, 2.6) * 0.16;
            // Push the hottest cells toward white so the disc has a real core.
            colour = mix(colour, vec3(1.0, 0.98, 0.93), pow(granulation, 2.0) * 0.2);

            // Limb darkening: real photospheres are dimmer at the edge, and this is
            // most of what stops an emissive sphere looking like a flat disc.
            float facing = clamp(dot(normal, normalize(vView)), 0.0, 1.0);
            colour *= 0.66 + 0.34 * pow(facing, 0.4);

            gl_FragColor = vec4(colour, 1.0);
          }
        `,
      })
    : new THREE.MeshBasicMaterial({ map: textures.map, color: 0xffdca8 });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.round(segments / 2)), material);
  mesh.name = 'SunSurface';
  group.add(mesh);

  // A thin, hot shell just above the photosphere, brighter where the limb is grazed.
  const chromosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.028, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: textures.map },
        uColor: { value: new THREE.Color(0xffb057) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
          float alpha = pow(clamp(rim, 0.0, 1.0), 2.2) * 0.55;
          gl_FragColor = vec4(uColor * (0.8 + rim), alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  chromosphere.name = 'Chromosphere';
  group.add(chromosphere);

  const coronaTexture = glowTexture();
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: coronaTexture,
      color: 0xffa94d,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.5,
    }),
  );
  corona.scale.setScalar(radius * 5.4);
  corona.renderOrder = -1;
  group.add(corona);

  const innerGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: coronaTexture,
      color: 0xfff0c8,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.62,
    }),
  );
  innerGlow.scale.setScalar(radius * 3.1);
  group.add(innerGlow);

  const light = new THREE.PointLight(0xfff1dc, 2.2, 0, 0.06);
  light.castShadow = false; // enabled by the scene when quality allows
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0006;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 400;
  group.add(light);

  // Selection / aim halo, matching the planets so the Sun is a first-class body.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture([
        [0, 'rgba(255,255,255,0)'],
        [0.6, 'rgba(255,226,178,0)'],
        [0.82, 'rgba(255,226,178,0.5)'],
        [0.94, 'rgba(255,210,140,0.08)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0,
    }),
  );
  halo.scale.setScalar(radius * 3.6);
  halo.renderOrder = 1;
  group.add(halo);

  // The Sun is aimable like any other body, so it carries the same pointing outline.
  const outline = createOutlineSprite(radius, '255,214,150');
  group.add(outline);

  return { group, mesh, chromosphere, corona, innerGlow, light, halo, outline, textures, radius, animated };
}

/**
 * Ring material.
 *
 * The rings are a thin sheet lit by the Sun from the side, which is what gives them
 * their character: they nearly vanish edge-on, the ice warms and densifies at grazing
 * incidence, and they brighten into the forward-scattering opposition surge when the
 * Sun is behind them. A flat unlit material cannot express any of that.
 *
 * `toneMapped: false` is kept from the original look — the ACES curve pulls the ice
 * several stops down and it reads as grey sludge — so the shader is authored to land at
 * roughly the previous average brightness.
 *
 * @param {object} options
 * @param {THREE.Texture} options.ringTexture UV strip across the ring radius
 * @param {object} options.render the body's `render.ring` block (opacity)
 * @param {number} options.planetRadius used for the analytic shadow band
 * @param {boolean} [options.additive] additive luminance pass instead of the sheet
 */
function createRingMaterial({ ringTexture, render, planetRadius, additive = false }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: ringTexture },
      /** Unit vector at the ring, pointing at the Sun. Updated per frame by the scene. */
      uSunDirection: { value: new THREE.Vector3(0, 0, 1) },
      uPlanetPosition: { value: new THREE.Vector3() },
      uPlanetRadius: { value: planetRadius },
      uOpacity: { value: additive ? 0.24 : Math.min(1, render.opacity ?? 0.98) },
      uGain: { value: additive ? 1 : 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDirection;
      uniform vec3 uPlanetPosition;
      uniform float uPlanetRadius;
      uniform float uOpacity;
      uniform float uGain;
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      void main() {
        vec4 texel = texture2D(uMap, vUv);
        float thickness = texel.a;

        // Geometric normal of the sheet, derived from screen-space derivatives so it
        // works for a double-sided annulus without authoring a normal attribute.
        vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
        vec3 sun = normalize(uSunDirection);
        vec3 view = normalize(cameraPosition - vWorldPosition);

        float facing = abs(dot(normal, sun));
        float grazing = 1.0 - abs(dot(normal, view));

        /**
         * Optical depth rises sharply at grazing incidence — the strongest single cue
         * that a ring is a cloud of particles rather than a painted disc. Mixed rather
         * than multiplied, so the sheet never disappears entirely.
         */
        float densified = thickness * mix(1.0, 2.5, pow(grazing, 1.6));

        // Back-scatter: the opposition surge, kept modest because it is only a few
        // tens of percent in reality.
        float backscatter = 0.82 + 0.32 * pow(max(0.0, dot(view, -sun)), 3.2);
        // Low grazing sunlight warms the ice very slightly.
        vec3 tint = mix(vec3(1.0), vec3(1.06, 1.0, 0.92), grazing);

        vec3 colour = texel.rgb * tint * (0.34 + 0.66 * facing * backscatter) * uGain;

        /**
         * The planet's shadow.
         *
         * The rings must not cast into the shadow map: a PointLight cube map cannot
         * resolve geometry 10 m thick spanning 280,000 km, and sampling it drew a hard
         * staircase across the planet. The band is evaluated analytically instead — a
         * ring point is shadowed when it lies behind the planet along the Sun direction
         * and within the planet's radius of that axis.
         */
        float shadow = 1.0;
        vec3 relativeToPlanet = vWorldPosition - uPlanetPosition;
        float alongSun = dot(relativeToPlanet, sun);
        if (alongSun < 0.0) {
          float axisDistance = length(relativeToPlanet - sun * alongSun);
          // A soft penumbra edge, so the band does not read as a cut-out.
          shadow = mix(0.22, 1.0, smoothstep(uPlanetRadius * 0.90, uPlanetRadius * 1.18, axisDistance));
        }

        gl_FragColor = vec4(colour * shadow, min(1.0, densified) * uOpacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    ...(additive ? { blending: THREE.AdditiveBlending } : {}),
  });
}

/** Saturn/Uranus ring annulus, UV-mapped so u runs across the ring radius. */
export function createRings(render, planetRadius, ringTexture, { segments = 220, maxAnisotropy = 8 } = {}) {
  const { inner, outer } = render;
  const innerEdge = planetRadius * inner;
  const outerEdge = planetRadius * outer;

  const buildGeometry = () => {
    const geometry = new THREE.RingGeometry(innerEdge, outerEdge, segments, 4);
    const position = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const v3 = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      v3.fromBufferAttribute(position, i);
      const radius = v3.length();
      const u = THREE.MathUtils.clamp((radius - innerEdge) / (outerEdge - innerEdge), 0, 1);
      uv.setXY(i, u, i % 2 === 0 ? 0 : 1);
    }
    uv.needsUpdate = true;
    return geometry;
  };

  if (ringTexture) {
    ringTexture.anisotropy = maxAnisotropy;
    ringTexture.needsUpdate = true;
  }

  const group = new THREE.Group();
  group.name = 'Rings';

  // Base pass: the physical sheet, with its gaps and varying optical depth.
  const base = new THREE.Mesh(buildGeometry(), createRingMaterial({ ringTexture, render, planetRadius }));
  base.rotation.x = Math.PI / 2;
  base.name = 'RingSheet';
  group.add(base);

  // Luminance pass: a faint additive copy so the ice catches the light at the
  // grazing angles where a single thin sheet reads almost transparent.
  const glow = new THREE.Mesh(
    buildGeometry(),
    createRingMaterial({ ringTexture, render, planetRadius, additive: true }),
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.004;
  glow.name = 'RingGlow';
  group.add(glow);

  return group;
}

/** Custom fresnel shell: bright rim where the view grazes the atmosphere. */
export function createAtmosphere(color, radius, { intensity = 1, power = 2.6 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uPower: { value: power },
      /** Sunlit limb factor: the halo fades on the night side. */
      uSolar: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorldNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uPower;
      uniform vec3 uSolar;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vWorldNormal;
      void main() {
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
        float sunlit = smoothstep(-0.45, 0.35, dot(normalize(vWorldNormal), normalize(uSolar)));
        float alpha = pow(clamp(rim, 0.0, 1.0), uPower) * uIntensity * (0.12 + sunlit * 0.95);
        gl_FragColor = vec4(uColor * (0.7 + rim * 1.4), alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), material);
  mesh.name = 'Atmosphere';
  return mesh;
}

/**
 * Planet surface shading.
 *
 * Earth gets its own pass (day/night terminator plus emissive city lights). Every
 * other body uses `createLitSurfaceMaterial`, which shades from an explicit Sun
 * direction rather than the scene's shadow-casting point light — see that function
 * for why the shadow map is deliberately not used.
 */
function createSurfaceMaterial({ textures, isEarth, quality, roughness, atmosphereColor }) {
  if (isEarth) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: textures.map },
        uNight: { value: textures.lights },
        uClouds: { value: textures.clouds },
        uSunDirection: { value: SUN_DIRECTION },
        uCloudOffset: { value: 0 },
        uHasClouds: { value: quality === 'performance' ? 0 : 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform sampler2D uClouds;
        uniform vec3 uSunDirection;
        uniform float uCloudOffset;
        uniform float uHasClouds;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;

        void main() {
          vec4 day = texture2D(uDay, vUv);
          vec3 normal = normalize(vNormal);
          vec3 view = normalize(vView);
          vec3 sun = normalize(uSunDirection);
          float lambert = dot(normal, sun);
          // A soft, slightly wrapped terminator: real geometry, but readable.
          float wrapped = clamp((lambert + 0.45) / 1.45, 0.0, 1.0);
          wrapped = wrapped * wrapped * (3.0 - 2.0 * wrapped);
          vec3 surface = day.rgb * (0.22 + wrapped * 1.35);

          vec4 night = texture2D(uNight, vUv);
          float nightMask = 1.0 - smoothstep(-0.30, 0.10, lambert);
          vec3 colour = surface + night.rgb * nightMask * 1.35;

          // Oceans: blue-dominant pixels get a Fresnel-weighted specular sheen.
          float ocean = clamp((day.b - day.r) * 3.0, 0.0, 1.0);
          float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
          colour += vec3(0.45, 0.68, 1.0) * ocean * fresnel * 0.55 * wrapped;

          if (uHasClouds > 0.5) {
            vec2 cloudUv = vec2(fract(vUv.x + uCloudOffset), vUv.y);
            float clouds = texture2D(uClouds, cloudUv).a;
            float cloudLight = max(0.08, (lambert + 0.35) / 1.2);
            colour = mix(colour, vec3(0.97, 0.98, 1.0) * cloudLight, clouds * 0.9);
          }
          gl_FragColor = vec4(colour, 1.0);
        }
      `,
    });
  }

  // Every other body is shaded analytically from the Sun direction.
  return createLitSurfaceMaterial({ textures, roughness, atmosphereColor });
}

/**
 * Surface shading for a planet or moon, driven by an explicit Sun direction.
 *
 * These bodies are NOT lit by the scene's PointLight. A point light renders a cube
 * shadow map, and at this scene's scale (a 4-unit star and planets tens of units away)
 * no workable resolution can resolve a ring or a moon, so shadow sampling produced a
 * hard staircase across every terminator. Evaluating the Sun direction per body in the
 * shader gives the same day/night result analytically, with no shadow map and no
 * aliasing — and it costs one dot product.
 *
 * Atmosphere scattering is folded in here too, so a planet's limb warms toward the
 * horizon the way a thin shell of air actually looks.
 */
function createLitSurfaceMaterial({ textures, roughness, bumpScale = 0.035, atmosphereColor }) {
  const uniforms = {
    uMap: { value: textures.map },
    uSunDirection: { value: SUN_DIRECTION },
    uNightTint: { value: new THREE.Color(0x0a0f1c) },
    uRoughness: { value: roughness ?? 0.85 },
    uBumpScale: { value: textures.bumpMap ? bumpScale : 0 },
    uBumpMap: { value: textures.bumpMap || null },
    uHasBump: { value: textures.bumpMap ? 1 : 0 },
    uAtmosphere: { value: atmosphereColor ? new THREE.Color(atmosphereColor) : new THREE.Color(0x000000) },
    uHasAtmosphere: { value: atmosphereColor ? 1 : 0 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform sampler2D uBumpMap;
      uniform vec3 uSunDirection;
      uniform vec3 uNightTint;
      uniform float uRoughness;
      uniform float uBumpScale;
      uniform float uHasBump;
      uniform vec3 uAtmosphere;
      uniform float uHasAtmosphere;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;

      /**
       * Cheap normal perturbation from the bump map.
       *
       * A full tangent-space basis is not worth it for rocky/gas surfaces seen at this
       * size: sampling the height field on a fixed screen-space-ish tangent pair still
       * gives relief shading and a terminator that picks up surface structure.
       */
      vec3 perturbedNormal(vec3 n, vec2 uv) {
        if (uHasBump < 0.5) return n;
        float texel = 1.0 / 1024.0;
        float hL = texture2D(uBumpMap, uv - vec2(texel, 0.0)).r;
        float hR = texture2D(uBumpMap, uv + vec2(texel, 0.0)).r;
        float hD = texture2D(uBumpMap, uv - vec2(0.0, texel)).r;
        float hU = texture2D(uBumpMap, uv + vec2(0.0, texel)).r;
        vec3 slope = vec3((hL - hR), (hD - hU), 0.0) * uBumpScale * 40.0;
        return normalize(n + slope);
      }

      void main() {
        vec3 normal = perturbedNormal(normalize(vNormal), vUv);
        vec3 sun = normalize(uSunDirection);
        // Wrapped lambert: a hard terminator looks like a cut-out, real limbs do not.
        // The wrap and the curve are both gentle, because a strong smoothstep crushes
        // the mid-tones of a banded gas giant and Jupiter ends up reading as dark
        // brown rather than the bright tan it actually is.
        float lambert = dot(normal, sun);
        float wrapped = clamp((lambert + 0.42) / 1.42, 0.0, 1.0);
        wrapped = wrapped * wrapped * (3.0 - 2.0 * wrapped);
        float diffuse = mix(wrapped, pow(wrapped, 0.82), 0.55);

        vec3 albedo = texture2D(uMap, vUv).rgb;
        // The constant term is a deliberate ambient floor: in this scene the Sun is the
        // only light, and without it a moon silhouetted against a gas giant reads as a
        // black hole punched in the planet rather than as a body.
        vec3 colour = albedo * (0.23 + 1.12 * diffuse);

        // A cool ambient fill so the night side reads as dark rock, not a black hole.
        colour += uNightTint * albedo * 0.6;

        // Limb scattering: the rim catches the atmosphere colour where it is sunlit.
        if (uHasAtmosphere > 0.5) {
          float rim = pow(1.0 - clamp(dot(normal, normalize(vView)), 0.0, 1.0), 2.6);
          float sunlitRim = smoothstep(-0.25, 0.45, lambert);
          colour += uAtmosphere * rim * (0.18 + sunlitRim * 0.7);
        }

        gl_FragColor = vec4(colour, 1.0);
      }
    `,
  });
}

/**
 * A planet: surface, optional ring, atmosphere shell and cloud deck.
 * `radius` is a render radius in scene units.
 */
export function createPlanet(definition, radius, { quality, maxAnisotropy = 8, sphereSegments = 64, shadows = false }) {
  const group = new THREE.Group();
  group.name = definition.name;
  group.userData.bodyId = definition.id;

  const isEarth = definition.render.surface === 'earth';
  const textures = createBodyTextures(definition.render, definition.id, quality);
  applyAnisotropy(textures.map, maxAnisotropy);

  const material = createSurfaceMaterial({
    textures,
    isEarth,
    quality,
    roughness: definition.render.roughness,
    atmosphereColor: definition.render.atmosphereColor,
  });

  // Axial tilt lives on a dedicated node so spin stays around the true pole.
  const tiltNode = new THREE.Group();
  tiltNode.rotation.z = THREE.MathUtils.degToRad(definition.axialTilt || 0);
  group.add(tiltNode);

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, sphereSegments, Math.round(sphereSegments / 2)), material);
  mesh.name = `${definition.name}Surface`;
  // Casting is decided by the scene (it depends on radius); receiving lets a ring
  // system throw its shadow across the planet, which is most of what makes Saturn
  // recognisable. Both are off when the preset has no shadow map at all, so the
  // cheaper tiers never pay for shadow sampling.
  mesh.castShadow = false;
  mesh.receiveShadow = shadows;
  mesh.userData.bodyId = definition.id;
  tiltNode.add(mesh);

  // Clouds are composited inside the Earth shader (uCloudOffset) so the deck
  // rotates independently without a second transparent sphere or z-fighting.
  const clouds = null;

  let atmosphere = null;
  if (definition.render.atmosphereColor && quality !== 'performance') {
    const strength = definition.id === 'venus' ? 1.5 : definition.id === 'earth' ? 1.25 : 0.8;
    atmosphere = createAtmosphere(definition.render.atmosphereColor, radius * 1.09, { intensity: strength });
    group.add(atmosphere);
  }

  let rings = null;
  if (definition.render.ring) {
    rings = createRings(definition.render.ring, radius, textures.ring, { maxAnisotropy, segments: quality === 'high' ? 256 : 160 });
    tiltNode.add(rings);
    // The rings receive the planet's shadow (the far side really is dark), but they
    // must NOT cast into the shadow map: a point light renders a cube map, and a
    // 10-metre-thick ring spanning 280,000 km cannot be resolved at any workable
    // resolution. Casting produced a hard staircase across the planet's terminator,
    // which is far more distracting than the missing ring band.
    const ringShadows = shadows && definition.id !== 'saturn' && definition.id !== 'uranus';
    rings.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = ringShadows;
      child.receiveShadow = shadows;
    });
  }

  // A faint selection halo, faded in by the UI when this body is selected.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture([
        [0, 'rgba(255,255,255,0)'],
        [0.62, 'rgba(255,255,255,0)'],
        [0.82, `rgba(255,255,255,0.5)`],
        [0.94, 'rgba(255,255,255,0.06)'],
        [1, 'rgba(255,255,255,0)'],
      ]),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    }),
  );
  halo.scale.setScalar(radius * 6);
  group.add(halo);

  // Pointing feedback: a contained limb outline, independent of the wide halo above.
  // Added to the untilted group so the ring stays concentric with the silhouette (on
  // the tilt node it would inherit the axial tilt and sit off-centre).
  const outline = createOutlineSprite(radius);
  group.add(outline);

  return { group, mesh, tiltNode, clouds, rings, halo, outline, atmosphere, textures, radius };
}

/** A moon: same surface pipeline, simpler surroundings. */
export function createMoon(definition, radius, { quality, maxAnisotropy = 8 }) {
  const group = new THREE.Group();
  group.name = definition.name;
  group.userData.bodyId = definition.id;

  const textures = createBodyTextures(definition.render, definition.id, quality === 'high' ? 'balanced' : 'performance');
  applyAnisotropy(textures.map, maxAnisotropy);

  // Moons are lit analytically like the planets, so a moon in a planet's shadow would
  // still be lit — acceptable at this scale, and far better than cube-map aliasing.
  const material = createLitSurfaceMaterial({
    textures,
    roughness: definition.render.roughness ?? 0.95,
    bumpScale: 0.02,
  });
  const segments = quality === 'high' ? 40 : quality === 'balanced' ? 26 : 16;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments / 2), material);
  mesh.userData.bodyId = definition.id;
  mesh.castShadow = false;
  group.add(mesh);

  // Moons are aimable too, so they carry the same pointing outline.
  const outline = createOutlineSprite(radius, '190,214,246');
  group.add(outline);

  return { group, mesh, outline, textures, radius };
}

/** Fixed-radius sphere used for the interactive hit target of tiny moons. */
export function createHitProxy(radius, minRadius = 0.34) {
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(radius, minRadius), 12, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  proxy.name = 'HitProxy';
  return proxy;
}

/**
 * A tight outline ring that hugs a body's limb.
 *
 * This is deliberately not the selection halo: the halo is a wide, diffuse glow that
 * says "this one is chosen", whereas pointing needs a *contained* outline that says
 * "this is what your finger is on" without lighting up the space around it. Same sprite
 * technique, but the gradient is a narrow annulus at 0.90–1.0 of the sprite radius, and
 * the sprite is only ~1.4 planet radii across so the band lands on the limb.
 *
 * A sprite is used rather than a back-face shell because it is one draw call, needs no
 * geometry, and is immune to the z-fighting and inverted-normal problems a scaled shell
 * has on an irregular body.
 */
export function createOutlineSprite(radius, color = '200,224,255') {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture([
        [0, 'rgba(255,255,255,0)'],
        [0.88, 'rgba(255,255,255,0)'],
        [0.935, `rgba(${color},0.7)`],
        [0.968, `rgba(${color},0.26)`],
        [1, 'rgba(255,255,255,0)'],
      ]),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    }),
  );
  sprite.name = 'Outline';
  sprite.scale.setScalar(radius * 2.8);
  return sprite;
}

export { renderRadius };
