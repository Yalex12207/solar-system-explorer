/**
 * Manual verification harness (not part of the app bundle).
 *
 * Drives the running dev server with Playwright: captures console/page errors and
 * screenshots the boot screen, hero, system view, detail mode, compare and
 * missions at desktop and mobile viewports.
 *
 * Usage:  node tools/verify.mjs [url] [outDir]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = process.argv[3] || 'verify-shots';
mkdirSync(outDir, { recursive: true });

const errors = [];
const logs = [];

async function shoot(page, name) {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`  · shot ${name}.png`);
}

async function run() {
  // Reuse the browser build that is already present on this machine when given;
  // otherwise Playwright resolves its own managed download. The profile directory
  // is kept inside the workspace so the run never depends on the system temp ACLs.
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const context = await chromium.launchPersistentContext(process.env.VERIFY_PROFILE || './.verify-profile', {
    executablePath,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const page = context.pages()[0] || (await context.newPage());

  page.on('console', (message) => {
    const text = `${message.type()}: ${message.text()}`;
    logs.push(text);
    const isFaviconNoise = /favicon|404 \(Not Found\)/.test(text);
    if (message.type() === 'error' && !isFaviconNoise) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    // Ignore the conventional favicon probe, which has no asset in this project.
    if (response.status() >= 400 && !/favicon/.test(response.url())) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });

  console.log(`→ open ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // ——— boot screen (captured while still initialising) ——————————
  await page.waitForSelector('.boot', { timeout: 30000 });
  await page.waitForTimeout(700);
  await shoot(page, '01-boot');
  const progress = await page.locator('.boot-progress-bar').count();
  console.log(`  · boot progress bar present: ${progress > 0}`);

  await page.waitForSelector('.boot-enter.ready', { timeout: 45000 });
  const enterDisabled = await page.locator('.boot-enter').isDisabled();
  console.log(`  · enter button enabled: ${!enterDisabled}`);
  await shoot(page, '02-boot-ready');

  // ——— landing hero ————————————————————————————————————————————
  await page.locator('.boot-enter').click();
  const stateAfterBoot = await page.evaluate(() => document.getElementById('root')?.firstElementChild?.className);
  console.log(`  · after entry click: ${stateAfterBoot}`);
  await page.waitForSelector('.hero-title', { timeout: 15000 });
  await page.waitForTimeout(2200); // let the stat staircase finish
  await shoot(page, '03-hero');
  const statCount = await page.locator('.hero-stat-value').count();
  console.log(`  · hero stats rendered: ${statCount}`);

  // ——— into the system ————————————————————————————————————————
  await page.locator('.hero-cta').click();
  await page.waitForSelector('.topbar', { timeout: 10000 });
  await page.waitForTimeout(2600);
  await shoot(page, '04-system-wide');

  const canvasBox = await page.locator('.scene-canvas canvas').boundingBox();
  console.log(`  · canvas size: ${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)}`);
  const glInfo = await page.evaluate(() => {
    const canvas = document.querySelector('.scene-canvas canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (!gl) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'masked',
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
  console.log(`  · webgl: ${JSON.stringify(glInfo)}`);

  // ——— orbit drag ————————————————————————————————————————————
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  const before = await page.screenshot({ clip: { x: cx - 60, y: cy - 60, width: 120, height: 120 } });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(cx - i * 14, cy + i * 5);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await page.screenshot({ clip: { x: cx - 60, y: cy - 60, width: 120, height: 120 } });
  console.log(`  · drag changed the view: ${Buffer.compare(before, after) !== 0}`);
  await shoot(page, '05-after-drag');

  // ——— wheel zoom ————————————————————————————————————————————
  const sizeBefore = await page.evaluate(() => {
    const gl = document.querySelector('.scene-canvas canvas');
    return gl ? gl.width : 0;
  });
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(900);
  await shoot(page, '06-after-zoom');
  console.log(`  · wheel zoom executed (buffer ${sizeBefore}px)`);

  // ——— search ————————————————————————————————————————————
  await page.locator('.topbar-right .icon-button', { hasText: 'SEARCH' }).click();
  await page.waitForTimeout(500);
  await page.locator('.search-input').fill('europa');
  await page.waitForTimeout(400);
  const resultCount = await page.locator('.search-result').count();
  console.log(`  · search results for "europa": ${resultCount}`);
  await shoot(page, '07-search');
  if (resultCount > 0) {
    await page.locator('.search-result').first().click();
    await page.waitForTimeout(2200);
    await shoot(page, '08-selected-moon');
    const infoVisible = await page.locator('.panel-right .panel-title').count();
    console.log(`  · info panel shown after search jump: ${infoVisible > 0}`);
  }

  // ——— planets index → select → detail ————————————————————————
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.locator('.topbar-link', { hasText: 'Planets' }).click();
  await page.waitForTimeout(700);
  await shoot(page, '09-planets-index');
  const browserRows = await page.locator('.browser-row').count();
  console.log(`  · index rows: ${browserRows}`);

  await page.locator('.browser-row', { hasText: 'Saturn' }).locator('.browser-main').click();
  await page.waitForTimeout(2600);
  await shoot(page, '10-saturn-selected');
  const title = await page.locator('.panel-right .panel-title').first().textContent().catch(() => null);
  console.log(`  · selection panel title: ${title}`);

  const chapterButtons = await page.locator('.panel-right .chapter-item, .panel-right .primary-button').count();
  await page.locator('.panel-right .primary-button').first().click();
  await page.waitForTimeout(2400);
  await shoot(page, '11-saturn-detail');
  const chapterCount = await page.locator('.panel-right .chapter-item').count();
  console.log(`  · detail chapters: ${chapterCount}`);

  // cycle chapters
  for (let i = 0; i < chapterCount; i += 1) {
    await page.locator('.panel-right .chapter-item').nth(i).click();
    await page.waitForTimeout(400);
  }
  await shoot(page, '12-detail-last-chapter');
  console.log(`  · chapters clicked: ${chapterButtons >= 0 ? chapterCount : 0}`);

  // ——— time control (expand the dock first: readouts live in the details row) ———
  await page.locator('.dock-collapse').click();
  await page.waitForTimeout(500);
  const dateBefore = await page.locator('.time-readout-value').first().textContent();
  await page.locator('.dock-button', { hasText: '100×' }).first().click();
  await page.waitForTimeout(2500);
  const dateAfter = await page.locator('.time-readout-value').first().textContent();
  console.log(`  · time advanced: ${dateBefore} → ${dateAfter} (${dateBefore !== dateAfter})`);
  await shoot(page, '13-time-100x');
  await page.locator('.dock-button', { hasText: 'PAUSE' }).first().click();
  await page.waitForTimeout(400);
  const pausedDate = await page.locator('.time-readout-value').first().textContent();
  await page.waitForTimeout(1400);
  const stillPaused = await page.locator('.time-readout-value').first().textContent();
  console.log(`  · pause holds: ${pausedDate === stillPaused}`);
  await page.locator('.dock-button', { hasText: '1×' }).first().click();

  // ——— orbits toggle ————————————————————————————————————————————
  await page.locator('.dock-button', { hasText: 'ORBITS' }).click();
  await page.waitForTimeout(700);
  await shoot(page, '14-orbits-off');
  await page.locator('.dock-button', { hasText: 'ORBITS' }).click();

  // ——— missions ————————————————————————————————————————————
  await page.locator('.topbar-link', { hasText: 'Missions' }).click();
  await page.waitForTimeout(900);
  await shoot(page, '15-missions');
  const missionCards = await page.locator('.mission-card').count();
  console.log(`  · mission cards: ${missionCards}`);
  await page.locator('.mission-card').first().click();
  await page.waitForTimeout(700);
  await shoot(page, '16-mission-detail');
  const missionTitle = await page.locator('.panel-title').first().textContent();
  console.log(`  · mission detail opened: ${missionTitle}`);

  // ——— compare ————————————————————————————————————————————
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.locator('.dock-collapse').click(); // collapse so the dock clears the panel
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.topbar-link')];
    const planets = buttons.find((b) => b.textContent.includes('Planets'));
    planets?.click();
  });
  await page.waitForTimeout(400);
  await page.locator('.browser-row', { hasText: 'Earth' }).locator('.browser-main').click();
  await page.waitForTimeout(1800);
  await page.locator('.panel-right .ghost-button', { hasText: 'COMPARE' }).click();
  await page.waitForTimeout(900);
  await shoot(page, '17-compare');
  const compareRows = await page.locator('.compare-metric').count();
  console.log(`  · compare metric rows: ${compareRows}`);

  // ——— guided tour ————————————————————————————————————————————
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.locator('.dock-collapse').click();
  await page.waitForTimeout(400);
  await page.locator('.dock-button', { hasText: 'TOUR' }).first().click();
  await page.waitForTimeout(2600);
  await shoot(page, '18-tour');
  const storyVisible = await page.locator('.story-card').count();
  console.log(`  · tour card visible: ${storyVisible > 0}`);
  await page.locator('.story-nav .dock-button', { hasText: 'NEXT' }).click();
  await page.waitForTimeout(2200);
  await shoot(page, '19-tour-step2');
  await page.locator('.dock-button', { hasText: 'STOP TOUR' }).click();

  // ——— about ————————————————————————————————————————————
  await page.locator('.topbar-link', { hasText: 'About' }).click();
  await page.waitForTimeout(700);
  await shoot(page, '20-about');
  await page.keyboard.press('Escape');

  // ——— quality switch (labelled HIGH / BAL / PERF) ————————————————
  await page.locator('.topbar-right .icon-button', { hasText: /HIGH|BAL|PERF/ }).click();
  await page.waitForTimeout(300);
  await shoot(page, '21-quality-menu');
  await page.locator('.dropdown-item', { hasText: 'PERFORMANCE' }).click();
  await page.waitForTimeout(3200);
  await shoot(page, '22-performance-mode');
  const stillAlive = await page.evaluate(() => !!document.querySelector('.scene-canvas canvas'));
  console.log(`  · canvas survived quality rebuild: ${stillAlive}`);

  // ——— frame rate probe ————————————————————————————————————————
  const frameStats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let last = performance.now();
        const started = last;
        const tick = (now) => {
          samples.push(now - last);
          last = now;
          if (now - started < 2500) requestAnimationFrame(tick);
          else {
            const sorted = [...samples].sort((a, b) => a - b);
            resolve({
              frames: samples.length,
              averageMs: Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)),
              p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
              fps: Math.round(1000 / (samples.reduce((a, b) => a + b, 0) / samples.length)),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`  · frame budget: ${JSON.stringify(frameStats)}`);

  // ——— reload ————————————————————————————————————————————
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.boot-enter.ready', { timeout: 45000 });
  await page.locator('.boot-enter').click();
  await page.waitForSelector('.hero-cta', { timeout: 15000 });
  await page.locator('.hero-cta').click();
  await page.waitForSelector('.topbar', { timeout: 15000 });
  console.log('  · reload path works (boot → hero → system)');
  await shoot(page, '23-after-reload');

  // ——— mobile ————————————————————————————————————————————
  const mobile = await context.browser().newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mpage = await mobile.newPage();
  mpage.on('pageerror', (error) => errors.push(`mobile pageerror: ${error.message}`));
  mpage.on('console', (message) => {
    if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`);
  });
  await mpage.goto(url, { waitUntil: 'domcontentloaded' });
  await mpage.waitForSelector('.boot-enter.ready', { timeout: 25000 });
  await mpage.screenshot({ path: `${outDir}/30-mobile-boot.png` });
  await mpage.locator('.boot-enter').tap();
  await mpage.waitForTimeout(1800);
  await mpage.screenshot({ path: `${outDir}/31-mobile-hero.png` });
  await mpage.locator('.hero-cta').tap();
  await mpage.waitForSelector('.topbar', { timeout: 15000 });
  await mpage.waitForTimeout(2600);
  await mpage.screenshot({ path: `${outDir}/32-mobile-system.png` });

  // tap a planet through the search overlay (3D tap targets are tiny on phones)
  await mpage.locator('.topbar-right .icon-button').first().tap();
  await mpage.waitForTimeout(500);
  await mpage.locator('.search-input').fill('mars');
  await mpage.waitForTimeout(500);
  await mpage.screenshot({ path: `${outDir}/33-mobile-search.png` });
  await mpage.locator('.search-result').first().tap();
  await mpage.waitForTimeout(2600);
  await mpage.screenshot({ path: `${outDir}/34-mobile-drawer.png` });
  const drawerVisible = await mpage.locator('.drawer.open').count();
  console.log(`  · mobile drawer visible: ${drawerVisible > 0}`);

  const touchTarget = await mpage.evaluate(() => {
    const button = document.querySelector('.drawer .primary-button');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  console.log(`  · primary button target: ${JSON.stringify(touchTarget)}`);

  await mpage.locator('.drawer .primary-button').tap();
  await mpage.waitForTimeout(2000);
  await mpage.screenshot({ path: `${outDir}/35-mobile-detail.png` });

  await mobile.close();
  await context.close();

  console.log(`\n=== console errors: ${errors.length} ===`);
  for (const error of errors.slice(0, 30)) console.log(`  ! ${error}`);
  console.log(`=== console messages: ${logs.length} ===`);
  for (const log of logs.slice(0, 12)) console.log(`  · ${log}`);

  process.exit(errors.length ? 1 : 0);
}

run().catch((error) => {
  console.error('harness failed:', error);
  process.exit(2);
});
