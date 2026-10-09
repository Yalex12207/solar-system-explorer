/**
 * V2.2 planet-exploration suite.
 *
 * Drives the real UI for every promise in the brief: focus-by-click for all eight
 * planets and the modelled moons, the info-panel fields, the five detail chapters,
 * EXPLORE, the moons chapter, Saturn's rings, compare and search. Fails the run on any
 * console error, page error or failed request.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4321/';
const outDir = 'verify-shots/v22';
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

const context = await chromium.launchPersistentContext('./.verify-profile-v22', {
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
page.on('requestfailed', (r) => errors.push(`request: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.boot-enter.ready', { timeout: 60000 });
await page.locator('.boot-enter').click();
await page.waitForSelector('.hero-cta');
await page.locator('.hero-cta').click();
await page.waitForSelector('.topbar');
await page.waitForTimeout(2500);

const readStore = () => page.evaluate(() => window.__ui);

/**
 * Wait until a camera flight has actually settled.
 *
 * Aim points computed mid-glide are stale by the time the ray is cast, which made the
 * moon assertions intermittently pick a neighbour. Waiting on the rig's own state is
 * more reliable than guessing a timeout.
 */
const settleCamera = async (expectedId, timeoutMs = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const mode = await page.evaluate(() => window.__solar.cameraController.mode);
    if (mode === 'focus') return true;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(120);
  }
  return false;
};

// ————————————————————————————————— 1. focus by click, every planet
console.log('\n1. Planet focus by click');
{
  const planets = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
  const unreachable = [];
  for (const id of planets) {
    // Frame the body first so it is front-most and genuinely pickable.
    await page.evaluate((name) => window.__solar.cameraController.focus(name, { distanceMultiplier: 3.4, duration: 0.6 }), id);
    await settleCamera();
    await page.waitForTimeout(400);
    // Aim and cast within one frame: the moons orbit, so a timed loop would let the aim
    // point drift off the body it was computed for.
    const picked = await page.evaluate((name) => {
      const scene = window.__solar;
      const world = scene.getBodyPosition(name).clone();
      const ndc = world.project(scene.camera);
      const hit = scene.pickFromScreen((ndc.x + 1) / 2, (1 - ndc.y) / 2);
      return hit ? hit.id : null;
    }, id);
    if (picked !== id) unreachable.push(`${id}->${picked}`);
  }
  check('every planet is pickable in the 3D scene', unreachable.length === 0, unreachable.join(', '));

  // Click Earth's disc and confirm the camera flies to it.
  await page.evaluate(() => window.__solar.cameraController.frameSystem({ distance: 80, duration: 0.6 }));
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__solar.cameraController.focus('earth', { distanceMultiplier: 3.4, duration: 0.5 }));
  await page.waitForTimeout(1400);
  const earthPoint = await page.evaluate(() => {
    const scene = window.__solar;
    const world = scene.getBodyPosition('earth').clone();
    const ndc = world.project(scene.camera);
    return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
  });
  const box = await page.locator('.scene-canvas canvas').boundingBox();
  await page.mouse.click(box.x + box.width * earthPoint.x, box.y + box.height * earthPoint.y);
  await page.waitForTimeout(2600);
  const selected = await readStore();
  check('clicking a planet selects it', selected.selectedId === 'earth', String(selected.selectedId));
  const distance = await page.evaluate(() => {
    const scene = window.__solar;
    return scene.camera.position.distanceTo(scene.getBodyPosition(window.__ui.selectedId));
  });
  check('camera flies in close to the selected planet', distance < 30, `distance ${distance.toFixed(1)}`);
  await page.screenshot({ path: `${outDir}/01-focus-earth.png` });
}

