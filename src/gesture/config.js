/**
 * Hand-gesture control configuration.
 *
 * Every threshold, smoothing factor and rate that shapes the gesture experience
 * lives here so the feel can be tuned without touching recognition or rendering
 * code. Values are deliberately conservative: the goal is a calm, cinematic
 * instrument, not a twitchy demo.
 */
export const GESTURE_CONFIG = {
  /** Recognition loop. The renderer keeps its own 60 fps loop regardless. */
  vision: {
    /** Target inference rate on desktop (frames per second). */
    detectionFps: 24,
    /** Inference rate on phones — half the work, same feel. */
    detectionFpsMobile: 15,
    /** Hard floor/ceiling applied after device detection. */
    minFps: 8,
    maxFps: 30,
  },

  /**
   * MediaPipe Hand Landmarker options. `numHands: 1` keeps inference cheap and
   * removes the ambiguity of which hand is driving.
   */
  model: {
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  },

  /** Where the vendored model and wasm runtime live (see tools/fetch-mediapipe.mjs). */
  assets: {
    modelPath: '/mediapipe/hand_landmarker.task',
    wasmPath: '/mediapipe/wasm',
  },

  /**
   * A pose must hold for `holdMs` and reach `confidence` before it becomes the
   * active gesture. This is what stops hand tremor from firing commands.
   */
  confidence: {
    /** Minimum pose score, 0–1, for a pose to be considered at all. */
    threshold: 0.7,
    /** How long a pose must hold before the gesture activates. */
    holdMs: 320,
    /** How long the absence of a pose must hold before the gesture clears. */
    releaseMs: 420,
  },

  /** Palm tracking: one-euro-style smoothing plus a dead zone. */
  pointer: {
    /** Smoothing time constant in seconds. Higher is calmer but laggier. */
    smoothing: 0.12,
    /** Pointer displacement below this many normalised units is ignored (jitter). */
    deadZone: 0.004,
    /** Maximum pointer travel per second, normalised units. */
    maxSpeed: 3.2,
  },

  /** Move-hand → orbit. Direct manipulation: hand travel maps to camera rotation. */
  orbit: {
    /** Degrees of orbit per normalised unit of hand travel. */
    degreesPerUnit: 220,
    /** Smoothing time constant for the orbit velocity, in seconds. */
    smoothing: 0.1,
    /** Orbit stops below this speed (degrees/second). */
    minSpeed: 0.4,
    /** Maximum orbit speed, degrees/second. */
    maxSpeed: 220,
  },

  /** Pinch → dolly. The pinch ratio drives speed, not absolute position. */
  zoom: {
    /** Ratio at or below which a pinch counts as fully closed. */
    closedRatio: 0.34,
    /** Ratio at or above which the hand counts as open for zoom purposes. */
    openRatio: 0.85,
    /** Peak dolly speed in scene units per second. */
    maxSpeed: 9,
    /** Speed below this is ignored (keeps a resting pinch still). */
    deadZone: 0.35,
    /** Smoothing time constant for the zoom speed, in seconds. */
    smoothing: 0.14,
  },

  /** Point → selection. The ray is tested against body hit proxies. */
  pointing: {
    /** Cursor must rest on a body for this long before it is treated as aimed. */
    dwellMs: 260,
    /** Normalised distance the fingertip may drift while still counting as aimed. */
    aimTolerance: 0.02,
    /**
     * Halo opacity while merely aimed. Kept low because the outline already marks the
     * target; a strong halo as well reads as a spotlight rather than a pointer.
     */
    aimHaloOpacity: 0.22,
  },

  /** Swipe → cycle bodies. */
  swipe: {
    /** Minimum palm travel, in normalised units, to count as a swipe. */
    distance: 0.14,
    /** Maximum duration of a swipe, in milliseconds. */
    maxDurationMs: 600,
    /**
     * Minimum speed, normalised units per second, measured on the *smoothed* pointer.
     * The pointer smoother (see `pointer.smoothing`) attenuates a fast hand by roughly
     * 40%, so this threshold has to sit below the raw hand speed to stay reachable —
     * at 0.55 a deliberate full-width swipe never registered.
     */
    minSpeed: 0.32,
    /** Ignore further swipes for this long. */
    cooldownMs: 700,
  },

  /** Fist → pause/resume. */
  fist: {
    /** Pause is a toggle, so it needs the strictest confirmation. */
    holdMs: 500,
    /** Ignore repeat toggles for this long. */
    cooldownMs: 900,
  },

  /** Cursor reticle shown while pointing. */
  cursor: {
    /** Radius in pixels of the thin ring. */
    radius: 15,
    /** Ring radius once a body is aimed at. */
    aimRadius: 22,
  },

  /** Debug aids. */
  debug: {
    /** Start with the camera preview hidden; the button reveals it. */
    showCameraByDefault: false,
    /** Draw the landmark skeleton over the preview when it is visible. */
    drawLandmarks: true,
  },
};

/** Landmark indices for the MediaPipe hand topology. */
export const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
};

/** Gesture identifiers shared by the recognizer, the controller and the UI. */
export const GESTURE = {
  NONE: 'none',
  OPEN_PALM: 'open_palm',
  PINCH: 'pinch',
  POINT: 'point',
  FIST: 'fist',
};

/** Human-readable labels for the UI. */
export const GESTURE_LABEL = {
  [GESTURE.NONE]: 'Searching',
  [GESTURE.OPEN_PALM]: 'Open Palm',
  [GESTURE.PINCH]: 'Pinch',
  [GESTURE.POINT]: 'Point',
  [GESTURE.FIST]: 'Fist',
};
