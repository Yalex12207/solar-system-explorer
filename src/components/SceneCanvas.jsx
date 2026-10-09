/**
 * SceneCanvas — owns the WebGL lifecycle.
 *
 * The scene is rebuilt whenever the quality preset changes (segment counts and
 * particle budgets are baked in at construction) but the canvas element and the
 * React tree survive, so there is no flash and no orphaned WebGL context.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SolarSystemScene } from '../scenes/solarSystem.js';
import { CameraRig } from '../utils/cameraRig.js';
import { getAudio } from '../utils/audio.js';

export default function SceneCanvas({
  quality,
  timeScale,
  showOrbits,
  showLabels,
  initialDate,
  onReady,
  onPick,
  onHover,
  onFrame,
  onSimulationTick,
  onContextLost,
  /** When false, pointer input is ignored so gestures have exclusive control. */
  pointerEnabled = true,
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rigRef = useRef(null);
  const clockRef = useRef({ last: performance.now(), accumulator: 0 });
  /** Held in a ref so the render loop is never rebuilt when the callback changes. */
  const frameCallbackRef = useRef(onFrame);
  frameCallbackRef.current = onFrame;
  const [contextWarning, setContextWarning] = useState(false);

  /** Build (or rebuild) the scene for the current quality preset. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let scene = null;
    let rig = null;
    let disposed = false;

    try {
      scene = new SolarSystemScene({
        container,
        quality,
        timeScale,
        startDate: initialDate,
      });
      rig = new CameraRig({
        camera: scene.camera,
        domElement: scene.canvas,
        getBodyPosition: (id, target) => scene.getBodyPosition(id, target),
        getBodyRadius: (id) => scene.getBodyRadius(id),
      });
      scene.cameraController = rig;
    } catch (error) {
      // Never white-screen: report the failure upward and let the UI degrade.
      scene?.dispose();
      onContextLost?.(error);
      return undefined;
    }

    sceneRef.current = scene;
    rigRef.current = rig;
    scene.setOrbitVisibility(showOrbits);
    scene.setLabelVisibility(showLabels);
    scene.resize();

    const canvas = scene.canvas;
    const handleContextLost = (event) => {
      event.preventDefault();
      setContextWarning(true);
      onContextLost?.(new Error('WebGL context lost'));
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    onReady?.(scene, rig);

    let frame = 0;
    const loop = () => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      const now = performance.now();
      const delta = now - clockRef.current.last;
      clockRef.current.last = now;
      // Per-frame hook for the gesture layer: drains smoothed hand signals into the
      // camera without ever touching React state on the hot path.
      frameCallbackRef.current?.(delta / 1000);
      scene.update();
      clockRef.current.accumulator += delta;
      // Throttle UI-facing date updates to ~6 Hz; the 3D layer keeps animating.
      if (clockRef.current.accumulator > 160) {
        clockRef.current.accumulator = 0;
        onSimulationTick?.(scene.getSimulationDate());
      }
    };
    frame = requestAnimationFrame(loop);

    const resizeObserver = new ResizeObserver(() => scene.resize());
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      rig?.dispose();
      scene?.dispose();
      sceneRef.current = null;
      rigRef.current = null;
    };
    // Intentionally rebuild only when the quality preset changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  // ——— lightweight reactive bindings ————————————————————————————
  useEffect(() => {
    sceneRef.current?.setTimeScale(timeScale);
  }, [timeScale]);

  useEffect(() => {
    sceneRef.current?.setOrbitVisibility(showOrbits);
  }, [showOrbits]);

  useEffect(() => {
    sceneRef.current?.setLabelVisibility(showLabels);
  }, [showLabels]);

  // ——— pointer interaction ——————————————————————————————————————
  const pointerState = useRef({ x: 0, y: 0, moved: false, lastTap: 0, hoverRaf: 0 });

  const toNdc = useCallback((event) => {
    const rect = sceneRef.current?.canvas.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return [0, 0];
    return [((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1];
  }, []);

  const handlePointerDown = useCallback(
    (event) => {
      if (!pointerEnabled) return;
      if (event.pointerType === 'touch' && !event.isPrimary) return;
      pointerState.current.x = event.clientX;
      pointerState.current.y = event.clientY;
      pointerState.current.moved = false;
    },
    [pointerEnabled],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (!pointerEnabled) return;
      const state = pointerState.current;
      if (Math.abs(event.clientX - state.x) > 6 || Math.abs(event.clientY - state.y) > 6) state.moved = true;
      if (event.pointerType === 'touch') return;
      // Hover picking is throttled to one raycast per frame at most.
      if (state.hoverRaf) return;
      state.hoverRaf = requestAnimationFrame(() => {
        state.hoverRaf = 0;
        const scene = sceneRef.current;
        if (!scene) return;
        if (state.moved) {
          onHover?.(null);
          return;
        }
        const hit = scene.pickWithPriority(...toNdc(event));
        onHover?.(hit ? hit.id : null);
      });
    },
    [onHover, toNdc, pointerEnabled],
  );

  const handlePointerUp = useCallback(
    (event) => {
      if (!pointerEnabled) return;
      const state = pointerState.current;
      if (event.pointerType === 'touch' && !event.isPrimary) return;
      if (state.moved) return;
      const scene = sceneRef.current;
      if (!scene) return;
      const hit = scene.pickWithPriority(...toNdc(event));
      const now = performance.now();
      const isDoubleTap = now - state.lastTap < 300;
      state.lastTap = isDoubleTap ? 0 : now;
      if (!hit) {
        onPick?.(null, { double: false });
        return;
      }
      onPick?.(hit.id, { double: isDoubleTap });
      getAudio()?.ping();
    },
    [onPick, toNdc, pointerEnabled],
  );

  const handlePointerLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  return (
    <div
      ref={containerRef}
      className={`scene-canvas ${pointerEnabled ? '' : 'hand-controlled'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={(event) => {
        if (!pointerEnabled) return;
        const scene = sceneRef.current;
        if (!scene) return;
        const hit = scene.pickWithPriority(...toNdc(event));
        if (hit) onPick?.(hit.id, { double: true });
      }}
    >
      {/* The canvas is created and owned by SolarSystemScene. */}
      {contextWarning ? (
        <div className="context-warning" role="status">
          Graphics context was lost. Reload the page to restore the 3D view.
        </div>
      ) : null}
    </div>
  );
}