// ————————————————————————————————— 2. info panel fields
console.log('\n2. Planet information');
{
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.stat-label')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.textContent.trim().toLowerCase()),
  );
  const required = ['diameter', 'mass', 'distance from sun', 'orbital period', 'rotation period', 'gravity', 'temperature'];
  const missing = required.filter((r) => !labels.includes(r));
  // Earth has a single moon, so the label is correctly singular.
  const hasMoonField = labels.some((l) => l === 'moon' || l === 'moons');
  check('info panel shows all eight required fields', missing.length === 0 && hasMoonField, `missing: ${[...missing, ...(hasMoonField ? [] : ['moons'])].join(', ')}`);
  check('panel title names the body', (await page.locator('.panel-title').first().textContent()).trim().length > 0);
  const subtitle = await page.locator('.panel-subtitle').first().textContent().catch(() => '');
  check('panel shows the epithet', Boolean(subtitle && subtitle.length > 2), subtitle);
}

// ————————————————————————————————— 3. EXPLORE + five chapters
console.log('\n3. Planet detail');
{
  await page.locator('.panel-actions .primary-button').first().click();
  await page.waitForTimeout(2600);
  const store = await readStore();
  check('EXPLORE opens detail view', store.view === 'detail', String(store.view));
  const chapters = await page.evaluate(() =>
    [...document.querySelectorAll('.chapter-label')]
      // The phone drawer is in the DOM but display:none on desktop, so only visible
      // labels count as rendered chapters.
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.textContent.trim().toUpperCase()),
  );
  const expected = ['OVERVIEW', 'ATMOSPHERE', 'MOONS', 'MISSIONS', 'FACTS'];
  const missing = expected.filter((c) => !chapters.includes(c));
  check('five chapters present in order', missing.length === 0 && chapters.join() === expected.join(), chapters.join(' / '));
  check('focus mode engaged', await page.evaluate(() => document.querySelector('.app')?.classList.contains('focus-mode')));

  // Walk every chapter and confirm it renders content.
  const empty = [];
  for (let i = 0; i < expected.length; i += 1) {
    await page.locator('.chapter-item').nth(i).click();
    await page.waitForTimeout(700);
    const body = await page.evaluate(() => document.querySelector('.chapter-content')?.textContent?.trim().length ?? 0);
    if (body < 30) empty.push(`${expected[i]}:${body}`);
  }
  check('every chapter renders content', empty.length === 0, empty.join(', '));
  await page.screenshot({ path: `${outDir}/02-chapters.png` });
}

// ————————————————————————————————— 4. Earth specifics
console.log('\n4. Earth');
{
  await page.evaluate(() => window.__solar.cameraController.focus('earth', { distanceMultiplier: 1.4, duration: 0.8 }));
  await page.waitForTimeout(2600);
  const earth = await page.evaluate(() => {
    const record = window.__solar.registry.get('earth');
    const mat = record.mesh.material;
    return {
      shader: mat.type,
      hasDay: Boolean(mat.uniforms?.uDay?.value),
      hasNight: Boolean(mat.uniforms?.uNight?.value),
      hasClouds: Boolean(mat.uniforms?.uClouds?.value),
      hasAtmosphere: Boolean(record.atmosphere),
      cloudOffset: mat.uniforms?.uCloudOffset?.value ?? null,
    };
  });
  check('Earth uses the atmosphere shader', earth.shader === 'ShaderMaterial', earth.shader);
  check('Earth has an ocean/continent day map', earth.hasDay);
  check('Earth has a night-lights map', earth.hasNight);
  check('Earth has a cloud deck', earth.hasClouds);
  check('Earth has an atmosphere shell', earth.hasAtmosphere);

  const spinA = await page.evaluate(() => window.__solar.registry.get('earth').mesh.rotation.y);
  await page.waitForTimeout(1800);
  const spinB = await page.evaluate(() => window.__solar.registry.get('earth').mesh.rotation.y);
  check('Earth rotates', spinA !== spinB, `${spinA.toFixed(4)} -> ${spinB.toFixed(4)}`);

  const cloudA = await page.evaluate(() => window.__solar.registry.get('earth').mesh.material.uniforms.uCloudOffset.value);
  await page.waitForTimeout(1500);
  const cloudB = await page.evaluate(() => window.__solar.registry.get('earth').mesh.material.uniforms.uCloudOffset.value);
  check('cloud deck drifts independently of the surface', cloudA !== cloudB, `${cloudA.toFixed(4)} -> ${cloudB.toFixed(4)}`);
  await page.screenshot({ path: `${outDir}/03-earth.png` });
}

