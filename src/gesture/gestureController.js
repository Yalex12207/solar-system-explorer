/**
 * GestureController — the bridge between recognised hand poses and the scene.
 *
 * Two rates meet here: recognition runs at 15–24 fps, rendering at 60 fps. Every
 * continuous signal is therefore stored as a target *velocity* by the frame
 * handler and drained smoothly by `update()` on every rendered frame. That is what
 * makes a 24 fps hand feel like a 60 fps camera, and it is also the load-bearing
 * part of the anti-jitter story alongside the recognizer's smoothing and debounce.
 *
 * Discrete events (swipe, fist, point-aim) use explicit confirmation windows and
 * cooldowns so a single hand gesture fires exactly once.
 */

import { GESTURE, GESTURE_CONFIG } from './config.js';

function damp(current, target, tau, delta) {
  if (!Number.isFinite(current)) return target;
  return current + (target - current) * (1 - Math.exp(-Math.max(1e-4, delta) / Math.max(1e-4, tau)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class GestureController {
  /**
   * @param {object} handlers
   * @param {(deltaX:number, deltaY:number) => void} handlers.orbit  degrees to rotate
   * @param {(amount:number) => void} handlers.zoom                  −1 in … +1 out
   * @param {(id:string|null, screen:{x:number,y:number}|null) => void} handlers.aim
   * @param {(id:string|null) => void} handlers.select
   * @param {(direction:number) => void} handlers.swipe
   * @param {() => void} handlers.togglePause
   * @param {(node:{id:string,name:string}|null) => void} handlers.hover
   */
  constructor(handlers = {}, config = GESTURE_CONFIG) {
    this.handlers = handlers;
    this.config = config;

    /** Drained every rendered frame. */
    this.orbitVelocity = { x: 0, y: 0 };
    this.orbitTarget = { x: 0, y: 0 };
    this.zoomTarget = 0;

    /** Pointer state, interpolated for display. */
    this.pointer = { x: 0.5, y: 0.5 };
    this.pointerTarget = { x: 0.5, y: 0.5 };

    this.gesture = GESTURE.NONE;
    this.confidence = 0;
    this.hasHand = false;
    this.detectionFps = 0;
    this.inferenceMs = 0;

    /** Aim state. */
    this.aimedId = null;
    this.aimedName = null;
    this.aimStartedAt = 0;
    this.aimAnchor = null;
    this.aimConfirmed = false;

    this.lastFrameAt = 0;
    this.fpsWindow = [];

    /** Set while a fist pause is in effect so the UI can show it. */
    this.paused = false;
    /** Latches the fist so one closing fires exactly one toggle. */
    this.fistLatched = false;
  }

  /** Recognition rate, for the status readout. */
  _trackFps(timestamp) {
    if (this.lastFrameAt) {
      const delta = timestamp - this.lastFrameAt;
      if (delta > 0 && delta < 500) {
        this.fpsWindow.push(1000 / delta);
        if (this.fpsWindow.length > 24) this.fpsWindow.shift();
      }
    }
    this.lastFrameAt = timestamp;
    if (this.fpsWindow.length) {
      this.detectionFps = this.fpsWindow.reduce((sum, value) => sum + value, 0) / this.fpsWindow.length;
    }
  }

  /**
   * One recognition frame. Called from the tracker at 15–24 fps.
   * @param {object} frame produced by GestureRecognizer.update
   */
  handleFrame(frame) {
    this._trackFps(frame.timestamp);
    this.hasHand = frame.hasHand;
    this.gesture = frame.gesture;
    this.confidence = frame.confidence;

    // Pointer always tracks the palm so the reticle feels alive even mid-gesture.
    if (frame.hasHand && frame.pointer && Number.isFinite(frame.pointer.x)) {
      this.pointerTarget = { x: frame.pointer.x, y: frame.pointer.y };
    }

    // ——— continuous: orbit ————————————————————————————————————————
    // Move hand rotates the system. Direction matches the mirror view: moving the
    // hand left turns the system left.
    if (frame.gesture === GESTURE.OPEN_PALM && frame.palmVelocity) {
      const speed = Math.hypot(frame.palmVelocity.x, frame.palmVelocity.y);
      const scaled = speed < 0.02 ? 0 : Math.min(this.config.orbit.maxSpeed, speed * this.config.orbit.degreesPerUnit);
      if (scaled === 0) {
        this.orbitTarget = { x: 0, y: 0 };
      } else {
        const unitX = frame.palmVelocity.x / speed;
        const unitY = frame.palmVelocity.y / speed;
        this.orbitTarget = { x: unitX * scaled, y: unitY * scaled };
      }
    } else {
      this.orbitTarget = { x: 0, y: 0 };
    }

    // ——— continuous: pinch zoom ————————————————————————————————————
    this.zoomTarget = frame.zoomAmount || 0;

    // ——— discrete: swipe cycles bodies ————————————————————————————
    if (frame.swipe) {
      this.handlers.swipe?.(frame.swipe.direction);
    }

    // ——— discrete: fist toggles the simulation ————————————————————
    // Latched: the fist fires once when it closes and must open before it can fire
    // again. A cooldown alone was not enough — holding a fist re-toggled the pause,
    // which read as "time keeps flickering".
    if (frame.gesture === GESTURE.FIST && frame.confidence >= this.config.confidence.threshold) {
      const now = frame.timestamp;
      const ready = now - (this.lastFistAt || 0) > this.config.fist.cooldownMs;
      if (!this.fistLatched && ready) {
        this.fistLatched = true;
        this.lastFistAt = now;
        this.paused = !this.paused;
        this.handlers.togglePause?.(this.paused);
      }
    } else if (frame.gesture !== GESTURE.FIST) {
      // Any other gesture (or none) releases the latch.
      this.fistLatched = false;
    }

    // ——— pointing: aim, dwell, then lock ——————————————————————————
    if (frame.gesture === GESTURE.POINT && frame.landmarks) {
      this._updateAim(frame);
    } else if (this.aimedId) {
      this._clearAim();
    }
  }

  /**
   * Aim uses the index fingertip rather than the palm: that is what the user is
   * pointing with. The cursor must rest within `aimTolerance` for `dwellMs` before
   * the body locks, which prevents sweeping the hand past a planet from selecting it.
   */
  _updateAim(frame) {
    const tip = frame.landmarks[8];
    if (!tip) return;
    const now = frame.timestamp;

    const hit = this.handlers.pick?.(tip.x, tip.y);

    if (!hit) {
      // The finger is on empty space: keep the reticle but drop the lock.
      this.handlers.aim?.(null, { x: tip.x, y: tip.y });
      if (this.aimedId) this._clearAim();
      this.aimAnchor = { x: tip.x, y: tip.y };
      return;
    }

    const drifted =
      !this.aimAnchor ||
      Math.hypot(tip.x - this.aimAnchor.x, tip.y - this.aimAnchor.y) > this.config.pointing.aimTolerance;

    if (hit.id !== this.aimedId || drifted) {
      this.aimedId = hit.id;
      this.aimedName = hit.name;
      this.aimAnchor = { x: tip.x, y: tip.y };
      this.aimStartedAt = now;
      this.aimConfirmed = false;
    } else if (!this.aimConfirmed && now - this.aimStartedAt >= this.config.pointing.dwellMs) {
      this.aimConfirmed = true;
      this.handlers.select?.(this.aimedId);
    }

    this.handlers.aim?.(this.aimedId, { x: tip.x, y: tip.y });
    this.handlers.hover?.(this.aimedId);
  }

  _clearAim() {
    this.aimedId = null;
    this.aimedName = null;
    this.aimConfirmed = false;
    this.aimAnchor = null;
    this.handlers.hover?.(null);
  }

  /**
   * Every rendered frame. Drains the velocity targets and returns the increments
   * the camera rig should apply this frame.
   *
   * @param {number} delta seconds since the previous rendered frame
   */
  update(delta) {
    const clamped = Math.min(0.05, Math.max(0, delta));

    this.orbitVelocity = {
      x: damp(this.orbitVelocity.x, this.orbitTarget.x, this.config.orbit.smoothing, clamped),
      y: damp(this.orbitVelocity.y, this.orbitTarget.y, this.config.orbit.smoothing, clamped),
    };
    if (Math.abs(this.orbitVelocity.x) < this.config.orbit.minSpeed) this.orbitVelocity.x = 0;
    if (Math.abs(this.orbitVelocity.y) < this.config.orbit.minSpeed) this.orbitVelocity.y = 0;

    const zoomLinear = this.zoomTarget * this.config.zoom.maxSpeed;
    this.zoomVelocity = damp(this.zoomVelocity || 0, zoomLinear, this.config.zoom.smoothing, clamped);
    if (Math.abs(this.zoomVelocity) < this.config.zoom.deadZone) this.zoomVelocity = 0;

    // Pointer interpolation keeps the reticle smooth between slow inference frames.
    this.pointer = {
      x: damp(this.pointer.x, this.pointerTarget.x, this.config.pointer.smoothing, clamped),
      y: damp(this.pointer.y, this.pointerTarget.y, this.config.pointer.smoothing, clamped),
    };

    return {
      orbitX: this.orbitVelocity.x * clamped,
      orbitY: this.orbitVelocity.y * clamped,
      zoom: this.zoomVelocity * clamped,
      pointer: this.pointer,
      gesture: this.gesture,
    };
  }

  /** Status snapshot for the gesture UI. */
  get status() {
    return {
      gesture: this.gesture,
      confidence: this.confidence,
      hasHand: this.hasHand,
      detectionFps: this.detectionFps,
      inferenceMs: this.inferenceMs,
      aimedId: this.aimedId,
      aimedName: this.aimedName,
      paused: this.paused,
    };
  }

  reset() {
    this.orbitTarget = { x: 0, y: 0 };
    this.orbitVelocity = { x: 0, y: 0 };
    this.zoomTarget = 0;
    this.zoomVelocity = 0;
    this.gesture = GESTURE.NONE;
    this.hasHand = false;
    this.fistLatched = false;
    this.fpsWindow = [];
    this.lastFrameAt = 0;
    this._clearAim();
  }
}
