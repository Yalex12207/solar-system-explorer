/**
 * Focus-mode verification.
 *
 * Each viewport is exercised after a fresh load, so neither inherits state from the
 * other. The body is framed with `focus()` first, which guarantees it is front-most and
 * therefore genuinely pickable — framing the whole system leaves Earth behind the Sun.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = 'verify-shots/focus';
mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext('./.verify-profile-focus', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
});

const errors = [];
const page = context.pages()[0] || (await context.newPage());
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().split('\n')[0]);
});

const enterSystem = async () => {
  await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
  await page.locator('.boot-enter').click();
  await page.waitForSelector('.hero-cta');
  await page.locator('.hero-cta').click();
  await page.waitForSelector('.topbar');
  await page.waitForTimeout(2400);
};

const openDetail = async (id) => {
  await page.evaluate((name) => window.__solar.cameraController.focus(name, { distanceMultiplier: 2.4, duration: 1.0 }), id);
  await page.waitForTimeout(2000);
  const point = await page.evaluate((name) => {
    const scene = window.__solar;
    const world = scene.getBodyPosition(name).clone();
    const ndc = world.project(scene.camera);
    return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
  }, id);
  const picked = await page.evaluate((p) => {
    const hit = window.__solar.pickFromScreen(p.x, p.y);
    return hit ? hit.id : null;
  }, point);
  const box = await page.locator('.scene-canvas canvas').boundingBox();
  // Guard the projection: an off-screen or non-finite point makes Playwright throw
  // "Invalid parameters" instead of reporting what actually happened.
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    console.log('  !! non-finite projection for', id, JSON.stringify(point));
    return picked;
  }
  const px = box.x + box.width * Math.min(0.98, Math.max(0.02, point.x));
  const py = box.y + box.height * Math.min(0.98, Math.max(0.02, point.y));
  await page.mouse.dblclick(px, py, { delay: 60 });
  await page.waitForTimeout(2600);
  return picked;
};

const readState = () =>
  page.evaluate(() => ({
    view: window.__ui?.view,
    selectedId: window.__ui?.selectedId,
    focusMode: document.querySelector('.app')?.classList.contains('focus-mode') ?? false,
    panel: document.querySelector('.panel-detail.open')?.className ?? null,
    exit: document.querySelector('.focus-exit')?.textContent?.trim() ?? null,
  }));

// ——— desktop ———
await page.goto(url, { waitUntil: 'domcontentloaded' });
await enterSystem();
console.log('desktop picked:', await openDetail('jupiter'));
console.log('desktop state:', JSON.stringify(await readState()));
await page.screenshot({ path: `${outDir}/focus-desktop.png` });

await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
console.log('after Escape:', JSON.stringify(await readState()));

console.log('re-open picked:', await openDetail('jupiter'));
await page.locator('.focus-exit').click();
await page.waitForTimeout(1500);
console.log('after button:', JSON.stringify(await readState()));

// ——— mobile, fresh load ———
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await enterSystem();
console.log('mobile picked:', await openDetail('jupiter'));
const mobile = await page.evaluate(() => {
  const sheet = document.querySelector('.drawer');
  const detail = document.querySelector('.panel-detail');
  const rect = (sheet || detail)?.getBoundingClientRect();
  return {
    drawerPresent: Boolean(sheet),
    drawerClass: sheet?.className ?? null,
    sidePanelPresent: Boolean(detail),
    geometry: rect ? { top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
  };
});
console.log('mobile sheet:', JSON.stringify(mobile));
await page.screenshot({ path: `${outDir}/focus-mobile.png` });

console.log('page errors:', errors.length, errors.slice(0, 4));
await context.close();
