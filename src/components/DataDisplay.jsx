/**
 * Shared data-display primitives used by the info panel, detail chapters and the
 * comparison view. Keeping the markup in one place is what stops the three views
 * from drifting apart.
 */

/** Format a large number with thousands separators. */
export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** Ratio of two bodies expressed as a readable multiple. */
export function ratioLabel(a, b) {
  if (!a || !b) return null;
  const ratio = a / b;
  if (ratio >= 1) return `${formatNumber(ratio, ratio >= 10 ? 0 : 1)}× larger`;
  return `${formatNumber(1 / ratio, 1 / ratio >= 10 ? 0 : 1)}× smaller`;
}

/**
 * Key statistics in the exact composition the brief calls for:
 * a large value with a small uppercase label underneath.
 */
export function StatGrid({ stats, columns = 2 }) {
  if (!stats?.length) return null;
  return (
    <div className="stat-grid" style={{ '--stat-columns': columns }}>
      {stats.map((stat) => (
        <div className="stat" key={stat.label}>
          <div className="stat-value mono">{stat.value}</div>
          <div className="stat-label caps">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal proportional bar with a value readout (used for comparisons). */
export function StatBar({ value, max, label, valueLabel, accent = '#7FB0FF' }) {
  const percent = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="stat-row">
      <div className="stat-row-head">
        <span className="stat-row-label">{label}</span>
        <span className="stat-row-value mono">{valueLabel}</span>
      </div>
      <div className="stat-bar">
        <div
          className="stat-bar-fill"
          style={{ width: `${percent}%`, background: `linear-gradient(90deg, transparent, ${accent})` }}
        />
      </div>
    </div>
  );
}

export function Divider({ label }) {
  if (!label) return <div className="divider" role="presentation" />;
  return (
    <div className="divider labelled" role="presentation">
      <span className="mono caps">{label}</span>
    </div>
  );
}

export function MetaList({ items }) {
  if (!items?.length) return null;
  return (
    <dl className="meta-list">
      {items.map((item) => (
        <div className="meta-item" key={item.key}>
          <dt className="meta-key caps">{item.key}</dt>
          <dd className="meta-value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
