/**
 * Editorial content: landing copy, the numeric reveals and the scroll story.
 * Separated from components so copy changes never touch rendering code.
 */

export const BRAND = {
  name: 'Solar System Explorer',
  short: 'SOLAR SYSTEM',
  tagline: 'An interactive journey through our cosmic neighborhood.',
  heroTitle: 'THE SOLAR SYSTEM',
  heroKicker: 'Interactive Atlas · Vol. 01',
  enterLabel: 'EXPLORE THE UNIVERSE',
  loadingLabel: 'INITIALIZING',
};

export const NAV_LINKS = [
  { key: 'explore', label: 'Explore' },
  { key: 'planets', label: 'Planets' },
  { key: 'missions', label: 'Missions' },
  { key: 'about', label: 'About' },
];

/** Landing-page numeric reveals, revealed in sequence. */
export const HERO_STATS = [
  { value: '8', label: 'PLANETS', detail: 'Four rocky worlds, four giants' },
  { value: '1', label: 'STAR', detail: 'A G2V main-sequence sun' },
  { value: '200+', label: 'MOONS', detail: 'Confirmed natural satellites' },
  { value: '4.6B', label: 'YEARS', detail: 'Since the protoplanetary disc' },
];

/**
 * Apple-style scroll story. Each section maps to a camera subject so the 3D
 * scene follows the narrative instead of sitting behind static text.
 */
export const STORY = [
  {
    id: 'our-star',
    index: '01',
    title: 'OUR STAR',
    body:
      'Every orbit in the solar system is a negotiation with the Sun. It holds 99.86% of the mass here — a plasma furnace converting 600 million tonnes of hydrogen every second.',
    focus: 'sun',
    multiplier: 2.6,
  },
  {
    id: 'inner-worlds',
    index: '02',
    title: 'INNER WORLDS',
    body:
      'Mercury, Venus, Earth and Mars — four small, dense, rocky planets huddled in the first 1.5% of the system’s width, where the Sun’s heat refuses to let ice survive.',
    focus: 'mars',
    multiplier: 1.9,
  },
  {
    id: 'the-giants',
    index: '03',
    title: 'THE GIANTS',
    body:
      'Beyond the frost line, hydrogen and helium could condense into worlds massive enough to bend the shape of the system itself. Jupiter alone outweighs every other planet combined.',
    focus: 'jupiter',
    multiplier: 2.1,
  },
  {
    id: 'our-home',
    index: '04',
    title: 'OUR HOME',
    body:
      'One rocky world happens to hold liquid water, a protective magnetic field and an atmosphere that filters ultraviolet light. Everything alive that we know of lives here.',
    focus: 'earth',
    multiplier: 1.4,
  },
  {
    id: 'beyond',
    index: '05',
    title: 'BEYOND',
    body:
      'Voyager 1 crossed the heliopause in 2012 and keeps transmitting. It is 24 billion kilometres away — and still inside the Sun’s gravitational reach.',
    focus: 'neptune',
    multiplier: 3.4,
  },
];

export const ABOUT = {
  title: 'An atlas built from real numbers',
  paragraphs: [
    'Solar System Explorer renders the solar system with a documented compromise: distances and sizes are compressed so that every planet can be seen at once, while every figure displayed in the interface is the real measured value.',
    'Surfaces are generated procedurally at runtime — no bitmap textures are downloaded, so the site works offline, loads instantly and degrades gracefully on slow connections. Orbital positions start from J2000 elements and advance at true relative rates, so pressing 100× shows Mercury lapping the outer planets.',
    'Built with React, Three.js and a custom WebGL layer. Every scene resource is created and disposed by the same code path, which keeps long sessions free of GPU memory growth.',
  ],
  credits: [
    { label: 'Data', value: 'NASA / JPL planetary fact sheets, J2000 orbital elements' },
    { label: 'Rendering', value: 'Three.js r169 · WebGL 2 · custom shaders' },
    { label: 'Interface', value: 'React 19 · Vite · hand-written CSS design system' },
  ],
  disclaimer:
    'Not affiliated with NASA or JPL. Distances and body sizes are visually compressed for legibility; all displayed measurements are real.',
};

/** Onboarding hints, reused by the help panel and the first-run overlay. */
export const CONTROLS_HELP = [
  { keys: 'Drag', action: 'Orbit the system' },
  { keys: 'Scroll', action: 'Zoom in and out' },
  { keys: 'Click', action: 'Select a body' },
  { keys: 'Double-click', action: 'Open detail mode' },
  { keys: 'Esc', action: 'Return to the wide shot' },
  { keys: 'Space', action: 'Pause or resume time' },
];
