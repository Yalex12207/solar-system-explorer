/**
 * BootScreen — the cold-open.
 *
 * Progress is honest but instant: the real work (texture generation) happens in
 * the first frames of the scene, and the bar simply gives the eye something to
 * follow before the hero appears.
 */

import { useEffect, useState } from 'react';
import { BRAND } from '../data/narrative.js';

/** Keep the progress readout inside its stated range no matter what the clock does. */
function clampProgress(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export default function BootScreen({ quality, sceneReady = false, onEnter }) {
  const [sequenceDone, setSequenceDone] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [progress, setProgress] = useState(6);

  // The bar is a fixed-time sequence; the scene builds in parallel behind it.
  useEffect(() => {
    let frame = 0;
    let start = null;
    const duration = 1500;
    const tick = (now) => {
      // Anchor the clock to the first frame: a tab that was backgrounded or a
      // stepped clock must never produce a negative progress value.
      if (start === null) start = now;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      // easeOutCubic so the bar decelerates into 100%
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(6 + eased * 94);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setSequenceDone(true);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Never trap the user behind a slow first frame: after a short grace period the
  // entry button appears regardless, and the scene continues building behind it.
  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  const ready = sequenceDone && (sceneReady || stalled);

  useEffect(() => {
    const onKey = (event) => {
      if (!ready) return;
      if (event.key === 'Enter' || event.key === ' ') onEnter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, onEnter]);

  useEffect(() => {
    const fallback = document.getElementById('boot-fallback');
    if (fallback) {
      fallback.style.opacity = '0';
      window.setTimeout(() => fallback.remove(), 700);
    }
  }, []);

  return (
    <div className="boot">
      <div className="boot-inner">
        <div className="boot-mark mono caps">{BRAND.short}</div>
        <div className="boot-status mono caps" aria-live="polite">
          {ready ? 'SYSTEM READY' : `${BRAND.loadingLabel}…`}
        </div>
        <div className="boot-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clampProgress(progress))}>
          <div className="boot-progress-bar" style={{ transform: `scaleX(${clampProgress(progress) / 100})` }} />
        </div>
        <button type="button" className={`boot-enter ${ready ? 'ready' : ''}`} onClick={onEnter} disabled={!ready}>
          {BRAND.enterLabel}
        </button>
        <p className="boot-note mono">
          RENDER PROFILE · {quality.toUpperCase()} · PROCEDURAL TEXTURES · NO PLUGINS
        </p>
      </div>
    </div>
  );
}
