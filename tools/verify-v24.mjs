/**
 * V2.4 suite: time simulation and space missions.
 *
 * Verifies the two halves of the brief against the real UI — the time machine (speeds,
 * live solar-system clock, pause) and the mission archive (required missions, timeline
 * years, detail fields) — and then drives the Voyager Experience end to end, asserting
 * that the camera genuinely leaves the system before the title card appears.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = 'verify-shots/v24';
mkdirSync(outDir, { recursive: true });

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

const context = await chromium.launchPersistentContext('./.verify-profile-v24', {
  executablePath: process.env.CHROMIUM_PATH,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
});
const page = context.pages()[0] || (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().split('\n')[0]}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-cta');
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(2500);
await page.locator('.dock-collapse').click().catch(() => {});
await page.waitForTimeout(400);

const readStore = () => page.evaluate(() => window.__ui);

// ————————————————————————————————— 1. time control
console.log('\n1. Time control');
{
  const buttons = await page.locator('.time-control .dock-button').allTextContents();
  const labels = buttons.map((t) => t.trim());
  check('the dock exposes all six speeds', labels.length === 6, labels.join(' | '));
  const expected = ['PAUSE', '1×', '10×', '100×', '1k×', '10k×'];
  const missing = expected.filter((e) => !labels.includes(e));
  check('speeds are PAUSE, 1x, 10x, 100x, 1000x, 10000x', missing.length === 0, `missing ${missing.join(', ')}`);

  const scales = await page.evaluate(() => window.__timeScales ?? null);
  check('10000 exists as an actual scale value', Array.isArray(scales) ? scales.includes(10000) : true, JSON.stringify(scales));

  await page.locator('.time-control .dock-button', { hasText: '10k×' }).click();
  await page.waitForTimeout(900);
  const atTenK = await readStore();
  check('selecting 10000x sets the simulation scale', atTenK.timeScale === 10000, String(atTenK.timeScale));

  // The clock must actually move.
  const before = await page.evaluate(() => window.__ui.simulationDate.getTime());
  await page.waitForTimeout(2200);
  const after = await page.evaluate(() => window.__ui.simulationDate.getTime());
  check('the solar system clock advances', after > before, `${new Date(before).toISOString()} -> ${new Date(after).toISOString()}`);
  const years = (after - before) / (365.25 * 86400000);
  check('10000x advances years, not seconds', years > 0.1, `${years.toFixed(2)} years in ~2s`);
  await page.screenshot({ path: `${outDir}/01-time-10000x.png` });
}

// ————————————————————————————————— 2. solar system time readout
console.log('\n2. Solar system time readout');
{
  const readout = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.time-readout')];
    const rows = groups.flatMap((g) =>
      [...g.children].map((child) => ({
        value: child.querySelector('.time-readout-value')?.textContent?.trim() ?? null,
        label: child.querySelector('.time-readout-label')?.textContent?.trim() ?? null,
      })),
    );
    return rows;
  });
  const labels = readout.map((r) => (r.label || '').toLowerCase());
  check('a SOLAR SYSTEM TIME readout is present', labels.some((l) => l.includes('solar system time')), labels.join(' | '));
  check('an EARTH day-of-year readout is present', labels.includes('earth'), labels.join(' | '));

  const dateRow = readout.find((r) => (r.label || '').toLowerCase().includes('solar system time'));
  const earthRow = readout.find((r) => (r.label || '').toLowerCase() === 'earth');
  check('the date is formatted YYYY.MM.DD', /^\d{4}\.\d{2}\.\d{2}$/.test(dateRow?.value ?? ''), String(dateRow?.value));
  check('the Earth row reports a DAY number', /^DAY \d+$/.test(earthRow?.value ?? ''), String(earthRow?.value));

  // It must be driven by the simulation, not the wall clock.
  const dayA = Number((earthRow?.value ?? '').replace(/\D/g, ''));
  await page.waitForTimeout(2400);
  const after = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.time-readout')].flatMap((g) => [...g.children]);
    const earth = rows.find((c) => (c.querySelector('.time-readout-label')?.textContent || '').trim().toLowerCase() === 'earth');
    return earth?.querySelector('.time-readout-value')?.textContent?.trim() ?? '';
  });
  const dayB = Number(after.replace(/\D/g, ''));
  check('the day number tracks the simulation', dayB !== dayA, `DAY ${dayA} -> DAY ${dayB}`);
  await page.screenshot({ path: `${outDir}/02-readout.png` });
}

// ————————————————————————————————— 3. pause
console.log('\n3. Pause');
{
  await page.locator('.time-control .dock-button', { hasText: 'PAUSE' }).click();
  await page.waitForTimeout(700);
  const paused = await readStore();
  check('the PAUSE control stops the clock', paused.timeScale === 0, String(paused.timeScale));

  const frozenA = await page.evaluate(() => window.__ui.simulationDate.getTime());
  await page.waitForTimeout(1800);
  const frozenB = await page.evaluate(() => window.__ui.simulationDate.getTime());
  check('a paused clock does not advance', frozenA === frozenB, `${frozenA} -> ${frozenB}`);

  // Space toggles it back.
  await page.locator('.scene-canvas canvas').click({ position: { x: 30, y: 30 } }).catch(() => {});
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  const resumed = await readStore();
  check('SPACE resumes the simulation', resumed.timeScale !== 0, String(resumed.timeScale));

  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const rePaused = await readStore();
  check('SPACE pauses it again', rePaused.timeScale === 0, String(rePaused.timeScale));
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
}

// ————————————————————————————————— 4. missions
console.log('\n4. Missions');
{
  await page.locator('.topbar-link', { hasText: 'MISSIONS' }).click();
  await page.waitForTimeout(1200);
  const listed = await page.evaluate(() =>
    [...document.querySelectorAll('.mission-name, .mission-card-name, .timeline-name, .stat-row-label')].map((el) =>
      el.textContent.trim(),
    ),
  );
  const body = await page.evaluate(() => document.body.textContent);
  const required = ['Apollo', 'Voyager 1', 'Voyager 2', 'Cassini', 'Juno', 'New Horizons'];
  const missing = required.filter((name) => !body.includes(name));
  check('all required missions are present', missing.length === 0, `missing ${missing.join(', ')}`);
  check('a Mars rover mission is present', /Mars Exploration Rovers|Perseverance|Curiosity/.test(body));
  check('the missions panel opened', (await readStore()).view === 'missions');
  await page.screenshot({ path: `${outDir}/03-missions.png` });
}

// ————————————————————————————————— 5. timeline
console.log('\n5. Mission timeline');
{
  const timeline = await page.evaluate(() =>
    [...document.querySelectorAll('.timeline-item')].map((li) => ({
      year: li.querySelector('.timeline-year')?.textContent?.trim() ?? null,
      name: li.querySelector('.timeline-name')?.textContent?.trim() ?? null,
    })),
  );
  check('the timeline renders entries', timeline.length >= 20, `${timeline.length} entries`);

  const require = [
    [1977, /voyager/i],
    [1997, /cassini/i],
    [2011, /juno/i],
    [2015, /new horizons/i],
  ];
  const wrong = [];
  for (const [year, pattern] of require) {
    const found = timeline.find((t) => Number(t.year) === year && pattern.test(t.name || ''));
    if (!found) {
      const atYear = timeline.filter((t) => Number(t.year) === year).map((t) => t.name);
      wrong.push(`${year} ${pattern}: got [${atYear.join(', ')}]`);
    }
  }
  check('1977 VOYAGER / 1997 CASSINI / 2011 JUNO / 2015 NEW HORIZONS', wrong.length === 0, wrong.join(' | '));

  const years = timeline.map((t) => Number(t.year));
  const sorted = years.every((y, i) => i === 0 || years[i - 1] <= y);
  check('the timeline is in chronological order', sorted);
  await page.screenshot({ path: `${outDir}/04-timeline.png` });
}

// ————————————————————————————————— 6. mission detail
console.log('\n6. Mission detail');
{
  await page.locator('.timeline-item', { hasText: 'New Horizons' }).locator('.timeline-body').click();
  await page.waitForTimeout(1400);
  const detail = await page.evaluate(() => {
    const panel = document.querySelector('.panel-mission');
    const stats = [...(panel?.querySelectorAll('.stat') ?? [])].map((s) => ({
      label: s.querySelector('.stat-label')?.textContent?.trim().toLowerCase() ?? null,
      value: s.querySelector('.stat-value')?.textContent?.trim() ?? null,
    }));
    return {
      title: panel?.querySelector('.panel-title')?.textContent?.trim() ?? null,
      stats,
      achievement: panel?.querySelector('.mission-achievement-value')?.textContent?.trim() ?? null,
      launchDate: panel?.querySelector('.mission-hero-value')?.textContent?.trim() ?? null,
      milestone: panel?.querySelector('.mission-milestone')?.textContent?.trim() ?? null,
    };
  });
  check('the detail panel opens for the mission', detail.title === 'New Horizons', String(detail.title));
  const labels = detail.stats.map((s) => s.label);
  for (const field of ['launch', 'destination', 'status']) {
    check(`mission detail shows ${field}`, labels.includes(field), labels.join(', '));
  }
  check('mission detail shows an achievement', Boolean(detail.achievement), String(detail.achievement));
  check('the true launch date is shown', detail.launchDate === '19 January 2006', String(detail.launchDate));
  check('the 2015 milestone is surfaced', /2015/.test(detail.milestone ?? ''), String(detail.milestone));
  await page.screenshot({ path: `${outDir}/05-mission-detail.png` });
}

// ————————————————————————————————— 7. the Voyager Experience
console.log('\n7. Voyager Experience');
{
  await page.locator('.panel-back').click();
  await page.waitForTimeout(900);
  await page.locator('.timeline-item', { hasText: 'Voyager 1' }).locator('.timeline-body').click();
  await page.waitForTimeout(1200);
  const launch = page.locator('.voyage-launch');
  check('the departure is offered from the Voyager record', (await launch.count()) > 0);
  await launch.click();
  await page.waitForTimeout(900);

  const staged = await readStore();
  check('the sequence starts and freezes the clock', staged.voyage !== null && staged.timeScale === 0, JSON.stringify({ voyage: staged.voyage, timeScale: staged.timeScale }));
  check('the app enters voyage mode', await page.evaluate(() => document.querySelector('.app')?.classList.contains('voyage-active')));
  check('the departure is announced', (await page.locator('.voyage-eyebrow').first().textContent()).toLowerCase().includes('leaving'));

  // The camera must genuinely leave: distance grows, and the system is scaled to compensate.
  const startDistance = await page.evaluate(() => {
    const rig = window.__solar.cameraController;
    return rig.voyageDistance ?? 0;
  });
  await page.waitForTimeout(6000);
  const mid = await page.evaluate(() => ({
    distance: window.__solar.cameraController.voyageDistance ?? 0,
    rootScale: +window.__solar.root.scale.x.toFixed(5),
    mode: window.__solar.cameraController.mode,
  }));
  check('the camera leaves the system', mid.distance > startDistance * 3, `${startDistance.toFixed(0)} -> ${mid.distance.toFixed(0)}`);
  check('the rig is in departure mode', mid.mode === 'escape', String(mid.mode));
  check('the system is depth-compensated so it stays framed', mid.rootScale > 0 && mid.rootScale < 0.9, `scale ${mid.rootScale}`);
  await page.screenshot({ path: `${outDir}/06-voyage-departing.png` });

  // Wait out the rest of the flight plus the card timing.
  await page.waitForTimeout(10000);
  const card = await page.evaluate(() => ({
    title: document.querySelector('.voyage-card-title')?.textContent?.trim() ?? null,
    sub: document.querySelector('.voyage-card-sub')?.textContent?.trim() ?? null,
    returnButton: Boolean(document.querySelector('.voyage-return')),
    distance: window.__solar.cameraController.voyageDistance ?? 0,
    complete: Boolean(window.__solar.cameraController.voyageComplete),
  }));
  check('the departure completes', card.complete, JSON.stringify(card));
  check('the title card reads VOYAGER 1', card.title === 'VOYAGER 1', String(card.title));
  check('the card reads A MESSAGE FROM HUMANITY', card.sub === 'A MESSAGE FROM HUMANITY', String(card.sub));
  check('a way back is offered', card.returnButton);
  await page.screenshot({ path: `${outDir}/07-voyage-card.png` });

  // Returning restores the system.
  await page.locator('.voyage-return').click();
  await page.waitForTimeout(2600);
  const back = await page.evaluate(() => ({
    voyage: window.__ui?.voyage ?? null,
    rootScale: +window.__solar.root.scale.x.toFixed(3),
    mode: window.__solar.cameraController.mode,
    voyageActive: document.querySelector('.app')?.classList.contains('voyage-active') ?? false,
    canvas: Boolean(document.querySelector('.scene-canvas canvas')),
  }));
  check('returning clears the sequence', back.voyage === null && !back.voyageActive, JSON.stringify(back));
  check('the system scale is restored', Math.abs(back.rootScale - 1) < 0.01, String(back.rootScale));
  check('the scene is still alive after the trip', back.canvas);
  await page.screenshot({ path: `${outDir}/08-after-voyage.png` });
}

console.log(`\n=== console errors: ${errors.length} ===`);
for (const error of errors.slice(0, 8)) console.log(`  ! ${error}`);
console.log(`\n${checks - failures}/${checks} checks passed`);
await context.close();
process.exit(failures > 0 || errors.length > 0 ? 1 : 0);
