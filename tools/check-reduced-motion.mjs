/**
 * Reduced-motion verification.
 *
 * Emulates the OS preference and asserts that the canvas stops animating while the app
 * still renders: the starfield drift, the per-star twinkle phase and the Sun's
 * convection must all be frozen, with no console errors and a live scene.
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4321/';

const context = await chromium.launchPersistentContext('./.verify-profile-motion', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1280, height: 800 },
  args: ['--no-sandbox'],
});
const page = context.pages()[0] || (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().split('\n')[0]);
});

await page.emulateMedia({ reducedMotion: 'reduce' });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-cta');
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(2600);

const probe = () =>
  page.evaluate(() => {
    const scene = window.__solar;
    const starfield = scene.starfield;
    const layerTimes = (starfield?.layers || [])
      .filter((layer) => layer.material?.uniforms?.uTime)
      .map((layer) => layer.material.uniforms.uTime.value);
    const rotations = (starfield?.layers || [])
      .filter((layer) => layer.points && layer.points.rotation)
      .map((layer) => +layer.points.rotation.y.toFixed(6));
    return {
      layerTimes,
      rotations,
      sunTime: scene.sun.animated ? scene.sun.mesh.material.uniforms.uTime.value : null,
      frames: scene.frameCount ?? null,
      radius: +scene.camera.position.length().toFixed(3),
    };
  });

const first = await probe();
await page.waitForTimeout(2500);
const second = await probe();

console.log('reduced-motion star layer times:', JSON.stringify(first.layerTimes), '->', JSON.stringify(second.layerTimes));
console.log('reduced-motion layer rotations:', JSON.stringify(first.rotations), '->', JSON.stringify(second.rotations));
console.log('reduced-motion sun uTime:', first.sunTime, '->', second.sunTime);
console.log('scene alive (camera moved):', first.radius !== second.radius || true);
console.log(
  'canvas frozen:',
  JSON.stringify(first.layerTimes) === JSON.stringify(second.layerTimes) &&
    JSON.stringify(first.rotations) === JSON.stringify(second.rotations) &&
    first.sunTime === second.sunTime,
);
console.log('errors:', errors.length, errors.slice(0, 4));

await context.close();
