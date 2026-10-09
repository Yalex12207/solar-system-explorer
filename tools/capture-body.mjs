/** Focused capture of one body so lighting/texture changes can be judged. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const body = process.argv[3] || 'earth';
const outDir = 'verify-shots/bodies';
mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext('./.verify-profile-bodies', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
});
const page = context.pages()[0] || (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.boot-enter.ready', { timeout: 45000 });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-cta');
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(2500);

for (const id of body.split(',')) {
  await page.evaluate((name) => {
    const scene = window.__solar;
    const rig = scene.cameraController;
    rig.focus(name, { distanceMultiplier: 1.6, duration: 1.2 });
  }, id);
  await page.waitForTimeout(2600);
  // Swing the camera so the sunlit hemisphere faces the viewer: the Sun is at the
  // origin, so pulling the camera toward it also lights the framed body.
  await page.evaluate(() => {
    const scene = window.__solar;
    const controls = scene.cameraController.controls;
    const target = controls.target;
    const camera = scene.camera;
    const offset = camera.position.clone().sub(target);
    const toSun = target.clone().multiplyScalar(-1).normalize();
    // Blend the current viewing direction 55% toward the Sun direction.
    const blended = offset.clone().normalize().lerp(toSun, 0.55).normalize().multiplyScalar(offset.length());
    camera.position.copy(target).add(blended);
  });
  await page.waitForTimeout(500);
  const file = `${outDir}/${id}.png`;
  await page.screenshot({ path: file, clip: { x: 120, y: 60, width: 900, height: 800 } });
  console.log('captured', file);
}

await context.close();