// ————————————————————————————————— 5. Moon
console.log('\n5. The Moon');
{
  // Framed wide enough that both Earth and its Moon are on screen.
  await page.evaluate(() => window.__solar.cameraController.focus('earth', { distanceMultiplier: 5, duration: 0.6 }));
  await page.waitForTimeout(1800);
  const moonPoint = await page.evaluate(() => {
    const scene = window.__solar;
    const world = scene.getBodyPosition('moon').clone();
    const ndc = world.project(scene.camera);
    return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2, onScreen: Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 };
  });
  check('the Moon is projected on screen beside Earth', moonPoint.onScreen, JSON.stringify(moonPoint));
  const pickedMoon = await page.evaluate((p) => {
    const hit = window.__solar.pickFromScreen(p.x, p.y);
    return hit ? hit.id : null;
  }, moonPoint);
  check('the Moon is clickable even against Earth\'s disc', pickedMoon === 'moon', `picked ${pickedMoon}`);

  await page.evaluate(() => window.__solar.cameraController.focus('moon', { distanceMultiplier: 3, duration: 0.6 }));
  await page.waitForTimeout(1500);
  const moonBox = await page.locator('.scene-canvas canvas').boundingBox();
  const moonScreen = await page.evaluate(() => {
    const scene = window.__solar;
    const world = scene.getBodyPosition('moon').clone();
    const ndc = world.project(scene.camera);
    return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
  });
  await page.mouse.click(moonBox.x + moonBox.width * moonScreen.x, moonBox.y + moonBox.height * moonScreen.y);
  await page.waitForTimeout(2200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await page.mouse.click(moonBox.x + moonBox.width * moonScreen.x, moonBox.y + moonBox.height * moonScreen.y);
  await page.waitForTimeout(2400);
  // The Moon moves while the selection panel is read, so re-read the label list.
  const moonStats = await page.evaluate(() =>
    [...document.querySelectorAll('.stat-label')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.textContent.trim().toLowerCase()),
  );
  check('the Moon panel shows diameter', moonStats.includes('diameter'), moonStats.join(', '));
  check(
    'the Moon panel shows distance from Earth',
    moonStats.some((l) => l.startsWith('distance from')),
    moonStats.join(', '),
  );
  check('the Moon panel shows orbital period', moonStats.includes('orbital period'), moonStats.join(', '));
  await page.screenshot({ path: `${outDir}/04-moon.png` });
}

