/**
 * SolarSystemScene — the WebGL layer.
 *
 * Deliberately framework-agnostic: React only calls `setQuality`, `setTimeScale`,
 * `setOrbitVisibility`, `focus` and `dispose`. Everything else (orbital motion,
 * rotation, picking, particles) lives here so the render loop never touches React
 * state on the hot path.
 *
 * Orbital model: semi-major axes and periods come from real data, mean anomalies
 * at J2000 from JPL's approximate elements, so planets start roughly where they
 * actually were on 1 January 2000 and advance at the correct relative rates.
 */

import * as THREE from 'three';
import { PLANETS, SUN } from '../data/planets.js';
import { MOONS_BY_PARENT } from '../data/moons.js';
import { COSMIC_SCALE, QUALITY_PRESETS, SCALE, renderMoonOrbit, renderOrbit, renderRadius } from '../data/scale.js';
import { createHitProxy, createMoon, createPlanet, createSun } from '../utils/bodies.js';
import { createCosmicLayers, disposeCosmicLayers, updateCosmicLayers } from './cosmic.js';
import {
  createCoronalDust,
  createNebulaPatches,
  createStarfield,
  prefersReducedMotion,
  updateCoronalDust,
  updateStarfield,
} from './starfield.js';
import { bodyLabelTexture, createBodyLabel, updateLabelScale } from '../utils/labels.js';

const DEG = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);

const _sunDirection = new THREE.Vector3();
const _bodyWorldPosition = new THREE.Vector3();
const _viewRotation = new THREE.Matrix4();
/** Scratch for the small-body pick priority test (no per-pick allocation). */
const _pickBodyPosition = new THREE.Vector3();
const _pickProjected = new THREE.Vector3();

export class SolarSystemScene {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container  element the canvas is appended to
   * @param {string} [options.canvasClassName] class applied to the created canvas
   *
   * The scene creates its own canvas rather than borrowing one from the DOM. A
   * WebGL context that has been lost can never be re-created on the same canvas,
   * so owning (and discarding) the element is what makes teardown — including
   * React StrictMode's mount/unmount/mount cycle — safe.
   */
  constructor({
    container,
    canvasClassName = 'solar-system-canvas',
    quality = 'balanced',
    timeScale = 1,
    startDate = null,
    onReady = null,
    cameraController = null,
  }) {
    this.container = container;
    this.canvasClassName = canvasClassName;
    this.cameraController = cameraController;
    this.onReady = onReady;
    this.quality = QUALITY_PRESETS[quality] ? quality : 'balanced';

    this.canvas = document.createElement('canvas');
    this.canvas.className = canvasClassName;
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);

    this.registry = new Map(); // id -> record (body, moons, pivot, ...)
    this.pickTargets = [];
    this.labels = [];
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.days = (Date.now() - J2000) / 86400000;
    if (startDate instanceof Date) this.days = (startDate.getTime() - J2000) / 86400000;
    this.timeScale = timeScale;
    this.orbitLines = [];
    this.showOrbits = true;
    this.lastFrameTimes = [];
    this.disposed = false;

