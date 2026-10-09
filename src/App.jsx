/**
 * App — phase orchestration for the explorer.
 *
 * The WebGL scene is created by <SceneCanvas /> and handed back through `onReady`.
 * All camera and time choreography lives here as effects driven by store state, so
 * individual UI components only ever dispatch actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SceneCanvas from './components/SceneCanvas.jsx';
import BootScreen from './components/BootScreen.jsx';
import LandingHero from './components/LandingHero.jsx';
import TopBar from './components/TopBar.jsx';
import { InfoPanel } from './components/Panels.jsx';
import DetailPanel from './components/Panels.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import MissionsPanel from './components/MissionsPanel.jsx';
import AboutPanel from './components/AboutPanel.jsx';
import ControlDock from './components/ControlDock.jsx';
import PlanetsBrowser from './components/PlanetsBrowser.jsx';
import MobileDrawer from './components/MobileDrawer.jsx';
import ErrorFallback from './components/ErrorFallback.jsx';
import GesturePanel from './components/GesturePanel.jsx';
import HandCursor from './components/HandCursor.jsx';
import VoyagerSequence from './components/VoyagerSequence.jsx';
import CosmicScalePanel from './components/CosmicScalePanel.jsx';
import CosmicFinale from './components/CosmicFinale.jsx';
import { ActionType, StoreProvider, persistPreferences, useStore } from './store/store.jsx';
import { getNode, isMoon, ALL_NODES, MISSION_BY_ID } from './data/catalog.js';
import { useAutoQuality, useDeviceProfile, useKeyBindings, usePerformanceGuard } from './hooks/useEnvironment.js';
import { useHandControl } from './hooks/useHandControl.js';
import { COSMIC_SCALE } from './data/scale.js';
import { COSMIC_STAGES, DISTANCE_PAIRS, ASTRONOMY, lightTravel } from './data/cosmic.js';
import { getAudio } from './utils/audio.js';
import { GESTURE_CONFIG } from './gesture/config.js';
import { STORY } from './data/narrative.js';

/** Bodies a swipe cycles through, in orbital order (the Sun first, then planets). */
const SWIPE_ORDER = ALL_NODES.filter((node) => node.type !== 'moon').map((node) => node.id);

