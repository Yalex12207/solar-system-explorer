/**
 * The hand reticle drawn in screen space.
 *
 * Screen space rather than a 3D object is the right call here: the cursor is a UI
 * affordance that must stay a constant size and sit above the scene, exactly like
 * the label sprites it accompanies. It is a real DOM element so it inherits the
 * design system's stroke weights and never needs its own render pass.
 */

import { GESTURE_CONFIG } from '../gesture/config.js';

export default function HandCursor({ visible, x, y, aimed, label, gestureActive }) {
  if (!visible) return null;

  const style = {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    '--cursor-size': `${aimed ? GESTURE_CONFIG.cursor.aimRadius : GESTURE_CONFIG.cursor.radius}px`,
  };

  return (
    <div
      className={`hand-cursor ${aimed ? 'aimed' : ''} ${gestureActive ? 'active' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <span className="hand-cursor-ring" />
      <span className="hand-cursor-dot" />
      {aimed && label ? <span className="hand-cursor-label">{label}</span> : null}
    </div>
  );
}
