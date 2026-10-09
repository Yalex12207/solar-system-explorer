/** Capture the Oort Cloud and Milky Way stages with settled camera and no veil. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = 'verify-shots/v25';
mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext('./.verify-profile-vshots', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
});
const page = context.pages()[0] || (await context.newPage());
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text().split('\n')[0]);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-cta');
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(2400);
await page.locator('.dock-collapse').click().catch(() => {});
await page.waitForTimeout(300);

/** Wait until the rig has settled AND the layer fade has actually completed. */
const settle = async (timeout = 25000) => {
  const start = Date.now();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const state = await page.evaluate(() => {
      const scene = window.__solar;
      const cosmic = scene.cosmic;
      const stage = scene.cosmicStage;
      const opacity = stage === 'oort-cloud'
        ? cosmic.oort.material.uniforms.uOpacity.value
        : Math.max(
            cosmic.galaxy.stars.material.uniforms.uOpacity.value,
            cosmic.marker.ring.material.opacity,
          );
      return {
        mode: scene.cameraController.mode,
        progress: scene.cameraController.cosmicProgress ?? 1,
        opacity,
      };
    });
    if (state.mode !== 'cosmic' && state.progress >= 1 && state.opacity > 0.95) return true;
    if (Date.now() - start > timeout) return false;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }
};

await page.locator('.cosmic-control .cosmic-button').click();
await page.waitForTimeout(1000);
await page.locator('.scale-rung').nth(4).click();
await settle();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/07-oort-cloud.png` });
console.log(
  'oort:',
  JSON.stringify(
    await page.evaluate(() => ({
      oort: window.__solar.cosmic.oort.points.visible,
      oortScale: +window.__solar.cosmic.oort.points.scale.x.toFixed(4),
      rootScale: +window.__solar.root.scale.x.toFixed(4),
      labels: window.__solar.labelGroup.visible,
      mode: window.__solar.cameraController.mode,
    })),
  ),
);

await page.locator('.scale-rung').nth(5).click();
await settle();
await page.waitForTimeout(1400);
await page.screenshot({ path: `${outDir}/08-milky-way.png` });
console.log(
  'galaxy:',
  JSON.stringify(
    await page.evaluate(() => ({
      galaxy: window.__solar.cosmic.galaxy.group.visible,
      galaxyScale: +window.__solar.cosmic.galaxy.group.scale.x.toFixed(4),
      marker: window.__solar.cosmic.marker.group.visible,
      markerOpacity: +window.__solar.cosmic.marker.ring.material.opacity.toFixed(3),
      rootScale: +window.__solar.root.scale.x.toFixed(5),
      labels: window.__solar.labelGroup.visible,
      mode: window.__solar.cameraController.mode,
      distance: +window.__solar.cameraController.cosmicDistance.toFixed(0),
    })),
  ),
);

// A closer look at the marker, to confirm YOU ARE HERE is legible on the arm.
await page.evaluate(() => {
  const scene = window.__solar;
  const rig = scene.cameraController;
  const marker = scene.cosmic.marker.group.position.clone().multiplyScalar(scene.cosmic.galaxy.group.scale.x);
  rig.controls.target.copy(marker);
  rig.mode = 'system';
  rig.tracking = true;
  const offset = marker.clone().normalize().multiplyScalar(260);
  offset.y = 90;
  scene.camera.position.copy(marker).add(offset);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/09-you-are-here.png` });

await context.close();
