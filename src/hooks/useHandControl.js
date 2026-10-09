/**
 * useHandControl — owns the gesture session lifecycle.
 *
 * Responsibilities, in order of importance:
 *  1. Keep the 60 fps render loop untouched. Inference is step-scheduled by the
 *     tracker and every React state write is throttled, so recognition can never
 *     block a frame.
 *  2. Fail soft. A denied permission, a missing camera, an unloadable model or an
 *     insecure origin all resolve to a status the UI can explain, never a throw.
 *  3. Expose per-frame signals through a ref (`signalsRef`) for the render loop,
 *     and coarse status through state for the UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GestureController } from '../gesture/gestureController.js';
import { GestureRecognizer } from '../gesture/recognizer.js';
import { HandTracker, TRACKER_ERROR, describeTrackerError } from '../gesture/handTracker.js';
import { GESTURE_CONFIG } from '../gesture/config.js';

/** How often coarse status is pushed into React state. */
const STATUS_PUSH_MS = 160;

export function useHandControl({
  active,
  onOrbit,
  onZoom,
  onPick,
  onAim,
  onSelect,
  onSwipe,
  onTogglePause,
  onUnavailable,
}) {
  const [status, setStatus] = useState({
    state: 'idle', // idle | starting | active | error
    code: null,
    message: null,
    gesture: 'none',
    confidence: 0,
    hasHand: false,
    detectionFps: 0,
    inferenceMs: 0,
    aimedName: null,
    paused: false,
  });

  const signalsRef = useRef({
    orbitX: 0,
    orbitY: 0,
    zoom: 0,
    pointer: { x: 0.5, y: 0.5 },
    gesture: 'none',
  });

  const trackerRef = useRef(null);
  const recognizerRef = useRef(null);
  const controllerRef = useRef(null);
  const handlersRef = useRef({ onOrbit, onZoom, onPick, onAim, onSelect, onSwipe, onTogglePause });
  const lastPushRef = useRef(0);
  const statusRef = useRef(status);

  handlersRef.current = { onOrbit, onZoom, onPick, onAim, onSelect, onSwipe, onTogglePause };
  statusRef.current = status;

  /** Build the recognizer + controller once. */
  const ensurePipeline = useCallback(() => {
    if (!recognizerRef.current) recognizerRef.current = new GestureRecognizer();
    if (!controllerRef.current) {
      controllerRef.current = new GestureController({
        orbit: (deltaX, deltaY) => handlersRef.current.onOrbit?.(deltaX, deltaY),
        zoom: (amount) => handlersRef.current.onZoom?.(amount),
        pick: (x, y) => handlersRef.current.onPick?.(x, y),
        aim: (id, screen) => handlersRef.current.onAim?.(id, screen),
        hover: () => {},
        select: (id) => handlersRef.current.onSelect?.(id),
        swipe: (direction) => handlersRef.current.onSwipe?.(direction),
        togglePause: () => handlersRef.current.onTogglePause?.(),
      });
    }
    return { recognizer: recognizerRef.current, controller: controllerRef.current };
  }, []);

  /** Push a fresh status snapshot into React, but only at a human-readable rate. */
  const pushStatus = useCallback((controller, timestamp) => {
    if (timestamp - lastPushRef.current <= STATUS_PUSH_MS) return;
    lastPushRef.current = timestamp;
    const snapshot = controller.status;
    setStatus((previous) => {
      if (
        previous.state === 'active' &&
        previous.gesture === snapshot.gesture &&
        previous.hasHand === snapshot.hasHand &&
        previous.aimedName === snapshot.aimedName &&
        previous.paused === snapshot.paused &&
        Math.abs(previous.confidence - snapshot.confidence) < 0.03 &&
        Math.abs(previous.detectionFps - snapshot.detectionFps) < 1.5
      ) {
        return previous;
      }
      return {
        ...previous,
        state: previous.state === 'idle' ? 'active' : previous.state,
        gesture: snapshot.gesture,
        confidence: snapshot.confidence,
        hasHand: snapshot.hasHand,
        detectionFps: snapshot.detectionFps,
        inferenceMs: snapshot.inferenceMs,
        aimedName: snapshot.aimedName,
        paused: snapshot.paused,
      };
    });
  }, []);

  /** One inference frame → recognizer → controller. */
  const handleLandmarks = useCallback(
    (landmarks, timestamp) => {
      const { recognizer, controller } = ensurePipeline();
      const frame = recognizer.update(landmarks, timestamp);
      controller.handleFrame(frame);
      pushStatus(controller, timestamp);
    },
    [ensurePipeline, pushStatus],
  );

  /**
   * A camera failure is terminal for the session, so it is reported twice: as a status
   * the panel can explain, and through `onUnavailable` so the app can actually hand
   * control back to the pointer.
   *
   * Without the second signal the store stayed on `controlMode: 'hand'` while no hand
   * could ever be detected — the canvas had pointer events disabled and the labelled
   * fallback told the user to use a mouse that the app was ignoring.
   */
  const handleError = useCallback(
    (code) => {
      setStatus((previous) => ({
        ...previous,
        state: 'error',
        code,
        message: describeTrackerError(code),
        hasHand: false,
        gesture: 'none',
      }));
      onUnavailable?.(code);
    },
    [onUnavailable],
  );

  const handleTrackerStatus = useCallback((next) => {
    setStatus((previous) => ({ ...previous, state: next.state, fps: next.fps ?? previous.fps }));
  }, []);

  /** Start / stop with the session flag. */
  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    ensurePipeline();

    /**
     * Verification mode: drive the pipeline through `injectFrame` only, with no camera
     * and no model. Without this, a real tracker running alongside injected frames
     * produces two competing streams that corrupt each other's gesture state — which is
     * exactly what the end-to-end test hit. Enabled only by an explicit query flag.
     */
    const testMode =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gestureTest');
    if (testMode) {
      setStatus((previous) => ({ ...previous, state: 'active', code: null, message: null }));
      return () => {
        cancelled = true;
        recognizerRef.current?.reset();
        controllerRef.current?.reset();
      };
    }

    setStatus((previous) => ({ ...previous, state: 'starting', code: null, message: null }));

    const tracker = new HandTracker({
      onFrame: (landmarks, timestamp) => {
        if (!cancelled) handleLandmarks(landmarks, timestamp);
      },
      onError: handleError,
      onStatus: handleTrackerStatus,
    });
    trackerRef.current = tracker;

    tracker.start().then((started) => {
      if (cancelled) return;
      if (started) {
        setStatus((previous) => ({ ...previous, state: 'active', code: null, message: null }));
      }
    });

    return () => {
      cancelled = true;
      trackerRef.current = null;
      // Reset so the next session starts from a clean gesture state.
      recognizerRef.current?.reset();
      controllerRef.current?.reset();
      signalsRef.current = {
        orbitX: 0,
        orbitY: 0,
        zoom: 0,
        pointer: { x: 0.5, y: 0.5 },
        gesture: 'none',
      };
      void tracker.stop();
      setStatus((previous) => ({
        ...previous,
        state: 'idle',
        hasHand: false,
        gesture: 'none',
        aimedName: null,
        paused: false,
      }));
    };
  }, [active, ensurePipeline, handleError, handleLandmarks, handleTrackerStatus]);

  /**
   * Advance the controller's smoothing. Called from the render loop every frame —
   * this is what converts 24 fps recognition into 60 fps motion.
   */
  const tick = useCallback((delta) => {
    const controller = controllerRef.current;
    if (!controller || !active) return signalsRef.current;
    const signals = controller.update(delta);
    signalsRef.current = signals;
    return signals;
  }, [active]);

  /** Latest raw landmarks, for the debug preview. */
  const getFrame = useCallback(() => trackerRef.current?.latestFrame || null, []);

  /**
   * Feed a synthetic landmark frame straight into the recognizer.
   *
   * This is the seam used by tools/gesture-e2e.mjs: it exercises the real
   * recognizer → controller → camera path without a camera or the model, which is
   * the only way to regression-test gesture behaviour in CI.
   */
  const injectFrame = useCallback(
    (landmarks, timestamp = performance.now()) => {
      if (!active) return null;
      const { recognizer, controller } = ensurePipeline();
      const frame = recognizer.update(landmarks, timestamp);
      controller.handleFrame(frame);
      // Refresh the UI too, so the reticle and status panel track injected frames
      // exactly as they would a real camera.
      pushStatus(controller, timestamp);
      return controller.status;
    },
    [active, ensurePipeline, pushStatus],
  );

  return { status, signalsRef, tick, getFrame, injectFrame, config: GESTURE_CONFIG, TRACKER_ERROR };
}
