/**
 * Visual review pass: capture a set of screens at realistic desktop and mobile
 * sizes for design inspection (not an assertion harness).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = 'verify-shots/review';
mkdirSync(outDir, { recursive: true });

const context = await chromium.launchPersistentContext('./.verify-profile-review', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1680, height: 1000 },
  args: ['--no-sandbox'],
});
const page = context.pages()[0] || (await context.newPage());

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.boot-enter.ready', { timeout: 45000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/a-boot.png` });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-title');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${outDir}/b-hero.png` });
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/c-system.png` });

// Earth selection → info panel
await page.locator('.topbar-right .icon-button', { hasText: 'SEARCH' }).click();
await page.locator('.search-input').fill('earth');
await page.waitForTimeout(400);
await page.locator('.search-result').first().click();
await page.waitForTimeout(2800);
await page.screenshot({ path: `${outDir}/d-earth-panel.png` });

// Scroll the panel to its data
await page.locator('.panel-right .panel-scroll').evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/e-earth-panel-scrolled.png` });

// Detail mode
await page.locator('.panel-right .primary-button').first().click();
await page.waitForTimeout(2600);
await page.screenshot({ path: `${outDir}/f-earth-detail.png` });

// Jupiter detail (gas giant + moons)
await page.locator('.topbar-right .icon-button', { hasText: 'SEARCH' }).click();
await page.locator('.search-input').fill('jupiter');
await page.waitForTimeout(400);
await page.locator('.search-result').first().click();
await page.waitForTimeout(2800);
await page.screenshot({ path: `${outDir}/g-jupiter.png` });

// Compare
await page.locator('.dock-collapse').click().catch(() => {});
await page.waitForTimeout(300);
await page.locator('.panel-right .ghost-button', { hasText: 'COMPARE' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/h-compare.png` });

// Missions
await page.locator('.topbar-link', { hasText: 'Missions' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/i-missions.png` });

// Mission detail
await page.locator('.mission-card').first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/j-mission-detail.png` });

// Tour (return to the system view first)
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
try {
  await page.locator('.dock-button', { hasText: 'TOUR' }).first().click({ timeout: 8000 });
} catch {
  await page.locator('.dock-collapse').click();
  await page.waitForTimeout(400);
  await page.locator('.dock-button', { hasText: 'TOUR' }).first().click({ timeout: 8000 });
}
await page.waitForTimeout(3200);
await page.screenshot({ path: `${outDir}/k-tour.png` });
await page.locator('.story-nav .dock-button', { hasText: 'NEXT' }).click();
await page.waitForTimeout(2600);
await page.screenshot({ path: `${outDir}/l-tour-2.png` });
await page.locator('.dock-button', { hasText: 'STOP TOUR' }).click().catch(() => {});
await page.waitForTimeout(600);

// Planets mega menu
await page.locator('.topbar-link', { hasText: 'Planets' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${outDir}/m-index.png` });
await page.keyboard.press('Escape');

// Expanded dock
await page.locator('.dock-collapse').click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/n-dock.png` });

// Performance mode
await page.locator('.topbar-right .icon-button', { hasText: /HIGH|BAL|PERF/ }).click();
await page.waitForTimeout(300);
await page.locator('.dropdown-item', { hasText: 'PERFORMANCE' }).click();
await page.waitForTimeout(3200);
await page.screenshot({ path: `${outDir}/o-performance.png` });

// Mobile
const mobile = await context.browser().newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const mpage = await mobile.newPage();
await mpage.goto(url, { waitUntil: 'domcontentloaded' });
await mpage.waitForSelector('.boot-enter.ready', { timeout: 45000 });
await mpage.locator('.boot-enter').tap();
await mpage.waitForTimeout(2000);
await mpage.screenshot({ path: `${outDir}/p-mobile-hero.png` });
await mpage.locator('.hero-cta').tap();
await mpage.waitForSelector('.topbar');
await mpage.waitForTimeout(3000);
await mpage.screenshot({ path: `${outDir}/q-mobile-system.png` });
await mpage.locator('.topbar-right .icon-button').first().tap();
await mpage.waitForTimeout(400);
await mpage.locator('.search-input').fill('titan');
await mpage.waitForTimeout(400);
await mpage.screenshot({ path: `${outDir}/r-mobile-search.png` });
await mpage.locator('.search-result').first().tap();
await mpage.waitForTimeout(2800);
await mpage.screenshot({ path: `${outDir}/s-mobile-drawer.png` });
await mpage.locator('.drawer .primary-button').tap();
await mpage.waitForTimeout(2400);
await mpage.screenshot({ path: `${outDir}/t-mobile-detail.png` });

await mobile.close();
await context.close();
console.log('review screenshots written to', outDir);
