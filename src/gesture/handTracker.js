/**
 * HandTracker — camera acquisition and MediaPipe Hand Landmarker inference.
 *
 * Runs completely outside the render loop: inference is step-scheduled at a modest
 * rate (24 fps desktop, 15 fps mobile) and yields between frames, so the Three.js
 * loop stays at 60 fps. Nothing here touches React or the scene graph; it emits
 * landmark frames and the controller decides what they mean.
 *
 * The MediaPipe runtime is imported dynamically so a failure to load it (offline,
 * blocked wasm, old browser) degrades to "hand control unavailable" instead of
 * breaking the app.
 */

import { GESTURE_CONFIG } from './config.js';

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Reasons the tracker can refuse to start, surfaced to the UI. */
export const TRACKER_ERROR = {
  INSECURE: 'insecure-context',
  UNSUPPORTED: 'unsupported',
  PERMISSION: 'permission-denied',
  NO_CAMERA: 'no-camera',
  MODEL: 'model-load-failed',
  UNKNOWN: 'unknown',
};

export function describeTrackerError(code) {
  switch (code) {
    case TRACKER_ERROR.INSECURE:
      return 'Camera access needs HTTPS or localhost.';
    case TRACKER_ERROR.UNSUPPORTED:
      return 'This browser has no camera API.';
    case TRACKER_ERROR.PERMISSION:
      return 'Camera permission was declined.';
    case TRACKER_ERROR.NO_CAMERA:
      return 'No camera was found on this device.';
    case TRACKER_ERROR.MODEL:
      return 'The gesture model could not be loaded.';
    default:
      return 'The camera could not be started.';
  }
}

export class HandTracker {
  /**
   * @param {object} options
   * @param {(landmarks: Array|null, timestamp: number) => void} options.onFrame
   * @param {(code: string) => void} [options.onError]
   * @param {(status: object) => void} [options.onStatus]
   */
  constructor({ onFrame, onError, onStatus, config = GESTURE_CONFIG } = {}) {
    this.config = config;
    this.onFrame = onFrame;
    this.onError = onError;
    this.onStatus = onStatus;

    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.running = false;
    this.starting = false;
    this.frameHandle = null;
    this.videoFrameHandle = null;
    this.lastInferenceAt = 0;
    this.lastVideoTime = -1;
    this.fps = config.vision.detectionFps;
    this.inferenceMs = 0;
    this.handsDetected = 0;
    this._canvas = null;
    this._context = null;
    this._useVideoFrameCallback = false;
  }

  /** Effective detection rate for this device. */
  _detectionIntervalMs() {
    const isMobile =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(hover: none) and (pointer: coarse)').matches &&
      Math.min(window.innerWidth, window.innerHeight) < 900;
    const target = isMobile ? this.config.vision.detectionFpsMobile : this.config.vision.detectionFps;
    this.fps = Math.max(this.config.vision.minFps, Math.min(this.config.vision.maxFps, target));
    return 1000 / this.fps;
  }

