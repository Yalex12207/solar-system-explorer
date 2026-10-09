/**
 * Mobile gesture rate and camera-failure checks (V2.3).
 *
 * Three independent scenarios, each on a fresh page load, because they have genuinely
 * different expected outcomes:
 *
 *  1. **Mobile-shaped device, pointer use** — recognition must drop to the reduced rate
 *     while the renderer keeps its own budget, and touch must still select bodies.
 *  2. **Mobile-shaped device, hand control** — with no camera available the session must
 *     fail soft: a readable message, the scene alive, and control handed back to touch.
 *  3. **Desktop, camera denied by the user** — the same, with the mouse restored.
 *
 * Scenario 2 is why this file exists: once the unavailable path hands control back, the
 * gesture panel is *supposed* to close, so its message cannot be asserted from the same
 * moment as the mode. The message is captured while it is on screen instead.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
mkdirSync('verify-shots', { recursive: true });

let checks = 0;
let failures = 0;
const check = (name, condition, detail = '') => {
  checks += 1;
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
};

const fatalErrors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => fatalErrors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') fatalErrors.push(`${label} console: ${m.text().split('\n')[0]}`);
  });
};

/**
 * Run `fn` while ignoring console errors it provokes.
 *
 * The rate probe imports a source module, which 404s against a production build. Chrome
 * reports that as a bare "Failed to load resource" with no URL, so it cannot be filtered
 * by text — it is scoped to the probe instead. Any error raised *outside* this window is
 * still fatal.
 */
const ignoringConsoleErrors = async (fn) => {
  const before = fatalErrors.length;
  try {
    return await fn();
  } finally {
    fatalErrors.splice(before);
  }
};

const enterSystem = async (page) => {
  await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
  await page.locator('.boot-enter').click();
  await page.waitForSelector('.hero-cta');
  await page.locator('.hero-cta').click();
  await page.waitForSelector('.topbar');
  await page.waitForTimeout(2200);
};

const openHandControl = async (page) => {
  await page.locator('.dock-collapse').click().catch(() => {});
  await page.waitForTimeout(400);
  const button = page.locator('.input-control .dock-button', { hasText: 'HAND CONTROL' });
  if (!(await button.count())) return false;
  await button.first().click();
  return true;
};

// ————————————————————————————————— 1. mobile rate + touch
console.log('\n1. Mobile-shaped device, pointer use');
{
  const context = await chromium.launchPersistentContext('./.verify-profile-gmobile1', {
    executablePath: process.env.CHROMIUM_PATH,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    args: ['--no-sandbox'],
  });
  const page = context.pages()[0] || (await context.newPage());
  watch(page, 'mobile-pointer');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await enterSystem(page);

  // The tracker has not started, so its own rate calculation is exercised directly. This
  // imports a source module, which only exists on the dev server; a production build is
  // detected and reported rather than silently passing.
  const rate = await ignoringConsoleErrors(() =>
    page.evaluate(async () => {
      let module = null;
      try {
        module = await import('/src/gesture/handTracker.js');
      } catch {
        return { unavailable: true };
      }
      const tracker = new module.HandTracker({ onFrame: () => {}, onStatus: () => {}, onError: () => {} });
      const interval = tracker._detectionIntervalMs();
      return {
        intervalMs: +interval.toFixed(2),
        fps: tracker.fps,
        coarse: window.matchMedia('(hover: none) and (pointer: coarse)').matches,
        small: Math.min(window.innerWidth, window.innerHeight) < 900,
      };
    }),
  );

  if (rate.unavailable) {
    console.log('  note  source module unavailable: run this suite against `npm run dev` for the rate checks');
  } else {
    check('the device reports as coarse-pointer and small', rate.coarse && rate.small, JSON.stringify(rate));
    check('mobile recognition drops to the reduced rate', rate.fps === 15, `${rate.fps} fps (${rate.intervalMs} ms)`);
    check('the reduced rate stays inside the configured bounds', rate.fps >= 8 && rate.fps <= 30, String(rate.fps));
  }

  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - started < 1000) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (performance.now() - started)));
        };
        requestAnimationFrame(tick);
      }),
  );
  check('the render loop keeps its own frame rate', fps >= 30, `${fps} fps`);

  // Touch selection still works, and opens the phone bottom sheet.
  const tap = await page.evaluate(() => {
    const scene = window.__solar;
    const world = scene.getBodyPosition('earth').clone();
    const ndc = world.project(scene.camera);
    return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
  });
  const box = await page.locator('.scene-canvas canvas').boundingBox();
  await page.touchscreen.tap(box.x + box.width * tap.x, box.y + box.height * tap.y);
  await page.waitForTimeout(2600);
  const tapped = await page.evaluate(() => {
    const drawer = document.querySelector('.drawer');
    return {
      selectedId: window.__ui?.selectedId ?? null,
      drawerVisible: drawer ? drawer.offsetParent !== null : false,
      drawerCount: document.querySelectorAll('.drawer').length,
    };
  });
  check('touch selects a body on mobile', Boolean(tapped.selectedId), JSON.stringify(tapped));
  check('the selection opens the bottom sheet', tapped.drawerVisible, JSON.stringify(tapped));
  await page.screenshot({ path: 'verify-shots/gesture-mobile-touch.png' });
  await context.close();
}

