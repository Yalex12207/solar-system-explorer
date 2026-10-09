/**
 * Readout panels.
 *
 * InfoPanel      — the compact panel shown on selection.
 * DetailContent  — chaptered detail body, shared by desktop panel and mobile drawer.
 * DetailPanel    — desktop wrapper around DetailContent.
 */

import { getChapters, getKeyStats, getMoonsOf, missionsForBody, nodeKindLabel, PLANETS } from '../data/catalog.js';
import { Divider, MetaList, StatBar, StatGrid } from './DataDisplay.jsx';

function statusClass(status = '') {
  if (/active/i.test(status)) return 'live';
  if (/complete/i.test(status)) return 'complete';
  return 'planned';
}

function ChapterOverview({ node }) {
  return (
    <>
      <p className="chapter-copy">{node.longDescription || node.description}</p>
      <Divider label="Vital statistics" />
      <StatGrid stats={getKeyStats(node)} columns={2} />
    </>
  );
}

function ChapterAtmosphere({ node }) {
  const atmosphere = node.atmosphere;
  if (!atmosphere) return <p className="chapter-copy">No atmosphere data recorded for this body.</p>;
  return (
    <>
      <p className="chapter-copy">{atmosphere.note}</p>
      <MetaList
        items={[
          { key: 'Composition', value: atmosphere.composition },
          { key: 'Surface pressure', value: atmosphere.pressure },
          { key: 'Temperature', value: node.temperature },
        ]}
      />
      <Divider label="Approximate composition" />
      <div className="composition">
        {atmosphere.composition.split('·').map((part) => {
          const match = part.match(/(\d+(?:\.\d+)?)\s*%/);
          const percent = match ? parseFloat(match[1]) : 0;
          const label = part.replace(/(\d+(?:\.\d+)?)\s*%/, '').trim();
          return (
            <StatBar
              key={part}
              label={label || 'Trace'}
              value={percent}
              max={100}
              valueLabel={match ? `${match[1]}%` : 'trace'}
              accent={node.accent}
            />
          );
        })}
      </div>
    </>
  );
}