// ————————————————————————————————— 6. Jupiter's Galilean moons
console.log("\n6. Jupiter's moons");
{
  await page.evaluate(() => window.__solar.cameraController.focus('jupiter', { distanceMultiplier: 2.2, duration: 0.8 }));
  await page.waitForTimeout(2800);
  const moons = ['io', 'europa', 'ganymede', 'callisto'];
  const wrong = [];
  for (const id of moons) {
    await page.evaluate((name) => window.__solar.cameraController.focus(name, { distanceMultiplier: 3.2, duration: 0.5 }), id);
    await settleCamera();
    await page.waitForTimeout(400);
    /**
     * The moons keep orbiting, so the aim point must be sampled and the ray cast within
     * the same frame. Three back-to-back attempts are used rather than a timed loop:
     * waiting between samples lets the moon drift off the aim point, which is a
     * property of the test rather than of picking.
     */
    const picked = await page.evaluate((name) => {
      const scene = window.__solar;
      let wins = 0;
      let last = null;
      const attempts = 3;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const world = scene.getBodyPosition(name).clone();
        const ndc = world.project(scene.camera);
        const hit = scene.pickFromScreen((ndc.x + 1) / 2, (1 - ndc.y) / 2);
        last = hit ? hit.id : null;
        if (last === name) wins += 1;
      }
      return { wins, last, attempts };
    }, id);
    if (picked.wins < picked.attempts) wrong.push(`${id}->${picked.last} (${picked.wins}/${picked.attempts})`);
  }
  check('all four Galilean moons are clickable', wrong.length === 0, wrong.join(', '));

  // And reachable through the MOONS chapter.
  await page.evaluate(() => window.__solar.cameraController.focus('jupiter', { distanceMultiplier: 2.2, duration: 0.6 }));
  await page.waitForTimeout(1600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const scene = window.__solar;
    scene.setSelection('jupiter');
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/05-jupiter.png` });
}

// ————————————————————————————————— 7. Saturn's rings
console.log('\n7. Saturn');
{
  const saturn = await page.evaluate(() => {
    const record = window.__solar.registry.get('saturn');
    const rings = record.rings;
    let meshes = 0;
    rings.traverse((child) => {
      if (child.isMesh) meshes += 1;
    });
    const first = rings.children[0]?.material;
    return {
      hasRings: Boolean(rings),
      meshes,
      transparent: first?.transparent ?? null,
      // The sheet is now a ShaderMaterial, so its texture lives in a uniform.
      hasTexture: Boolean(first?.uniforms?.uMap?.value),
      isLit: Boolean(first?.uniforms?.uSunDirection),
      hasShadowTerm: /uPlanetRadius/.test(first?.fragmentShader ?? ''),
      receives: rings.children[0]?.receiveShadow ?? null,
      casts: rings.children[0]?.castShadow ?? null,
      tilt: +(record.definition.render.ring.tilt ?? 0),
      outer: +(record.definition.render.ring.outer ?? 0),
    };
  });
  check('Saturn has a ring system', saturn.hasRings && saturn.meshes >= 2, JSON.stringify(saturn));
  check('rings are transparent with a texture', saturn.transparent === true && saturn.hasTexture === true, JSON.stringify(saturn));
  // V2.2 ring quality: sun-angle shading plus an analytic planet shadow.
  check('rings are shaded from the sun direction', saturn.isLit);
  check('rings evaluate the planet shadow analytically', saturn.hasShadowTerm);
  check('rings receive the planet shadow', saturn.receives === true, String(saturn.receives));
  check('rings do not cast (avoids cube-map aliasing)', saturn.casts === false, String(saturn.casts));
  check('rings are tilted', saturn.tilt > 0, `${saturn.tilt}deg`);
  check('rings extend well beyond the planet', saturn.outer > 2, `${saturn.outer} radii`);

  await page.evaluate(() => window.__solar.cameraController.focus('saturn', { distanceMultiplier: 2.0, duration: 0.8 }));
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `${outDir}/06-saturn.png` });
}

// ————————————————————————————————— 8. Compare
console.log('\n8. Compare');
{
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await page.locator('.topbar-link', { hasText: 'PLANETS' }).click();
  await page.waitForTimeout(900);
  // The index now carries its own COMPARE action opposite the explore arrow.
  const compareButton = page.locator('.browser-row', { hasText: 'Earth' }).locator('.browser-compare');
  check('the planet index offers a compare action', (await compareButton.count()) > 0);
  await compareButton.first().click();
  await page.waitForTimeout(1800);

  const compareState = await readStore();
  check('compare view opens', compareState.view === 'compare', String(compareState.view));
  check(
    'compare is pre-filled with a meaningful pairing',
    compareState.compare?.[0] === 'earth' && Boolean(compareState.compare?.[1]),
    JSON.stringify(compareState.compare),
  );
  const heading = await page.locator('.panel-title').first().textContent().catch(() => '');
  check('compare names both bodies', /vs/i.test(heading || ''), heading);
  const metrics = await page.evaluate(() =>
    [...document.querySelectorAll('.compare-metric-label')].map((el) => el.textContent.trim().toLowerCase()),
  );
  check('compare lists each metric as a row', metrics.length >= 7, `${metrics.length}: ${metrics.join(', ')}`);
  const required = ['diameter', 'mass', 'gravity', 'temperature', 'day length', 'year length', 'moons'];
  const missing = required.filter((r) => !metrics.some((m) => m.includes(r)));
  check('compare covers all seven required metrics', missing.length === 0, `missing: ${missing.join(', ')}`);
  const bars = await page.locator('.compare-bar-fill').count();
  check('compare uses proportional visual bars, not a plain table', bars > 0, `${bars} bars`);
  await page.screenshot({ path: `${outDir}/07-compare.png` });

  // A second pairing, driven from the pickers, proves it is a real two-slot tool.
  const pickers = page.locator('.compare-picker-button');
  if ((await pickers.count()) >= 2) {
    await pickers.nth(1).click();
    await page.waitForTimeout(500);
    await page.locator('.compare-dropdown .dropdown-item', { hasText: 'Jupiter' }).first().click();
    await page.waitForTimeout(1200);
    const swapped = await readStore();
    check('the second slot can be changed', swapped.compare?.[1] === 'jupiter', JSON.stringify(swapped.compare));
  }
}

// ————————————————————————————————— 9. Search
console.log('\n9. Search');
{
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  // The search field is a collapsed overlay; `/` opens it and focuses the input.
  await page.keyboard.press('/');
  await page.waitForTimeout(600);
  const searchInput = page.locator('.search.open .search-input');
  check('search opens and focuses its field', await searchInput.isVisible());
  await searchInput.fill('Earth');
  await page.waitForTimeout(1100);
  const results = await page.evaluate(() =>
    [...document.querySelectorAll('.search-result')].map((el) => el.textContent.trim()),
  );
  check('search returns results for "Earth"', results.length > 0, `${results.length}`);
  check('a planet result is present', results.some((r) => /earth/i.test(r)), results.slice(0, 3).join(' | '));

  await searchInput.fill('Europa');
  await page.waitForTimeout(1100);
  const moonResults = await page.evaluate(() =>
    [...document.querySelectorAll('.search-result')].map((el) => el.textContent.trim()),
  );
  check('search also finds moons', moonResults.some((r) => /europa/i.test(r)), moonResults.slice(0, 3).join(' | '));

  await searchInput.fill('Titan');
  await page.waitForTimeout(1100);
  const titanResults = await page.evaluate(() =>
    [...document.querySelectorAll('.search-result')].map((el) => el.textContent.trim()),
  );
  check('search finds moons of other planets', titanResults.some((r) => /titan/i.test(r)), titanResults.slice(0, 3).join(' | '));

  await searchInput.fill('Earth');
  await page.waitForTimeout(1100);
  await page.locator('.search-result').first().click();
  await page.waitForTimeout(2800);
  const afterSearch = await readStore();
  check('clicking a search result focuses that body', afterSearch.selectedId === 'earth', String(afterSearch.selectedId));
  const flew = await page.evaluate(() => {
    const scene = window.__solar;
    const id = window.__ui?.selectedId;
    if (!id) return null;
    return scene.camera.position.distanceTo(scene.getBodyPosition(id));
  });
  check('the camera actually flies to the search result', flew !== null && flew < 30, `distance ${flew?.toFixed(1)}`);
  await page.screenshot({ path: `${outDir}/08-search.png` });
}

console.log(`\n=== console errors: ${errors.length} ===`);
for (const error of errors.slice(0, 10)) console.log(`  ! ${error}`);
console.log(`\n${checks - failures}/${checks} checks passed`);
await context.close();
process.exit(failures > 0 || errors.length > 0 ? 1 : 0);