// ————————————————————————————————— 2. mobile hand control with no camera
console.log('\n2. Mobile-shaped device, hand control unavailable');
{
  const context = await chromium.launchPersistentContext('./.verify-profile-gmobile2', {
    executablePath: process.env.CHROMIUM_PATH,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    args: ['--no-sandbox'],
  });
  const page = context.pages()[0] || (await context.newPage());
  watch(page, 'mobile-hand');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await enterSystem(page);
  check('the dock exposes hand control on mobile', await openHandControl(page));

  // Poll while the session settles so the message is captured before the fallback closes
  // the panel; the fallback itself is what we are testing next.
  let seen = { message: null, state: null };
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await page.evaluate(() => {
      const panel = document.querySelector('.gesture-panel');
      const unavailable = document.querySelector('.gesture-unavailable, .gesture-fallback, .gesture-message');
      return {
        panelVisible: panel ? panel.offsetParent !== null : false,
        message: unavailable?.textContent?.trim() ?? null,
        state: document.querySelector('.gesture-state')?.textContent?.trim() ?? null,
        bodyHasFallbackCopy: document.body.textContent.includes('Use mouse or touch instead'),
      };
    });
    if (snapshot.message || snapshot.bodyHasFallbackCopy || snapshot.state) seen = { ...seen, ...snapshot };
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
    if (seen.message || seen.bodyHasFallbackCopy) break;
  }
  const final = await page.evaluate(() => ({
    canvas: Boolean(document.querySelector('.scene-canvas canvas')),
    sceneAlive: Boolean(window.__solar),
    controlMode: window.__ui?.controlMode ?? null,
    errorPhase: document.querySelector('.app')?.classList.contains('phase-error') ?? false,
    panelVisible: (() => {
      const panel = document.querySelector('.gesture-panel');
      return panel ? panel.offsetParent !== null : false;
    })(),
    unavailableTitle: document.querySelector('.gesture-error-title')?.textContent?.trim() ?? null,
    pointerEnabled: !(document.querySelector('.scene-canvas')?.classList.contains('hand-controlled') ?? true),
  }));
  check('a camera failure does not white-screen on mobile', !final.errorPhase && final.canvas && final.sceneAlive, JSON.stringify(final));
  check('mobile names the unavailable state', final.unavailableTitle === 'HAND CONTROL UNAVAILABLE', String(final.unavailableTitle));
  check('mobile keeps the explanation on screen', final.panelVisible && (seen.bodyHasFallbackCopy || Boolean(seen.message)), JSON.stringify({ ...seen, ...final }));
  check('mobile hands the pointer back without hiding the reason', final.pointerEnabled, JSON.stringify(final));

  // Touch must work while the explanation is still on screen.
  const tap = await page.evaluate(() => {
    const scene = window.__solar;
    const world = scene.getBodyPosition('earth').clone();
    const ndc = world.project(scene.camera);
    return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
  });
  const box = await page.locator('.scene-canvas canvas').boundingBox();
  await page.touchscreen.tap(box.x + box.width * tap.x, box.y + box.height * tap.y);
  await page.waitForTimeout(2600);
  const tapped = await page.evaluate(() => ({
    selectedId: window.__ui?.selectedId ?? null,
    drawerVisible: (() => {
      const drawer = document.querySelector('.drawer');
      return drawer ? drawer.offsetParent !== null : false;
    })(),
  }));
  check('touch still selects a body while the failure is shown', Boolean(tapped.selectedId), JSON.stringify(tapped));

  // The bottom sheet now covers the lower part of the screen, so it is closed before
  // reaching for the panel's own close button.
  await page.locator('.drawer .panel-close').click().catch(() => {});
  await page.waitForTimeout(900);

  // Dismissing the panel is what returns the store to touch.
  await page.locator('.gesture-close').click({ force: true }).catch(() => {});
  await page.waitForTimeout(1200);
  const dismissed = await page.evaluate(() => ({
    controlMode: window.__ui?.controlMode ?? null,
    panelVisible: (() => {
      const panel = document.querySelector('.gesture-panel');
      return panel ? panel.offsetParent !== null : false;
    })(),
  }));
  check('dismissing the panel returns to touch', dismissed.controlMode === 'touch' && !dismissed.panelVisible, JSON.stringify(dismissed));
  await page.screenshot({ path: 'verify-shots/gesture-mobile-denied.png' });
  await context.close();
}

