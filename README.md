# Solar System Explorer

An immersive, interactive 3D atlas of our cosmic neighbourhood — built as a real,
extensible front-end project rather than a demo.

Dark, cinematic, data-driven: **Apple product launch × NASA data visualisation × sci-fi UI × digital museum.**

![System view](verify-shots/04-system-wide.png)

---

## What it does

- **Cinematic cold open** — boot screen → full-bleed title card (`THE SOLAR SYSTEM`, `8 PLANETS / 1 STAR / 200+ MOONS / 4.6B YEARS`) → the live system.
- **Free exploration** — drag to orbit the whole system, wheel/pinch to zoom, click any body to select, double-click (or double-tap) to enter detail mode.
- **12 focusable bodies** — the Sun, all eight planets, and 15 modelled moons including the four Galilean moons, Titan, Enceladus and Triton.
- **Real data, compressed presentation** — every figure in the UI is the measured value (NASA/JPL fact sheets). Only the *rendered* distances and sizes are compressed so all eight orbits fit in frame.
- **Detail mode with chapters** — `01 OVERVIEW · 02 ATMOSPHERE · 03 MOONS · 04 MISSIONS · 05 FACTS`, generated per body from the data (a body without an atmosphere simply never receives that chapter).
- **Time control** — pause / 1× / 10× / 100× / 1000× with a live simulated date and day-of-year readout. Orbits start from J2000 mean elements, so relative motion is genuinely correct.
- **Compare** — any two planets side by side across diameter, mass, gravity, temperature, day length, year length and moons, with proportional bars.
- **Missions archive** — 24 real programmes (Apollo 11, Voyager 1 & 2, Cassini–Huygens, Juno, New Horizons, Perseverance, Parker Solar Probe, JUICE, Dragonfly…) plus a launch timeline.
- **Search** — instant fuzzy-ish search across planets, moons and missions; `/` focuses it.
- **Hand gesture control** — optional webcam control via MediaPipe Hand Landmarker: open palm to orbit, pinch to fly the camera, point to lock a planet, fist to stop time, swipe to change world. See [Hand gesture control](#hand-gesture-control).
- **Guided tour** — a five-section scroll-story camera pass (`OUR STAR → INNER WORLDS → THE GIANTS → OUR HOME → BEYOND`).
- **Quality tiers** — `HIGH QUALITY` / `BALANCED` / `PERFORMANCE`, auto-selected from the device profile and auto-downgraded if the frame budget is missed.
- **Graceful degradation** — no WebGL, a lost context or a failed build never white-screens: a branded fallback page keeps planets, moons and missions readable as data.
- **Responsive** — desktop side panel, tablet bottom sheet, phone drawer; ≥44px touch targets throughout.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # production bundle in dist/
npm run preview    # serve the built bundle (port 4319)
npm run clean      # clear node_modules/.vite and dist

npm run assets:gesture   # re-vendor the MediaPipe model + wasm (already committed)
npm run test:gesture     # 34 gesture-recognition assertions, no browser needed
npm run test:e2e         # 30 end-to-end hand-control checks (needs `npm run dev`)
npm run test:mobile      # 20 mobile-rate + camera-failure checks
npm run test:v22         # 46 planet-exploration checks (focus, info, chapters, moons, rings, compare, search)
npm run test:v24         # 42 time-simulation and mission checks, including the Voyager departure
npm run test:v25         # 42 Cosmic Scale checks: the ladder, real data, Distance Mode, the galaxy
npm run test:motion      # reduced-motion: asserts the canvas freezes
node tools/capture-body.mjs http://127.0.0.1:4321/ "sun,earth,jupiter"   # body close-ups
node tools/capture-focus.mjs http://127.0.0.1:4321/                     # focus mode, desktop + mobile
node tools/capture-rings.mjs http://127.0.0.1:4321/                     # Saturn at three viewing angles
node tools/capture-cosmic.mjs http://127.0.0.1:4321/                    # Oort Cloud, Galaxy, YOU ARE HERE
node tools/review.mjs http://127.0.0.1:4321/                            # full visual sweep
```

`npm run build` runs `tools/build.mjs`, which points esbuild's scratch directory at a
workspace-local folder. esbuild resolves that from `os.tmpdir()`, and if the system temp
directory is held by another process the build aborts with
`[vite:esbuild-transpile] remove ...: Access is denied` — a failure with nothing to do with
the project. `npm run build:vite` calls Vite directly if you need the unwrapped behaviour.

Requires Node 18+ (developed on Node 24 / npm 11). The gesture model and wasm runtime
are vendored into `public/mediapipe/`, so no CDN is contacted at runtime.

> **Note for restricted environments:** Vite/esbuild spawn a native service process and
> Playwright drives Chromium over a named pipe. Both are blocked by aggressive sandboxes;
> run `npm install` and `npm run build` with normal user permissions.

### If the 3D view is black and the console shows shader errors

Vite caches its pre-bundled dependencies in `node_modules/.vite`. That cache can be
invalidated in place if a production build runs while the dev server is live; the symptom
is a black canvas with `THREE.WebGLProgram: Shader Error` logged for every material. Stop
the dev server, run `npm run clean`, then `npm run dev` again. The scene also logs an
explicit diagnostic when it detects this state.

---

## Architecture

Data, rendering and UI are three separate layers. React never touches Three.js objects
directly, and the 3D layer never imports React.

```
src/
├── main.jsx                 entry: mounts <App>, removes the pre-hydration fallback
├── App.jsx                  phase orchestration + camera/time choreography (effects)
├── data/                    ── pure data, zero rendering concerns ──
│   ├── planets.js           Sun + 8 planets, all measured values
│   ├── moons.js             15 moons with orbital radii and periods
│   ├── missions.js          24 missions and their target bodies
│   ├── catalog.js           id → body resolution, chapters, stats, search index
│   ├── narrative.js         landing copy, numeric reveals, scroll story, about text
│   └── scale.js             the compression model + quality presets
├── scenes/
│   ├── solarSystem.js       SolarSystemScene: renderer, orbits, picking, frame loop
│   └── starfield.js         nebula backdrop, star field, coronal dust
├── utils/
│   ├── bodies.js            mesh factories (sun, planet, rings, atmosphere, moons)
│   ├── textures.js          procedural texture generator (no image assets at all)
│   ├── noise.js             seeded value noise / fBm / ridged multifractal
│   ├── cameraRig.js         eased focus, tracking, cinematic orbit, tour
│   ├── labels.js            canvas text sprites, constant on-screen size
│   └── audio.js             optional Web Audio ambient bed (off by default)
├── gesture/                 ── hand control, in three separable layers ──
│   ├── config.js            every threshold, smoothing factor and rate (tune here)
│   ├── recognizer.js        landmarks → pose scores → debounced gesture (pure, testable)
│   ├── handTracker.js       camera + MediaPipe Hand Landmarker, step-scheduled
│   └── gestureController.js gesture → smoothed camera/selection intent
├── hooks/
│   ├── useEnvironment.js    WebGL detection, auto quality, frame-budget guard, media queries
│   └── useHandControl.js    gesture session lifecycle + per-frame signal drain
├── store/
│   └── store.jsx            single reducer + context, preference persistence
├── components/              SceneCanvas, BootScreen, LandingHero, TopBar, Panels,
│                            ComparePanel, MissionsPanel, AboutPanel, ControlDock,
│                            PlanetsBrowser, MobileDrawer, ErrorFallback, DataDisplay,
│                            GesturePanel, HandCursor
└── styles/
    └── global.css           the entire design system (tokens → components → responsive)
```

### Key decisions

**The scene owns its canvas.** `SolarSystemScene` creates and removes its own
`<canvas>`. A WebGL context that has been lost can never be re-created on the same
element, so owning the element is what makes quality switching and React StrictMode's
mount → unmount → mount cycle safe. Teardown disposes every geometry, material and
texture, then releases the context.

**No bitmap assets.** Every surface — Earth's continents, Jupiter's bands, Saturn's
ring gaps, the nebula, the star sprites, the labels — is generated at runtime from
seeded noise onto 2D canvases. There is nothing to 404, nothing to lazy-load, and the
site works fully offline.

**Data is the single source of truth.** Panels, chapters, comparison metrics, search
results and the 3D scene all read the same definitions. Adding a body means adding one
object to `data/planets.js` or `data/moons.js` — the UI, the camera, the search index
and the detail chapters pick it up automatically.

**Frame-rate independent motion.** Camera easing uses exponential damping
(`1 - exp(-λ·dt)`) rather than per-frame lerp constants, so a 30 fps phone and a
144 Hz monitor produce the same choreography.

---

## The visual scale model

Real proportions cannot be drawn literally: Mercury is 1.4% of Jupiter's volume, and
Neptune is 78× further out than Mercury. `src/data/scale.js` documents the compromise:

| Quantity | Transform |
| --- | --- |
| Body radius | `earthRadius * (diameter / 12742) ^ 0.45` |
| Orbit radius | `earthOrbit * (semiMajorAxisAu) ^ 0.52` |
| Moon orbit | mapped into 1.55–3.7 parent radii, normalised per system |

Everything the user *reads* remains true. The About panel states this explicitly.

---

## Cosmic Scale (V2.5)

The ladder answers one question: *how large is the solar system?* Six rungs, from the world
under your feet to the galaxy that contains it.

```
EARTH → MOON → SOLAR SYSTEM → OUTER SOLAR SYSTEM → OORT CLOUD → MILKY WAY
```

### Visual scale, real data

Real proportions are unusable — the Oort Cloud is 100,000× wider than Earth's orbit, and the
Galaxy is 100 million× wider again. So the split is made explicit rather than hidden behind a
disclaimer: `src/data/cosmic.js` holds **only measured values** (the same discipline as
`planets.js`) and `COSMIC_SCALE` in `src/data/scale.js` holds **only artistic compression**.
The panel carries a persistent `VISUAL SCALE │ REAL DATA` legend, and Distance Mode reads its
numbers from the data layer rather than from the scene's render positions — so a compressed
picture can never quietly become a fabricated measurement.

### The rungs

| Rung | Readout | What is shown |
| --- | --- | --- |
| Earth | 12,742 km diameter | the planet itself |
| Moon | 384,400 km | Earth–Moon separation |
| Solar System | 1 AU · 149.6 million km | the eight orbits |
| Outer Solar System | 4.5 billion km · heliopause ≈ 120 AU | Neptune's orbit and beyond |
| Oort Cloud | 2,000–200,000 AU · ≈ 3.2 light-years | a hollow shell of icy bodies |
| Milky Way | ≈ 105,700 light-years across | a four-armed barred spiral |

The final rung marks the Sun at **0.492 of the disc radius** — its real 26,000 of 52,850
light-years — on the Orion Arm, and closes on `YOU ARE HERE / Solar System / Orion Arm /
Somewhere in the Milky Way.`

### Making a twelve-order-of-magnitude span share one camera

The camera's far plane is 4000 and the near plane 0.05, so no single scene can hold both a
planet and a galaxy. Three mechanisms resolve it, and all three were needed:

1. **Depth compensation.** Every layer is scaled by `visibleRadius / reference`, so the
   solar-system model shrinks to a bright point while the Oort shell and Galaxy disc each fill
   a consistent share of the frame. The camera therefore only ever travels within a bounded
   range; the *subject* changes size instead.
2. **Log-distance flights.** The ladder spans 3.4 to 1500 units, and a linear ease spends
   almost all of its duration in the last few percent — which reads as a jump. Interpolating
   the exponent makes each doubling take the same time, so the recession feels even and slow.
3. **Point size expressed in pixels, not world units.** The layer shaders size points by
   `size × 340 / distance`, which at 1,500 units collapsed the Galaxy to about 1.4 pixels: the
   rasteriser clamped every star to a single pixel and the Galaxy rendered as near-invisible
   dust despite being correctly built, scaled and lit. Because each layer is always framed at
   roughly the same apparent size, `pointSizeFactor()` inverts that expression and pins the
   on-screen size in pixels instead.

### Performance

The Galaxy is one `THREE.Points` draw call for 26,000 stars plus one for 4,200 dust points
(15,000 / 2,200 on balanced, 6,000 / 700 on performance), and the Oort Cloud is a third
(9,000 / 5,200 / 2,200). Both layers are hidden outside their stage, so they cost nothing in
normal use, and nothing in either module allocates per frame.

---

## Time simulation & missions (V2.4)

The time machine and the mission archive, plus one cinematic set piece.

### Time control

Six speeds in the dock's **TIME** row: `PAUSE · 1× · 10× · 100× · 1k× · 10k×`. 10000×
advances the system by roughly 27 years a day, which is the point — Neptune's 165-year
orbit becomes watchable rather than theoretical. The two largest speeds are abbreviated so
one row still holds them all on a laptop.

**Space** toggles pause/resume from anywhere, and the dock shows `PAUSED` with a reminder
of the shortcut while it is stopped.

### Solar system time

The readout is an instrument, not a card: `SOLAR SYSTEM TIME` with the date as `YYYY.MM.DD`
alongside an `EARTH` row giving the day of year. Both are derived from the simulated date,
not the wall clock — verified by asserting the day number actually changes while the
simulation runs and freezes when it is paused.

### Missions

25 real programmes. The missions the brief names are all present — Apollo 11, Voyager 1,
Voyager 2, Cassini–Huygens, Juno, New Horizons and a dedicated Mars Exploration Rovers
entry — and the detail card now carries the five fields the brief asks for: **launch,
destination, status, achievement** and the mission record itself.

### Mission timeline

Sorted by the year the mission *mattered*, not by its launch. That distinction is real:
New Horizons launched in 2006 and reached Pluto in 2015, and a launch-ordered timeline
buries the flyby among three other 2006 launches. The data layer names the headline year
via `milestone`, so the timeline reads **1977 VOYAGER · 1997 CASSINI · 2011 JUNO · 2015
NEW HORIZONS** while the detail card still reports the true launch date (19 January 2006).

### The Voyager Experience

Choosing Voyager's record offers `THE EDGE OF THE SOLAR SYSTEM`. The camera then leaves:
distance grows from rest into a long coast over ~12 seconds, and the title card fades in
through black to `VOYAGER 1` over `A MESSAGE FROM HUMANITY`. Esc or the return button
restores the system, including its scale.

Two details make the shot work, and both are in `CameraRig.voyage` / the scene:

- **The departure is not eased toward a target.** Exponential damping would approach the
  destination asymptotically, so the system would never actually resolve to a point of
  light. Distance is instead a function of elapsed time (`cruise · ease(p^2)`), which
  guarantees arrival and gives the slow release → coast → gentle arrival pacing.
- **The system is depth-compensated.** The departure spans thousands of units while the
  starfield shell sits at a few hundred and the camera's far plane is 4000, so flying
  outward would pass through the star shell and leave the scene. Scaling the system by
  `reference / distance` cancels the growth exactly, so it holds a nearly constant
  apparent size while the star field streams past — which is what reads as *leaving* a
  system. Orbit rings and labels retire as they become meaningless.

While the sequence runs the whole working UI stands down (see the note in `global.css`
about the two cascade traps that had to be handled for that to actually work).

---

## Planet exploration (V2.2)

This pass turned "click a planet" into an exploration loop. Nothing in V2.1's visual core
was rebuilt; the changes are the exploration behaviour, one data-layer fix, and Saturn's
ring shading.

**Click → fly → read → explore.** Clicking a body flies the camera in (eased, 0.8–1.5 s)
and opens its info panel; `EXPLORE <BODY>` or a double-click enters detail mode with the
five chapters (`OVERVIEW · ATMOSPHERE · MOONS · MISSIONS · FACTS`). Chapters are generated
per body from the data, so a body without an atmosphere never receives that chapter, and a
moon gets a shorter, tailored list.

**Every figure stays in the data layer.** The info panel's eight fields — diameter, mass,
distance from the Sun, orbital period, rotation period, gravity, temperature and moon
count — are composed by `getKeyStats()` in `src/data/catalog.js`. No component holds a
scientific value. `getKeyStats(node, limit)` now drops *secondary* fields (day length,
axial tilt) before any primary one when the slot budget is tight; before this, "Day Length"
consumed a slot and pushed "Moons" out of the panel on every planet.

**Moons are first-class.** Earth's Moon and Jupiter's four Galilean moons are modelled,
clickable and reachable three ways: directly in the 3D scene, from the MOONS chapter, or
from the body index. A moon's panel shows distance from its *parent*, not a meaningless
solar distance.

**Small-body pick priority.** A moon in front of its planet is often a few pixels wide
while the planet's limb sweeps the same spot, so a correct raycast reports the planet and
the moon becomes unclickable. `SolarSystemScene.pickWithPriority()` lets a satellite win
when the pointer is genuinely inside its own projected disc (1.1× slop, raycast proxy
included). This changes only which body a click resolves to — nothing about the render.

**Saturn's rings** are now shaded from the Sun direction instead of being a flat unlit
sheet: optical depth rises sharply at grazing incidence (so they nearly vanish edge-on),
the ice warms slightly at low sun angles, the opposition surge brightens them when the Sun
is behind them, and the planet's shadow band is evaluated **analytically** — a ring point
is shadowed when it lies behind the planet along the Sun direction and inside the planet's
radius of that axis. They still do not cast into the shadow map, because a PointLight cube
map cannot resolve geometry 10 m thick spanning 280,000 km.

**Compare** gained a one-click entry in the body index (`COMPARE` beside each planet),
pairing the choice with a sensible opponent. The view itself already had the seven required
metrics — diameter, mass, gravity, mean temperature, day length, year length, moons — each
as a pair of proportional bars normalised to the larger value, not a table.

**Search** covers planets, moons and missions. `/` opens it, a result flies the camera to
that body, and Europa, Titan and the rest are all reachable by name.

Two layout fixes came out of this pass: the overlay panels (compare, missions, about) had
`position: absolute` with no horizontal anchor, so they rendered off the left edge and
clipped their own titles and values — they are now centred; and the info panel's field
budget no longer starves the moon count.

---

## Cinematic rendering (V2.1)

This pass was visual only — no new features, no new pages. The brief was *deeper space,
brighter worlds, a camera that flies*.

### Deep-space backdrop

Three star shells at different radii, `starCount` split 56 / 31 / 13 % between far, mid
and near. Larger stars are rarer (a cubed random magnitude), each has its own colour
temperature and twinkle phase, and nearer shells drift slightly faster — so moving the
camera produces real parallax instead of a painted sky. Three nebula patch sprites sit
outside the shells at 4–16 % opacity, plus the existing near-black wash behind
everything. One draw call per layer.

### The Sun

The photosphere is now a shader, not a texture: granulation sampled on a **circular**
basis (the body normal projected onto two planes) rather than in UV space, two scales
drifting at different rates, limb darkening, and a white-hot core. Sampling in UV
inherited the latitude bands of the texture generator and the Sun looked like molten
rock; the isotropic sampling is what fixed it. The base texture is now dedicated
`sunPhotosphere()` isotropic turbulence rather than the shared banded giant. Cost is a
few ALU ops on one sphere and it is skipped on the performance tier.

### Planets

- **Earth** was the priority body. Continent/sea is decided by the *lowest* frequency
  octaves only — summing many octaves produced speckle that read as noise — with a
  warp, a 30 % land fraction to match the real planet, and detail octaves that only
  texture the interior. The palette was desaturated (land is greyer than a map),
  clouds gained a warp plus a subtropical dry belt and a contrast curve, and the ocean
  sheen and city lights already keyed off the same mask.
- **Jupiter** was reading as dark mud. The band oscillation spanned the whole palette,
  so half the surface sampled its darkest entry; bands are now compressed toward the
  bright half with the brightness bias a real gas giant has, the palette was lifted,
  and its belt turbulence is data-driven (`render.turbulence`) so the belts stay zonal.
- **Saturn** and the other giants got matching palette/turbulence data, and the ring
  albedo was lowered — drawn with `toneMapped: false` plus an additive luminance pass,
  the previous albedo clipped the sunlit face to a flat white wedge.

### Lighting model

Every planet and moon is now shaded **analytically from the Sun direction** in its own
shader (`createLitSurfaceMaterial`) instead of by the scene's shadow-casting PointLight.
A point light renders a cube shadow map, and at this scale (a 4-unit star, bodies tens
of units away) no workable resolution can resolve a ring or a moon: shadow sampling drew
a hard staircase across every terminator. The explicit sun-direction approach gives the
same day/night result with no shadow map at all, adds a wrapped-lambert terminator and
an atmosphere-coloured limb, and removes the aliasing entirely. The light's shadow is
therefore switched off, since nothing samples it.

### Focus mode

Double-clicking a body opens its detail view. That now also:

- dims the top bar, dock and drawer to 34 % (restored on hover/focus),
- draws a 2.2vh cinematic letterbox,
- frames the body **beside** the panel via a screen-space bias, so it is never centred
  underneath it,
- turns the camera partway toward the lit hemisphere, so a body flown to from the wide
  shot is not presented as a black disc. The correction is deliberately partial (16 %):
  rotating fully onto the Sun–body axis would put the Sun directly behind the subject
  and let its disc swallow the frame,
- fades the orbit rings to 34 % so a ring crossing in front of a body cannot cut a line
  across the thing being studied (the crossing is correct geometry, not a depth bug),
- offers an explicit `← BACK TO SOLAR SYSTEM` control; Esc already did the same.

Focus mode itself had a latent bug: it was keyed off `state.phase === 'detail'`, but the
reducer moves between panels with `view` and never assigns that phase — so the drawer
used to render *alongside* the desktop panel. Both now key off `state.view`.

### Reduced motion

`prefers-reduced-motion` previously only affected CSS. The canvas now checks for itself:
star drift, twinkle phase and the Sun's convection are all frozen (verified by
`tools/check-reduced-motion.mjs`), and the new focus-mode transitions are disabled in CSS.

---

## Hand gesture control (V2.3)

Optional webcam control, built on **MediaPipe Hand Landmarker** (no custom model). It is
off by default: pick `HAND CONTROL` in the dock's **INPUT** row, and the app asks for the
camera. Mouse and touch keep working at all times.

| Gesture | How it reads | What it does |
| --- | --- | --- |
| **Open Palm** | four fingers extended | Enters gesture control, then orbits. Move the hand and the system turns with it; hold still and it stops. |
| **Pinch** | thumb and index tips together, thumb not folded across the palm | Fly the camera. Closing the gap zooms in, opening it zooms out. |
| **Point** | index extended, other three folded | Aim. A thin circular reticle follows the fingertip, the body under it gains a **subtle limb outline**, and after a short dwell it locks and opens its panel. |
| **Fist** | all four folded, thumb tucked across the palm | Stop and resume time. Latched, so one fist is exactly one toggle. |
| **Swipe** | a fast horizontal palm traverse | Step to the next body in orbital order (left sweep advances, matching a touch swipe). |

The status panel sits bottom-right with `● ACTIVE`, the current pose, confidence and
detection rate, plus a `SHOW CAMERA` button that reveals a small mirrored preview with the
landmark skeleton drawn over it. The video is hidden by default and never occupies the
screen; nothing else is on screen either.

### Why it feels steady

Four independent layers, all tunable in `src/gesture/config.js`:

1. **Pose scoring** is geometric, not positional. Finger extension is the *angle* at the
   first joint (`-cos`, so +1 straight and −1 folded) rather than a tip-to-wrist distance,
   which would depend on finger length and misclassify whole hands.
2. **Debounce** — a pose must hold for 320 ms (500 ms for the fist) before it activates, and
   must be absent for 420 ms before it clears. One dropped detection frame never cancels a
   move mid-orbit.
3. **Confidence gate** — a pose must score ≥ 0.7, and the four poses are scored against each
   other. A fist and a pinch are separated by whether the thumb has folded across the palm,
   not by finger curl alone, so closing a fist cannot zoom the camera.
4. **Smoothing at two rates** — recognition runs at 24 fps (15 on phones) while rendering
   runs at 60. The controller stores *velocities* from each recognition frame and drains them
   smoothly on every rendered frame, with a pointer dead zone and a travel cap so tremor can
   never move the camera.

### Pointing feedback

Two separate cues, because they answer different questions: a wide diffuse **halo** means
"this one is chosen", and a contained **limb outline** (an additive annulus sprite at
0.90–1.0 of the body's radius) means "your finger is on this". Pointing drives the outline
plus a dim halo; selection drives the bright halo. Both are faded by opacity, so changing
state never recompiles a material. The halo weight is read from
`GESTURE_CONFIG.pointing.aimHaloOpacity`, so the documented tuning knob is the only place
the pointing feel lives.

### Camera failure behaviour

A denied permission, a missing camera, an insecure origin or a failed model load all
produce `HAND CONTROL UNAVAILABLE` with a readable reason and `Use mouse or touch instead.`
The key detail is what happens to the pointer: a failed session **releases the canvas**
rather than switching mode. Switching mode would unmount the panel that explains the
failure — the user would be told to use a mouse by a panel that vanished as it said so.
Instead the failure state keeps the explanation on screen, hands pointer input straight
back (verified by actually dragging the mouse in that state), and leaves the panel's own
close button to return the mode to mouse/touch. The 3D scene is never affected.

### Performance

- Inference is step-scheduled at 24 fps desktop / 15 fps mobile and never blocks the render
  loop; the Three.js loop keeps its own 60 fps budget (measured at 165 fps on this machine).
- MediaPipe is dynamically imported, so it is a separate 40 kB gzipped chunk that only loads
  when you actually enter hand control.
- The mobile rate is asserted directly (`tools/gesture-mobile.mjs` instantiates the tracker
  on a 390×844 coarse-pointer viewport and checks the reduced interval), and the render loop
  is measured separately to confirm it is untouched.

---

## Verification

`tools/verify.mjs` drives the running dev server with Playwright and asserts the whole
journey: boot progress → entry → title card → system → orbit drag → wheel zoom → search
→ selection → detail chapters → time advance and pause → orbit toggle → missions →
compare → guided tour → about → quality rebuild → reload → mobile drawer and touch
targets. It also fails the run on any console error, page error or failed request.

```bash
npm run dev
node tools/verify.mjs http://127.0.0.1:4321/ verify-shots   # needs playwright
npm run test:gesture                                        # 34 recognizer assertions
npm run test:e2e                                            # 26 hand-control checks
npm run test:classes                                        # JSX ↔ CSS coverage check
```

`verify-shots/` holds the screenshots it captures.

**How gesture behaviour is tested.** `tools/hand-fixture.mjs` synthesises the 21 landmarks
for any hand pose from a small forward-kinematic model whose proportions match what
MediaPipe reports. `gesture-selftest.mjs` feeds those poses to the real recognizer and
asserts classification, debounce, the confidence gate, zoom/zoom direction, bounded orbit
velocity, swipe detection in both directions, and that no signal ever becomes non-finite
under hand tremor. `gesture-e2e.mjs` drives the real UI and injects the same fixtures
through the `window.__gesture.injectFrame` seam (enabled by `?gestureTest=1`, which also
skips the camera so only one frame source exists), then asserts against the *camera and
scene*: orbit, zoom, aim/select, pause/resume and swipe cycling.

Synthetic landmarks are used because a headless browser has no hand — the recognizer,
controller, camera rig and scene under test are all the production ones. Both suites caught
real bugs during development, including a fist that toggled repeatedly while held, a swipe
that dispatched the wrong action field, and moons leaking into the swipe cycle.

---

## Performance notes

- One `requestAnimationFrame` loop, already-running scenes only; no per-frame allocation
  in the hot path (moon and planet transforms are written into reused objects).
- Quality presets control sphere segments (96/64/40), star count (9000/5200/2400),
  coronal dust (900/450/0), pixel-ratio cap and shadow maps. Shadows are only enabled on
  the High preset.
- Earth's clouds and city lights are computed inside a single custom shader rather than
  as extra transparent spheres, removing both an overdraw pass and z-fighting.
- Labels are DOM-free canvas sprites with a constant on-screen size, faded by distance.
- The live `DAY N` / date readout is throttled to ~6 Hz so React never re-renders per frame.
- Gesture recognition is step-scheduled outside the render loop and its React status writes
  are throttled to ~6 Hz; MediaPipe is a lazily-imported, separately bundled chunk.

---

## Accessibility & fallbacks

- Full keyboard path: `Esc` (back), `Space` (pause/resume), `/` (search), `←/→` (tour), plus lists for every body.
- Visible `:focus-visible` rings, `aria-pressed`/`aria-expanded` on toggles, live regions for state changes.
- `prefers-reduced-motion` neutralises all entrances and animation.
- `@supports` fallback swaps frosted glass for opaque panels where `backdrop-filter` is unavailable.
- Sound is **off** by default and only starts on an explicit user gesture.

---

## Extending it

| Goal | Where |
| --- | --- |
| Add a planet or moon | `src/data/planets.js`, `src/data/moons.js` (then add its id to the parent's `render.moons`) |
| Add a mission | `src/data/missions.js` (reference existing body ids in `destinationIds`) |
| Change surface art | `src/utils/textures.js` — palette and generator per `surface` type |
| Add a UI language | all copy lives in `src/data/*` and `narrative.js`; add a locale dictionary keyed by the `locale` value already in the store |
| Tune the camera | `src/utils/cameraRig.js` (`focus`, `frameSystem`, `tour`) |
| Retune quality tiers | `QUALITY_PRESETS` in `src/data/scale.js` |
| Tune gesture feel | `src/gesture/config.js` — thresholds, hold times, smoothing, speeds |
| Add or change a gesture | score it in `src/gesture/recognizer.js`, map it in `src/gesture/gestureController.js` |
| Update the gesture model | bump the version in `tools/fetch-mediapipe.mjs`, then `npm run assets:gesture` |

---

## Privacy

Hand control is opt-in and entirely local: video frames go to the MediaPipe model running
in the page's own WebAssembly/WebGL context and are never uploaded anywhere. Leaving hand
control stops every camera track and releases the model. No frame is stored or transmitted.

---

## Data sources & disclaimer

Figures follow NASA/JPL planetary fact sheets; orbital elements are JPL's approximate
J2000 Keplerian elements. Not affiliated with NASA or JPL. Distances and body sizes are
visually compressed for legibility; all displayed measurements are real.
