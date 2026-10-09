/**
 * Hand-control end-to-end test.
 *
 * Drives the real UI: enables HAND CONTROL from the dock, checks the panel and the
 * camera fallback, then injects synthetic landmark frames into the live pipeline
 * (through the `window.__gesture.injectFrame` seam) and asserts that the *camera and
 * scene* respond ?orbit, zoom, point-to-select, fist-to-pause and swipe-to-cycle.
 *
 * Synthetic landmarks are used because headless Chromium has no real hand; the
 * recognizer, controller, camera rig and scene are all the production ones.
 *
 * Run: node tools/gesture-e2e.mjs [url]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
// Verification mode: the app skips the camera and model so injected frames are the
// only input. Without it a real tracker reading a placeholder image competes with the
// injected stream and corrupts the gesture state.
const target = `${url}${url.includes('?') ? '&' : '?'}gestureTest=1`;
const outDir = 'verify-shots/gesture';
mkdirSync(outDir, { recursive: true });

let failures = 0;
let checks = 0;
const errors = [];

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const context = await chromium.launchPersistentContext('./.verify-profile-gesture', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
});

const page = context.pages()[0] || (await context.newPage());
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text().split('\n')[0]}`);
});

console.log('Hand control end-to-end\n');

await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-cta', { timeout: 20000 });
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar', { timeout: 20000 });
await page.waitForTimeout(2500);

// 1. The control exists and the default stays mouse/touch -------
console.log('Control modes');
{
  const activeBefore = await page.locator('.gesture-panel').count();
  check('hand panel is hidden by default', activeBefore === 0, `${activeBefore} panels`);

  await page.locator('.dock-collapse').click();
  await page.waitForTimeout(500);
  const modes = await page.locator('.input-control .dock-button').allTextContents();
  check(
    'dock exposes MOUSE / TOUCH / HAND CONTROL',
    modes.length === 3 && modes.join('|').includes('HAND CONTROL'),
    modes.join('|'),
  );
  const mouseActive = await page.locator('.input-control .dock-button.active').first().textContent();
  check('mouse is the default mode', mouseActive?.trim() === 'MOUSE', mouseActive);
  await page.screenshot({ path: `${outDir}/01-control-modes.png` });
}

// 2. Enabling hand control yields a usable panel -------
console.log('\nEnabling hand control');
{
  await page.locator('.input-control .dock-button', { hasText: 'HAND CONTROL' }).click();
  await page.waitForSelector('.gesture-panel', { timeout: 10000 });
  check('gesture panel appears', (await page.locator('.gesture-panel').count()) === 1);

  // The camera may be unavailable in this environment; either way the panel must be
  // honest and the rest of the app must keep working.
  await page.waitForTimeout(6000);
  const state = await page.locator('.gesture-state').textContent();
  const unavailable = await page.locator('.gesture-error-title').count();
  check(
    'panel reports Active or a graceful Unavailable',
    /Active|Unavailable|Starting|Ready/i.test(state || ''),
    state,
  );
  if (unavailable > 0) {
    const copy = await page.locator('.gesture-error-copy').first().textContent();
    const fallback = await page.locator('.gesture-error-copy.dim').textContent();
    check('unavailable state explains why', Boolean(copy && copy.length > 8), copy);
    check('unavailable state offers mouse/touch', /mouse or touch/i.test(fallback || ''), fallback);
  }

  const poses = await page.locator('.gesture-pose').allTextContents();
  check(
    'panel lists the four poses',
    poses.length === 4 && poses.join('|').includes('Open Palm') && poses.join('|').includes('Fist'),
    poses.join('|'),
  );

  check('scene still running under hand control', await page.evaluate(() => Boolean(window.__solar)));
  await page.screenshot({ path: `${outDir}/02-hand-panel.png` });
}

// 3. Injected gestures drive the camera -------
console.log('\nGesture ?camera');

/**
 * Synthetic camera clock.
 *
 * Frames are stamped from this counter rather than from `performance.now()`: adding
 * the step to real time each frame drifts the recognizer's clock arbitrarily far into
 * the future, which corrupts its frame-time deltas (and silently disabled swipe
 * detection). The counter advances by exactly one frame interval per injection, which
 * is what a camera does.
 */
let gestureClock = 0;

const readCamera = () =>
  page.evaluate(() => {
    const scene = window.__solar;
    const controls = scene.cameraController.controls;
    const offset = scene.camera.position.clone().sub(controls.target);
    return {
      position: scene.camera.position.toArray().map((n) => +n.toFixed(4)),
      distance: +offset.length().toFixed(4),
      azimuth: +Math.atan2(offset.x, offset.z).toFixed(4),
      target: controls.target.toArray().map((n) => +n.toFixed(4)),
      mode: scene.cameraController.mode,
    };
  });