function Explorer() {
  const { state, dispatch } = useStore();
  const profile = useDeviceProfile();
  const autoQuality = useAutoQuality(profile);
  const [scene, setScene] = useState(null);
  const sceneRef = useRef(null);
  const [storyIndex, setStoryIndex] = useState(-1);
  const [fps, setFps] = useState(60);
  const appliedAutoQuality = useRef(false);
  const [cursor, setCursor] = useState({ visible: false, x: 0.5, y: 0.5, aimed: false, label: null });
  const cursorRef = useRef(cursor);

  const selectedNode = state.selectedId ? getNode(state.selectedId) : null;

  /** True while the hand-control mode is selected (regardless of whether it started). */
  const handActive = state.controlMode === 'hand';

  // ——— quality bootstrapping ————————————————————————————————————
  useEffect(() => {
    if (state.autoQuality && autoQuality !== state.quality) {
      dispatch({ type: ActionType.SET_QUALITY, quality: autoQuality });
      appliedAutoQuality.current = true;
    }
  }, [autoQuality, state.autoQuality, state.quality, dispatch]);

  usePerformanceGuard({
    enabled: state.autoQuality && state.phase === 'system',
    onDowngrade: useCallback(
      (measured) => {
        setFps(measured);
        const chain = { high: 'balanced', balanced: 'performance', performance: 'performance' };
        const next = chain[state.quality];
        if (next !== state.quality) dispatch({ type: ActionType.SET_QUALITY, quality: next });
      },
      [state.quality, dispatch],
    ),
  });

  // ——— preferences persistence ——————————————————————————————————
  useEffect(() => {
    persistPreferences(state);
  }, [
    state.quality,
    state.showOrbits,
    state.showLabels,
    state.soundEnabled,
    state.timeScale,
    state.locale,
    state.controlMode,
    state.cameraVisible,
  ]);

  // ——— hand gesture control —————————————————————————————————————
  /**
   * Every callback below runs at recognition rate (15–24 fps) except `tick`, which
   * runs per rendered frame. Camera motion therefore goes through the rig's orbit
   * and dolly helpers rather than through React state.
   */
  const handleGestureOrbit = useCallback((degreesX, degreesY) => {
    sceneRef.current?.cameraController?.orbitBy(degreesX, degreesY);
  }, []);

  const handleGestureZoom = useCallback((amount) => {
    sceneRef.current?.cameraController?.dollyBy(amount);
  }, []);

  const handleGesturePick = useCallback((x, y) => {
    const scene = sceneRef.current;
    if (!scene) return null;
    const hit = scene.pickFromScreen(x, y);
    if (!hit) return null;
    return { id: hit.id, name: hit.name };
  }, []);

  /**
   * Aim feedback while a hand points at a body.
   *
   * The halo weight comes from the gesture config rather than the scene default, so the
   * documented anti-mistrigger knob is the single place the pointing feel is tuned.
   */
  const handleGestureAim = useCallback((id) => {
    sceneRef.current?.setAim(id, GESTURE_CONFIG.pointing.aimHaloOpacity);
  }, []);

  const handleGestureSelect = useCallback((id) => {
    if (!id) return;
    dispatch({ type: ActionType.SELECT, id });
    sceneRef.current?.setSelection(id);
  }, [dispatch]);

  /**
   * Swipe steps through the system in orbital order.
   *
   * A hand sweeping to the *left* advances to the next body (mirroring a swipe on a
   * touch screen), so the mapping is deliberately inverted against the raw direction.
   *
   * The current selection is read from a ref, not from the closure: recognition
   * frames can arrive faster than React re-renders, and a stale `selectedId` would
   * make consecutive swipes repeat the same step.
   */
  const selectedIdRef = useRef(state.selectedId);
  selectedIdRef.current = state.selectedId;
  const timeScaleRef = useRef(state.timeScale);
  timeScaleRef.current = state.timeScale;

  const handleGestureSwipe = useCallback(
    (direction) => {
      const current = selectedIdRef.current;
      const index = current ? SWIPE_ORDER.indexOf(current) : -1;
      const step = direction < 0 ? 1 : -1;
      const nextIndex =
        index < 0
          ? step > 0
            ? Math.max(0, SWIPE_ORDER.indexOf('earth'))
            : SWIPE_ORDER.length - 1
          : (index + step + SWIPE_ORDER.length) % SWIPE_ORDER.length;
      const nextId = SWIPE_ORDER[nextIndex];
      // NOTE: the action field is `id`; passing `nextId` here silently selected
      // nothing (the reducer read `action.id` as undefined) and then cleared the view.
      dispatch({ type: ActionType.SELECT, id: nextId });
      sceneRef.current?.setSelection(nextId);
      getAudio()?.ping();
    },
    [dispatch],
  );

  /** Fist toggles the simulation; the time scale is restored on resume. */
  const lastTimeScale = useRef(1);
  const handleGesturePause = useCallback(() => {
    const paused = timeScaleRef.current === 0;
    if (paused) {
      dispatch({ type: ActionType.SET_TIME_SCALE, scale: lastTimeScale.current || 1 });
    } else {
      lastTimeScale.current = timeScaleRef.current || 1;
      dispatch({ type: ActionType.SET_TIME_SCALE, scale: 0 });
    }
  }, [dispatch]);

  /**
   * Hand control could not start (denied permission, no camera, insecure origin, model
   * failure).
   *
   * The session must fail *soft* without hiding the reason: switching `controlMode` back
   * to mouse here would unmount the panel that explains what happened, which is exactly
   * the bug this replaced — the user was told to use a mouse by a panel that vanished as
   * it said so. Instead the failure state itself releases the canvas (see
   * `handOwnsCanvas`), so the mouse works immediately, the explanation stays on screen,
   * and the user can retry or dismiss the panel with its own close button.
   */
  const handleGestureUnavailable = useCallback(() => {
    // Intentionally no mode change; the pointer already works in this state.
  }, []);

  const { status: gestureStatus, tick: gestureTick, getFrame: getGestureFrame, injectFrame } = useHandControl({
    active: handActive && state.phase === 'system',
    onOrbit: handleGestureOrbit,
    onZoom: handleGestureZoom,
    onPick: handleGesturePick,
    onAim: handleGestureAim,
    onSelect: handleGestureSelect,
    onSwipe: handleGestureSwipe,
    onTogglePause: handleGesturePause,
    onUnavailable: handleGestureUnavailable,
  });

  /**
   * While hand control is running it owns the canvas, so pointer events are disabled to
   * stop a stray mouse move fighting the hand.
   *
   * A *failed* session must NOT keep that lock. It used to: after a denied camera the
   * canvas stayed pointer-disabled while the on-screen message told the user to use a
   * mouse the app was ignoring. The mode is left alone so the explanation stays visible
   * and the session can be retried, but the pointer is handed straight back.
   */
  const handFailed = handActive && gestureStatus.state === 'error';
  const handOwnsCanvas = handActive && !handFailed;

  /**
   * Test seam: lets tools/gesture-e2e.mjs drive the real recognizer → controller →
   * camera path without a camera or the model loaded.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__gesture = { injectFrame, isActive: handActive };
    return () => {
      if (window.__gesture?.injectFrame === injectFrame) delete window.__gesture;
    };
  }, [injectFrame, handActive]);

  /** Read-only view of the store, for the verification harness. */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__ui = state;
    return () => {
      if (window.__ui === state) delete window.__ui;
    };
  }, [state]);

  /**
   * Voyager Experience state.
   *
   * Declared above `handleFrame` because that callback reads it every frame; the
   * departure itself is driven entirely by the camera rig, so this only carries what the
   * overlay needs to render.
   */
  const voyageActive = state.voyage !== null;
  const voyageActiveRef = useRef(voyageActive);
  voyageActiveRef.current = voyageActive;
  const [voyageProgress, setVoyageProgress] = useState({ progress: 0, complete: false });
  /** Last written values, so the per-frame poll does not re-render needlessly. */
  const voyagePercentRef = useRef(-1);
  const voyageCompleteRef = useRef(false);

  /**
   * Cosmic-scale state, also read by the render-loop callback.
   *
   * `cosmicActiveRef` mirrors the store flag and `cosmicCompleteRef` the last value written
   * to state; both are refs for the same reason as the voyage pair — a memoised per-frame
   * callback must not capture these bindings.
   */
  const cosmicStage = state.cosmicStage;
  const cosmicActive = cosmicStage !== null;
  const cosmicActiveRef = useRef(cosmicActive);
  cosmicActiveRef.current = cosmicActive;
  const cosmicCompleteRef = useRef(true);
  const cosmicPercentRef = useRef(-1);
  /** True once the guided pull-back has reached the Milky Way and the card should rise. */
  const [cosmicFinale, setCosmicFinale] = useState(false);
  const [cosmicProgress, setCosmicProgress] = useState({ progress: 1, complete: true });

  /**
   * Per-frame drain of the gesture signals plus the cursor update.
   * State is written only when the cursor actually changes, which at rest is never.
   */
  const handleFrame = useCallback(
    (delta) => {
      /**
       * Voyager progress is read from the rig, which is the single source of truth for the
       * departure. State is written only when the rounded percentage moves, so a 12-second
       * shot costs at most 100 renders rather than one per frame.
       *
       * The flag is read from a ref rather than the `voyageActive` binding: this callback is
       * memoised for the render loop, and capturing the value here meant the poll kept
       * seeing `false` after the sequence started. The camera flew, the card never came.
       */
      if (voyageActiveRef.current) {
        const rig = sceneRef.current?.cameraController;
        if (rig) {
          const progress = Math.min(1, Math.max(0, rig.voyageProgress ?? 0));
          const complete = Boolean(rig.voyageComplete);
          const percent = Math.round(progress * 100);
          if (percent !== voyagePercentRef.current || complete !== voyageCompleteRef.current) {
            voyagePercentRef.current = percent;
            voyageCompleteRef.current = complete;
            setVoyageProgress({ progress, complete });
          }
        }
      }

      // Cosmic-stage progress, on the same terms: read from the rig via a ref so the
      // memoised callback cannot go stale, and written only when the percentage moves.
      if (cosmicActiveRef.current) {
        const rig = sceneRef.current?.cameraController;
        if (rig) {
          const progress = Math.min(1, Math.max(0, rig.cosmicProgress ?? 0));
          const complete = rig.mode !== 'cosmic';
          const percent = Math.round(progress * 100);
          if (percent !== cosmicPercentRef.current || complete !== cosmicCompleteRef.current) {
            cosmicPercentRef.current = percent;
            cosmicCompleteRef.current = complete;
            setCosmicProgress({ progress, complete });
          }
        }
      }

      if (!handActive) return;
      const signals = gestureTick(delta);
      if (signals.orbitX || signals.orbitY || signals.zoom) {
        sceneRef.current?.cameraController?.orbitBy(signals.orbitY, signals.orbitX);
        if (signals.zoom) sceneRef.current?.cameraController?.dollyBy(signals.zoom);
      }
      const visible = Boolean(gestureStatus.hasHand || gestureStatus.state === 'active');
      const aimed = Boolean(gestureStatus.aimedName);
      const previous = cursorRef.current;
      const moved =
        Math.abs(previous.x - signals.pointer.x) > 0.002 || Math.abs(previous.y - signals.pointer.y) > 0.002;
      if (
        moved ||
        previous.visible !== visible ||
        previous.aimed !== aimed ||
        previous.label !== gestureStatus.aimedName
      ) {
        const next = {
          visible,
          x: signals.pointer.x,
          y: signals.pointer.y,
          aimed,
          label: gestureStatus.aimedName,
        };
        cursorRef.current = next;
        setCursor(next);
      }
    },
    [gestureStatus.aimedName, gestureStatus.hasHand, gestureStatus.state, gestureTick, handActive],
  );

  /** Leaving hand mode restores mouse/touch and clears the reticle. */
  useEffect(() => {
    if (handActive) return;
    sceneRef.current?.setAim(null);
    if (cursorRef.current.visible) {
      cursorRef.current = { visible: false, x: 0.5, y: 0.5, aimed: false, label: null };
      setCursor(cursorRef.current);
    }
  }, [handActive]);

  // ——— scene readiness ——————————————————————————————————————————
  const handleSceneReady = useCallback((instance) => {
    sceneRef.current = instance;
    setScene(instance);
    // Exposed for the verification harness (tools/verify.mjs, tools/review.mjs) so
    // camera framing can be asserted without screenshot diffing.
    if (typeof window !== 'undefined') window.__solar = instance;
    dispatch({ type: ActionType.READY });
  }, [dispatch]);

  const handleSceneError = useCallback(
    (error) => {
      dispatch({ type: ActionType.FAIL, error: error?.message || 'WebGL initialisation failed' });
    },
    [dispatch],
  );

  // ——— interaction ——————————————————————————————————————————————
  const handlePick = useCallback(
    (id, { double } = {}) => {
      if (!id) {
        if (!double) {
          dispatch({ type: ActionType.CLEAR_SELECTION });
          sceneRef.current?.setSelection(null);
        }
        return;
      }
      dispatch({ type: ActionType.SELECT, id });
      sceneRef.current?.setSelection(id);
      if (double) dispatch({ type: ActionType.OPEN_DETAIL, id });
    },
    [dispatch],
  );

  const handleHover = useCallback(
    (id) => {
      dispatch({ type: ActionType.HOVER, id });
    },
    [dispatch],
  );

  const handleSimulationTick = useCallback(
    (date) => {
      dispatch({ type: ActionType.SET_SIMULATION_DATE, date });
    },
    [dispatch],
  );

  // ——— camera choreography ———————————————————————————————————————
  useEffect(() => {
    const rig = sceneRef.current?.cameraController;
    if (!rig || state.phase !== 'system') return;
    if (state.view === 'compare' || state.view === 'missions' || state.view === 'about') {
      rig.setAutoOrbit(true);
      return;
    }
    if (storyIndex >= 0) return; // the story drives the camera
    if (!state.selectedId) {
      rig.frameSystem({ distance: profile.isMobile ? 92 : 78 });
      return;
    }
    const multiplier = state.view === 'detail' ? (isMoon(state.selectedId) ? 2.4 : 1.25) : isMoon(state.selectedId) ? 2.2 : 1.5;
    /**
     * In detail view the panel owns the right third of the screen, so the body is
     * biased left to sit in the open area rather than centring underneath it. Phones
     * use a full-width bottom sheet, so there is nothing to avoid and the bias is
     * cleared. A negative bias moves the subject left.
     */
    const bias = state.view === 'detail' && !profile.isMobile ? { x: -0.3, y: 0 } : null;
    rig.focus(state.selectedId, { distanceMultiplier: multiplier, duration: 1.3, bias });
  }, [state.selectedId, state.view, state.phase, storyIndex, profile.isMobile]);

  /**
   * Orbit emphasis: full in the system view, faded in detail view so a ring crossing in
   * front of a body does not cut a line across the thing being studied.
   */
  useEffect(() => {
    sceneRef.current?.setOrbitEmphasis(state.view === 'detail' ? 0 : 1);
  }, [state.view, state.sceneReady]);

  // ——— selection halo ———————————————————————————————————————————
  useEffect(() => {
    sceneRef.current?.setSelection(state.selectedId);
  }, [state.selectedId]);

  // ——— sound ————————————————————————————————————————————————————
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    if (state.soundEnabled) audio.enable();
    else audio.disable();
  }, [state.soundEnabled]);

  useEffect(() => {
    if (!state.soundEnabled) return;
    getAudio()?.setBodyTone(state.selectedId || 'sun', selectedNode?.accent);
  }, [state.soundEnabled, state.selectedId, selectedNode?.accent]);

  // ——— scroll story ——————————————————————————————————————————————
  useEffect(() => {
    if (storyIndex < 0) return;
    const rig = sceneRef.current?.cameraController;
    const section = STORY[storyIndex];
    if (!rig || !section) return;
    rig.focus(section.focus, { distanceMultiplier: section.multiplier, duration: 1.5 });
  }, [storyIndex]);

  const startStory = useCallback(() => {
    setStoryIndex(0);
    sceneRef.current?.setSelection(null);
  }, []);

  const stopStory = useCallback(() => {
    setStoryIndex(-1);
    sceneRef.current?.cameraController?.frameSystem({ distance: 78 });
  }, []);

  const stepStory = useCallback(
    (direction) => {
      setStoryIndex((current) => {
        const next = current + direction;
        if (next < 0) return 0;
        if (next >= STORY.length) return current;
        return next;
      });
    },
    [],
  );

  // ——— Cosmic Scale ————————————————————————————————————————————————
  /**
   * The ladder's camera control.
   *
   * Each stage is a framing (see `CameraRig.cosmic`), and the scene is told which
   * representation to show so the Oort Cloud and Galaxy can take over from the solar-system
   * model. The trip is cancellable: `cosmicTourRef` is checked between hops so closing the
   * panel mid-flight does not leave a queued flight running.
   *
   * Declared here, above the key bindings, because Escape has to be able to leave the
   * ladder. The per-frame refs are declared above `handleFrame` for the same reason.
   */
  const cosmicTourRef = useRef(false);

  const leaveCosmic = useCallback(() => {
    cosmicTourRef.current = false;
    setCosmicFinale(false);
    const scene = sceneRef.current;
    scene?.clearCosmicStage();
    scene?.cameraController?.frameSystem({ distance: 78, duration: 1.8 });
    setCosmicProgress({ progress: 1, complete: true });
    dispatch({ type: ActionType.SET_COSMIC_STAGE, stage: null });
    dispatch({ type: ActionType.SET_DISTANCE_PAIR, pair: null });
  }, [dispatch]);

  const goToStage = useCallback(
    (stageId, { duration } = {}) => {
      const preset = COSMIC_SCALE.stages[stageId];
      const rig = sceneRef.current?.cameraController;
      const scene = sceneRef.current;
      if (!preset || !rig || !scene) return;
      // A manual rung selection cancels any guided trip still in flight. Without this the
      // tour's pending iterations kept dispatching their own stages and overrode the click,
      // which is why rung selections appeared to lag by one.
      cosmicTourRef.current = false;
      scene.setCosmicStage(stageId);
      rig.cosmic({ distance: preset.distance, duration: duration ?? preset.duration, stage: stageId });
      setCosmicProgress({ progress: 0, complete: false });
      dispatch({ type: ActionType.SET_COSMIC_STAGE, stage: stageId });
    },
    [dispatch],
  );

  const stepCosmic = useCallback(
    (direction) => {
      const position = COSMIC_STAGES.findIndex((item) => item.id === (cosmicStage ?? 'earth'));
      const next = Math.min(COSMIC_STAGES.length - 1, Math.max(0, position + direction));
      const stageId = COSMIC_STAGES[next].id;
      if (stageId === cosmicStage) return;
      goToStage(stageId);
    },
    [cosmicStage, goToStage],
  );

  /**
   * The cinematic pull-back: Earth → Solar System → Outer System → Oort Cloud → Milky Way.
   *
   * Stages are flown in order with the ladder's own durations, and the closing card is
   * raised only once the galaxy flight completes. Time is frozen for the duration, because
   * drifting planets would fight a shot about distance.
   */
  const runCosmicTour = useCallback(async () => {
    const rig = sceneRef.current?.cameraController;
    const scene = sceneRef.current;
    if (!rig || !scene) return;
    cosmicTourRef.current = true;
    dispatch({ type: ActionType.SET_DISTANCE_PAIR, pair: null });

    for (const stage of COSMIC_STAGES) {
      if (!cosmicTourRef.current) return;
      const preset = COSMIC_SCALE.stages[stage.id];
      scene.setCosmicStage(stage.id);
      rig.cosmic({ distance: preset.distance, duration: preset.duration, stage: stage.id });
      setCosmicProgress({ progress: 0, complete: false });
      dispatch({ type: ActionType.SET_COSMIC_STAGE, stage: stage.id });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, preset.duration * 1000 + 320);
      });
    }
    if (!cosmicTourRef.current) return;
    setCosmicProgress({ progress: 1, complete: true });
    // Only the guided trip raises the closing card; hopping rungs manually does not.
    setCosmicFinale(true);
  }, [dispatch]);

  const endCosmicFinale = useCallback(() => {
    setCosmicFinale(false);
    leaveCosmic();
  }, [leaveCosmic]);

  // ——— keyboard ——————————————————————————————————————————————————
  useKeyBindings(
    useMemo(
      () => ({
        Escape: () => {
          // The cinematic takeovers own Escape while they are on screen.
          if (voyageActive) return;
          if (cosmicActive) {
            leaveCosmic();
            return;
          }
          if (storyIndex >= 0) stopStory();
          else if (state.view !== 'explore') dispatch({ type: ActionType.CLOSE_DETAIL });
          else {
            dispatch({ type: ActionType.CLEAR_SELECTION });
            sceneRef.current?.setSelection(null);
          }
        },
        ' ': () => {
          // Time is frozen for the shots, so Space must not fight them.
          if (state.phase !== 'system' || voyageActive || cosmicActive) return;
          dispatch({ type: ActionType.SET_TIME_SCALE, scale: state.timeScale === 0 ? 1 : 0 });
        },
        ArrowRight: () => (cosmicActive ? stepCosmic(1) : storyIndex >= 0 && stepStory(1)),
        ArrowLeft: () => (cosmicActive ? stepCosmic(-1) : storyIndex >= 0 && stepStory(-1)),
      }),
      [
        dispatch,
        state.view,
        state.timeScale,
        state.phase,
        storyIndex,
        stepStory,
        stopStory,
        voyageActive,
        cosmicActive,
        leaveCosmic,
        stepCosmic,
      ],
    ),
    { enabled: state.phase !== 'boot' },
  );

  /**
   * Voyager Experience: the departure is a cinematic takeover.
   *
   * Starting it zeroes the clock (the store handles that) and hands the camera to the rig's
   * `voyage` mode. The state itself is declared above `handleFrame`; this is the control
   * surface for it.
   */
  const startVoyage = useCallback(
    (missionId = 'voyager-1') => {
      dispatch({ type: ActionType.START_VOYAGE, missionId, startedAt: performance.now() });
    },
    [dispatch],
  );

  const endVoyage = useCallback(() => {
    sceneRef.current?.cameraController?.frameSystem({ distance: 78, duration: 1.8 });
    sceneRef.current?.resetVoyageDepth();
    setVoyageProgress({ progress: 0, complete: false });
    dispatch({ type: ActionType.END_VOYAGE });
  }, [dispatch]);

  useEffect(() => {
    if (!voyageActive) return;
    const rig = sceneRef.current?.cameraController;
    if (!rig) return;
    rig.voyage({ duration: 12, cruise: 4200, power: 2 });
    setVoyageProgress({ progress: 0, complete: false });
  }, [voyageActive]);

  // ——— Cosmic Scale ————————————————————————————————————————————————
  // The ladder's state and camera controls are declared above the key bindings, because
  // Escape has to be able to leave it.


  // ——— Distance Mode ————————————————————————————————————————————————
  /**
   * Real Distance Mode measurement.
   *
   * The *numbers* come from the data layer (a body's distance from the Sun, or a moon's
   * semi-major axis); the scene's render positions are never used, because those are the
   * compressed ones. This is the distinction the panel's VISUAL SCALE / REAL DATA legend
   * promises, enforced in code rather than in prose.
   */
  const distanceReadout = useMemo(() => {
    const pair = DISTANCE_PAIRS.find((item) => item.id === state.distancePair);
    if (!pair) return null;
    const left = getNode(pair.left);
    const right = getNode(pair.right);
    if (!left || !right) return null;

    /** A body's own distance from the Sun, in km, from the data layer. */
    const heliocentricKm = (node) => (node?.distanceAu ? node.distanceAu * ASTRONOMY.auKm : null);

    let value = null;
    let direct = false;
    if (left.parent === right.id) {
      // The left body orbits the right one: its semi-major axis *is* the separation.
      value = left.semiMajorAxisKm ?? null;
      direct = true;
    } else if (right.parent === left.id) {
      value = right.semiMajorAxisKm ?? null;
      direct = true;
    } else {
      const a = heliocentricKm(left);
      const b = heliocentricKm(right);
      // The Sun is the origin, so its own heliocentric distance is zero.
      const aIsSun = left.id === 'sun';
      const bIsSun = right.id === 'sun';
      if (aIsSun && b !== null) value = b;
      else if (bIsSun && a !== null) value = a;
      else if (a !== null && b !== null) value = Math.abs(a - b);
    }
    if (value === null) return null;

    const inAu = value / ASTRONOMY.auKm;
    return {
      route: pair.label,
      value: `${(value / 1e6).toFixed(1)} million km`,
      unit: inAu >= 0.05 ? `= ${inAu.toFixed(2)} AU` : `1 AU = 149.6 million km`,
      auxiliary: direct ? 'Measured along the orbit’s semi-major axis' : `Also ${inAu.toFixed(2)} AU from the Sun`,
      light: lightTravel(value),
    };
  }, [state.distancePair]);

  // ——— simulation clock readout ——————————————————————————————————
  const simulation = useMemo(() => {    const date = state.simulationDate;
    const iso = `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`;
    const dayOfYear = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
    return { iso, dayOfYear: `DAY ${dayOfYear}` };
  }, [state.simulationDate]);

  const overlayActive = state.view !== 'explore' || state.phase === 'hero';

  if (state.phase === 'error') {
    return <ErrorFallback error={state.error} />;
  }

  /**
   * Focus mode: a body is open in detail.
   *
   * Keyed off `view`, not `phase`: the reducer moves between panels with `view` and
   * never assigns `phase: 'detail'`, so a phase check here would never be true.
   * Everything that is not the body or its panel recedes — "少一点 UI，多一点宇宙".
   */
  const focusMode = state.view === 'detail';

  return (
    <div
      className={`app phase-${state.phase}${focusMode ? ' focus-mode' : ''}${
        voyageActive ? ' voyage-active' : ''
      }${cosmicActive ? ' cosmic-active' : ''} view-${state.view}`}
    >
      <SceneCanvas
        quality={state.quality}
        timeScale={state.timeScale}
        showOrbits={state.showOrbits}
        showLabels={state.showLabels}
        onReady={handleSceneReady}
        onPick={handlePick}
        onHover={handleHover}
        onFrame={handleFrame}
        onSimulationTick={handleSimulationTick}
        onContextLost={handleSceneError}
        pointerEnabled={!handOwnsCanvas}
      />

      <div className="vignette" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      {handOwnsCanvas ? (
        <HandCursor
          visible={cursor.visible}
          x={cursor.x}
          y={cursor.y}
          aimed={cursor.aimed}
          label={cursor.label}
          gestureActive={gestureStatus.gesture !== 'none'}
        />
      ) : null}

      {/* The departure sits above everything and takes the whole frame. */}
      {voyageActive ? (
        <VoyagerSequence
          mission={state.voyage?.missionId ? MISSION_BY_ID[state.voyage.missionId] : null}
          complete={voyageProgress.complete}
          progress={voyageProgress.progress}
          onExit={endVoyage}
        />
      ) : null}

      {/* The Cosmic Scale ladder, and its closing frame once the pull-back lands. */}
      {cosmicActive ? (
        <CosmicScalePanel
          stage={cosmicStage}
          distancePair={state.distancePair}
          distance={distanceReadout}
          onSelectStage={(id) => goToStage(id)}
          onStep={stepCosmic}
          onSelectDistance={(pair) => dispatch({ type: ActionType.SET_DISTANCE_PAIR, pair })}
          onClose={leaveCosmic}
        />
      ) : null}

      {cosmicActive && cosmicFinale ? (
        <CosmicFinale complete={cosmicProgress.complete} onExit={endCosmicFinale} />
      ) : null}

      {state.phase === 'boot' ? (
        <BootScreen
          quality={state.quality}
          sceneReady={state.sceneReady}
          onEnter={() => dispatch({ type: ActionType.OPEN_HERO })}
        />
      ) : null}

      {state.phase === 'hero' ? (
        <LandingHero
          onEnter={() => dispatch({ type: ActionType.ENTER_SYSTEM })}
          onNavigate={(key) => {
            dispatch({ type: ActionType.ENTER_SYSTEM });
            if (key === 'missions') dispatch({ type: ActionType.OPEN_MISSIONS });
            if (key === 'about') dispatch({ type: ActionType.OPEN_ABOUT });
          }}
        />
      ) : null}

      {state.phase === 'system' ? (
        <div className={`ui-layer ${overlayActive ? 'overlay-active' : ''}`}>
          <TopBar
            quality={state.quality}
            onSetQuality={(quality) => dispatch({ type: ActionType.SET_QUALITY, quality })}
            onOpenMission={(id) => dispatch({ type: ActionType.OPEN_MISSION, id })}
            onSelectBody={(id) => {
              dispatch({ type: ActionType.SELECT, id });
              dispatch({ type: ActionType.CLOSE_DETAIL });
              sceneRef.current?.setSelection(id);
            }}
          />

          <PlanetsBrowser
            onSelect={(id) => {
              dispatch({ type: ActionType.SELECT, id });
              sceneRef.current?.setSelection(id);
            }}
            onExplore={(id) => dispatch({ type: ActionType.OPEN_DETAIL, id })}
            onCompare={(id, opponent) => {
              dispatch({ type: ActionType.SET_COMPARE, slots: [id, opponent] });
              dispatch({ type: ActionType.OPEN_COMPARE });
              sceneRef.current?.setSelection(null);
            }}
            onOpenMission={(id) => (id ? dispatch({ type: ActionType.OPEN_MISSION, id }) : dispatch({ type: ActionType.OPEN_MISSIONS }))}
          />

          <ControlDock
            timeScale={state.timeScale}
            quality={state.quality}
            showOrbits={state.showOrbits}
            cosmicActive={cosmicActive}
            onStartCosmicTour={() => {
              // The guided trip is the cinematic version; it starts from the innermost rung.
              runCosmicTour().catch(() => setCosmicFinale(false));
            }}
            onLeaveCosmic={leaveCosmic}
            showLabels={state.showLabels}
            soundEnabled={state.soundEnabled}
            storyActive={storyIndex >= 0}
            simulation={simulation}
            fps={fps}
            controlMode={state.controlMode}
            onSetControlMode={(mode) => dispatch({ type: ActionType.SET_CONTROL_MODE, mode })}
            onSetTimeScale={(scale) => dispatch({ type: ActionType.SET_TIME_SCALE, scale })}
            onSetQuality={(quality) => dispatch({ type: ActionType.SET_QUALITY, quality })}
            onToggleOrbits={() => dispatch({ type: ActionType.TOGGLE_ORBITS })}
            onToggleLabels={() => dispatch({ type: ActionType.TOGGLE_LABELS })}
            onToggleSound={() => dispatch({ type: ActionType.TOGGLE_SOUND })}
            onToggleStory={() => (storyIndex >= 0 ? stopStory() : startStory())}
            onReset={() => {
              dispatch({ type: ActionType.CLEAR_SELECTION });
              sceneRef.current?.setSelection(null);
            }}
          />

          <GesturePanel
            status={gestureStatus}
            visible={handActive}
            cameraVisible={state.cameraVisible}
            onToggleCamera={() => dispatch({ type: ActionType.TOGGLE_CAMERA })}
            onExit={() => dispatch({ type: ActionType.SET_CONTROL_MODE, mode: profile.isMobile ? 'touch' : 'mouse' })}
            getFrame={getGestureFrame}
          />

          {storyIndex >= 0 ? (
            <div className="story" role="region" aria-label="Guided tour">
              <div className="story-card glass fade-in">
                <div className="story-index caps mono">SECTION {STORY[storyIndex].index}</div>
                <h2 className="story-title">{STORY[storyIndex].title}</h2>
                <p className="story-body">{STORY[storyIndex].body}</p>
                <div className="story-nav">
                  <button
                    type="button"
                    className="dock-button"
                    onClick={() => stepStory(-1)}
                    disabled={storyIndex === 0}
                  >
                    PREV
                  </button>
                  <div className="story-dots" aria-hidden="true">
                    {STORY.map((section, index) => (
                      <span key={section.id} className={`story-dot ${index === storyIndex ? 'active' : ''}`} />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="dock-button"
                    onClick={() => (storyIndex === STORY.length - 1 ? stopStory() : stepStory(1))}
                  >
                    {storyIndex === STORY.length - 1 ? 'FINISH' : 'NEXT'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {state.view === 'explore' && selectedNode ? (
            <InfoPanel
              node={selectedNode}
              onClose={() => {
                dispatch({ type: ActionType.CLEAR_SELECTION });
                sceneRef.current?.setSelection(null);
              }}
              onExplore={(id) => dispatch({ type: ActionType.OPEN_DETAIL, id })}
              onCompare={(id) => {
                dispatch({ type: ActionType.SET_COMPARE, slots: [id, state.compare[1] === id ? 'mars' : state.compare[1]] });
                dispatch({ type: ActionType.OPEN_COMPARE });
              }}
            />
          ) : null}

          {state.view === 'detail' && selectedNode ? (
            <DetailPanel
              node={selectedNode}
              chapter={state.chapter}
              onChapter={(chapter) => dispatch({ type: ActionType.SET_CHAPTER, chapter })}
              onClose={() => dispatch({ type: ActionType.CLOSE_DETAIL })}
              onSelectBody={(id) => {
                dispatch({ type: ActionType.OPEN_DETAIL, id });
                sceneRef.current?.setSelection(id);
              }}
              onOpenMission={(id) => dispatch({ type: ActionType.OPEN_MISSION, id })}
            />
          ) : null}

          {state.view === 'compare' ? (
            <ComparePanel
              slots={state.compare}
              onSetSlots={(slots) => dispatch({ type: ActionType.SET_COMPARE, slots })}
              onClose={() => dispatch({ type: ActionType.CLOSE_DETAIL })}
              onExplore={(id) => {
                dispatch({ type: ActionType.OPEN_DETAIL, id });
                sceneRef.current?.setSelection(id);
              }}
            />
          ) : null}

          {state.view === 'missions' ? (
            <MissionsPanel
              activeMissionId={state.activeMissionId}
              onOpenMission={(id) => dispatch({ type: ActionType.OPEN_MISSION, id })}
              onCloseMission={() => dispatch({ type: ActionType.CLOSE_MISSION })}
              onClose={() => dispatch({ type: ActionType.CLOSE_DETAIL })}
              onStartVoyage={startVoyage}
              onFocusBody={(id) => {
                dispatch({ type: ActionType.SELECT, id });
                sceneRef.current?.setSelection(id);
              }}
            />
          ) : null}

          {state.view === 'about' ? <AboutPanel onClose={() => dispatch({ type: ActionType.CLOSE_DETAIL })} /> : null}

          <MobileDrawer
            node={selectedNode}
            view={state.view}
            chapter={state.chapter}
            onChapter={(chapter) => dispatch({ type: ActionType.SET_CHAPTER, chapter })}
            onClose={() => {
              dispatch({ type: ActionType.CLEAR_SELECTION });
              sceneRef.current?.setSelection(null);
            }}
            onExplore={(id) => dispatch({ type: ActionType.OPEN_DETAIL, id })}
            onOpenMission={(id) => dispatch({ type: ActionType.OPEN_MISSION, id })}
          />
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {state.phase === 'system' ? 'Solar system loaded. Use the controls to explore.' : 'Loading solar system explorer'}
      </span>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Explorer />
    </StoreProvider>
  );
}
