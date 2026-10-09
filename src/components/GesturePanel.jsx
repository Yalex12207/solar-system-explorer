/**
 * GesturePanel — the hand-control readout and camera preview.
 *
 * Deliberately quiet: a status line, the current pose, and an optional mirror of
 * the camera. No skeleton HUD, no numbers storm — it should read like an instrument
 * panel on a museum exhibit, not a computer-vision demo.
 */

import { useEffect, useRef } from 'react';
import { GESTURE, GESTURE_LABEL } from '../gesture/config.js';
import { HAND_CONNECTIONS } from '../gesture/handTracker.js';

const POSE_ORDER = [GESTURE.OPEN_PALM, GESTURE.PINCH, GESTURE.POINT, GESTURE.FIST];

/** Preview window: mirrored video with a light landmark overlay. */
function CameraPreview({ getFrame, visible, onClose }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (!visible) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const frame = getFrame?.();
      if (!frame) return;

      ctx.strokeStyle = 'rgba(127, 176, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const p1 = frame[a];
        const p2 = frame[b];
        if (!p1 || !p2) continue;
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      for (const point of frame) {
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [visible, getFrame]);

  if (!visible) return null;

  return (
    <div className="gesture-preview">
      <video className="gesture-preview-video" ref={(element) => {
        // Reuse the tracker's hidden stream: adopting the element keeps a single
        // camera session rather than opening a second one.
        if (!element) return;
        const source = document.querySelector('video[aria-hidden="true"]');
        if (source && element.srcObject !== source.srcObject) {
          element.srcObject = source.srcObject;
          element.play?.().catch(() => {});
        }
      }} muted playsInline />
      <canvas className="gesture-preview-canvas" ref={canvasRef} width={200} height={150} />
      <button type="button" className="gesture-preview-close" onClick={onClose} aria-label="Hide camera preview">
        ✕
      </button>
      <p className="gesture-preview-label mono caps">Camera · mirrored</p>
    </div>
  );
}

export default function GesturePanel({
  status,
  visible,
  cameraVisible,
  onToggleCamera,
  onExit,
  getFrame,
}) {
  if (!visible) return null;

  const error = status.state === 'error';
  const starting = status.state === 'starting';
  const active = status.state === 'active';

  return (
    <>
      <div className="gesture-panel" role="status" aria-live="polite">
        <div className="gesture-panel-head">
          <span className={`gesture-dot ${active ? 'live' : error ? 'error' : ''}`} aria-hidden="true" />
          <span className="gesture-title mono caps">Hand control</span>
          <span className="gesture-state mono caps">
            {active ? 'Active' : error ? 'Unavailable' : starting ? 'Starting' : 'Ready'}
          </span>
          <button type="button" className="gesture-close" onClick={onExit} aria-label="Exit hand control">
            ✕
          </button>
        </div>

        {error ? (
          <div className="gesture-body">
            <p className="gesture-error-title">HAND CONTROL UNAVAILABLE</p>
            <p className="gesture-error-copy">{status.message}</p>
            <p className="gesture-error-copy dim">Use mouse or touch instead.</p>
          </div>
        ) : (
          <>
            <div className="gesture-body">
              <p className="gesture-gesture">
                {status.hasHand ? GESTURE_LABEL[status.gesture] || 'Reading' : 'Show your hand'}
              </p>
              <p className="gesture-meta mono">
                {status.hasHand
                  ? `${Math.round(status.confidence * 100)}% · ${status.detectionFps.toFixed(0)} fps`
                  : 'Palm up to the camera'}
              </p>
            </div>

            <ul className="gesture-poses">
              {POSE_ORDER.map((pose) => (
                <li
                  key={pose}
                  className={`gesture-pose ${status.gesture === pose ? 'on' : ''} ${!status.hasHand ? 'dim' : ''}`}
                >
                  {GESTURE_LABEL[pose]}
                </li>
              ))}
            </ul>

            {status.aimedName ? (
              <p className="gesture-aim mono caps">Locked · {status.aimedName}</p>
            ) : null}
            {status.paused ? <p className="gesture-aim mono caps paused">Time paused</p> : null}
          </>
        )}

        <div className="gesture-actions">
          <button
            type="button"
            className={`dock-button ${cameraVisible ? 'active' : ''}`}
            onClick={onToggleCamera}
            aria-pressed={cameraVisible}
          >
            {cameraVisible ? 'HIDE CAMERA' : 'SHOW CAMERA'}
          </button>
        </div>
      </div>

      <CameraPreview getFrame={getFrame} visible={cameraVisible && active} onClose={onToggleCamera} />
    </>
  );
}
