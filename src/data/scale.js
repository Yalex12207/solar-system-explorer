/**
 * Visual scale constants.
 *
 * Real solar-system proportions cannot be rendered literally: Mercury is 1.4% of
 * Jupiter's volume, and Neptune is 78x further from the Sun than Mercury. We
 * therefore use a documented "visual proportions + true data" model:
 *
 *   - RADII      -> compressed with a power curve so sizes stay comparable on screen
 *   - DISTANCES  -> compressed with a power curve so all eight orbits fit in frame
 *   - Every number *shown in the UI* stays scientifically accurate (see planets.js).
 *
 * All values are in abstract "scene units" (1 unit ~= 6.7 million km at Earth's
 * orbit, but the mapping is deliberately non-linear).
 */

export const SCALE = {
  /** Power applied to (diameter / Earth diameter) when deriving render radius. */
  sizeExponent: 0.45,
  /** Render radius of Earth in scene units. */
  earthRadius: 0.55,
  /** Power applied to (semi-major axis in AU) when deriving orbit radius. */
  distanceExponent: 0.52,
  /** Render radius of Earth's orbit in scene units. */
  earthOrbit: 10.2,
  /** Sun render radius (true ratio would be ~109 Earth radii; we compress hard). */
  sunRadius: 4.05,
  /** Moons are compressed harder still, otherwise they would collide with orbits. */
  moonSizeExponent: 0.4,
  /** Largest moon orbit is mapped into this many parent radii. */
  moonOrbitSpan: 2.15,
};

/** Convert a body diameter in km into a render radius in scene units. */
export function renderRadius(diameterKm, exponent = SCALE.sizeExponent) {
  const earthRatio = diameterKm / 12742;
  return SCALE.earthRadius * Math.pow(earthRatio, exponent);
}

/** Convert a semi-major axis in AU into an orbit radius in scene units. */
export function renderOrbit(au) {
  return SCALE.earthOrbit * Math.pow(au, SCALE.distanceExponent);
}

/** Moons: normalise against the widest orbit of that planet's system. */
export function renderMoonOrbit(semiMajorAxisKm, maxSemiMajorAxisKm, parentRenderRadius) {
  const t = maxSemiMajorAxisKm > 0 ? semiMajorAxisKm / maxSemiMajorAxisKm : 0;
  return parentRenderRadius * (1.55 + SCALE.moonOrbitSpan * Math.pow(t, 0.55));
}

/**
 * Cosmic Scale visual parameters — the `VISUAL SCALE` half of the bargain.
 *
 * Every number here is an artistic compression, and none of them is ever shown to the user
 * as a measurement. The corresponding real values live in `cosmic.js` and are what the
 * readouts print. Keeping the two in separate files is deliberate: it makes it impossible
 * to "fix" a visual constant into a data field by accident.
 *
 * The camera's far plane is 4000 and the near plane 0.05, so each stage flies the camera to
 * `distance` and then scales its representation by `reference / distance` — the same
 * depth-compensation trick the Voyager departure uses. That is what lets an Oort Cloud
 * shell 200,000 AU across and a galaxy 105,700 light-years across share one camera.
 */
