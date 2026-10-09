/**
 * CosmicScalePanel — the scale ladder, the real-data readout and Distance Mode.
 *
 * The brief's central demand is that the user understands how large the solar system is
 * without being lied to. So this panel is built around one rule: **compressed visuals are
 * always labelled**, and **measurements are always real**. The header carries a persistent
 * `VISUAL SCALE` / `REAL DATA` legend rather than a one-off disclaimer, because every
 * number below it is a real measurement while every picture above it is not to scale.
 *
 * The final rung is the payoff: `YOU ARE HERE`, on the Orion Arm, with the solar system
 * marked at its measured 26,000 light-years from the galactic centre.
 */

import { COSMIC_FINAL_ID, COSMIC_STAGES, DISTANCE_PAIRS, getCosmicStage } from '../data/cosmic.js';

export default function CosmicScalePanel({
  stage,
  distancePair,
  distance,
  onSelectStage,
  onStep,
  onSelectDistance,
  onClose,
}) {
  const index = COSMIC_STAGES.findIndex((item) => item.id === stage);
  const current = getCosmicStage(stage);
  const isFinal = stage === COSMIC_FINAL_ID;
  const pair = DISTANCE_PAIRS.find((item) => item.id === distancePair) || null;

  return (
    <aside className="panel panel-cosmic open" aria-label="Cosmic scale">
      <div className="panel-header">
        <p className="panel-eyebrow mono caps">Cosmic Scale</p>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Leave cosmic scale">
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        {/* The honesty legend: one line, always visible, never a footnote. */}
        <div className="scale-legend" role="note">
          <span className="scale-legend-item visual">
            <span className="scale-legend-swatch" aria-hidden="true" />
            VISUAL SCALE
          </span>
          <span className="scale-legend-divider" aria-hidden="true" />
          <span className="scale-legend-item real">
            <span className="scale-legend-swatch" aria-hidden="true" />
            REAL DATA
          </span>
        </div>

        <ol className="scale-ladder">
          {COSMIC_STAGES.map((item, position) => (
            <li key={item.id}>
              <button
                type="button"
                className={`scale-rung ${item.id === stage ? 'active' : ''} ${
                  position < index ? 'passed' : ''
                }`}
                onClick={() => onSelectStage(item.id)}
                aria-pressed={item.id === stage}
              >
                <span className="scale-rung-index mono">{String(position + 1).padStart(2, '0')}</span>
                <span className="scale-rung-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="scale-actions">
          <button type="button" className="ghost-button" onClick={() => onStep(-1)} disabled={index <= 0}>
            ← Closer
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onStep(1)}
            disabled={index >= COSMIC_STAGES.length - 1}
          >
            Further →
          </button>
        </div>

        {current ? (
          <div className="scale-readout" key={current.id}>
            <p className="scale-kicker">{current.kicker}</p>
            <div className="scale-measure">
              <div className="scale-measure-value mono">{current.real.value}</div>
              <div className="scale-measure-label caps">{current.real.label}</div>
            </div>
            <dl className="scale-facts">
              {current.facts.map((fact) => (
                <div className="scale-fact" key={fact.label}>
                  <dt className="scale-fact-key caps">{fact.label}</dt>
                  <dd className="scale-fact-value mono">{fact.value}</dd>
                </div>
              ))}
            </dl>
            <p className="scale-note">{current.unitNote}</p>
          </div>
        ) : null}

        {/* ——— the final frame ——— */}
        {isFinal ? (
          <div className="you-are-here">
            <p className="you-are-here-tag mono caps">You are here</p>
            <p className="you-are-here-body">Solar System</p>
            <p className="you-are-here-arm mono caps">Orion Arm</p>
            <p className="you-are-here-copy">Somewhere in the Milky Way.</p>
          </div>
        ) : null}

        {/* ——— Distance Mode ——— */}
        <div className="distance-mode">
          <div className="distance-mode-head">
            <p className="dropdown-label caps mono">Distance mode</p>
            {pair ? (
              <button type="button" className="distance-clear mono caps" onClick={() => onSelectDistance(null)}>
                Clear
              </button>
            ) : null}
          </div>
          <div className="distance-chips">
            {DISTANCE_PAIRS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip ${item.id === distancePair ? 'active' : ''}`}
                onClick={() => onSelectDistance(item.id === distancePair ? null : item.id)}
                aria-pressed={item.id === distancePair}
              >
                {item.label}
              </button>
            ))}
          </div>

          {pair ? (
            <div className="distance-readout">
              <p className="distance-route mono">{pair.label}</p>
              <p className="distance-value">{distance?.value ?? '—'}</p>
              <p className="distance-unit mono">{distance?.unit ?? ''}</p>
              {distance?.auxiliary ? <p className="distance-aux mono">{distance.auxiliary}</p> : null}
              {distance?.light ? <p className="distance-light mono">Light travel time · {distance.light}</p> : null}
            </div>
          ) : (
            <p className="distance-hint">
              Measure a real separation. The ruler prints the measurement and the unit it is expressed in —
              the picture stays compressed, the number never does.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
