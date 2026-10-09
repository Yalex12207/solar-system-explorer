/**
 * V2.5 suite: Cosmic Scale.
 *
 * Verifies the ladder (Earth → Moon → Solar System → Outer System → Oort Cloud → Milky Way),
 * the VISUAL SCALE / REAL DATA separation, Distance Mode with real measurements, the
 * cinematic pull-back, the closing `YOU ARE HERE` frame, and that the galaxy layers stay
 * within their particle budgets. Also confirms the earlier interaction modes still work.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = 'verify-shots/v25';
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

const context = await chromium.launchPersistentContext('./.verify-profile-v25', {
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
await page.waitForTimeout(2600);
await page.locator('.dock-collapse').click().catch(() => {});
await page.waitForTimeout(400);

const readStore = () => page.evaluate(() => window.__ui);
const readScene = () =>
  page.evaluate(() => {
    const scene = window.__solar;
    const cosmic = scene.cosmic;
    return {
      cosmicStage: window.__ui?.cosmicStage ?? null,
      rootScale: +scene.root.scale.x.toFixed(5),
      rootVisible: scene.root.visible,
      cosmicVisible: cosmic?.root.visible ?? null,
      oortVisible: cosmic?.oort.points.visible ?? null,
      oortCount: cosmic?.oort.count ?? null,
      galaxyVisible: cosmic?.galaxy.group.visible ?? null,
      galaxyStars: cosmic?.galaxy.starCount ?? null,
      markerVisible: cosmic?.marker.group.visible ?? null,
      markerOpacity: cosmic?.marker.ring.material.opacity ?? null,
      markerDistance: cosmic ? +cosmic.marker.group.position.length().toFixed(3) : null,
      discRadius: cosmic?.galaxy.discRadius ?? null,
      mode: scene.cameraController.mode,
      distance: +(scene.cameraController.cosmicDistance ?? 0).toFixed(1),
      canvas: Boolean(document.querySelector('.scene-canvas canvas')),
    };
  });

// ————————————————————————————————— 1. the entry point
console.log('\n1. Cosmic Scale entry');
{
  const button = page.locator('.cosmic-control .cosmic-button');
  check('the dock exposes COSMIC SCALE', (await button.count()) > 0);
  check('it reads COSMIC SCALE before the ladder opens', (await button.textContent()).trim() === 'COSMIC SCALE');
  await button.click();
  await page.waitForTimeout(2400);
  const state = await readStore();
  check('the ladder opens', state.cosmicStage !== null, String(state.cosmicStage));
  check('the panel appears', await page.locator('.panel-cosmic').isVisible());
  check('the app marks itself cosmic-active', await page.evaluate(() => document.querySelector('.app')?.classList.contains('cosmic-active')));
}

// ————————————————————————————————— 2. the ladder
console.log('\n2. The ladder');
{
  const rungs = await page.evaluate(() =>
    [...document.querySelectorAll('.scale-rung-label')].map((el) => el.textContent.trim().toUpperCase()),
  );
  const expected = ['EARTH', 'MOON', 'SOLAR SYSTEM', 'OUTER SOLAR SYSTEM', 'OORT CLOUD', 'MILKY WAY'];
  check('the ladder has all six rungs in order', rungs.join('|') === expected.join('|'), rungs.join(' | '));
  await page.screenshot({ path: `${outDir}/01-ladder.png` });
}

// ————————————————————————————————— 3. real data vs visual scale
console.log('\n3. Visual scale vs real data');
{
  const legend = await page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? '';
    return {
      visual: text('.scale-legend-item.visual'),
      real: text('.scale-legend-item.real'),
      hasLegendBlock: Boolean(document.querySelector('.scale-legend')),
    };
  });
  check('VISUAL SCALE is labelled', /VISUAL SCALE/i.test(legend.visual), legend.visual);
  check('REAL DATA is labelled', /REAL DATA/i.test(legend.real), legend.real);

  // The Moon rung must print the real 384,400 km figure.
  await page.locator('.scale-rung').nth(1).click();
  await page.waitForTimeout(2000);
  const moonMeasure = await page.evaluate(() => ({
    value: document.querySelector('.scale-measure-value')?.textContent?.trim() ?? '',
    label: document.querySelector('.scale-measure-label')?.textContent?.trim() ?? '',
  }));
  check('the Moon rung reports the real distance', /384,400 km/.test(moonMeasure.value), JSON.stringify(moonMeasure));
  check('the measurement is labelled', /distance/i.test(moonMeasure.label), moonMeasure.label);

  // And the galaxy rung its real diameter.
  await page.locator('.scale-rung').nth(5).click();
  await page.waitForTimeout(3400);
  const galaxyMeasure = await page.evaluate(() => ({
    value: document.querySelector('.scale-measure-value')?.textContent?.trim() ?? '',
    facts: [...document.querySelectorAll('.scale-fact-value')].map((el) => el.textContent.trim()),
  }));
  check('the Milky Way rung reports a real diameter', /105,700 light-years/.test(galaxyMeasure.value), galaxyMeasure.value);
  check(
    'it reports our real distance from the centre and our arm',
    galaxyMeasure.facts.some((f) => /26,000 light-years/.test(f)) && galaxyMeasure.facts.some((f) => /Orion Arm/i.test(f)),
    galaxyMeasure.facts.join(' | '),
  );
  await page.screenshot({ path: `${outDir}/02-milky-way-panel.png` });
}

// ————————————————————————————————— 4. YOU ARE HERE
console.log('\n4. The final frame');
{
  const final = await page.evaluate(() => ({
    tag: document.querySelector('.you-are-here-tag')?.textContent?.trim() ?? null,
    body: document.querySelector('.you-are-here-body')?.textContent?.trim() ?? null,
    arm: document.querySelector('.you-are-here-arm')?.textContent?.trim() ?? null,
    copy: document.querySelector('.you-are-here-copy')?.textContent?.trim() ?? null,
  }));
  check('YOU ARE HERE is shown', (final.tag ?? '').toUpperCase() === 'YOU ARE HERE', String(final.tag));
  check('the label reads Solar System', final.body === 'Solar System', String(final.body));
  check('the arm is named', final.arm === 'Orion Arm', String(final.arm));
  check('the closing line is present', final.copy === 'Somewhere in the Milky Way.', String(final.copy));

  // The marker must be placed at the measured fraction of the disc, not at the centre.
  const scene = await readScene();
  const fraction = scene.markerDistance / scene.discRadius;
  check('the marker sits at the measured galactocentric fraction', Math.abs(fraction - 0.492) < 0.01, `${fraction.toFixed(3)}`);
  check('the galaxy marker is visible', scene.markerVisible === true);
}

// ————————————————————————————————— 5. Distance Mode
console.log('\n5. Distance Mode');
{
  await page.locator('.distance-chips .chip', { hasText: 'Earth → Sun' }).click();
  await page.waitForTimeout(1100);
  const readout = await page.evaluate(() => ({
    route: document.querySelector('.distance-route')?.textContent?.trim() ?? null,
    value: document.querySelector('.distance-value')?.textContent?.trim() ?? null,
    unit: document.querySelector('.distance-unit')?.textContent?.trim() ?? null,
    light: document.querySelector('.distance-light')?.textContent?.trim() ?? null,
  }));
  check('the route is named', readout.route === 'Earth → Sun', String(readout.route));
  check('the real distance is printed', /149\.6 million km/.test(readout.value ?? ''), String(readout.value));
  check('the unit is given as 1 AU', /1\.00 AU/.test(readout.unit ?? ''), String(readout.unit));
  check('light travel time is derived', /8 min/.test(readout.light ?? ''), String(readout.light));

  await page.locator('.distance-chips .chip', { hasText: 'Earth → Moon' }).click();
  await page.waitForTimeout(1100);
  const moon = await page.evaluate(() => ({
    value: document.querySelector('.distance-value')?.textContent?.trim() ?? null,
    aux: document.querySelector('.distance-aux')?.textContent?.trim() ?? null,
  }));
  check('the Earth–Moon measurement is real', /384,400 km|0\.4 million km/.test(moon.value ?? ''), String(moon.value));
  await page.screenshot({ path: `${outDir}/03-distance-mode.png` });
}

// ————————————————————————————————— 6. particle budgets
console.log('\n6. Particle budgets');
{
  const budget = await page.evaluate(() => {
    const cosmic = window.__solar.cosmic;
    return {
      oort: cosmic.oort.count,
      galaxyStars: cosmic.galaxy.starCount,
      galaxyDust: cosmic.galaxy.dustCount,
      oortPoints: cosmic.oort.geometry.attributes.position.count,
      starPoints: cosmic.galaxy.stars.geometry.attributes.position.count,
      // One draw call per layer is what keeps the galaxy affordable.
      oortObjects: 1,
    };
  });
  check('the Oort Cloud uses a bounded point budget', budget.oort > 0 && budget.oort <= 12000, JSON.stringify(budget));
  check('the galaxy uses a bounded star budget', budget.galaxyStars > 0 && budget.galaxyStars <= 30000, String(budget.galaxyStars));
  check('geometry matches the declared budget', budget.oortPoints === budget.oort && budget.starPoints === budget.galaxyStars, JSON.stringify(budget));
}

// ————————————————————————————————— 7. the cinematic pull-back
console.log('\n7. Cinematic pull-back');
{
  await page.locator('.panel-cosmic .panel-close').click();
  await page.waitForTimeout(2800);
  const back = await readStore();
  check('closing the panel leaves the ladder', back.cosmicStage === null, String(back.cosmicStage));
  const restored = await readScene();
  check('the solar system is restored', restored.rootVisible && Math.abs(restored.rootScale - 1) < 0.02, JSON.stringify(restored));
  check('the cosmic layers are hidden again', restored.cosmicVisible === false, String(restored.cosmicVisible));

  /**
   * Representation per rung.
   *
   * Each rung is driven on its own and allowed to settle before asserting, because the
   * guided trip runs asynchronously and would otherwise race these clicks.
   */
  const wrong = [];
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.locator('.cosmic-control .cosmic-button').click();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1200);
    // eslint-disable-next-line no-await-in-loop
    await page.locator('.scale-rung').nth(i).click();
    const settle = i >= 4 ? 9000 : 3000;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(settle);
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await readScene();
    const wantsSystem = i <= 3;
    if (wantsSystem && !snapshot.rootVisible) wrong.push(`rung ${i}: system hidden`);
    if (wantsSystem && snapshot.cosmicVisible) wrong.push(`rung ${i}: cosmic layers shown`);
    if (i === 4 && !snapshot.oortVisible) wrong.push(`rung 4: shell hidden ${JSON.stringify(snapshot)}`);
    if (i === 5 && !snapshot.galaxyVisible) wrong.push('rung 5: galaxy hidden');
    // The system must shrink away as the camera leaves.
    if (i === 5 && snapshot.rootScale > 0.5) wrong.push(`rung 5: system not compressed (${snapshot.rootScale})`);
    // eslint-disable-next-line no-await-in-loop
    await page.locator('.cosmic-control .cosmic-button').click();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2600);
  }
  check('every rung shows the right representation', wrong.length === 0, wrong.join(' | '));

  // Now the guided trip, observed from the outside.
  await page.locator('.cosmic-control .cosmic-button').click();
  await page.waitForTimeout(1600);
  const started = await readScene();
  check('the trip starts from the innermost rung', started.cosmicStage === 'earth', String(started.cosmicStage));
  const startDistance = started.distance;

  await page.waitForTimeout(10000);
  const midway = await readScene();
  check('the camera keeps pulling back', midway.distance > startDistance * 3, `${startDistance} -> ${midway.distance}`);
  await page.screenshot({ path: `${outDir}/04-pullback.png` });

  // Wait out the remaining hops plus the card timing.
  await page.waitForTimeout(24000);
  const card = await page.evaluate(() => ({
    tag: document.querySelector('.finale-tag')?.textContent?.trim() ?? null,
    title: document.querySelector('.finale-title')?.textContent?.trim() ?? null,
    arm: document.querySelector('.finale-arm')?.textContent?.trim() ?? null,
    copy: document.querySelector('.finale-copy')?.textContent?.trim() ?? null,
    returnButton: Boolean(document.querySelector('.finale-return')),
    stage: window.__ui?.cosmicStage ?? null,
  }));
  check('the trip reaches the Milky Way', card.stage === 'milky-way', String(card.stage));
  check('the closing frame shows YOU ARE HERE', (card.tag ?? '').toUpperCase() === 'YOU ARE HERE', String(card.tag));
  check('it names the Solar System', card.title === 'Solar System', String(card.title));
  check('it names the Orion Arm', card.arm === 'Orion Arm', String(card.arm));
  check('it closes with the line', card.copy === 'Somewhere in the Milky Way.', String(card.copy));
  check('a way back is offered', card.returnButton);
  await page.screenshot({ path: `${outDir}/05-finale.png` });

  await page.locator('.finale-return').click();
  await page.waitForTimeout(3000);
  const ended = await readScene();
  check('returning restores the system', ended.cosmicStage === null && Math.abs(ended.rootScale - 1) < 0.02, JSON.stringify(ended));
  await page.screenshot({ path: `${outDir}/06-restored.png` });
}