export const COSMIC_SCALE = {
  /**
   * Camera framing per stage.
   *
   * `target` is a body id or null for the origin; `distance` is the camera's separation from
   * it, `duration` the flight time, and `reference` the distance at which that stage's own
   * representation renders at its authored size.
   *
   * `reference` is a *framing* number, not a physical reach. Setting it equal to `distance`
   * is what makes a representation fill the frame: the scale factor is `visibleRadius /
   * reference`, so the waypoint stages (outer system, Oort Cloud, Galaxy) all present at a
   * consistent apparent size and only the content changes. The inner stages use the
   * solar-system model's own tuning (reference 120 at distance 120), which is why they read
   * as a smooth zoom rather than a cut.
   */
  stages: {
    earth: { target: 'earth', distance: 3.4, reference: 120, duration: 1.4 },
    moon: { target: 'moon', distance: 2.6, reference: 120, duration: 1.4 },
    'solar-system': { target: null, distance: 78, reference: 120, duration: 1.8 },
    'outer-solar-system': { target: null, distance: 260, reference: 260, duration: 2.4 },
    // Framed from *outside* the shell. The camera must not sit inside it: a hollow sphere
    // seen from within renders as a thin ring at the frame edge, not as a cloud.
    'oort-cloud': { target: null, distance: 830, reference: 830, duration: 2.8 },
    'milky-way': { target: null, distance: 1500, reference: 1500, duration: 3.2 },
  },

  /**
   * How large each representation should appear, in its own units, at its own `reference`
   * distance. The scene scales every cosmic layer by `visibleRadius / reference`, which is
   * what keeps the ladder visually continuous: the subject always fills a similar share of
   * the frame and only its identity changes.
   */
  visibleSystemRadius: 48,
  /**
   * The Oort shell is framed to sit well inside the frame, with the camera clearly beyond
   * it, so it reads as a hollow cloud and the compressed solar system sits visibly at its
   * centre.
   */
  visibleOortRadius: 0.75,
  /** The Galaxy is framed so its disc diameter covers most of the viewport height. */
  visibleGalaxyRadius: 430,

  /** Oort Cloud shell, in scene units. Real extent: 2,000–200,000 AU. */
  oort: {
    inner: 0.36,
    outer: 1,
    /** Authored render radius before depth compensation. */
    renderRadius: 420,
    /**
     * Particle budget. The Cloud is drawn as a shell of points rather than a solid surface:
     * it is billions of bodies spread over a volume, and a solid mesh would read as a wall.
     */
    count: { high: 9000, balanced: 5200, performance: 2200 },
  },

  /** Milky Way, authored with a disc radius of `discRadius` units. */
  galaxy: {
    discRadius: 10,
    thickness: 0.06,
    arms: 4,
    /** Logarithmic spiral tightness; higher wraps the arms more tightly. */
    winding: 0.26,
    /** Radius of the central bar/bulge as a fraction of the disc. */
    bulge: 0.16,
    starCount: { high: 26000, balanced: 15000, performance: 6000 },
    dustCount: { high: 4200, balanced: 2200, performance: 700 },
  },

  /**
   * Where the Sun sits in the Galaxy.
   *
   * Real value: 26,000 light-years from the centre in a disc of radius ≈ 52,850
   * light-years — so the marker goes at 0.492 of the disc radius, where it genuinely is.
   * The Orion Arm sits between the Sagittarius and Perseus arms, so the marker's angle is
   * a chosen point on that spur rather than a fabricated measurement.
   */
  sunMarker: {
    radialFraction: 26000 / 52850,
    armAngle: 0.62,
  },
};

/** Quality tiers drive segment counts, particle budgets and post effects. */
export const QUALITY_PRESETS = {
  high: {
    id: 'high',
    label: 'HIGH QUALITY',
    sphereSegments: 96,
    moonSegments: 32,
    starCount: 9000,
    coronalDust: 900,
    maxPixelRatio: 2,
    shadows: true,
    nebula: true,
    clouds: true,
    atmosphere: true,
  },
  balanced: {
    id: 'balanced',
    label: 'BALANCED',
    sphereSegments: 64,
    moonSegments: 24,
    starCount: 5200,
    coronalDust: 450,
    maxPixelRatio: 1.5,
    shadows: false,
    nebula: true,
    clouds: true,
    atmosphere: true,
  },
  performance: {
    id: 'performance',
    label: 'PERFORMANCE',
    sphereSegments: 40,
    moonSegments: 16,
    starCount: 2400,
    coronalDust: 0,
    maxPixelRatio: 1,
    shadows: false,
    nebula: false,
    clouds: false,
    atmosphere: false,
  },
};

export const QUALITY_ORDER = ['performance', 'balanced', 'high'];
