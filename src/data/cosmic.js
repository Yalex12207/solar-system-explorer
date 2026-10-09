/**
 * Cosmic Scale stages.
 *
 * The whole point of this file is to answer "how big is the solar system?" honestly, so it
 * holds **real measured values only** — the same discipline as `planets.js`. The visual
 * compromise lives in `scale.js` (`COSMIC_SCALE`) and is labelled in the UI as
 * `VISUAL SCALE` next to `REAL DATA`.
 *
 * Distances are given in km for the near stages and in light-years for the galactic ones,
 * because converting the Galaxy into kilometres produces numbers no one can read.
 */

/** Reference lengths, from IAU / NASA fact sheets. */
export const ASTRONOMY = {
  /** 1 astronomical unit — the mean Earth–Sun distance (IAU 2012 definition). */
  auKm: 149597870.7,
  /** Light travels this far in one Julian year. */
  lightYearKm: 9.4607304725808e12,
  /** Distance from the Sun to the centre of the Milky Way. */
  galacticCentreLy: 26000,
  /** Radius of the galactic disc. */
  galacticRadiusLy: 52850,
  /** The Solar System's orbital period around the galactic centre. */
  galacticYearMy: 225,
};

const { auKm, lightYearKm } = ASTRONOMY;

/** Format a kilometre figure with the unit scaled to something readable. */
function km(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 0 : 2)} billion km`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} million km`;
  return `${Math.round(value).toLocaleString('en-US')} km`;
}

/** Format a light-year figure. */
function ly(value) {
  if (value >= 1000) return `${Math.round(value).toLocaleString('en-US')} light-years`;
  return `${value.toFixed(value >= 10 ? 0 : 1)} light-years`;
}

/**
 * The ladder, outermost last.
 *
 * `visual` names the representation the renderer should show; `real` is what the readout
 * prints. Keeping the two apart is the whole point of the scale/fact separation.
 */
export const COSMIC_STAGES = [
  {
    id: 'earth',
    label: 'EARTH',
    kicker: 'The world you are standing on',
    real: { value: '12,742 km', label: 'Diameter' },
    facts: [
      { label: 'Surface area', value: '510.1 million km²' },
      { label: 'One orbit of the Sun', value: '365.25 days' },
    ],
    unitNote: 'This is where the ladder starts.',
    visual: 'system',
  },
  {
    id: 'moon',
    label: 'MOON',
    kicker: 'The nearest thing to us',
    real: { value: km(384400), label: 'Distance from Earth' },
    facts: [
      { label: 'Light travel time', value: '1.28 seconds' },
      { label: 'One orbit of Earth', value: '27.32 days' },
    ],
    unitNote: '384,400 km — you could fit every other planet between us.',
    visual: 'system',
  },
  {
    id: 'solar-system',
    label: 'SOLAR SYSTEM',
    kicker: 'One star and everything bound to it',
    real: { value: '1 AU', label: 'Earth to the Sun' },
    facts: [
      { label: 'Earth to the Sun', value: '149.6 million km' },
      { label: 'Light travel time', value: '8 minutes 20 seconds' },
    ],
    unitNote: 'The astronomical unit is defined by this distance.',
    visual: 'system',
  },
  {
    id: 'outer-solar-system',
    label: 'OUTER SOLAR SYSTEM',
    kicker: 'Where the sunlight is a rumour',
    real: { value: '4.5 billion km', label: 'Neptune to the Sun' },
    facts: [
      { label: 'Neptune’s orbit', value: '164.8 years' },
      { label: 'Light travel time', value: '4 hours 10 minutes' },
      { label: 'Heliopause', value: `≈ 120 AU (${km(120 * auKm)})` },
    ],
    unitNote: 'Neptune is 30 AU out; the Sun’s wind stops around 120 AU.',
    visual: 'system',
  },
  {
    id: 'oort-cloud',
    label: 'OORT CLOUD',
    kicker: 'The edge of the Sun’s gravity',
    real: { value: '2,000 – 200,000 AU', label: 'Detached shell' },
    facts: [
      { label: 'Outer edge', value: km(200000 * auKm) },
      { label: 'In light-years', value: '≈ 3.2 light-years' },
      { label: 'Population', value: 'Billions of icy bodies' },
    ],
    unitNote: 'The solar system is far larger than the part we can see.',
    visual: 'oort',
  },
  {
    id: 'milky-way',
    label: 'MILKY WAY',
    kicker: 'A barred spiral of 100–400 billion stars',
    real: { value: '≈ 105,700 light-years', label: 'Disc diameter' },
    facts: [
      { label: 'Our distance from the centre', value: '26,000 light-years' },
      { label: 'Our arm', value: 'Orion Arm' },
      { label: 'One galactic orbit', value: '225 million years' },
    ],
    unitNote: 'The Sun is one of hundreds of billions of stars here.',
    visual: 'galaxy',
  },
];

/** Index helpers so the UI and camera rig never hard-code positions. */
export const COSMIC_INDEX = COSMIC_STAGES.reduce((map, stage, index) => {
  map[stage.id] = index;
  return map;
}, {});

export function getCosmicStage(id) {
  const index = COSMIC_INDEX[id];
  return index === undefined ? null : COSMIC_STAGES[index];
}

/** The ladder's final stage — the one that shows YOU ARE HERE. */
export const COSMIC_FINAL_ID = 'milky-way';

/**
 * Distance Mode pairs.
 *
 * `left`/`right` are body ids the scene can resolve, so the ruler measures a real
 * separation and prints both the measurement and the unit it is expressed in.
 */
export const DISTANCE_PAIRS = [
  { id: 'earth-sun', left: 'earth', right: 'sun', label: 'Earth → Sun' },
  { id: 'earth-moon', left: 'earth', right: 'moon', label: 'Earth → Moon' },
  { id: 'sun-neptune', left: 'sun', right: 'neptune', label: 'Sun → Neptune' },
];

/** Light travel time for a distance in km, formatted for a readout. */
export function lightTravel(kmValue) {
  const seconds = kmValue / 299792.458;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

export { km as formatKmShort, ly as formatLightYears };