    this._initRenderer();
    this._initScene();
    this._buildSystem();
    this._initEvents();
    this.resize();
  }

  // ————————————————————————— infrastructure —————————————————————————

  _initRenderer() {
    const preset = QUALITY_PRESETS[this.quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality !== 'performance',
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x05070d, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 4000);
    this.camera.position.set(0, 26, 78);

    this.root = new THREE.Group();
    this.root.name = 'SolarSystem';
    this.scene.add(this.root);

    this.ambient = new THREE.AmbientLight(0x2b3350, 0.55);
    this.scene.add(this.ambient);
    // Weak fill so night sides are readable without washing out the terminator.
    this.hemi = new THREE.HemisphereLight(0x334066, 0x080a12, 0.28);
    this.scene.add(this.hemi);

    this.orbitGroup = new THREE.Group();
    this.orbitGroup.name = 'Orbits';
    this.root.add(this.orbitGroup);

    this.bodyGroup = new THREE.Group();
    this.bodyGroup.name = 'Bodies';
    this.root.add(this.bodyGroup);

    this.labelGroup = new THREE.Group();
    this.labelGroup.name = 'Labels';
    this.root.add(this.labelGroup);
  }

  // ————————————————————————— construction —————————————————————————

  _buildSystem() {
    const preset = QUALITY_PRESETS[this.quality];
    this.sun = createSun({ quality: this.quality, maxAnisotropy: this.maxAnisotropy });
    this.scene.add(this.sun.group);
    this.scene.add(this.sun.light);
    this.registry.set(SUN.id, { definition: SUN, ...this.sun, radius: this.sun.radius, isSun: true });
    // The Sun is pickable and aimable like any other body.
    this.sun.mesh.userData.bodyId = SUN.id;
    this.pickTargets.push(this.sun.mesh);

    if (preset.shadows && this.sun.light.castShadow) {
      // Nothing in the scene casts into the shadow map any more: every surface is lit
      // analytically from the Sun direction (see createLitSurfaceMaterial), because a
      // PointLight cube map cannot resolve this scene's ring and moon geometry without
      // hard staircase aliasing. Keeping the light's shadow switched off avoids paying
      // for a map that nothing samples.
      this.sun.light.castShadow = false;
    }

    for (const planet of PLANETS) {
      this._buildPlanet(planet, preset);
    }

    const reducedMotion = prefersReducedMotion();
    const field = createStarfield({
      count: preset.starCount,
      nebula: preset.nebula,
      twinkle: preset.nebula && !reducedMotion,
      motion: !reducedMotion,
      radius: 900,
    });
    this.starfield = field;
    this.scene.add(field.group);
    // Held constant when the user asked for reduced motion, which freezes the
    // photosphere's convection along with the starfield drift.
    this.animateSurfaces = !reducedMotion;

    // Distant nebula clouds sit outside the star shells, behind everything else.
    const patches = createNebulaPatches({ radius: 1500, quality: this.quality });
    this.nebulaPatches = patches;
    if (patches.group.children.length) this.scene.add(patches.group);

    this.dust = createCoronalDust({ count: preset.coronalDust, innerRadius: 7, outerRadius: 68 });
    if (this.dust) this.root.add(this.dust.points);

    /**
     * Cosmic-scale representations (Oort Cloud, Milky Way, the Sun's marker).
     *
     * They sit outside `root` because they are not part of the solar-system model and must
     * not inherit its depth compensation — each has its own reference distance. Hidden until
     * a cosmic stage asks for them, so they cost nothing in normal use.
     */
    this.cosmic = createCosmicLayers({ quality: this.quality });
    this.scene.add(this.cosmic.root);
  }

  _buildPlanet(definition, preset) {
    const radius = renderRadius(definition.diameter);
    const orbitRadius = renderOrbit(definition.distanceAu);
    const inclination = this._inclinationFor(definition);
    const eccentricity = definition.eccentricity || 0.01 + (definition.order % 3) * 0.008;

    const pivot = new THREE.Group();
    pivot.name = `${definition.name}Orbit`;
    pivot.rotation.x = inclination * DEG;
    this.bodyGroup.add(pivot);

    const built = createPlanet(definition, radius, {
      quality: this.quality,
      maxAnisotropy: this.maxAnisotropy,
      sphereSegments: preset.sphereSegments,
      shadows: preset.shadows,
    });
    built.mesh.castShadow = preset.shadows && radius > 0.25;
    pivot.add(built.group);

    // Orbit line: three points per ellipse step for a smooth, very thin ring.
    const curve = new THREE.EllipseCurve(
      0,
      0,
      orbitRadius,
      orbitRadius * Math.sqrt(1 - eccentricity * eccentricity),
      0,
      Math.PI * 2,
      false,
      0,
    );
    const points = curve.getPoints(this.quality === 'performance' ? 128 : 256).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(definition.accent).multiplyScalar(0.55),
      transparent: true,
      opacity: definition.id === 'earth' ? 0.42 : 0.26,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.name = `${definition.name}OrbitLine`;
    line.rotation.x = inclination * DEG;
    // Remembered so focus mode can scale it without losing the authored value.
    line.userData.baseOpacity = material.opacity;
    this.orbitGroup.add(line);
    this.orbitLines.push(line);

    const record = {
      definition,
      ...built,
      pivot,
      orbitRadius,
      eccentricity,
      inclination,
      radius,
      moons: [],
      spin: 0,
      meanAnomaly: this._meanAnomalyAtEpoch(definition),
      dailyMotion: 360 / definition.orbitalPeriodDays,
      cloudOffset: 0,
    };

    // Moons (only those defined for this planet in the data layer).
    const moonDefinitions = MOONS_BY_PARENT[definition.id] || [];
    const maxAxis = moonDefinitions.reduce((max, moon) => Math.max(max, moon.semiMajorAxisKm), 0);
    for (const moon of moonDefinitions) {
      const moonRadius = Math.max(0.075, renderRadius(moon.diameter, SCALE.moonSizeExponent));
      const orbit = renderMoonOrbit(moon.semiMajorAxisKm, maxAxis, radius);
      const moonPivot = new THREE.Group();
      moonPivot.name = `${moon.name}Orbit`;
      moonPivot.rotation.x = (Math.random() - 0.5) * 0.06;
      built.group.add(moonPivot);

      const moonBuilt = createMoon(moon, moonRadius, { quality: this.quality, maxAnisotropy: this.maxAnisotropy });
      moonBuilt.group.position.x = orbit;
      moonPivot.add(moonBuilt.group);

      const proxy = createHitProxy(moonRadius, 0.26);
      proxy.userData.bodyId = moon.id;
      moonBuilt.group.add(proxy);

      // Faint moon orbit ring keeps the system legible when zoomed in.
      const moonCurve = new THREE.EllipseCurve(0, 0, orbit, orbit, 0, Math.PI * 2, false, 0);
      const moonGeometry = new THREE.BufferGeometry().setFromPoints(
        moonCurve.getPoints(96).map((p) => new THREE.Vector3(p.x, 0, p.y)),
      );
      const moonLine = new THREE.LineLoop(
        moonGeometry,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(definition.accent).multiplyScalar(0.5),
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
        }),
      );
      moonPivot.add(moonLine);

      const moonRecord = {
        definition: moon,
        ...moonBuilt,
        pivot: moonPivot,
        parent: definition.id,
        orbit,
        line: moonLine,
        meanAnomaly: this._moonMeanAnomaly(moon),
        dailyMotion: 360 / moon.orbitalPeriodDays,
      };
      this.registry.set(moon.id, moonRecord);
      record.moons.push(moonRecord);
      this.pickTargets.push(moonBuilt.mesh, proxy);
    }

    this.registry.set(definition.id, record);
    this.pickTargets.push(built.mesh);

    const label = createBodyLabel(definition, radius);
    label.userData.bodyId = definition.id;
    built.group.add(label);
    this.labels.push(label);
  }

  /**
   * Small artificial inclination per planet so the system does not look like a
   * flat disc, while keeping the true ordering of the orbits.
   */
  _inclinationFor(definition) {
    const table = {
      mercury: 7,
      venus: 3.4,
      earth: 0,
      mars: 1.9,
      jupiter: 1.3,
      saturn: 2.5,
      uranus: 0.8,
      neptune: 1.8,
    };
    return table[definition.id] ?? 1.5;
  }

  /** Mean anomaly (deg) at J2000 from JPL approximate elements. */
  _meanAnomalyAtEpoch(definition) {
    const elements = {
      mercury: { L: 252.25, peri: 77.46 },
      venus: { L: 181.98, peri: 131.56 },
      earth: { L: 100.47, peri: 102.95 },
      mars: { L: 355.45, peri: 336.06 },
      jupiter: { L: 34.4, peri: 14.75 },
      saturn: { L: 49.94, peri: 92.6 },
      uranus: { L: 313.23, peri: 170.96 },
      neptune: { L: 304.88, peri: 44.97 },
    }[definition.id];
    if (!elements) return Math.random() * 360;
    return (elements.L - elements.peri + 360) % 360;
  }

  _moonMeanAnomaly(moon) {
    // Stable pseudo-random phase per moon id.
    let hash = 0;
    for (let i = 0; i < moon.id.length; i += 1) hash = (hash * 31 + moon.id.charCodeAt(i)) % 100000;
    return hash / 100000 * 360;
  }

  /**
   * Push the correct sun direction into every custom material.
   * Called once per frame after the world matrices are refreshed.
   */
  _updateLighting() {
    // Rotation-only view matrix: turns a world direction into view space.
    _viewRotation.extractRotation(this.camera.matrixWorldInverse);

    // Both planets and moons shade from `uSunDirection`; a body only receives the
    // update if its material actually declares the uniform.
    for (const record of this.registry.values()) {
      if (!record.mesh || record.isSun) continue;
      const material = Array.isArray(record.mesh.material) ? record.mesh.material[0] : record.mesh.material;
      if (!material || !material.uniforms) continue;

      // Direction from this body toward the Sun (the Sun sits at the origin).
      record.mesh.getWorldPosition(_bodyWorldPosition);
      _sunDirection.copy(_bodyWorldPosition).multiplyScalar(-1).normalize();

      const dayUniform = material.uniforms.uSunDirection;
      if (dayUniform) {
        // The shaders compare view-space vectors, so rotate into view space.
        dayUniform.value.copy(_sunDirection).transformDirection(_viewRotation).normalize();
      }

      if (record.atmosphere && record.atmosphere.material.uniforms.uSolar) {
        record.atmosphere.material.uniforms.uSolar.value.copy(_sunDirection);
      }

      /**
       * Rings shade themselves from the Sun too. Their uniforms are world-space: the
       * scene is not rotated, so the body-to-Sun vector needs no view transform, and
       * the analytic planet shadow needs the planet's own position and radius.
       */
      if (record.rings) {
        for (const child of record.rings.children) {
          const uniforms = child.material?.uniforms;
          if (!uniforms || !uniforms.uSunDirection) continue;
          uniforms.uSunDirection.value.copy(_sunDirection);
          uniforms.uPlanetPosition.value.copy(_bodyWorldPosition);
        }
      }
    }
  }

  // ————————————————————————— interaction —————————————————————————

  _initEvents() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
  }

  resize() {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    const width = parent ? parent.clientWidth : window.innerWidth;
    const height = parent ? parent.clientHeight : window.innerHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width / height < 0.85 ? 58 : 42;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[this.quality].maxPixelRatio),
    );
  }

  /** Raycast from normalised device coordinates; returns null or a hit record. */
  pick(ndcX, ndcY, { visibleOnly = true } = {}) {
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = this.pickTargets.filter((target) => {
      if (!visibleOnly) return true;
      if (!target.visible) return false;
      let node = target;
      while (node) {
        if (node.visible === false) return false;
        node = node.parent;
      }
      return true;
    });
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const hit = hits[0];
    // The visible sphere and its invisible proxy share the same body id.
    let node = hit.object;
    let id = node.userData.bodyId;
    while (!id && node.parent) {
      node = node.parent;
      id = node.userData.bodyId;
    }
    if (!id) return null;
    return { id, point: hit.point, distance: hit.distance };
  }

  /**
   * Pick helper that lets a small satellite win over the body behind it.
   *
   * A moon in front of its planet is often a handful of pixels wide while the planet's
   * limb sweeps across the same spot, so the raycast correctly reports the planet and
   * the moon becomes effectively unclickable — the user is aiming at a visible moon and
   * hitting a planet. When the pointer lands inside the small body's own disc, that body
   * wins. This is a deliberate hit-testing affordance, not a depth change: nothing about
   * the render is altered, only which body a click resolves to.
   */
  pickWithPriority(ndcX, ndcY, { visibleOnly = true } = {}) {
    const primary = this.pick(ndcX, ndcY, { visibleOnly });
    // Only planets with modelled moons create the occlusion problem.
    const candidates = this.pickTargets.filter((target) => {
      const bodyId = target.userData.bodyId;
      if (!bodyId || !this.registry.get(bodyId)?.parent) return false;
      if (!visibleOnly) return true;
      let node = target;
      while (node) {
        if (node.visible === false) return false;
        node = node.parent;
      }
      return true;
    });
    if (!candidates.length) return primary;

    const smallHits = this.raycaster.intersectObjects(candidates, false);
    if (!smallHits.length) return primary;

    const near = smallHits[0];
    let node = near.object;
    let id = node.userData.bodyId;
    while (!id && node.parent) {
      node = node.parent;
      id = node.userData.bodyId;
    }
    if (!id || (primary && primary.id === id)) return primary;

    // Accept the satellite only if the pointer is genuinely inside its own disc. The
    // slop is small on purpose: the raycast target is a proxy slightly larger than the
    // mesh, while this test projects the mesh, so a little slack is needed — but a
    // generous margin would steal clicks aimed at the planet's centre.
    const record = this.registry.get(id);
    if (!record?.mesh) return primary;
    record.mesh.getWorldPosition(_pickBodyPosition);
    const distance = _pickBodyPosition.distanceTo(this.camera.position);
    if (distance < 1e-4) return primary;
    _pickProjected.copy(_pickBodyPosition).project(this.camera);
    const slop = 1.1;
    const radiusNdc = (this.getBodyRadius(id) / distance) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dx = ndcX - _pickProjected.x;
    const dy = ndcY - _pickProjected.y;
    if (Math.hypot(dx, dy) > radiusNdc * slop) return primary;

    return { id, point: near.point, distance: near.distance };
  }

  /** World-space position of a body's centre (used by the camera controller). */
  getBodyPosition(id, target = new THREE.Vector3()) {
    const record = this.registry.get(id);
    if (!record) return target.set(0, 0, 0);
    if (record.isSun) return target.set(0, 0, 0);
    return record.group.getWorldPosition(target);
  }

  /** Effective radar radius of a body in scene units (for camera framing). */
  getBodyRadius(id) {
    const record = this.registry.get(id);
    if (!record) return 1;
    if (record.isSun) return record.radius;
    return record.radius;
  }

  /** Registry record for a body (definition + meshes). */
  getRecord(id) {
    return this.registry.get(id) || null;
  }

  // ————————————————————————— runtime controls —————————————————————————

  setQuality(quality) {
    if (!QUALITY_PRESETS[quality] || quality === this.quality) return;
    // Rebuilding is the honest way to change segment counts and particle budgets.
    this.pendingQuality = quality;
  }

  setTimeScale(scale) {
    this.timeScale = scale;
  }

  setSimulationDate(date) {
    this.days = (date.getTime() - J2000) / 86400000;
  }

  getSimulationDate() {
    return new Date(J2000 + this.days * 86400000);
  }

  setOrbitVisibility(visible) {
    this.showOrbits = visible;
    this.orbitGroup.visible = visible;
    for (const record of this.registry.values()) {
      if (record.line) record.line.visible = visible;
    }
  }

  /**
   * Dim the orbit rings while a single body is being studied.
   *
   * The rings are genuinely tessellated in world space, so from a steep angle an inner
   * planet's orbit passes in front of an outer body and draws a line straight across its
   * disc. That is not a depth bug — it is correct geometry — but it competes with the
   * body, so focus mode fades the rings back rather than hiding them (context is still
   * useful) and the detail panel's "less UI" rule holds.
   */
  setOrbitEmphasis(emphasis) {
    const opacity = THREE.MathUtils.clamp(emphasis, 0, 1);
    if (this._orbitEmphasis === opacity) return;
    this._orbitEmphasis = opacity;
    for (const line of this.orbitLines) {
      if (!line.material) continue;
      const base = line.userData.baseOpacity ?? 0.26;
      line.material.opacity = base * (0.34 + opacity * 0.66);
    }
  }

  setLabelVisibility(visible) {
    this.labelGroup.visible = visible;
    for (const label of this.labels) label.visible = visible;
  }

  /**
   * Voyager Experience depth compensation.
   *
   * The departure is unbounded — thousands of units — while the starfield shell sits at a
   * few hundred and the camera's far plane is 4000. Simply flying outward would run the
   * camera *through* the star shell and eventually out of the scene entirely.
   *
   * Two things happen instead, and together they are what makes the shot work:
   *
   *  - the system is scaled by `reference / distance`, which cancels the growth in
   *    distance exactly. The solar system therefore keeps a nearly constant apparent
   *    size while the star field streams past it, which is precisely the sensation of
   *    leaving a system rather than watching it shrink;
   *  - the navigation aids (orbit rings, labels) fade out, because a crisp orbit line at
   *    interstellar range destroys the illusion.
   *
   * @param {number} voyageDistance current distance from the departure origin
   * @param {number} reference      distance at which the scale is 1
   */
  setVoyageDepth(voyageDistance, reference = 90) {
    if (!this.root) return;
    const scale = THREE.MathUtils.clamp(reference / Math.max(1, voyageDistance), 0.0016, 1);
    this.root.scale.setScalar(scale);

    const intimacy = THREE.MathUtils.clamp(scale * 16, 0, 1);
    if (this._voyageIntimacy === intimacy) return;
    this._voyageIntimacy = intimacy;
    for (const line of this.orbitLines) {
      if (!line.material) continue;
      const base = line.userData.baseOpacity ?? 0.26;
      line.material.opacity = base * intimacy;
    }
    // Labels are faded by distance inside the frame loop, so hiding the group is the only
    // honest way to retire them here.
    this.labelGroup.visible = this.showLabels !== false && intimacy > 0.5;
  }

  /** Restore the pre-departure state (scale, orbit emphasis, labels). */
  resetVoyageDepth() {
    if (this.root) this.root.scale.setScalar(1);
    this._voyageIntimacy = undefined;
    this.labelGroup.visible = this.showLabels !== false;
  }

  /** Highlight the selected body with a soft halo. */
  setSelection(id) {
    this.selectedId = id;
    this._applyHalos();
  }

  /**
   * Cosmic Scale stage control.
   *
   * The solar-system model is only meaningful for the four inner stages; the Oort Cloud and
   * Milky Way stages replace it with their own representations, so the model is hidden
   * rather than scaled into invisibility. Labels and orbit rings are retired at the same
   * time — at galactic range they would be meaningless noise.
   */
  setCosmicStage(stage) {
    this.cosmicActive = Boolean(stage);
    this.cosmicStage = stage ?? null;
    // The solar-system model is shown unless the stage names a replacement. Testing for the
    // replacement rather than for 'system' matters: the inner rungs carry no explicit
    // `visual`, and requiring the positive value hid the system on Earth and the Moon.
    const visual = stage ? COSMIC_SCALE.stages[stage]?.visual : 'system';
    const showsSystem = visual !== 'oort' && visual !== 'galaxy';
    this.root.visible = showsSystem;
    this.starfield.group.visible = true;
    this._cosmicShowsSystem = showsSystem;
    if (!showsSystem) {
      // Nothing in the solar system is on screen, so its rings and labels must not be.
      this.labelGroup.visible = false;
      for (const line of this.orbitLines) line.visible = false;
    } else {
      this.labelGroup.visible = this.showLabels !== false;
      for (const line of this.orbitLines) line.visible = true;
    }
    if (this.cosmic) {
      updateCosmicLayers(this.cosmic, {
        stage: stage ?? null,
        transition: 1,
        distance: this.cameraController?.cosmicDistance ?? 1,
      });
    }
  }

  /** Leave Cosmic Scale and restore the solar-system presentation. */
  clearCosmicStage() {
    this.setCosmicStage(null);
    if (this.root) this.root.scale.setScalar(1);
    if (this.starfield) this.starfield.group.scale.setScalar(1);
    if (this.cosmic) {
      this.cosmic.root.visible = false;
      this.cosmic.oort.points.visible = false;
      this.cosmic.galaxy.group.visible = false;
      this.cosmic.marker.group.visible = false;
    }
    this.labelGroup.visible = this.showLabels !== false;
    for (const line of this.orbitLines) line.visible = true;
    this._cosmicAids = undefined;
  }

  /**
   * Outline / halo for the body a hand is currently aimed at, independent of selection
   * so pointing can preview a body without committing to it.
   */
  setAim(id, opacity = 0.22) {
    this.aimedId = id;
    this.aimOpacity = opacity;
    this._applyHalos();
  }

  /**
   * Aim / selection feedback.
   *
   * Two separate cues, because they answer different questions:
   *  - the **halo** is a wide diffuse glow meaning "this one is chosen";
   *  - the **outline** is a contained limb ring meaning "your finger is on this".
   *
   * Pointing drives the outline and a dimmer halo; selection drives the bright halo.
   * Both are additive sprites faded by opacity, so nothing re-compiles when they change.
   */
  _applyHalos() {
    const selected = this.selectedId;
    const aimed = this.aimedId;
    const aimOpacity = this.aimOpacity ?? 0.42;
    for (const [key, record] of this.registry) {
      if (record.halo) {
        if (key === selected) record.halo.material.opacity = 0.55;
        else if (key === aimed) record.halo.material.opacity = aimOpacity;
        else record.halo.material.opacity = 0;
      }
      if (record.outline) {
        // Restrained on purpose: the outline marks the fingertip target, it does not
        // celebrate it. Stronger when it is also the selection, so the two states stay
        // distinguishable without needing different geometry.
        if (key === aimed) record.outline.material.opacity = key === selected ? 0.7 : 0.5;
        else record.outline.material.opacity = 0;
      }
    }
  }

  /**
   * Pick a body from normalised screen coordinates (0–1, origin top-left).
   * Used by the gesture layer, which works in camera-normalised space.
   */
  pickFromScreen(x, y) {
    const canvas = this.canvas;
    if (!canvas) return null;
    const ndcX = x * 2 - 1;
    const ndcY = -(y * 2 - 1);
    const hit = this.pickWithPriority(ndcX, ndcY);
    if (!hit) return null;
    const record = this.registry.get(hit.id);
    return {
      id: hit.id,
      name: record?.definition?.name || hit.id,
      point: hit.point,
      distance: hit.distance,
    };
  }

  // ————————————————————————— frame loop —————————————————————————

  update() {
    if (this.disposed) return;
    if (this.pendingQuality) return; // handled by the React layer (full rebuild)

    const delta = Math.min(0.1, this.clock.getDelta());
    this.elapsed += delta;
    const dayStep = delta * this.timeScale;
    this.days += dayStep;

    // Sun: slow differential rotation, drifting surface, gently breathing corona.
    this.sun.mesh.rotation.y += delta * 0.035 * (1 + Math.log10(Math.max(1, this.timeScale)) * 0.2);
    // The shader already scrolls its own noise; advancing uTime at a constant rate
    // keeps the granulation independent of the simulation speed.
    if (this.sun.animated) {
      this.sun.mesh.material.uniforms.uTime.value = this.animateSurfaces === false ? 0 : this.elapsed;
    }
    const pulse = 1 + Math.sin(this.elapsed * 0.6) * 0.014;
    this.sun.corona.scale.setScalar(this.sun.radius * 5.4 * pulse);
    this.sun.innerGlow.scale.setScalar(this.sun.radius * 3.1 * (2 - pulse));

    for (const planet of PLANETS) {
      const record = this.registry.get(planet.id);
      if (!record) continue;
      const anomaly = (record.meanAnomaly + this.days * record.dailyMotion) * DEG;
      const a = record.orbitRadius;
      const b = a * Math.sqrt(1 - record.eccentricity * record.eccentricity);
      const x = Math.cos(anomaly) * a - a * record.eccentricity;
      const z = Math.sin(anomaly) * b;
      record.pivot.position.set(x, 0, z);

      // Rotation: sidereal period, compressed so a 10-hour day is still visible.
      const rotationHours = Math.abs(planet.rotationHours);
      const visibleSpin = delta * this.timeScale * (24 / rotationHours) * 0.6;
      const direction = planet.rotationHours < 0 ? -1 : 1;
      record.mesh.rotation.y += visibleSpin * direction;
      if (record.mesh.material.uniforms && record.mesh.material.uniforms.uCloudOffset) {
        record.cloudOffset += direction * visibleSpin * 0.35;
        record.mesh.material.uniforms.uCloudOffset.value = record.cloudOffset;
      }

      // Moons.
      for (const moon of record.moons) {
        const moonAnomaly = (moon.meanAnomaly + this.days * moon.dailyMotion) * DEG;
        moon.pivot.rotation.y = -moonAnomaly;
        moon.mesh.rotation.y = moonAnomaly; // tidally locked: same face to parent
      }
    }

    this.root.updateMatrixWorld();

    // Sun direction per body, expressed in view space for the day/night shader and
    // in world space for the atmosphere limb. Without this every body renders
    // unlit, because the uniforms would keep their zero initial value.
    this._updateLighting();

    if (this.labelGroup.visible) {
      for (const label of this.labels) {
        // Labels hang below each planet group, offset so they clear the sphere.
        label.position.y = -(label.userData.gap || 0.4);
        updateLabelScale(label, this.camera);
      }
    }

    if (this.starfield) {
      updateStarfield(this.starfield, this.elapsed);
    }
    updateCoronalDust(this.dust, delta);

    if (this.cameraController) {
      this.cameraController.update(delta);
      // The departure needs its depth compensation applied from the distance the rig just
      // computed, so this must follow the controller update.
      if (this.cameraController.mode === 'escape') {
        this.setVoyageDepth(this.cameraController.voyageDistance ?? 1);
      }
      /**
       * Cosmic-scale depth compensation.
       *
       * Everything is scaled by `visibleRadius / reference`:
       *
       *  - the solar-system model shrinks by `visibleSystemRadius / distance`, so it becomes
       *    a small bright point once the camera is hundreds of units out — which is the whole
       *    point of the Oort Cloud and Galaxy rungs;
       *  - the Oort shell and the Galaxy disc scale by their own visible radii, so each fills
       *    a consistent share of the frame at its own reference distance.
       *
       * Applied whenever a stage is active, not only while the camera is in `cosmic` mode:
       * the rig hands back to `system` when a flight settles so the user can orbit the
       * Galaxy, and gating on the mode made the scale snap back to 1 the moment the flight
       * ended.
       */
      const cosmicStage = this.cameraController.cosmicStage;
      if (this.cosmicActive && cosmicStage && this.cameraController.mode !== 'escape') {
        const distance = Math.max(1, this.cameraController.cosmicDistance ?? 1);
        const preset = COSMIC_SCALE.stages[cosmicStage] ?? null;
        const reference = preset?.reference ?? 120;

        this.root.scale.setScalar(
          THREE.MathUtils.clamp(COSMIC_SCALE.visibleSystemRadius / distance, 1e-5, 1),
        );

        /**
         * Retire the navigation aids.
         *
         * The system's orbit rings and labels describe the solar system; at Oort Cloud and
         * galactic range they are noise, and their ordinary distance-based fade does not
         * help because the camera is looking at bodies it is *leaving*, not approaching.
         * The test is expressed against the root's own scale — one number the whole
         * representation already agrees on — so it fires at the same apparent size on every
         * stage instead of needing a per-stage threshold.
         */
        const scale = this.root.scale.x;
        const aids = THREE.MathUtils.clamp((scale - 0.018) / 0.03, 0, 1);
        if (Math.abs((this._cosmicAids ?? -1) - aids) > 1e-3) {
          this._cosmicAids = aids;
          for (const line of this.orbitLines) {
            if (!line.material) continue;
            line.material.opacity = (line.userData.baseOpacity ?? 0.26) * aids;
          }
          this.labelGroup.visible = this.showLabels !== false && aids > 0.5;
        }
        // The star shells grow instead of shrinking so the sky never collapses in on the
        // camera as it leaves; the clamp keeps them inside the far plane.
        const starScale = THREE.MathUtils.clamp(distance / reference, 1, 8);
        this.starfield.group.scale.setScalar(starScale);

        if (this.cosmic?.oort) {
          this.cosmic.oort.points.scale.setScalar(
            (COSMIC_SCALE.visibleOortRadius * preset.distance) / reference,
          );
        }
        if (this.cosmic?.galaxy) {
          this.cosmic.galaxy.group.scale.setScalar(
            (COSMIC_SCALE.visibleGalaxyRadius * preset.distance) / reference / this.cosmic.galaxy.discRadius,
          );
          this.cosmic.marker.group.scale.setScalar(1 / Math.max(1e-6, this.cosmic.galaxy.group.scale.x));
        }

        updateCosmicLayers(this.cosmic, {
          stage: cosmicStage,
          transition: 1 - (this.cameraController.cosmicProgress ?? 1),
          distance,
        });
        this._cosmicLast = { stage: cosmicStage, reference, distance, root: this.root.scale.x };
      }
    }

    this.renderer.render(this.scene, this.camera);

    if (this.checkedPrograms !== true) {
      this.checkedPrograms = true;
      // If the GPU refused every shader program the canvas stays black. Report it
      // with something actionable rather than failing silently.
      const compiled = this.renderer.info.programs?.length ?? 0;
      if (compiled === 0) {
        console.error(
          '[SolarSystemScene] No shader programs compiled — the 3D view cannot draw. ' +
            'On a dev server a stale dependency cache is the usual cause: stop it and run `npm run clean`.',
        );
      }
    }
  }

  /** Full teardown: releases geometries, materials, textures and the canvas. */
  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this._resizeHandler);
    // Cosmic layers live outside the collected object graph below, so they are released
    // explicitly. Sharing sprite textures with the starfield means this must not dispose
    // them itself — `disposeCosmicLayers` only drops geometry and materials.
    disposeCosmicLayers(this.cosmic);
    this.cosmic = null;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();

    const collect = (object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value && value.isTexture) textures.add(value);
          }
          if (material.uniforms) {
            for (const uniform of Object.values(material.uniforms)) {
              if (uniform && uniform.value && uniform.value.isTexture) textures.add(uniform.value);
            }
          }
        }
      }
      for (const child of object.children) collect(child);
    };

    collect(this.scene);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();

    this.renderer.dispose();
    // Release the GPU context and drop the canvas: the next scene gets a fresh
    // element, because a lost context can never be revived on the same canvas.
    this.renderer.forceContextLoss?.();
    if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.registry.clear();
    this.pickTargets.length = 0;
    this.labels.length = 0;
    this.orbitLines.length = 0;
    this.scene.clear();
    void bodyLabelTexture;
  }
}
