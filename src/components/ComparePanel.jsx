/**
 * ComparePanel — side-by-side planetary comparison.
 *
 * Every metric is normalised against the larger of the two values, so the bars
 * are visually proportional even when the underlying numbers span six orders of
 * magnitude (Earth's mass vs Jupiter's, for example).
 */

import { useMemo, useState } from 'react';
import { COMPARE_METRICS, PLANETS, getNode } from '../data/catalog.js';
import { Divider, formatNumber } from './DataDisplay.jsx';

function Picker({ slot, value, onChange, exclude }) {
  const [open, setOpen] = useState(false);
  const node = getNode(value);
  return (
    <div className="compare-picker" style={{ '--accent': node?.accent || '#7FB0FF' }}>
      <p className="compare-slot caps mono">Object {String(slot).padStart(2, '0')}</p>
      <button type="button" className="compare-picker-button" onClick={() => setOpen((state) => !state)}>
        <span className="compare-picker-dot" style={{ background: node?.accent }} />
        <span className="compare-picker-name">{node?.name || 'Select'}</span>
        <span className="compare-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="dropdown glass compare-dropdown">
          {PLANETS.filter((planet) => planet.id !== exclude).map((planet) => (
            <button
              key={planet.id}
              type="button"
              className={`dropdown-item ${planet.id === value ? 'active' : ''}`}
              onClick={() => {
                onChange(planet.id);
                setOpen(false);
              }}
            >
              <span className="compare-picker-dot" style={{ background: planet.accent }} />
              <span>{planet.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ComparePanel({ slots, onSetSlots, onClose, onExplore }) {
  const left = getNode(slots[0]);
  const right = getNode(slots[1]);

  const rows = useMemo(() => {
    if (!left || !right) return [];
    return COMPARE_METRICS.map((metric) => {
      const a = metric.get(left);
      const b = metric.get(right);
      const max = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0)) || 1;
      // For temperature, the "winner" is the hotter body; for the rest, larger.
      const winner = metric.higherIsLarger ? (a >= b ? 'left' : 'right') : a >= b ? 'left' : 'right';
      return {
        ...metric,
        a,
        b,
        max,
        winner,
      };
    });
  }, [left, right]);

  if (!left || !right) {
    return (
      <section className="panel panel-compare open" aria-label="Compare planets">
        <div className="panel-header">
          <p className="panel-eyebrow mono caps">Compare</p>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close compare">
            ✕
          </button>
        </div>
        <p className="panel-body">Select two objects to compare.</p>
      </section>
    );
  }

  return (
    <section className="panel panel-compare open compare" aria-label="Compare planets">
      <div className="panel-header">
        <p className="panel-eyebrow mono caps">Compare</p>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close compare">
          ✕
        </button>
      </div>

      <div className="panel-scroll">
        <h2 className="panel-title">
          {left.name} <span className="compare-vs mono">VS</span> {right.name}
        </h2>
        <p className="panel-subtitle">Normalised readouts — each bar is scaled to the larger of the two values.</p>

        <div className="compare-pickers">
          <Picker slot={1} value={slots[0]} exclude={slots[1]} onChange={(id) => onSetSlots([id, slots[1]])} />
          <Picker slot={2} value={slots[1]} exclude={slots[0]} onChange={(id) => onSetSlots([slots[0], id])} />
        </div>

        <div className="compare-bars">
          {rows.map((row) => (
            <div className="compare-metric" key={row.key}>
              <div className="compare-metric-label caps">{row.label}</div>
              <div className="compare-metric-values">
                <span className={`compare-value mono ${row.winner === 'left' ? 'winner' : ''}`} style={{ '--accent': left.accent }}>
                  {formatNumber(row.a, row.key === 'massEarths' ? 2 : row.key === 'yearDays' || row.key === 'dayHours' ? 1 : 0)}
                  <span className="compare-unit">{row.unit}</span>
                </span>
                <span className={`compare-value mono ${row.winner === 'right' ? 'winner' : ''}`} style={{ '--accent': right.accent }}>
                  {formatNumber(row.b, row.key === 'massEarths' ? 2 : row.key === 'yearDays' || row.key === 'dayHours' ? 1 : 0)}
                  <span className="compare-unit">{row.unit}</span>
                </span>
              </div>
              <div className="compare-bar left">
                <span
                  className="compare-bar-fill"
                  style={{ width: `${Math.abs(row.a / row.max) * 100}%`, background: left.accent }}
                />
              </div>
              <div className="compare-bar right">
                <span
                  className="compare-bar-fill"
                  style={{ width: `${Math.abs(row.b / row.max) * 100}%`, background: right.accent }}
                />
              </div>
            </div>
          ))}
        </div>

        <Divider label="Open detail" />
        <div className="panel-actions">
          <button type="button" className="ghost-button" onClick={() => onExplore(left.id)}>
            {left.name.toUpperCase()}
          </button>
          <button type="button" className="ghost-button" onClick={() => onExplore(right.id)}>
            {right.name.toUpperCase()}
          </button>
        </div>
      </div>
    </section>
  );
}
