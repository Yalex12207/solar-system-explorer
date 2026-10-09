/**
 * PlanetsBrowser — the always-available index of bodies on the left.
 *
 * Reading order matches the orbital order, so the hierarchy of the system is
 * legible without interacting with the 3D view at all.
 */

import { PLANETS, SUN, MOONS, missionsForBody, getNode } from '../data/catalog.js';
import { ActionType, useStore } from '../store/store.jsx';

const GROUPS = [
  { key: 'star', label: 'Star' },
  { key: 'rocky', label: 'Terrestrial', ids: ['mercury', 'venus', 'earth', 'mars'] },
  { key: 'giants', label: 'Gas Giants', ids: ['jupiter', 'saturn'] },
  { key: 'ice', label: 'Ice Giants', ids: ['uranus', 'neptune'] },
];

export default function PlanetsBrowser({ onSelect, onExplore, onOpenMission, onCompare }) {
  const { state, dispatch } = useStore();
  if (!state.planetsOpen) return null;

  /**
   * Comparing directly from the index.
   *
   * The action pairs the chosen body with a sensible opponent so one click produces a
   * meaningful comparison rather than an empty slot. Earth partners with Mars (the
   * obvious pairing) and everything else partners with Earth, which is the unit the
   * brief's metrics are all expressed in.
   */
  const compareWith = (id) => (id === 'earth' ? 'mars' : 'earth');

  const renderPlanet = (planet) => {
    const moons = MOONS.filter((moon) => moon.parent === planet.id);
    const missions = missionsForBody(planet.id);
    return (
      <li key={planet.id}>
        <div className="browser-row" style={{ '--accent': planet.accent }}>
          <button type="button" className="body-item browser-main" onClick={() => onSelect(planet.id)}>
            <span className="body-item-dot" style={{ background: planet.accent }} />
            <span className="body-item-text">
              <span className="body-item-name">{planet.name}</span>
              <span className="body-item-meta mono">
                {planet.diameter.toLocaleString('en-US')} km · {planet.distanceFromSun}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="browser-compare mono"
            onClick={() => onCompare?.(planet.id, compareWith(planet.id))}
            title={`Compare ${planet.name} with ${getNode(compareWith(planet.id))?.name ?? ''}`}
          >
            COMPARE
          </button>
          <button type="button" className="browser-explore" onClick={() => onExplore(planet.id)} title={`Explore ${planet.name}`}>
            →
          </button>
        </div>
        {moons.length ? (
          <div className="browser-moons">
            {moons.map((moon) => (
              <button key={moon.id} type="button" className="chip" onClick={() => onSelect(moon.id)}>
                {moon.name}
              </button>
            ))}
          </div>
        ) : null}
        {missions.length ? (
          <div className="browser-missions">
            {missions.slice(0, 3).map((mission) => (
              <button key={mission.id} type="button" className="browser-mission mono" onClick={() => onOpenMission(mission.id)}>
                {mission.name}
              </button>
            ))}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <aside className="panel panel-left browser open desktop-only" aria-label="Body index">
      <div className="panel-header">
        <p className="panel-eyebrow mono caps">Index</p>
        <button
          type="button"
          className="panel-close"
          onClick={() => dispatch({ type: ActionType.TOGGLE_PLANETS })}
          aria-label="Close index"
        >
          ✕
        </button>
      </div>
      <div className="panel-scroll">
        <h2 className="panel-title">The System</h2>
        <p className="panel-subtitle">One star, eight planets, {MOONS.length} modelled moons.</p>

        <div className="browser-group">
          <p className="dropdown-label caps mono">{GROUPS[0].label}</p>
          <ul className="body-list">
            <li>
              <div className="browser-row" style={{ '--accent': SUN.accent }}>
                <button type="button" className="body-item browser-main" onClick={() => onSelect(SUN.id)}>
                  <span className="body-item-dot" style={{ background: SUN.accent }} />
                  <span className="body-item-text">
                    <span className="body-item-name">{SUN.name}</span>
                    <span className="body-item-meta mono">
                      {SUN.diameter.toLocaleString('en-US')} km · centre of mass
                    </span>
                  </span>
                </button>
                <button type="button" className="browser-explore" onClick={() => onExplore(SUN.id)} title="Explore the Sun">
                  →
                </button>
              </div>
            </li>
          </ul>
        </div>

        {GROUPS.slice(1).map((group) => (
          <div className="browser-group" key={group.key}>
            <p className="dropdown-label caps mono">{group.label}</p>
            <ul className="body-list">{group.ids.map((id) => renderPlanet(getNode(id)))}</ul>
          </div>
        ))}

        <p className="panel-foot mono caps">
          {PLANETS.length} planets · {MOONS.length} moons · {state.showOrbits ? 'orbits shown' : 'orbits hidden'}
        </p>
      </div>
    </aside>
  );
}
