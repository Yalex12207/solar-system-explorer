/**
 * Hand pose recognition.
 *
 * Pure geometry: takes the 21 MediaPipe landmarks for one hand plus the timestamp
 * and returns smoothed control signals. No DOM, no model, no Three.js — which makes
 * it unit-testable (see tools/gesture-selftest.mjs) and keeps the per-frame cost
 * negligible.
 *
 * Coordinate convention: landmarks arrive normalised to 0–1 in *unmirrored video*
 * space. `toInputSpace()` flips x so the signals match what the user sees in a
 * mirror; everything downstream (cursor, orbit direction, swipe) uses that space.
 */

import { GESTURE, GESTURE_CONFIG, LANDMARK } from './config.js';

/** Exponential smoothing that is independent of frame rate. */
function smooth(previous, next, tau, deltaSeconds) {
  if (!Number.isFinite(previous)) return next;
  const alpha = 1 - Math.exp(-Math.max(1e-4, deltaSeconds) / Math.max(1e-4, tau));
  return previous + (next - previous) * alpha;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/** Landmark (0–1, unmirrored video) → mirror-corrected input space (0–1). */
export function toInputSpace(landmark) {
  return { x: 1 - landmark.x, y: landmark.y, z: landmark.z ?? 0 };
}

/**
 * Per-finger extension, as the straightness of the finger at its first joint.
 *
 * `extension = -cos(angle at PIP)` between the knuckle and the tip: +1 for a fully
 * straight finger, −1 for fully folded. Using an angle rather than a
 * tip-to-wrist distance matters because raw distances depend on finger length —
 * a long curled finger can sit further from the wrist than a short straight one,
 * which silently misclassifies whole hands.
 */
function fingerExtensions(landmarks) {
  const joints = [
    [LANDMARK.INDEX_MCP, LANDMARK.INDEX_PIP, LANDMARK.INDEX_TIP],
    [LANDMARK.MIDDLE_MCP, LANDMARK.MIDDLE_PIP, LANDMARK.MIDDLE_TIP],
    [LANDMARK.RING_MCP, LANDMARK.RING_PIP, LANDMARK.RING_TIP],
    [LANDMARK.PINKY_MCP, LANDMARK.PINKY_PIP, LANDMARK.PINKY_TIP],
  ];
  return joints.map(([mcpIndex, pipIndex, tipIndex]) => {
    const pip = landmarks[pipIndex];
    const toBase = {
      x: landmarks[mcpIndex].x - pip.x,
      y: landmarks[mcpIndex].y - pip.y,
      z: (landmarks[mcpIndex].z ?? 0) - (pip.z ?? 0),
    };
    const toTip = {
      x: landmarks[tipIndex].x - pip.x,
      y: landmarks[tipIndex].y - pip.y,
      z: (landmarks[tipIndex].z ?? 0) - (pip.z ?? 0),
    };
    const baseLength = Math.hypot(toBase.x, toBase.y, toBase.z) || 1e-6;
    const tipLength = Math.hypot(toTip.x, toTip.y, toTip.z) || 1e-6;
    const cosine =
      (toBase.x * toTip.x + toBase.y * toTip.y + toBase.z * toTip.z) / (baseLength * tipLength);
    // Straight (cosine −1) → +1; folded (cosine +1) → −1.
    return -Math.max(-1, Math.min(1, cosine));
  });
}

/**
 * Pose scores for one hand. Each value is 0–1 and they are not mutually exclusive
 * — the tracker decides which pose wins.
 */
export function scorePoses(landmarks) {
  const scale = Math.max(1e-5, distance(landmarks[LANDMARK.WRIST], landmarks[LANDMARK.MIDDLE_MCP]));
  const [index, middle, ring, pinky] = fingerExtensions(landmarks);
  const extension = { index, middle, ring, pinky };

  // Extension now lives in −1…+1. The ramps are generous but not saturating, so a
  // half-closed hand lands mid-scale and is refused by the confidence threshold
  // instead of being forced into the nearest pose.
  const openness = (value) => Math.min(1, Math.max(0, (value + 0.3) / 1.3));
  const curl = (value) => Math.min(1, Math.max(0, (0.45 - value) / 1.45));

  const extendedCount = [index, middle, ring, pinky].filter((value) => value > 0.1).length;

  // Thumb sits out to the side; compare its tip against the index knuckle line.
  const thumbSpread = distance(landmarks[LANDMARK.THUMB_TIP], landmarks[LANDMARK.INDEX_MCP]) / scale;

  const openPalm = Math.min(
    1,
    (extendedCount / 4) * 0.6 +
      ((openness(index) + openness(middle) + openness(ring) + openness(pinky)) / 4) * 0.4,
  );

  // The thumb is excluded from the fist score: across the back of a fist it is a
  // poor signal, and including it made an open hand read as a fist.
  const fist = Math.min(
    1,
    ((4 - extendedCount) / 4) * 0.72 + ((curl(index) + curl(middle) + curl(ring) + curl(pinky)) / 4) * 0.28,
  );

  // Pinch needs BOTH a closed thumb–index gap and a thumb that has stayed out of
  // the palm. Keying on the gap alone classified a fist as a pinch — in a fist the
  // thumb naturally lies across the index — which would have made closing a fist
  // zoom the camera instead of stopping time.
  const gap = distance(landmarks[LANDMARK.THUMB_TIP], landmarks[LANDMARK.INDEX_TIP]) / scale;
  const gapRatio = Math.min(1, Math.max(0, (gap - 0.12) / 0.55));
  const toIndexKnuckle = distance(landmarks[LANDMARK.THUMB_TIP], landmarks[LANDMARK.INDEX_MCP]);
  const toMiddleKnuckle = distance(landmarks[LANDMARK.THUMB_TIP], landmarks[LANDMARK.MIDDLE_MCP]);
  // Above ~1 the thumb tip is nearer the middle knuckle, i.e. folded across the hand.
  const thumbAcross = Math.min(1, Math.max(0, ((toMiddleKnuckle / Math.max(1e-5, toIndexKnuckle)) - 0.85) / 0.7));
  // A conviction threshold before the pose can fire at all; the final confidence is
  // scaled so a marginal read stays under the configured activation threshold.
  const pinchRaw = (1 - gapRatio) * (0.62 + (1 - thumbAcross) * 0.38);
  const pinch = pinchRaw < 0.55 ? pinchRaw * 0.8 : pinchRaw;

  // Point: index out, the rest folded in.
  const indexOut = openness(index);
  const othersIn = (curl(middle) + curl(ring) + curl(pinky)) / 3;
  const point = Math.min(1, indexOut * 0.68 + othersIn * 0.32);

  return { openPalm, fist, pinch, point, gapRatio, thumbAcross, extension, thumbSpread, scale };
}

/**
 * Stateful recognizer: turns a stream of landmark frames into stable gestures and
 * smoothed control values. One instance per hand-control session.
 */
export class GestureRecognizer {
  constructor(config = GESTURE_CONFIG) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.pointer = { x: NaN, y: NaN };
    this.palmVelocity = { x: 0, y: 0 };
    this.rawGesture = GESTURE.NONE;
    this.gesture = GESTURE.NONE;
    this.candidate = GESTURE.NONE;
    this.poseScores = null;
    this.gestureConfidence = 0;
    this.candidateSince = 0;
    this.clearSince = 0;
    this.pinchRatio = 1;
    this.pinchVelocity = 0;
    this.swipeHistory = [];
    this.lastSwipeAt = 0;
    this.lastSwipeDirection = 0;
    this.lastTimestamp = 0;
    this.landmarks = null;
    this.pointerDown = false;
  }

  /**
   * Feed one frame.
   *
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks unmirrored video space
   * @param {number} timestamp milliseconds
   * @returns {object} control frame for the controller layer
   */
  update(landmarks, timestamp) {
    const deltaSeconds = Math.min(0.25, Math.max(1 / 240, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;

    if (!landmarks || landmarks.length < 21) {
      this.landmarks = null;
      // Hold the last gesture briefly: a single dropped frame must not stop the
      // camera dead or cancel a rotation mid-move.
      if (this.gesture !== GESTURE.NONE) {
        if (this.clearSince === 0) this.clearSince = timestamp;
        else if (timestamp - this.clearSince > this.config.confidence.releaseMs) this._clearGesture();
      }
      this._decay(0);
      this.pointerDown = false;
      return this._frame(timestamp);
    }

    this.clearSince = 0;
    this.landmarks = landmarks.map(toInputSpace);

    const scores = scorePoses(this.landmarks);
    const orientation = this._orientation(this.landmarks);
    let swipeCandidate = null;

    // Raw pointer rides the palm centre so it is stable even while fingers move.
    const raw = {
      x: (this.landmarks[LANDMARK.WRIST].x * 2 + this.landmarks[LANDMARK.INDEX_MCP].x + this.landmarks[LANDMARK.PINKY_MCP].x) / 4,
      y: (this.landmarks[LANDMARK.WRIST].y * 2 + this.landmarks[LANDMARK.INDEX_MCP].y + this.landmarks[LANDMARK.PINKY_MCP].y) / 4,
    };

    const previous = { x: this.pointer.x, y: this.pointer.y };
    const pointerConfig = this.config.pointer;
    let sx = smooth(this.pointer.x, raw.x, pointerConfig.smoothing, deltaSeconds);
    let sy = smooth(this.pointer.y, raw.y, pointerConfig.smoothing, deltaSeconds);

    // Dead zone: ignore sub-pixel tremor, and cap travel so a fast hand cannot
    // teleport the camera.
    const maxStep = pointerConfig.maxSpeed * deltaSeconds;
    if (Number.isFinite(previous.x)) {
      let dx = sx - previous.x;
      let dy = sy - previous.y;
      if (Math.abs(dx) < pointerConfig.deadZone) dx = 0;
      if (Math.abs(dy) < pointerConfig.deadZone) dy = 0;
      const step = Math.hypot(dx, dy);
      if (step > maxStep) {
        dx = (dx / step) * maxStep;
        dy = (dy / step) * maxStep;
      }
      sx = previous.x + dx;
      sy = previous.y + dy;
    }

    const velocity = {
      x: (sx - previous.x) / deltaSeconds || 0,
      y: (sy - previous.y) / deltaSeconds || 0,
    };
    this.pointer = { x: sx, y: sy };
    this.palmVelocity = {
      x: smooth(this.palmVelocity.x, velocity.x, this.config.orbit.smoothing, deltaSeconds),
      y: smooth(this.palmVelocity.y, velocity.y, this.config.orbit.smoothing, deltaSeconds),
    };

    // Pinch ratio drives zoom speed continuously.
    const pinchTau = this.config.zoom.smoothing;
    const targetRatio = scores.gapRatio;
    this.pinchRatio = smooth(this.pinchRatio, targetRatio, pinchTau, deltaSeconds);
    const ratioVelocity = (targetRatio - this.pinchRatio) / deltaSeconds;
    this.pinchVelocity = smooth(this.pinchVelocity, ratioVelocity, pinchTau, deltaSeconds);

    this.rawGesture = this._pickPose(scores);
    this.gestureConfidence = Math.max(...Object.values({
      openPalm: scores.openPalm,
      fist: scores.fist,
      pinch: scores.pinch,
      point: scores.point,
    }));
    this.poseScores = scores;

    const swipe = this._detectSwipe(sx, timestamp);
    this._advanceGesture(this.rawGesture, timestamp);
    // A horizontal sweep only counts as a swipe from an open hand. Evaluated *after*
    // `_advanceGesture` so the test uses the current pose: checking it before meant a
    // stale recognition (for example a pinch that had just ended) silently suppressed
    // swipes for the rest of the session.
    if (this._swipeEligible()) swipeCandidate = swipe;
    this._decay(this.gesture === GESTURE.NONE ? 0 : 1);

    return this._frame(timestamp, {
      orientation,
      swipe: swipeCandidate,
      scores,
    });
  }

  /** Whether the current pose can carry a swipe. */
  _swipeEligible() {
    return (
      this.gesture === GESTURE.OPEN_PALM ||
      this.rawGesture === GESTURE.OPEN_PALM ||
      this.gesture === GESTURE.NONE
    );
  }

  /** Highest-scoring pose that clears the confidence threshold. */
  _pickPose(scores) {
    // Clamp defensively: a threshold above 1 (from a hand-edited config) would
    // silently make every gesture unreachable instead of failing loudly.
    const threshold = Math.min(1, Math.max(0, this.config.confidence.threshold));
    let best = GESTURE.NONE;
    let bestScore = threshold;
    for (const [gesture, score] of [
      [GESTURE.FIST, scores.fist],
      [GESTURE.PINCH, scores.pinch],
      [GESTURE.POINT, scores.point],
      [GESTURE.OPEN_PALM, scores.openPalm],
    ]) {
      if (score > bestScore) {
        best = gesture;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * Debounced gesture state machine.
   *
   * A pose must hold for `holdMs` before it activates, and a recognised gesture
   * must stay absent for `releaseMs` before it clears. Both directions matter: the
   * hold stops a hand passing through a pose from firing it, and the release stops
   * one dropped detection frame from cancelling an orbit mid-move.
   */
  _advanceGesture(raw, timestamp) {
    if (raw === this.gesture) {
      // Still confirmed: nothing to do, and keep the release timer disarmed.
      this.candidate = raw;
      return;
    }

    if (raw === GESTURE.NONE) {
      if (this.gesture === GESTURE.NONE) return;
      if (this.candidateSince === 0) {
        this.candidateSince = timestamp;
        return;
      }
      if (timestamp - this.candidateSince >= this.config.confidence.releaseMs) this._clearGesture();
      return;
    }

    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = timestamp;
      return;
    }

    const hold = raw === GESTURE.FIST ? this.config.fist.holdMs : this.config.confidence.holdMs;
    if (timestamp - this.candidateSince >= hold) {
      this.gesture = raw;
      this.gestureConfidence = this._scoreFor(raw);
      // Arm the release timer so an immediate dropout is tolerated.
      this.candidateSince = timestamp;
    }
  }

  _scoreFor(gesture) {
    const scores = this.poseScores;
    if (!scores) return 0;
    switch (gesture) {
      case GESTURE.OPEN_PALM:
        return scores.openPalm;
      case GESTURE.FIST:
        return scores.fist;
      case GESTURE.PINCH:
        return scores.pinch;
      case GESTURE.POINT:
        return scores.point;
      default:
        return 0;
    }
  }

  _clearGesture() {
    this.gesture = GESTURE.NONE;
    this.candidate = GESTURE.NONE;
    this.gestureConfidence = 0;
    this.candidateSince = 0;
    this.pinchVelocity = 0;
  }

  _decay(active) {
    if (!active) {
      this.palmVelocity = {
        x: smooth(this.palmVelocity.x, 0, this.config.orbit.smoothing, 1 / 30),
        y: smooth(this.palmVelocity.y, 0, this.config.orbit.smoothing, 1 / 30),
      };
    }
  }

  /** Palm plane normal, used to gate pointing (a sideways hand should not select). */
  _orientation(landmarks) {
    const wrist = landmarks[LANDMARK.WRIST];
    const indexBase = landmarks[LANDMARK.INDEX_MCP];
    const pinkyBase = landmarks[LANDMARK.PINKY_MCP];
    const middleBase = landmarks[LANDMARK.MIDDLE_MCP];
    const across = { x: indexBase.x - pinkyBase.x, y: indexBase.y - pinkyBase.y, z: indexBase.z - pinkyBase.z };
    const along = { x: middleBase.x - wrist.x, y: middleBase.y - wrist.y, z: middleBase.z - wrist.z };
    const normal = normalize(cross(across, along));
    // Facing the camera when |z| dominates: the palm plane is parallel to the screen.
    const facing = Math.min(1, Math.abs(normal.z) / 0.55);
    return { normal, facing, rotation: Math.atan2(normal.y, normal.x) };
  }

  /**
   * Swipe: a fast, mostly horizontal palm traverse. Recorded on every frame and
   * evaluated as a window so slow drags never register.
   */
  _detectSwipe(x, timestamp) {
    const config = this.config.swipe;
    this.swipeHistory.push({ x, t: timestamp });
    while (this.swipeHistory.length && timestamp - this.swipeHistory[0].t > config.maxDurationMs) {
      this.swipeHistory.shift();
    }
    if (timestamp - this.lastSwipeAt < config.cooldownMs) return null;
    if (this.swipeHistory.length < 3) return null;

    const first = this.swipeHistory[0];
    const travel = x - first.x;
    const elapsed = (timestamp - first.t) / 1000;
    if (elapsed <= 0) return null;
    const speed = Math.abs(travel) / elapsed;
    if (Math.abs(travel) < config.distance || speed < config.minSpeed) return null;

    this.swipeHistory = [];
    this.lastSwipeAt = timestamp;
    this.lastSwipeDirection = Math.sign(travel);
    return { direction: Math.sign(travel), travel, speed };
  }

  _frame(timestamp, extra = {}) {
    const zoom = this.config.zoom;
    const range = Math.max(1e-4, zoom.openRatio - zoom.closedRatio);
    // -1 fully closed (zoom in), +1 fully open (zoom out).
    const pinchAmount = ((this.pinchRatio - zoom.closedRatio) / range) * 2 - 1;
    let pinchSpeed = 0;
    if (this.gesture === GESTURE.PINCH) {
      pinchSpeed = Math.max(-1, Math.min(1, pinchAmount));
      if (Math.abs(pinchSpeed) * zoom.maxSpeed < zoom.deadZone) pinchSpeed = 0;
    }

    return {
      gesture: this.gesture,
      rawGesture: this.rawGesture,
      confidence: this.gestureConfidence,
      pointer: { ...this.pointer },
      palmVelocity: { ...this.palmVelocity },
      pinchRatio: this.pinchRatio,
      /** −1 zoom in … +1 zoom out, 0 when not pinching. */
      zoomAmount: pinchSpeed,
      landmarks: this.landmarks,
      poses: extra.scores || null,
      orientation: extra.orientation || null,
      swipe: extra.swipe || null,
      hasHand: Boolean(this.landmarks),
      timestamp,
    };
  }
}

/** Exported for the self-test harness. */
export const internals = { fingerExtensions, distance, cross, normalize };