  async start() {
    if (this.running || this.starting) return true;
    this.starting = true;
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        // getUserMedia is unavailable on insecure origins as well as old browsers.
        const insecure = typeof window !== 'undefined' && !window.isSecureContext;
        throw new TrackerStartError(insecure ? TRACKER_ERROR.INSECURE : TRACKER_ERROR.UNSUPPORTED);
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      this.stream = stream;

      this.video = document.createElement('video');
      this.video.playsInline = true;
      this.video.muted = true;
      this.video.autoplay = true;
      this.video.setAttribute('aria-hidden', 'true');
      this.video.srcObject = stream;
      // Keep it invisible by default; the debug window reparents it when shown.
      this.video.style.cssText =
        'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px';
      document.body.appendChild(this.video);
      await this.video.play();

      await this._loadLandmarker();

      this._useVideoFrameCallback = typeof this.video.requestVideoFrameCallback === 'function';
      this.running = true;
      this.starting = false;
      this.onStatus?.({ state: 'active', fps: this.fps });
      this._schedule();
      return true;
    } catch (error) {
      this.starting = false;
      const code =
        error instanceof TrackerStartError
          ? error.code
          : error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
            ? TRACKER_ERROR.PERMISSION
            : error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError'
              ? TRACKER_ERROR.NO_CAMERA
              : error?.code === TRACKER_ERROR.MODEL
                ? TRACKER_ERROR.MODEL
                : TRACKER_ERROR.UNKNOWN;
      await this.stop();
      this.onStatus?.({ state: 'error', code });
      this.onError?.(code);
      return false;
    }
  }

  async _loadLandmarker() {
    let vision;
    try {
      vision = await import('@mediapipe/tasks-vision');
    } catch (error) {
      throw new TrackerStartError(TRACKER_ERROR.MODEL);
    }

    const { FilesetResolver, HandLandmarker } = vision;
    const base = import.meta.env?.BASE_URL || '/';
    const wasmPath = `${base.replace(/\/$/, '')}${this.config.assets.wasmPath}`;
    const modelPath = `${base.replace(/\/$/, '')}${this.config.assets.modelPath}`;

    let fileset;
    try {
      fileset = await FilesetResolver.forVisionTasks(wasmPath);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
        ...this.config.model,
        runningMode: 'VIDEO',
      });
    } catch (gpuError) {
      // Some drivers refuse the GPU delegate; the CPU path is slower but works.
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
          ...this.config.model,
          runningMode: 'VIDEO',
        });
      } catch (cpuError) {
        throw new TrackerStartError(TRACKER_ERROR.MODEL);
      }
    }
  }

  /** Step-scheduled inference: one detection per interval, never a blocking loop. */
  _schedule() {
    if (!this.running) return;
    const interval = this._detectionIntervalMs();

    const step = (timestamp) => {
      if (!this.running) return;
      this._scheduleNext(step);
      this._maybeDetect(timestamp, interval);
    };
    this._scheduleNext(step);
  }

  _scheduleNext(step) {
    const video = this.video;
    if (this._useVideoFrameCallback && video?.requestVideoFrameCallback) {
      this.videoFrameHandle = video.requestVideoFrameCallback((now) => step(now));
    } else {
      this.frameHandle = requestAnimationFrame(step);
    }
  }

  _maybeDetect(timestamp, interval) {
    if (!this.landmarker || !this.video || this.video.readyState < 2) return;
    if (timestamp - this.lastInferenceAt < interval) return;
    // Never run inference on the same decoded frame twice.
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastInferenceAt = timestamp;
    this.lastVideoTime = this.video.currentTime;

    const started = performance.now();
    try {
      const result = this.landmarker.detectForVideo(this.video, timestamp);
      this.inferenceMs = performance.now() - started;
      const landmarks = result?.landmarks?.[0] || null;
      this.handsDetected = result?.landmarks?.length ?? 0;
      this.lastResult = result;
      this.onFrame?.(landmarks, timestamp);
    } catch (error) {
      // A single failed inference must not kill the session.
      this.inferenceMs = performance.now() - started;
      this.onFrame?.(null, timestamp);
    }
  }

  /** Latest raw landmarks, used by the debug preview to draw the skeleton. */
  get lastLandmarks() {
    return this.lastResult?.landmarks?.[0] || null;
  }

  get isRunning() {
    return this.running;
  }

  get isReady() {
    return Boolean(this.landmarker);
  }

  /** Mirror-corrected landmarks, for drawing over a mirrored preview. */
  get latestFrame() {
    const landmarks = this.lastLandmarks;
    if (!landmarks) return null;
    return landmarks.map((point) => ({ x: 1 - point.x, y: point.y, z: point.z ?? 0 }));
  }

  async stop() {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    if (this.videoFrameHandle && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.videoFrameHandle);
    }
    this.videoFrameHandle = null;

    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    // The landmarker keeps GPU resources; close it between sessions.
    try {
      this.landmarker?.close?.();
    } catch (error) {
      /* already closed */
    }
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.onStatus?.({ state: 'idle' });
  }

  dispose() {
    void this.stop();
  }
}

class TrackerStartError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export { HAND_CONNECTIONS, TrackerStartError };