// ————————————————————————————————— 8. earlier modes still work
console.log('\n8. Existing interaction modes');
{
  const box = await page.locator('.scene-canvas canvas').boundingBox();
  const before = await page.evaluate(() => {
    const scene = window.__solar;
    const offset = scene.camera.position.clone().sub(scene.cameraController.controls.target);
    return Math.atan2(offset.x, offset.z);
  });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 150, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const scene = window.__solar;
    const offset = scene.camera.position.clone().sub(scene.cameraController.controls.target);
    return Math.atan2(offset.x, offset.z);
  });
  check('mouse dragging still orbits', Math.abs(after - before) > 0.02, `${before.toFixed(3)} -> ${after.toFixed(3)}`);

  const pick = await page.evaluate(() => {
    const scene = window.__solar;
    const world = scene.getBodyPosition('earth').clone();
    const ndc = world.project(scene.camera);
    const hit = scene.pickFromScreen((ndc.x + 1) / 2, (1 - ndc.y) / 2);
    return hit ? hit.id : null;
  });
  check('picking still resolves bodies', pick !== null, String(pick));

  // Time control must be untouched.
  const scales = await page.locator('.time-control .dock-button').allTextContents();
  check('the time controls are intact', scales.length === 6, scales.map((s) => s.trim()).join(' | '));
}

console.log(`\n=== console errors: ${errors.length} ===`);
for (const error of errors.slice(0, 8)) console.log(`  ! ${error}`);
console.log(`\n${checks - failures}/${checks} checks passed`);
await context.close();
process.exit(failures > 0 || errors.length > 0 ? 1 : 0);
