/**
 * Unified catalog: resolves any id to a body definition, builds the chapter list
 * for detail mode and powers the search index.
 */

import { PLANETS, PLANET_BY_ID, SUN, BODY_BY_ID } from './planets.js';
import { MOONS, MOON_BY_ID } from './moons.js';
import { MISSIONS, MISSION_BY_ID, missionsForBody } from './missions.js';

export { PLANETS, PLANET_BY_ID, SUN, BODY_BY_ID, MOONS, MOON_BY_ID, MISSIONS, MISSION_BY_ID, missionsForBody };

/** Every focusable body: the Sun, the eight planets and every modelled moon. */
export const ALL_NODES = [SUN, ...PLANETS, ...MOONS];

export const NODE_BY_ID = ALL_NODES.reduce((acc, node) => {
  acc[node.id] = node;
  return acc;
}, {});

export function getNode(id) {
  return NODE_BY_ID[id] || null;
}

export function isMoon(id) {
  return Boolean(MOON_BY_ID[id]);
}

export function getParent(id) {
  const moon = MOON_BY_ID[id];
  if (!moon) return null;
  return PLANET_BY_ID[moon.parent] || null;
}

/**
 * Detail-mode chapters for a body.
 * Moons and the Sun get a tailored, shorter list.
 */
export function getChapters(id) {
  const node = getNode(id);
  if (!node) return [];
  const chapters = [{ key: 'overview', label: 'Overview' }];
  if (node.id !== 'sun' && node.atmosphere) {
    chapters.push({ key: 'atmosphere', label: 'Atmosphere' });
  }
  const moonCount = node.type === 'planet' ? node.render?.moons?.length ?? 0 : 0;
  if (moonCount > 0) {
    chapters.push({ key: 'moons', label: 'Moons' });
  }
  chapters.push({ key: 'missions', label: 'Missions' });
  chapters.push({ key: 'facts', label: 'Facts' });
  // Number sequentially so the UI never shows a gap.
  return chapters.map((chapter, index) => ({ ...chapter, index: String(index + 1).padStart(2, '0') }));
}

/** Moons of a body, resolved from the moon catalog. */
export function getMoonsOf(id) {
  return MOONS.filter((moon) => moon.parent === id);
}

/**
 * Key statistics shown in the info panel, in a stable order.
 *
 * When a `limit` is given, secondary fields (day length, axial tilt) are dropped before
 * any primary field is: a naive truncation spent a slot on "Day Length" — which mostly
 * restates the rotation period — and pushed "Moons" out of the panel entirely.
 *
 * @param {object} node
 * @param {number} [limit] how many to return; omit for all
 */
export function getKeyStats(node, limit) {
  if (!node) return [];
  // A moon's parent distance is more informative than its (undefined) solar distance,
  // and "Moons" means something different for a moon, so these are handled explicitly.
  const isMoon = node.type === 'moon';
  const primary = [];
  const secondary = [];
  if (node.diameter) primary.push({ label: 'Diameter', value: formatKm(node.diameter), raw: `${node.diameter} km` });
  if (node.mass) primary.push({ label: 'Mass', value: node.mass, raw: node.mass });
  if (node.distanceFromSun) {
    primary.push({ label: 'Distance from Sun', value: node.distanceFromSun, raw: node.distanceFromSun });
  }
  if (node.distanceFromParent) {
    primary.push({
      label: 'Distance from ' + (getParent(node.id)?.name || 'parent'),
      value: node.distanceFromParent,
      raw: node.distanceFromParent,
    });
  }
  if (node.orbitalPeriod) primary.push({ label: 'Orbital Period', value: node.orbitalPeriod, raw: node.orbitalPeriod });
  if (node.rotationPeriod) primary.push({ label: 'Rotation Period', value: node.rotationPeriod, raw: node.rotationPeriod });
  if (node.gravity) primary.push({ label: 'Gravity', value: node.gravity, raw: node.gravity });
  if (node.temperature) primary.push({ label: 'Temperature', value: node.temperature, raw: node.temperature });
  if (!isMoon) {
    primary.push({
      label: node.moons === 1 ? 'Moon' : 'Moons',
      value: String(node.moons ?? 0),
      raw: String(node.moons ?? 0),
    });
  }
  // Day length duplicates the rotation period for most bodies, so it is secondary.
  if (node.dayLength && !isMoon) secondary.push({ label: 'Day Length', value: node.dayLength, raw: node.dayLength });
  if (node.axialTilt !== undefined) {
    secondary.push({ label: 'Axial Tilt', value: `${node.axialTilt}°`, raw: `${node.axialTilt}°` });
  }

  if (typeof limit !== 'number') return [...primary, ...secondary];
  if (primary.length >= limit) return primary.slice(0, limit);
  return [...primary, ...secondary.slice(0, limit - primary.length)];
}

