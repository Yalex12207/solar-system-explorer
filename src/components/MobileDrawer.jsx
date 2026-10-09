/**
 * MobileDrawer — bottom sheet that replaces the side panel on phones and tablets.
 *
 * Carries the compact selection readout, the chaptered detail view and the
 * mission quick-actions, so the mobile experience is the same product rather than
 * a reduced one.
 */

import { useMemo, useState } from 'react';
import { getKeyStats, missionsForBody, nodeKindLabel } from '../data/catalog.js';
import { Divider, StatGrid } from './DataDisplay.jsx';
import { DetailContent } from './Panels.jsx';

export default function MobileDrawer({ node, view, chapter, onChapter, onClose, onExplore, onOpenMission }) {
  const [collapsed, setCollapsed] = useState(false);
  const stats = useMemo(() => (node ? getKeyStats(node, 6) : []), [node]);
  if (!node) return null;

  const isDetail = view === 'detail';
  const missions = missionsForBody(node.id);

  return (
    <>
      <aside
        className={`drawer panel open mobile-only ${collapsed ? 'collapsed' : ''}`}
        style={{ '--accent': node.accent }}
        aria-label={`${node.name} details`}
      >
        <button
          type="button"
          className="drawer-handle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand details' : 'Collapse details'}
        />
        <div className="drawer-header">
          <div>
            <p className="panel-eyebrow mono caps">{nodeKindLabel(node)}</p>
            <h2 className="drawer-title">{node.displayName || node.name}</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close details">
            ✕
          </button>
        </div>

        <div className={`drawer-content ${collapsed ? 'is-collapsed' : ''}`}>
          {isDetail ? (
            <DetailContent
              node={node}
              chapter={chapter}
              onChapter={onChapter}
              onSelectBody={onExplore}
              onOpenMission={onOpenMission}
            />
          ) : (
            <>
              <p className="panel-subtitle">{node.subtitle}</p>
              {node.tagline ? <p className="panel-tagline">{node.tagline}</p> : null}
              <p className="panel-body">{node.description}</p>
              <Divider label="Key data" />
              <StatGrid stats={stats} columns={2} />
              {missions.length ? (
                <>
                  <Divider label="Missions" />
                  <div className="chip-row">
                    {missions.slice(0, 4).map((mission) => (
                      <button key={mission.id} type="button" className="chip" onClick={() => onOpenMission(mission.id)}>
                        {mission.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="panel-actions">
                <button type="button" className="primary-button" onClick={() => onExplore(node.id)}>
                  EXPLORE {node.name.toUpperCase()}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
