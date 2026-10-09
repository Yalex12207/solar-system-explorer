/**
 * Single global store for the explorer.
 *
 * Kept as a reducer + context rather than a state library: the shape is small,
 * fully serialisable, and consumed by both the React UI and (indirectly) the 3D
 * scene effects. localStorage persistence is limited to preferences.
 */

import { createContext, useContext, useMemo, useReducer } from 'react';
import { QUALITY_PRESETS } from '../data/scale.js';

/**
 * Simulation speeds. `0` is pause; the rest are multiples of real time.
 *
 * 10000× advances the system by roughly 27 years a day, which is the point: Neptune's
 * 165-year orbit becomes watchable rather than theoretical.
 */
export const TIME_SCALES = [0, 1, 10, 100, 1000, 10000];

const STORAGE_KEY = 'solar-system-explorer:prefs';

const initialState = {
  /** boot | hero | system | error */
  phase: 'boot',
  error: null,
  sceneReady: false,
  /** explore | detail | compare | missions | about */
  view: 'explore',
  selectedId: null,
  hoveredId: null,
  compare: ['earth', 'mars'],
  activeMissionId: null,
  chapter: 'overview',
  showOrbits: true,
  showLabels: true,
  timeScale: 1,
  paused: false,
  simulationDate: new Date(),
  quality: 'balanced',
  autoQuality: true,
  soundEnabled: false,
  locale: 'en',
  tourPlaying: false,
  planetsOpen: false,
  drawerOpen: false,
  helpOpen: false,
  /** mouse | touch | hand — three first-class ways to drive the system. */
  controlMode: 'mouse',
  /** Show the mirrored camera preview (debug / reassurance). */
  cameraVisible: false,
  /**
   * Voyager Experience: while set, the camera is leaving the solar system and the
   * normal UI stands down. `null` when not in the sequence.
   */
  voyage: null,
  /**
   * Cosmic Scale: the current rung of the ladder (`earth` … `milky-way`), or `null` when
   * the app is in its normal solar-system presentation.
   */
  cosmicStage: null,
  /** Distance Mode overlay: null, or a `DISTANCE_PAIRS` id. */
  distancePair: null,
};

function readPreferences() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const prefs = {};
    if (QUALITY_PRESETS[parsed.quality]) prefs.quality = parsed.quality;
    if (typeof parsed.showOrbits === 'boolean') prefs.showOrbits = parsed.showOrbits;
    if (typeof parsed.showLabels === 'boolean') prefs.showLabels = parsed.showLabels;
    if (typeof parsed.soundEnabled === 'boolean') prefs.soundEnabled = parsed.soundEnabled;
    if (TIME_SCALES.includes(parsed.timeScale)) prefs.timeScale = parsed.timeScale;
    if (parsed.locale === 'en' || parsed.locale === 'zh') prefs.locale = parsed.locale;
    if (['mouse', 'touch', 'hand'].includes(parsed.controlMode)) prefs.controlMode = parsed.controlMode;
    if (typeof parsed.cameraVisible === 'boolean') prefs.cameraVisible = parsed.cameraVisible;
    return prefs;
  } catch {
    return {};
  }
}

export function persistPreferences(state) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        quality: state.quality,
        showOrbits: state.showOrbits,
        showLabels: state.showLabels,
        soundEnabled: state.soundEnabled,
        timeScale: state.timeScale,
        locale: state.locale,
        controlMode: state.controlMode,
        cameraVisible: state.cameraVisible,
      }),
    );
  } catch {
    /* storage disabled — preferences simply do not persist */
  }
}

export const ActionType = {
  BOOT: 'BOOT',
  READY: 'READY',
  FAIL: 'FAIL',
  OPEN_HERO: 'OPEN_HERO',
  ENTER_SYSTEM: 'ENTER_SYSTEM',
  SELECT: 'SELECT',
  HOVER: 'HOVER',
  CLEAR_SELECTION: 'CLEAR_SELECTION',
  OPEN_DETAIL: 'OPEN_DETAIL',
  CLOSE_DETAIL: 'CLOSE_DETAIL',
  SET_CHAPTER: 'SET_CHAPTER',
  OPEN_COMPARE: 'OPEN_COMPARE',
  SET_COMPARE: 'SET_COMPARE',
  OPEN_PLANETS: 'OPEN_PLANETS',
  TOGGLE_PLANETS: 'TOGGLE_PLANETS',
  OPEN_MISSIONS: 'OPEN_MISSIONS',
  OPEN_MISSION: 'OPEN_MISSION',
  CLOSE_MISSION: 'CLOSE_MISSION',
  OPEN_ABOUT: 'OPEN_ABOUT',
  TOGGLE_ORBITS: 'TOGGLE_ORBITS',
  TOGGLE_LABELS: 'TOGGLE_LABELS',
  SET_TIME_SCALE: 'SET_TIME_SCALE',
  SET_QUALITY: 'SET_QUALITY',
  TOGGLE_SOUND: 'TOGGLE_SOUND',
  SET_LOCALE: 'SET_LOCALE',
  SET_SIMULATION_DATE: 'SET_SIMULATION_DATE',
  TOGGLE_TOUR: 'TOGGLE_TOUR',
  SET_HELP: 'SET_HELP',
  SET_CONTROL_MODE: 'SET_CONTROL_MODE',
  TOGGLE_CAMERA: 'TOGGLE_CAMERA',
  START_VOYAGE: 'START_VOYAGE',
  END_VOYAGE: 'END_VOYAGE',
  SET_COSMIC_STAGE: 'SET_COSMIC_STAGE',
  SET_DISTANCE_PAIR: 'SET_DISTANCE_PAIR',
};