export function formatKm(value) {
  if (!value) return '0 km';
  return `${value.toLocaleString('en-US')} km`;
}

/** Numeric metrics used by the comparison view. */
export const COMPARE_METRICS = [
  {
    key: 'diameter',
    label: 'Diameter',
    unit: 'km',
    get: (node) => node.diameter,
    format: (value) => `${Math.round(value).toLocaleString('en-US')}`,
    higherIsLarger: true,
  },
  {
    key: 'massEarths',
    label: 'Mass',
    unit: '× Earth',
    get: (node) => node.massEarths,
    format: (value) => (value >= 1 ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : value.toFixed(3)),
    higherIsLarger: true,
  },
  {
    key: 'gravity',
    label: 'Gravity',
    unit: 'm/s²',
    get: (node) => parseFloat(node.gravity),
    format: (value) => value.toFixed(2),
    higherIsLarger: true,
  },
  {
    key: 'temperatureC',
    label: 'Mean Temperature',
    unit: '°C',
    get: (node) => node.temperatureC,
    format: (value) => `${value.toLocaleString('en-US')}`,
    higherIsLarger: false,
  },
  {
    key: 'dayHours',
    label: 'Day Length',
    unit: 'hours',
    get: (node) => Math.abs(node.rotationHours ?? node.orbitalPeriodDays * 24),
    format: (value) => (value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1)),
    higherIsLarger: true,
  },
  {
    key: 'yearDays',
    label: 'Year Length',
    unit: 'days',
    get: (node) => node.orbitalPeriodDays,
    format: (value) => (value >= 1000 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1)),
    higherIsLarger: true,
  },
  {
    key: 'moons',
    label: 'Moons',
    unit: '',
    get: (node) => node.moons,
    format: (value) => String(value),
    higherIsLarger: true,
  },
];

/**
 * Search across bodies and missions. Returns ranked, grouped results.
 * Simple prefix/substring scoring keeps it dependency-free and instant.
 */
export function searchCatalog(query, { limit = 9 } = {}) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const results = [];

  const score = (text, weight) => {
    const value = text.toLowerCase();
    if (value === term) return 100 * weight;
    if (value.startsWith(term)) return 70 * weight;
    if (value.includes(term)) return 45 * weight;
    // Token match, e.g. "mars rover" -> "Mars Rover" or "Apollo 11" -> "apollo"
    const tokens = value.split(/[\s\-–]+/);
    if (tokens.some((token) => token.startsWith(term))) return 34 * weight;
    return 0;
  };

  for (const node of ALL_NODES) {
    const best = Math.max(
      score(node.name, 1.15),
      score(node.displayName, 1),
      score(node.subtitle || '', 0.9),
      score(node.id, 0.8),
    );
    if (best > 0) {
      results.push({
        kind: node.type === 'moon' ? 'moon' : node.type === 'star' ? 'star' : 'planet',
        id: node.id,
        title: node.name,
        subtitle: node.subtitle,
        accent: node.accent,
        score: best + 6,
      });
    }
  }

  for (const mission of MISSIONS) {
    const best = Math.max(
      score(mission.name, 1.1),
      score(mission.destination, 0.9),
      score(mission.agency, 0.7),
      score(mission.summary, 0.5),
    );
    if (best > 0) {
      results.push({
        kind: 'mission',
        id: mission.id,
        title: mission.name,
        subtitle: `${mission.agency} · ${mission.launchLabel || mission.launch}`,
        accent: mission.accent,
        score: best,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Short label used by chips and breadcrumbs. */
export function nodeKindLabel(node) {
  if (!node) return '';
  if (node.type === 'star') return 'Star';
  if (node.type === 'moon') return `Moon of ${getParent(node.id)?.name ?? '—'}`;
  return `Planet ${node.order} of 8`;
}