function ChapterMoons({ node, onSelectBody }) {
  const moons = getMoonsOf(node.id);
  if (!moons.length) return <p className="chapter-copy">No moons are modelled for this body yet.</p>;
  return (
    <>
      <p className="chapter-copy">
        {node.name} is confirmed to have {node.moons} {node.moons === 1 ? 'moon' : 'moons'}. The {moons.length} most
        significant are modelled in the 3D scene — select one to fly to it.
      </p>
      <div className="body-list">
        {moons.map((moon) => (
          <button key={moon.id} type="button" className="body-item" onClick={() => onSelectBody(moon.id)}>
            <span className="body-item-dot" style={{ background: moon.accent }} />
            <span className="body-item-name">{moon.name}</span>
            <span className="body-item-meta mono">
              {moon.diameter.toLocaleString('en-US')} km · {moon.orbitalPeriod}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function ChapterMissions({ node, onOpenMission }) {
  const missions = missionsForBody(node.id);
  if (!missions.length) {
    return <p className="chapter-copy">No missions in this atlas are recorded as visiting {node.name}.</p>;
  }
  return (
    <>
      <p className="chapter-copy">
        {missions.length} {missions.length === 1 ? 'programme has' : 'programmes have'} targeted {node.name}. Open one to
        read its record.
      </p>
      <div className="mission-mini-list">
        {missions.map((mission) => (
          <button key={mission.id} type="button" className="mission-mini" onClick={() => onOpenMission(mission.id)}>
            <span className="mission-mini-mark" style={{ background: mission.accent }} />
            <span className="mission-mini-text">
              <span className="mission-mini-name">{mission.name}</span>
              <span className="mission-mini-meta mono">
                {mission.agency} · {mission.launch}
              </span>
            </span>
            <span className={`badge ${statusClass(mission.status)}`}>{mission.status}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ChapterFacts({ node }) {
  const facts = node.facts || [];
  return (
    <>
      <p className="chapter-copy">Things worth remembering about {node.name}.</p>
      <ul className="fact-list">
        {facts.map((fact, index) => (
          <li className="fact-item" key={fact}>
            <span className="fact-index mono">{String(index + 1).padStart(2, '0')}</span>
            <span>{fact}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function InfoPanel({ node, onClose, onExplore, onCompare }) {
  if (!node) return null;
  // Eight slots, chosen by the data layer's own priority order.
  const stats = getKeyStats(node, 8);
  const moons = getMoonsOf(node.id);
  const missions = missionsForBody(node.id);

  return (
    <aside
      className="panel panel-right open desktop-only"
      style={{ '--accent': node.accent }}
      aria-label={`${node.name} information`}
    >
      <div className="panel-hero-accent" aria-hidden="true" />
      <div className="panel-header">
        <p className="panel-eyebrow mono caps">{nodeKindLabel(node)}</p>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        <h2 className="panel-title">{node.displayName || node.name}</h2>
        <p className="panel-subtitle">{node.subtitle}</p>
        {node.tagline ? <p className="panel-tagline">{node.tagline}</p> : null}
        <p className="panel-body">{node.description}</p>

        <Divider label="Key data" />
        <StatGrid stats={stats} columns={2} />

        {moons.length ? (
          <>
            <Divider label={`${moons.length} modelled ${moons.length === 1 ? 'moon' : 'moons'}`} />
            <div className="body-list">
              {moons.map((moon) => (
                <button key={moon.id} type="button" className="body-item" onClick={() => onExplore(moon.id)}>
                  <span className="body-item-dot" style={{ background: moon.accent }} />
                  <span className="body-item-name">{moon.name}</span>
                  <span className="body-item-meta mono">{moon.diameter.toLocaleString('en-US')} km</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {missions.length ? (
          <>
            <Divider label="Missions" />
            <div className="chip-row">
              {missions.slice(0, 6).map((mission) => (
                <span className="chip static" key={mission.id}>
                  {mission.name}
                </span>
              ))}
            </div>
          </>
        ) : null}

        <Divider />
        <div className="panel-actions">
          <button type="button" className="primary-button" onClick={() => onExplore(node.id)}>
            EXPLORE {node.name.toUpperCase()}
          </button>
          {node.type === 'planet' ? (
            <button type="button" className="ghost-button" onClick={() => onCompare(node.id)}>
              COMPARE
            </button>
          ) : null}
        </div>
        <p className="panel-foot mono caps">Double-click any body to open detail mode</p>
      </div>
    </aside>
  );
}

/** Chapter body shared by the desktop detail panel and the mobile drawer. */
export function DetailContent({ node, chapter, onChapter, onSelectBody, onOpenMission }) {
  const chapters = getChapters(node.id);
  const active = chapters.find((item) => item.key === chapter) || chapters[0];
  const parent = node.type === 'moon' ? PLANETS.find((planet) => planet.id === node.parent) : null;

  return (
    <>
      <h2 className="panel-title large">{node.displayName || node.name}</h2>
      <p className="panel-subtitle">{node.type === 'moon' ? `Moon of ${parent?.name ?? '—'}` : node.subtitle}</p>
      {node.tagline ? <p className="panel-tagline">{node.tagline}</p> : null}

      <nav className="chapters" aria-label="Chapters">
        <ul className="chapter-list">
          {chapters.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={`chapter-item ${item.key === active.key ? 'active' : ''}`}
                onClick={() => onChapter(item.key)}
                aria-current={item.key === active.key}
              >
                <span className="chapter-index mono">{item.index}</span>
                <span className="chapter-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="chapter-content" key={active.key}>
        <h3 className="chapter-heading caps">
          <span className="mono">{active.index}</span> {active.label}
        </h3>
        {active.key === 'overview' ? <ChapterOverview node={node} /> : null}
        {active.key === 'atmosphere' ? <ChapterAtmosphere node={node} /> : null}
        {active.key === 'moons' ? <ChapterMoons node={node} onSelectBody={onSelectBody} /> : null}
        {active.key === 'missions' ? <ChapterMissions node={node} onOpenMission={onOpenMission} /> : null}
        {active.key === 'facts' ? <ChapterFacts node={node} /> : null}
      </div>
    </>
  );
}

export default function DetailPanel({ node, chapter, onChapter, onClose, onSelectBody, onOpenMission }) {
  if (!node) return null;
  return (
    <aside
      className="panel panel-right panel-detail open"
      style={{ '--accent': node.accent }}
      aria-label={`${node.name} detail`}
    >
      <div className="panel-hero-accent" aria-hidden="true" />
      <div className="panel-header">
        <p className="panel-eyebrow mono caps">{nodeKindLabel(node)}</p>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Exit detail mode">
          ✕
        </button>
      </div>
      <div className="panel-scroll">
        <DetailContent
          node={node}
          chapter={chapter}
          onChapter={onChapter}
          onSelectBody={onSelectBody}
          onOpenMission={onOpenMission}
        />
        {/*
          Focus mode needs an explicit way out that names the destination. The ✕ above
          is a close affordance; this is the "you are inside a body, the system is one
          level up" affordance, and Esc does the same thing.
        */}
        <button type="button" className="focus-exit" onClick={onClose}>
          <span className="focus-exit-arrow" aria-hidden="true">
            ←
          </span>
          <span className="focus-exit-label">BACK TO SOLAR SYSTEM</span>
        </button>
      </div>
    </aside>
  );
}