// ————————————————————————————————— 3. desktop, camera denied
console.log('\n3. Desktop, camera permission denied');
{
  const context = await chromium.launchPersistentContext('./.verify-profile-gdenied', {
    executablePath: process.env.CHROMIUM_PATH,
    viewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = context.pages()[0] || (await context.newPage());
  watch(page, 'desktop-denied');
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await enterSystem(page);
  await openHandControl(page);
  await page.waitForTimeout(3200);

  const state = await page.evaluate(() => ({
    canvas: Boolean(document.querySelector('.scene-canvas canvas')),
    sceneAlive: Boolean(window.__solar),
    controlMode: window.__ui?.controlMode ?? null,
    errorPhase: document.querySelector('.app')?.classList.contains('phase-error') ?? false,
    pointerDisabled: document.querySelector('.scene-canvas')?.classList.contains('hand-controlled') ?? null,
    fallbackCopy: document.body.textContent.includes('Use mouse or touch instead'),
    unavailableTitle: document.querySelector('.gesture-error-title')?.textContent?.trim() ?? null,
    panelVisible: (() => {
      const panel = document.querySelector('.gesture-panel');
      return panel ? panel.offsetParent !== null : false;
    })(),
  }));
  check('a denied camera does not white-screen', !state.errorPhase && state.canvas && state.sceneAlive, JSON.stringify(state));
  check('a denied camera names the failure', state.unavailableTitle === 'HAND CONTROL UNAVAILABLE', String(state.unavailableTitle));
  check('a denied camera points the user at mouse or touch', state.fallbackCopy, JSON.stringify(state));
  check('the explanation stays on screen', state.panelVisible, JSON.stringify(state));
  check('the canvas is pointer-enabled again', state.pointerDisabled === false, String(state.pointerDisabled));

  // The mouse must genuinely work again, not just report that it should.
  const before = await page.evaluate(() => {
    const scene = window.__solar;
    const offset = scene.camera.position.clone().sub(scene.cameraController.controls.target);
    return Math.atan2(offset.x, offset.z);
  });
  const box = await page.locator('.scene-canvas canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 140, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const scene = window.__solar;
    const offset = scene.camera.position.clone().sub(scene.cameraController.controls.target);
    return Math.atan2(offset.x, offset.z);
  });
  check('dragging the mouse orbits the camera again', Math.abs(after - before) > 0.02, `${before.toFixed(3)} -> ${after.toFixed(3)}`);

  // Dismissing the panel is what returns the store to the pointer.
  await page.locator('.gesture-close').click().catch(() => {});
  await page.waitForTimeout(1200);
  const dismissed = await page.evaluate(() => ({ controlMode: window.__ui?.controlMode ?? null }));
  check('dismissing the failure returns to the mouse', dismissed.controlMode === 'mouse', String(dismissed.controlMode));
  await page.screenshot({ path: 'verify-shots/gesture-desktop-denied.png' });
  await context.close();
}

/**
 * Errors that are expected rather than defects.
 *
 * The rate probe imports a source module; when this suite runs against a production build
 * that path does not exist and the browser logs a 404. That request is made *by the test*,
 * never by the app, so it is filtered here — and the probe reports itself as unavailable
 * instead of silently passing.
 */
const EXPECTED = /NotAllowedError|Permission denied|getUserMedia|NotFoundError|Requested device not found|src\/gesture\/handTracker\.js/;

const fatal = fatalErrors.filter((e) => !EXPECTED.test(e));
console.log(`\n=== unexpected console errors: ${fatal.length} ===`);
for (const error of fatal.slice(0, 6)) console.log(`  ! ${error}`);
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures > 0 || fatal.length > 0 ? 1 : 0);
