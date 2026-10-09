/**
 * AboutPanel — methodology, credits and the honest note about compression.
 */

import { ABOUT, CONTROLS_HELP } from '../data/narrative.js';
import { SYSTEM_STATS } from '../data/planets.js';
import { Divider, MetaList } from './DataDisplay.jsx';

export default function AboutPanel({ onClose }) {
  return (
    <section className="panel panel-about open about" aria-label="About">
      <div className="panel-header">
        <p className="panel-eyebrow mono caps">About</p>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close about">
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        <h2 className="panel-title">{ABOUT.title}</h2>

        <div className="stat-grid" style={{ '--stat-columns': 4 }}>
          <div className="stat">
            <div className="stat-value mono">{SYSTEM_STATS.planets}</div>
            <div className="stat-label caps">Planets</div>
          </div>
          <div className="stat">
            <div className="stat-value mono">{SYSTEM_STATS.stars}</div>
            <div className="stat-label caps">Star</div>
          </div>
          <div className="stat">
            <div className="stat-value mono">{SYSTEM_STATS.confirmedMoonsLabel}</div>
            <div className="stat-label caps">Moons</div>
          </div>
          <div className="stat">
            <div className="stat-value mono">4.6B</div>
            <div className="stat-label caps">Years</div>
          </div>
        </div>

        {ABOUT.paragraphs.map((paragraph) => (
          <p className="panel-body" key={paragraph.slice(0, 24)}>
            {paragraph}
          </p>
        ))}

        <Divider label="Controls" />
        <ul className="help-list">
          {CONTROLS_HELP.map((item) => (
            <li className="help-item" key={item.keys}>
              <kbd className="help-keys mono">{item.keys}</kbd>
              <span className="help-action">{item.action}</span>
            </li>
          ))}
        </ul>

        <Divider label="Credits" />
        <MetaList items={ABOUT.credits.map((credit) => ({ key: credit.label, value: credit.value }))} />

        <Divider />
        <p className="panel-foot">{ABOUT.disclaimer}</p>
      </div>
    </section>
  );
}
