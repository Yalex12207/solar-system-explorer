/**
 * ErrorFallback — shown when WebGL is unavailable or scene construction fails.
 *
 * The brief is explicit: never white-screen. This page stays on brand, explains
 * what happened, offers a retry and keeps the editorial content reachable.
 */

import { useState } from 'react';
import { BRAND, ABOUT } from '../data/narrative.js';
import { PLANETS, MOONS, MISSIONS } from '../data/catalog.js';

export default function ErrorFallback({ error }) {
  const [tab, setTab] = useState('planets');
  const message = typeof error === 'string' ? error : error?.message || 'Unknown graphics error';

  return (
    <div className="app phase-error">
      <div className="fallback">
        <header className="fallback-header">
          <p className="mono caps">{BRAND.short}</p>
          <h1 className="fallback-title">3D view unavailable</h1>
          <p className="fallback-copy">
            This browser or device could not start WebGL, which the interactive solar system requires. Everything below
            still works — and the atlas reads perfectly as data.
          </p>
          <p className="fallback-error mono">{message}</p>
          <div className="fallback-actions">
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>
              RETRY
            </button>
            <a className="ghost-button" href="https://get.webgl.org/" target="_blank" rel="noreferrer">
              CHECK WEBGL SUPPORT
            </a>
          </div>
        </header>

        <nav className="fallback-tabs" aria-label="Fallback content">
          {[
            { key: 'planets', label: `Planets (${PLANETS.length})` },
            { key: 'moons', label: `Moons (${MOONS.length})` },
            { key: 'missions', label: `Missions (${MISSIONS.length})` },
            { key: 'about', label: 'About' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={`chip ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="fallback-body">
          {tab === 'planets' ? (
            <div className="fallback-grid">
              {PLANETS.map((planet) => (
                <article className="fallback-card" key={planet.id} style={{ '--accent': planet.accent }}>
                  <h2>{planet.name}</h2>
                  <p className="fallback-sub">{planet.subtitle}</p>
                  <dl>
                    <div>
                      <dt className="caps">Diameter</dt>
                      <dd className="mono">{planet.diameter.toLocaleString('en-US')} km</dd>
                    </div>
                    <div>
                      <dt className="caps">Distance</dt>
                      <dd className="mono">{planet.distanceFromSun}</dd>
                    </div>
                    <div>
                      <dt className="caps">Year</dt>
                      <dd className="mono">{planet.orbitalPeriod}</dd>
                    </div>
                    <div>
                      <dt className="caps">Moons</dt>
                      <dd className="mono">{planet.moons}</dd>
                    </div>
                  </dl>
                  <p className="fallback-desc">{planet.description}</p>
                </article>
              ))}
            </div>
          ) : null}

          {tab === 'moons' ? (
            <div className="fallback-grid">
              {MOONS.map((moon) => (
                <article className="fallback-card" key={moon.id} style={{ '--accent': moon.accent }}>
                  <h2>{moon.name}</h2>
                  <p className="fallback-sub">{moon.subtitle}</p>
                  <dl>
                    <div>
                      <dt className="caps">Diameter</dt>
                      <dd className="mono">{moon.diameter.toLocaleString('en-US')} km</dd>
                    </div>
                    <div>
                      <dt className="caps">Orbit</dt>
                      <dd className="mono">{moon.orbitalPeriod}</dd>
                    </div>
                  </dl>
                  <p className="fallback-desc">{moon.description}</p>
                </article>
              ))}
            </div>
          ) : null}

          {tab === 'missions' ? (
            <div className="fallback-grid">
              {MISSIONS.map((mission) => (
                <article className="fallback-card" key={mission.id} style={{ '--accent': mission.accent }}>
                  <h2>{mission.name}</h2>
                  <p className="fallback-sub">
                    {mission.agency} · {mission.launch}
                  </p>
                  <p className="fallback-desc">{mission.description}</p>
                </article>
              ))}
            </div>
          ) : null}

          {tab === 'about' ? (
            <div className="fallback-about">
              {ABOUT.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 20)}>{paragraph}</p>
              ))}
              <p className="fallback-error">{ABOUT.disclaimer}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