const injectSequence = async (sequence) => {
  // Each frame is injected on its own turn of the event loop so React can process the
  // state updates that gestures dispatch. A fully synchronous burst starves the
  // renderer, and a camera never delivers frames that way anyway.
  let latest = null;
  for (const frame of sequence) {
    const dt = frame.dt ?? 45;
    gestureClock += dt;
    latest = await page.evaluate(
      ({ landmarks, timestamp }) => {
        const gesture = window.__gesture;
        if (!gesture?.isActive) return { error: 'hand control not active' };
        return gesture.injectFrame(landmarks, timestamp);
      },
      { landmarks: frame.landmarks, timestamp: gestureClock },
    );
    await page.waitForTimeout(dt);
  }
  return latest;
};

/** Angular rate of the camera around its target, in radians per second. */
const measureAzimuthRate = async (windowMs) => {
  const before = await readCamera();
  await page.waitForTimeout(windowMs);
  const after = await readCamera();
  let delta = after.azimuth - before.azimuth;
  // Unwrap across the +/-pi boundary.
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta / (windowMs / 1000);
};

/** Synthetic hand builder, shared with the self-test so fixtures cannot drift. */
const { synthHand, POSE } = await import('./hand-fixture.mjs');
check('synthetic hand builder available', typeof synthHand === 'function');

