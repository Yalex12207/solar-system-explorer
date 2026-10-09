/**
 * MissionsPanel — the mission archive and a single-mission record.
 *
 * The overview doubles as a timeline: missions are sorted by launch year and the
 * year axis is drawn from that ordered list, not from a hard-coded scale.
 */

import { useMemo, useState } from 'react';
import { MISSIONS, MISSION_BY_ID, getNode } from '../data/catalog.js';

const FILTERS = ['All', 'Active', 'Complete', 'Planned', 'En route'];

function statusClass(status = '') {
  if (/active/i.test(status)) return 'live';
  if (/complete/i.test(status)) return 'complete';
  return 'planned';
}

/**
 * Missions that can launch the Voyager Experience. Voyager 1 is the canonical departure;
 * Voyager 2 launched first and took the grand tour, so it is offered too.
 */
const VOYAGE_MISSIONS = new Set(['voyager-1', 'voyager-2']);

/**
 * The year a mission occupies on the timeline.
 *
 * A mission's *launch* is not always the year it mattered: New Horizons launched in 2006
 * and reached Pluto in 2015, and sorting on launch buries the flyby among three other
 * 2006 launches. `milestone` lets the data layer name the year the timeline should show,
 * while the detail card still reports the true launch date.
 */
function timelineYear(mission) {
  return mission.milestone ?? mission.launch;
}

export default function MissionsPanel({ activeMissionId, onOpenMission, onCloseMission, onClose, onFocusBody, onStartVoyage }) {
  const [filter, setFilter] = useState('All');

  const missions = useMemo(
    () => MISSIONS.filter((mission) => (filter === 'All' ? true : mission.status === filter)),
    [filter],
  );

  const timeline = useMemo(() => [...MISSIONS].sort((a, b) => timelineYear(a) - timelineYear(b)), []);
  const active = activeMissionId ? MISSION_BY_ID[activeMissionId] : null;

  if (active) {
    return (
      <section className="panel panel-mission open mission-detail" style={{ '--accent': active.accent }} aria-label={active.name}>
        <div className="panel-hero-accent" aria-hidden="true" />
        <div className="panel-header">
          <button type="button" className="panel-back" onClick={onCloseMission}>
            ← All missions
          </button>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close missions">
            ✕
          </button>
        </div>

        <div className="panel-scroll">
          <p className="panel-eyebrow mono caps">{active.agency}</p>
          <h2 className="panel-title large">{active.name}</h2>
          <p className="panel-subtitle">{active.summary}</p>
          <p className="panel-body">{active.description}</p>

          <div className="stat-grid" style={{ '--stat-columns': 2 }}>
            <div className="stat">
              <div className="stat-value mono">{active.launch}</div>
              <div className="stat-label caps">Launch</div>
            </div>
            <div className="stat">
              <div className="stat-value mono">{active.destination}</div>
              <div className="stat-label caps">Destination</div>
            </div>
            <div className="stat">
              <div className="stat-value mono">{active.status}</div>
              <div className="stat-label caps">Status</div>
            </div>
            <div className="stat">
              <div className="stat-value mono">{active.crew}</div>
              <div className="stat-label caps">Crew</div>
            </div>
          </div>

          <div className="mission-hero">
            <p className="mission-hero-label caps mono">Launch date</p>
            <p className="mission-hero-value">{active.launchLabel || active.launch}</p>
            {active.milestone && active.milestone !== active.launch ? (
              <p className="mission-milestone mono">
                {active.milestone} · {active.milestoneLabel || 'Key milestone'}
              </p>
            ) : null}
          </div>

          {/* Achievement: the one thing this mission is remembered for. */}
          <div className="mission-achievement">
            <p className="dropdown-label caps mono">Achievement</p>
            <p className="mission-achievement-value">{active.achievement || active.highlights[0]}</p>
          </div>

          {/* The Voyager Experience is offered where the mission is read about. */}
          {VOYAGE_MISSIONS.has(active.id) ? (
            <button type="button" className="voyage-launch" onClick={() => onStartVoyage?.(active.id)}>
              <span className="voyage-launch-mark" aria-hidden="true">
                ✦
              </span>
              <span className="voyage-launch-text">
                <span className="voyage-launch-title">THE EDGE OF THE SOLAR SYSTEM</span>
                <span className="voyage-launch-copy">Leave the system with {active.name}</span>
              </span>
            </button>
          ) : null}

          <div className="mission-highlights">
            <p className="dropdown-label caps mono">Highlights</p>
            <ul className="fact-list">
              {active.highlights.map((highlight, index) => (
                <li className="fact-item" key={highlight}>
                  <span className="fact-index mono">{String(index + 1).padStart(2, '0')}</span>
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel-actions">
            {active.destinationIds.map((id) => {
              const node = getNode(id);
              if (!node) return null;
              return (
                <button key={id} type="button" className="ghost-button" onClick={() => onFocusBody(id)}>
                  FLY TO {node.name.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-missions open missions" aria-label="Missions">
      <div className="panel-header">
        <p className="panel-eyebrow mono caps">Archive</p>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close missions">
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        <h2 className="panel-title">Missions</h2>
        <p className="panel-subtitle">
          {MISSIONS.length} programmes that left Earth — flybys, orbiters, landers and the two spacecraft now leaving the
          heliosphere.
        </p>

        <div className="chip-row filters">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              className={`chip ${filter === item ? 'active' : ''}`}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="mission-grid">
          {missions.map((mission) => (
            <button
              key={mission.id}
              type="button"
              className="mission-card"
              style={{ '--accent': mission.accent }}
              onClick={() => onOpenMission(mission.id)}
            >
              <span className="mission-card-top">
                <span className="mission-card-name">{mission.name}</span>
                <span className={`badge ${statusClass(mission.status)}`}>{mission.status}</span>
              </span>
              <span className="mission-card-summary">{mission.summary}</span>
              <span className="mission-meta mono">
                {mission.launch} · {mission.destination}
              </span>
            </button>
          ))}
        </div>

        <ol className="timeline">
          {timeline.map((mission) => (
            <li className="timeline-item" key={`tl-${mission.id}`}>
              <span className="timeline-year mono">{timelineYear(mission)}</span>
              <button type="button" className="timeline-body" onClick={() => onOpenMission(mission.id)}>
                <span className="timeline-name">{mission.name}</span>
                <span className="timeline-dest">
                  {mission.milestone && mission.milestone !== mission.launch
                    ? `${mission.milestoneLabel || 'Milestone'} · launched ${mission.launch}`
                    : mission.destination}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