function reducer(state, action) {
  switch (action.type) {
    case ActionType.BOOT:
      return { ...state, phase: 'boot', error: null };
    case ActionType.READY:
      // The first frame is on screen. Stay on the boot screen: entering the hero
      // is an explicit user action, not a side effect of loading quickly.
      return { ...state, sceneReady: true };
    case ActionType.FAIL:
      return { ...state, phase: 'error', error: action.error };
    case ActionType.OPEN_HERO:
      return { ...state, phase: 'hero', view: 'explore' };
    case ActionType.ENTER_SYSTEM:
      return { ...state, phase: 'system', view: 'explore', drawerOpen: false, planetsOpen: false };
    case ActionType.SELECT:
      return {
        ...state,
        selectedId: action.id,
        planetsOpen: false,
        drawerOpen: action.id ? state.drawerOpen : false,
      };
    case ActionType.HOVER:
      return { ...state, hoveredId: action.id };
    case ActionType.CLEAR_SELECTION:
      return { ...state, selectedId: null, view: 'explore', activeMissionId: null, drawerOpen: false };
    case ActionType.OPEN_DETAIL:
      return { ...state, view: 'detail', selectedId: action.id, chapter: 'overview', drawerOpen: false, planetsOpen: false };
    case ActionType.CLOSE_DETAIL:
      return { ...state, view: 'explore', chapter: 'overview' };
    case ActionType.SET_CHAPTER:
      return { ...state, chapter: action.chapter };
    case ActionType.OPEN_COMPARE:
      return { ...state, view: 'compare', drawerOpen: false, planetsOpen: false };
    case ActionType.OPEN_PLANETS:
      return { ...state, planetsOpen: true, drawerOpen: false };
    case ActionType.TOGGLE_PLANETS:
      return { ...state, planetsOpen: !state.planetsOpen, drawerOpen: false };
    case ActionType.SET_COMPARE:
      return { ...state, compare: action.slots.slice(0, 2) };
    case ActionType.OPEN_MISSIONS:
      return { ...state, view: 'missions', activeMissionId: null, drawerOpen: false, planetsOpen: false };
    case ActionType.OPEN_MISSION:
      return { ...state, view: 'missions', activeMissionId: action.id };
    case ActionType.CLOSE_MISSION:
      return { ...state, activeMissionId: null };
    case ActionType.OPEN_ABOUT:
      return { ...state, view: 'about', drawerOpen: false, planetsOpen: false };
    case ActionType.TOGGLE_ORBITS:
      return { ...state, showOrbits: !state.showOrbits };
    case ActionType.TOGGLE_LABELS:
      return { ...state, showLabels: !state.showLabels };
    case ActionType.SET_TIME_SCALE:
      return { ...state, timeScale: action.scale, paused: action.scale === 0 };
    case ActionType.SET_QUALITY:
      return { ...state, quality: action.quality, autoQuality: false };
    case ActionType.TOGGLE_SOUND:
      return { ...state, soundEnabled: !state.soundEnabled };
    case ActionType.SET_LOCALE:
      return { ...state, locale: action.locale };
    case ActionType.SET_SIMULATION_DATE:
      return { ...state, simulationDate: action.date };
    case ActionType.TOGGLE_TOUR:
      return { ...state, tourPlaying: !state.tourPlaying };
    case ActionType.SET_HELP:
      return { ...state, helpOpen: action.open };
    case ActionType.SET_CONTROL_MODE:
      return {
        ...state,
        controlMode: action.mode,
        // Hand control opens the readout; leaving it hides the preview with it.
        cameraVisible: action.mode === 'hand' ? state.cameraVisible : false,
      };
    case ActionType.TOGGLE_CAMERA:
      return { ...state, cameraVisible: !state.cameraVisible };
    /**
     * The Voyager Experience takes over the view.
     *
     * `timeScale` is zeroed because the departure is a *cinematic* sequence and drifting
     * planets would fight the shot; the previous speed is restored on exit by the caller,
     * which is also what makes it a non-destructive detour.
     */
    case ActionType.START_VOYAGE:
      return {
        ...state,
        voyage: { missionId: action.missionId ?? 'voyager-1', startedAt: action.startedAt ?? 0 },
        selectedId: null,
        view: 'explore',
        timeScale: 0,
        drawerOpen: false,
        planetsOpen: false,
      };
    case ActionType.END_VOYAGE:
      return { ...state, voyage: null, timeScale: state.timeScale === 0 ? 1 : state.timeScale };
    /**
     * Cosmic Scale stage. `null` returns to the normal solar-system presentation.
     *
     * Entering the ladder clears the selection: the panels describe bodies, and at Oort
     * Cloud range there is no body to describe.
     */
    case ActionType.SET_COSMIC_STAGE:
      return {
        ...state,
        cosmicStage: action.stage ?? null,
        selectedId: action.stage ? null : state.selectedId,
        view: action.stage ? 'explore' : state.view,
        drawerOpen: false,
        planetsOpen: false,
      };
    case ActionType.SET_DISTANCE_PAIR:
      return { ...state, distancePair: action.pair ?? null };
    default:
      return state;
  }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState, (base) => ({ ...base, ...readPreferences() }));
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside <StoreProvider>');
  return context;
}

/** Convenience selectors so components stay declarative. */
export function useSelected() {
  const { state } = useStore();
  return state.selectedId;
}
