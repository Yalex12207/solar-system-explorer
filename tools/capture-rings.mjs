/**
 * Capture Saturn from several camera angles.
 *
 * The ring shading is angle-dependent by design, so a single view cannot confirm it:
 * this shoots a low-inclination view (rings near edge-on, maximum grazing densification)
 * and a view from the far side of the planet (the analytic shadow band).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = 'verify-shots/rings';
mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext('./.verify-profile-rings', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1280, height: 800 },
  args: ['--no-sandbox'],
});
const page = context.pages()[0] || (await context.newPage());
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-cta');
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(2500);

/** Park the camera at an explicit elevation and azimuth around Saturn. */
const viewFrom = async (label, { elevationDeg, azimuthDeg, distance }) => {
  await page.evaluate(
    ({ elevationDeg: el, azimuthDeg: az, distance: dist }) => {
      const scene = window.__solar;
      const rig = scene.cameraController;
      rig.focus('saturn', { distanceMultiplier: 1, duration: 0.5 });
      const target = scene.getBodyPosition('saturn').clone();
      const elRad = (el * Math.PI) / 180;
      const azRad = (az * Math.PI) / 180;
      const offset = {
        x: Math.cos(elRad) * Math.sin(azRad) * dist,
        y: Math.sin(elRad) * dist,
        z: Math.cos(elRad) * Math.cos(azRad) * dist,
      };
      rig.controls.target.copy(target);
      scene.camera.position.set(target.x + offset.x, target.y + offset.y, target.z + offset.z);
      // The rig would immediately re-derive the camera from its own focus state, so it
      // is parked in a mode it does not steer.
      rig.focusBias = null;
      rig.orientBias = 0;
      rig.focusId = null;
      rig.mode = 'idle';
      rig.tracking = true;
      rig.setAutoOrbit(false);
      rig.controls.autoRotate = false;
      rig.controls.minDistance = 0.1;
      rig.controls.maxDistance = 500;
    },
    { elevationDeg, azimuthDeg, distance },
  );
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${outDir}/${label}.png` });
  const state = await page.evaluate(() => {
    const scene = window.__solar;
    const ring = scene.registry.get('saturn').rings.children[0];
    return {
      sunDirection: ring.material.uniforms.uSunDirection.value.toArray().map((n) => +n.toFixed(3)),
      camDistance: +scene.camera.position.distanceTo(scene.getBodyPosition('saturn')).toFixed(2),
    };
  });
  console.log(label, JSON.stringify(state));
};

// Near edge-on: maximum grazing densification.
await viewFrom('a-edge-on', { elevationDeg: 4, azimuthDeg: 20, distance: 12 });
// Over the pole: rings fully face-on.
await viewFrom('b-face-on', { elevationDeg: 62, azimuthDeg: 15, distance: 12 });
// From the far side of the planet relative to the Sun: the shadow band.
await viewFrom('c-anti-sun', { elevationDeg: 22, azimuthDeg: 200, distance: 13 });

await context.close();