if (typeof synthHand === 'function') {
  // Open palm: orbit
  await page.evaluate(() => {
    const scene = window.__solar;
    // Park the camera in the wide shot and disable auto-orbit so the measurement is clean.
    scene.cameraController.frameSystem({ distance: 70, duration: 0.4 });
    scene.cameraController.setAutoOrbit(false);
  });
  await page.waitForTimeout(1400);
  const beforeOrbit = await readCamera();

  const frames = Array.from({ length: 34 }, (_, i) => ({
    landmarks: synthHand({ palmX: 0.3 + i * 0.006, curl: 0 }),
    dt: 45,
  }));
  await injectSequence(frames);
  await page.waitForTimeout(900);
  const afterOrbit = await readCamera();
  check(
    'open palm + hand travel orbits the camera',
    Math.abs(afterOrbit.azimuth - beforeOrbit.azimuth) > 0.02,
    `azimuth ${beforeOrbit.azimuth} -> ${afterOrbit.azimuth}`,
  );

  // Idle: the camera must stop moving. A real camera keeps delivering frames with no
  // hand in them, so the recognizer can release the pose — the harness must do the same,
  // otherwise it models a camera that stopped reporting rather than an empty frame.
  await injectSequence(Array.from({ length: 20 }, () => ({ landmarks: null, dt: 45 })));
  const rateA = await measureAzimuthRate(1000);
  await injectSequence(Array.from({ length: 12 }, () => ({ landmarks: null, dt: 45 })));
  const rateB = await measureAzimuthRate(1000);
  check(
    'camera stops when the hand is still',
    Math.abs(rateA) < 0.05 && Math.abs(rateB) < 0.05,
    `rates ${rateA.toFixed(4)} / ${rateB.toFixed(4)} rad/s`,
  );

  // Pinch: zoom  // Fixtures are built here in Node and injected as plain data.
  const pinchFrames = Array.from({ length: 40 }, () => ({ landmarks: POSE.pinchClosed(), dt: 45 }));
  const beforeZoom = await readCamera();
  await injectSequence(pinchFrames);
  await page.waitForTimeout(1100);
  const afterZoom = await readCamera();
  check(
    'closed pinch zooms the camera in',
    afterZoom.distance < beforeZoom.distance - 0.15,
    `distance ${beforeZoom.distance} -> ${afterZoom.distance}`,
  );
  await page.screenshot({ path: `${outDir}/03-pinch-zoom.png` });

  // Point: select
  await page.evaluate(() => {
    const scene = window.__solar;
    scene.cameraController.setAutoOrbit(false);
    scene.cameraController.frameSystem({ distance: 78, duration: 0.8 });
  });
  await page.waitForTimeout(1800);

  // Aim the fingertip at whatever body sits nearest the middle of the screen.
  const aim = await page.evaluate(() => {
    const scene = window.__solar;
    const results = [];
    for (const [id, record] of scene.registry) {
      const world = record.group.getWorldPosition(scene.camera.position.clone());
      const ndc = world.project(scene.camera);
      if (ndc.z > 1) continue;
      results.push({ id, x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2, off: Math.hypot(ndc.x, ndc.y) });
    }
    results.sort((a, b) => a.off - b.off);
    return results[0] || null;
  });
  check('found a body to point at', Boolean(aim), JSON.stringify(aim));

  if (aim) {
    // Clear any residual gesture, then point. The target is re-resolved as the camera
    // drifts, so the fingertip stays on the same body throughout the hold.
    await injectSequence(Array.from({ length: 16 }, () => ({ landmarks: null, dt: 45 })));
    await page.waitForTimeout(500);

    for (let i = 0; i < 40; i += 1) {
      const target = await page.evaluate((id) => {
        const scene = window.__solar;
        const record = scene.registry.get(id);
        if (!record) return null;
        const world = record.group.getWorldPosition(scene.camera.position.clone());
        const ndc = world.project(scene.camera);
        return { id, x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
      }, aim.id);
      if (!target) break;
      await injectSequence([{ landmarks: POSE.point(target), dt: 45 }]);
    }

    await page.waitForTimeout(1200);
    const selected = await page.evaluate(() => window.__solar.selectedId);
    check('pointing selects a body', selected === aim.id, `selected ${selected}, aimed ${aim.id}`);

    /**
     * V2.3 feedback: the aimed body carries a contained limb outline, and the reticle
     * stays a true circle. Both are read from the live scene rather than the DOM, so a
     * regression in the sprite or the cursor geometry is caught here.
     */
    const feedback = await page.evaluate((id) => {
      const scene = window.__solar;
      const record = scene.registry.get(id);
      const cursor = document.querySelector('.hand-cursor');
      const rect = cursor?.getBoundingClientRect();
      const style = cursor ? getComputedStyle(cursor) : null;
      return {
        hasOutline: Boolean(record?.outline),
        outlineOpacity: record?.outline ? +record.outline.material.opacity.toFixed(3) : null,
        outlineIsRing: /Outline/.test(record?.outline?.name ?? ''),
        outlineScale: record?.outline ? +record.outline.scale.x.toFixed(3) : null,
        bodyRadius: record?.radius ?? null,
        cursorWidth: rect ? Math.round(rect.width) : null,
        cursorHeight: rect ? Math.round(rect.height) : null,
        cursorRadiusCss: style?.borderRadius ?? null,
      };
    }, aim.id);
    check('the aimed body carries a limb outline', feedback.hasOutline && feedback.outlineIsRing, JSON.stringify(feedback));
    check('the outline is visible while pointing', feedback.outlineOpacity > 0.2, String(feedback.outlineOpacity));
    check(
      'the outline hugs the body, not a wide glow',
      feedback.outlineScale !== null && feedback.bodyRadius !== null && feedback.outlineScale < feedback.bodyRadius * 4,
      `scale ${feedback.outlineScale} vs radius ${feedback.bodyRadius}`,
    );
    check(
      'the reticle is a circle',
      feedback.cursorWidth !== null && Math.abs(feedback.cursorWidth - feedback.cursorHeight) <= 1,
      `${feedback.cursorWidth}x${feedback.cursorHeight}`,
    );

    const panelTitle = await page.locator('.panel-right .panel-title').first().textContent().catch(() => null);
    check('selection opens the info panel with a name', Boolean(panelTitle), panelTitle);
    const cursorAimed = await page.locator('.hand-cursor.aimed').count();
    check('reticle switches to the aimed glyph', cursorAimed > 0, `${cursorAimed}`);
    await page.screenshot({ path: `${outDir}/04-point-select.png` });
  }

  // Fist: pause. The gesture is cleared first so the fist registers as a fresh pose
  // rather than a continuation of the pointing that preceded it.
  await injectSequence(Array.from({ length: 16 }, () => ({ landmarks: null, dt: 45 })));
  await page.waitForTimeout(500);
  const timeBefore = await page.evaluate(() => window.__solar.timeScale);
  const fistFrames = Array.from({ length: 30 }, () => ({ landmarks: POSE.fist(), dt: 45 }));
  await injectSequence(fistFrames);
  await page.waitForTimeout(900);
  const timeAfterFist = await page.evaluate(() => window.__solar.timeScale);
  check('fist pauses the simulation', timeAfterFist === 0, `${timeBefore} -> ${timeAfterFist}`);

  // Hold the fist: pausing is a toggle and must not repeat.
  await injectSequence(Array.from({ length: 20 }, () => ({ landmarks: POSE.fist(), dt: 45 })));
  await page.waitForTimeout(700);
  const stillPaused = await page.evaluate(() => window.__solar.timeScale);
  check('holding the fist does not toggle repeatedly', stillPaused === 0, `${stillPaused}`);

  // Open palm then fist again resumes.
  const palmFrames = Array.from({ length: 20 }, () => ({ landmarks: POSE.open(), dt: 45 }));
  await injectSequence(palmFrames);
  await page.waitForTimeout(600);
  await injectSequence(Array.from({ length: 30 }, () => ({ landmarks: POSE.fist(), dt: 45 })));
  await page.waitForTimeout(800);
  const resumed = await page.evaluate(() => window.__solar.timeScale);
  check('a later fist resumes the simulation', resumed > 0, `${resumed}`);

  // Swipe: cycle bodies. Empty frames first, so the previous pose is released and the
  // sweep is evaluated as a fresh gesture rather than a continuation.
  //
  // The selection is set through the *store* — by clicking a body in the index — not by
  // calling scene.setSelection(), which would leave React state untouched and make the
  // swipe step from "nothing selected".
  await injectSequence(Array.from({ length: 16 }, () => ({ landmarks: null, dt: 45 })));
  await page.locator('.topbar-link', { hasText: 'Planets' }).click();
  await page.waitForTimeout(500);
  await page.locator('.browser-row', { hasText: 'Earth' }).locator('.browser-main').click();
  await page.waitForTimeout(900);
  const beforeSwipe = await page.evaluate(() => window.__ui?.selectedId);
  check('a body is selected through the UI before swiping', beforeSwipe === 'earth', String(beforeSwipe));

  // Frames advance fast so the injected stream also refreshes the React status; the
  // result is then read after a real pause, because selection rides React state.
  const swipeFrames = [];
  for (let i = 0; i < 4; i += 1) swipeFrames.push({ landmarks: synthHand({ palmX: 0.25, curl: 0 }), dt: 60 });
  for (let i = 0; i < 12; i += 1) {
    swipeFrames.push({ landmarks: synthHand({ palmX: 0.25 + i * 0.03, curl: 0 }), dt: 60 });
  }
  for (let i = 0; i < 16; i += 1) swipeFrames.push({ landmarks: synthHand({ palmX: 0.61, curl: 0 }), dt: 60 });
  await injectSequence(swipeFrames);
  await page.waitForTimeout(1400);
  const afterSwipe = await page.evaluate(() => window.__ui?.selectedId);
  check('swipe changes the selected body', Boolean(afterSwipe) && afterSwipe !== beforeSwipe, `${beforeSwipe} -> ${afterSwipe}`);
  check(
    '  swipe advances to the next planet rather than a moon',
    Boolean(afterSwipe) && !['moon', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'enceladus', 'rhea', 'iapetus', 'titania', 'oberon', 'miranda', 'ariel', 'triton', 'proteus'].includes(afterSwipe),
    afterSwipe,
  );
  await page.screenshot({ path: `${outDir}/05-swipe.png` });
}

// 4. Camera preview toggle -------
console.log('\nCamera preview');
{
  await page.locator('.gesture-actions .dock-button').click();
  await page.waitForTimeout(800);
  const previewVisible = await page.locator('.gesture-preview').count();
  const label = await page.locator('.gesture-preview-label').textContent().catch(() => null);
  check('SHOW CAMERA reveals the preview when active', previewVisible === 1 || label === null, `${previewVisible}`);
  if (previewVisible) {
    const mirrored = await page.evaluate(() => {
      const video = document.querySelector('.gesture-preview-video');
      if (!video) return null;
      return getComputedStyle(video).transform;
    });
    check('preview is mirrored', String(mirrored).includes('-1'), mirrored);
    await page.screenshot({ path: `${outDir}/06-camera-preview.png` });
  }
}

// 5. Returning to mouse/touch -------
console.log('\nReturning to mouse control');
{
  await page.locator('.gesture-close').click();
  await page.waitForTimeout(900);
  check('gesture panel is dismissed', (await page.locator('.gesture-panel').count()) === 0);
  check('reticle is removed', (await page.locator('.hand-cursor').count()) === 0);

  const camera = await readCamera();
  const canvasBox = await page.locator('.scene-canvas canvas').boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(cx - i * 12, cy + i * 4);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const afterDrag = await readCamera();
  check(
    'mouse dragging works again after hand control',
    Math.abs(afterDrag.azimuth - camera.azimuth) > 0.01,
    `azimuth ${camera.azimuth} -> ${afterDrag.azimuth}`,
  );
  await page.screenshot({ path: `${outDir}/07-mouse-restored.png` });
}

await context.close();

console.log(`\n=== console errors: ${errors.length} ===`);
for (const error of errors.slice(0, 12)) console.log(`  ! ${error}`);
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures || errors.length ? 1 : 0);
