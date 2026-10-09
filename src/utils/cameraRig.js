/**
 * CameraRig — smooth camera choreography on top of OrbitControls.
 *
 * Responsibilities:
 *  - free exploration (drag to orbit, wheel/pinch to zoom, two-finger pan)
 *  - `focus(id)`    : eased flight that frames a body and then keeps tracking it
 *  - `frameSystem()`: eased return to the wide establishing shot
 *  - cinematic orbit once a body has settled in frame
 *  - `tour(ids)`    : a slow automated pass across several bodies (scroll story)
 *
 * Flights interpolate the pivot and the orbital radius directly instead of
 * lerping the camera position, because OrbitControls' own `clampDistance` runs
 * after every frame and would otherwise pin the camera to `maxDistance`.
 *
 * All transitions use damped easing derived from a time constant, so they behave
 * identically at 30, 60 or 144 fps instead of being frame-rate dependent.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const _targetPosition = new THREE.Vector3();
const _offset = new THREE.Vector3();
/** Reusable basis vectors for screen-space focus bias. */
const _biasRight = new THREE.Vector3();
const _biasUp = new THREE.Vector3();
/** Scratch direction from the focused body toward the Sun. */
const _viewDirection = new THREE.Vector3();

/** Exponential damping that is independent of frame rate. */
function damp(current, target, lambda, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * delta));
}

export class CameraRig {
  constructor({ camera, domElement, getBodyPosition, getBodyRadius }) {
    this.camera = camera;
    this.getBodyPosition = getBodyPosition;
    this.getBodyRadius = getBodyRadius;

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.85;
    this.controls.panSpeed = 0.6;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 420;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.autoRotateSpeed = 0.42;

    this.mode = 'system';
    this.focusId = null;
    this.focusDistance = 60;
    this.focusLambda = 1.9;
    this.tracking = false;
    this.autoOrbit = true;
    this.lastInteraction = performance.now();
    this.tourQueue = [];
    this.tourTimer = 0;

    // Any direct user input takes over from the automation.
    const markInteraction = () => {
      this.lastInteraction = performance.now();
      this.controls.autoRotate = false;
      if (this.mode === 'focus') this.focusLambda = 2.6; // snappier follow while steering
    };
    domElement.addEventListener('pointerdown', markInteraction);
    domElement.addEventListener('wheel', markInteraction, { passive: true });
    this._markInteraction = markInteraction;
    this._domElement = domElement;

    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  get isTransitioning() {
    return this.mode === 'transition';
  }

  /** Eased flight to a body. `distanceMultiplier` frames it tighter or wider. */
  focus(id, { distanceMultiplier = 1, duration = 1.25, autoOrbit = true, bias = null } = {}) {
    const radius = this.getBodyRadius(id);
    const distance = THREE.MathUtils.clamp(radius * 3.4 * distanceMultiplier, 1.5, 320);
    this.focusId = id;
    this.focusDistance = distance;
    // Damping is derived from the requested duration so a 1s hop and a 2s glide
    // converge in roughly the time asked for, at any frame rate.
    this.focusLambda = 3.2 / Math.max(0.35, duration);
    this.tracking = false;
    this.autoOrbit = autoOrbit;
    this.mode = 'transition';
    // Screen-space shift so the body frames in the open area beside the detail panel
    // instead of centring under it. Null clears any previous bias.
    this.focusBias = bias;
    /**
     * How far to turn toward the Sun–body axis, 0..1.
     *
     * Partial on purpose: 1 would place the camera exactly on that axis with the Sun
     * directly behind the subject, which fills the frame with the Sun.
     */
    this.orientBias = 0.16;
    // The limits must accommodate the journey, not just the destination: clamping
    // maxDistance to the focus distance strands the camera at the wide shot.
    const current = this.camera.position.distanceTo(this.controls.target);
    this.controls.minDistance = Math.max(0.35, radius * 1.2);
    this.controls.maxDistance = Math.max(current * 1.3, distance * 1.6, 24);
    this.tourQueue = [];
  }

  /**
   * Voyager Experience: leave the solar system.
   *
   * A pure *departure* rather than a target to fly to. Ordinary easing is wrong here for
   * two reasons:
   *
   *  - exponential damping (`damp`) would approach the destination asymptotically, so the
   *    System would never actually read as a point of light;
   *  - a fixed duration cannot honour the brief's "very restrained" pacing, because the
   *    viewer should feel the departure *ease in* and then coast.
   *
   * So this re-parameterises time by distance: the camera's distance from the Sun is a
   * function of elapsed time, `cruise * t^k`, which starts from rest, accelerates into a
   * coast, and is then softened near the end. The viewing direction is held fixed — the
   * shot is the solar system receding, not a turning camera.
   *
   * @param {object} options
   * @param {number} options.duration seconds for the whole departure
   * @param {number} options.cruise   scene units of distance at `t = duration`
   * @param {number} options.power    coast exponent; 2 is a gentle launch
   */
  voyage({ duration = 11, cruise = 4200, power = 2 } = {}) {
    this.mode = 'escape';
    this.focusId = null;
    this.tracking = false;
    this.autoOrbit = false;
    this.focusBias = null;
    this._voyageElapsed = 0;
    this._voyageDuration = Math.max(1, duration);
    this._voyageCruise = Math.max(1, cruise);
    this._voyagePower = power;
    this._voyageComplete = false;

    const origin = this.controls.target.clone();
    if (origin.lengthSq() < 1e-6) origin.set(0, 0, 0);
    this._voyageOrigin = origin;

    // Freeze the direction of travel: outward along the current view ray.
    _offset.copy(this.camera.position).sub(origin);
    this._voyageStart = _offset.length();
    if (this._voyageStart < 1e-4) {
      _offset.set(0, 0.35, 1);
      this._voyageStart = 1e-4;
    }
    this._voyageDirection = _offset.clone().normalize();

    /** Current distance from the departure origin, for the scene's depth-compensation. */
    this.voyageDistance = this._voyageStart;

    // OrbitControls must not clamp the departure away.
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = this._voyageCruise * 1.2;
    this.controls.autoRotate = false;
    this.tourQueue = [];
  }

  /** True once the departure has reached its destination. */
  get voyageComplete() {
    return this.mode === 'escape' && this._voyageComplete;
  }

  /** Departure progress, 0–1. Zero when not departing. */
  get voyageProgress() {
    if (this.mode !== 'escape') return 0;
    return Math.min(1, this._voyageElapsed / this._voyageDuration);
  }

  /**
   * Cosmic Scale: fly the camera to a ladder stage.
   *
   * Each stage is a *framing* rather than a physical destination, because the real
   * distances span twelve orders of magnitude and no single camera can hold them. The
   * camera still moves along its current viewing ray — so the subject stays put and the
   * viewer feels the pull-back — while the presentation scales by `reference / distance`.
   *
   * The transition is an eased flight in log-distance rather than linear distance. Linear
   * interpolation between 3.4 and 1500 units spends almost the whole duration in the last
   * few percent, which reads as a jump; interpolating the exponent gives the even, quiet
   * recession the brief asks for.
   *
   * @param {object} options
   * @param {number} options.distance  camera separation at the destination
   * @param {number} options.duration  seconds
   * @param {string} options.stage     stage id, echoed for the scene's layer fades
   */
  cosmic({ distance = 78, duration = 2, stage = null } = {}) {
    const target = Math.max(0.5, distance);
    this.mode = 'cosmic';
    this.focusId = null;
    this.tracking = false;
    this.autoOrbit = false;
    this.focusBias = null;
    this.cosmicStage = stage;

    // Freeze the direction of travel, as the voyage does.
    const origin = this.controls.target.clone();
    if (origin.lengthSq() < 1e-6) origin.set(0, 0, 0);
    this._cosmicOrigin = origin;
    _offset.copy(this.camera.position).sub(origin);
    const start = _offset.length();
    this._cosmicDirection = start > 1e-4 ? _offset.clone().normalize() : new THREE.Vector3(0, 0.3, 1).normalize();
    this._cosmicStart = Math.max(0.5, start);
    this._cosmicTarget = target;
    this._cosmicDuration = Math.max(0.3, duration);
    this._cosmicElapsed = 0;
    this._cosmicLambda = 3.2 / this._cosmicDuration;

    // The whole span must be reachable, and nothing may clamp it back.
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = Math.max(this._cosmicStart, target) * 2.5;
    this.controls.autoRotate = false;
    this.tourQueue = [];
  }

  /**
   * Cosmic-stage transition progress, 0–1.
   *
   * Reports 1 whenever a stage is not mid-flight. Reading `_cosmicElapsed / duration` alone
   * returned 0 after a flight settled into free look (the mode has left `cosmic`), which left
   * every layer fade frozen at its start value — the galaxy stayed at zero opacity even
   * though the camera had arrived.
   */
  get cosmicProgress() {
    if (this.mode !== 'cosmic') return 1;
    return Math.min(1, this._cosmicElapsed / this._cosmicDuration);
  }

  /** Current separation from the cosmic origin, measured rather than cached. */
  get cosmicDistance() {
    if (this.mode === 'cosmic') return this.camera.position.distanceTo(this.controls.target);
    return this.camera.position.distanceTo(this.controls.target);
  }

  /**
   * Shift the framed subject sideways by a fraction of the viewport.
   *
   * `x` is an NDC offset (-1..1); positive moves the subject toward screen right, which
   * is what makes room for a left-hand HUD, and a negative value moves it left to clear
   * a right-hand panel.
   *
   * Only the *camera* is displaced, never the pivot. Moving both would leave the
   * framing unchanged (the view direction and target move together); moving the pivot
   * instead would accumulate, because the focus branch re-derives the camera from
   * `target + direction * distance` every frame and the subject would fly off screen.
   * Displacing the camera against a fixed pivot is exactly a screen-space shift, and it
   * is recomputed from scratch each frame so it cannot compound.
   */
  _applyFocusBias() {
    const bias = this.focusBias;
    if (!bias || (!bias.x && !bias.y)) return;
    const controls = this.controls;
    const distance = this.camera.position.distanceTo(controls.target);
    if (!Number.isFinite(distance) || distance < 1e-4) return;
    // World units per NDC unit at the current distance. Every term is guarded: this
    // runs inside the render loop, and a non-finite aspect (before the first resize)
    // would otherwise poison the camera position permanently.
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * distance;
    const halfWidth = halfHeight * this.camera.aspect;
    const offsetX = (bias.x || 0) * halfWidth;
    const offsetY = (bias.y || 0) * halfHeight;
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
    _biasRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    _biasUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
    if (_biasRight.lengthSq() < 1e-12 || _biasUp.lengthSq() < 1e-12) return;
    _biasRight.normalize();
    _biasUp.normalize();
    this.camera.position.addScaledVector(_biasRight, offsetX);
    this.camera.position.addScaledVector(_biasUp, offsetY);
  }

  /** Eased return to the wide shot. */
  frameSystem({ duration = 1.6, distance = 78 } = {}) {
    this.mode = 'transition';
    this.focusId = null;
    this.tracking = false;
    this.focusLambda = 1.6 / Math.max(0.4, duration);
    this.systemDistance = distance;
    const current = this.camera.position.distanceTo(this.controls.target);
    this.controls.minDistance = 8;
    this.controls.maxDistance = Math.max(current * 1.3, distance * 1.4, 120);
    this.autoOrbit = true;
    this.tourQueue = [];
  }

  /** Slow automated pass: [{ id, hold }] with an eased hop between each. */
  tour(stops) {
    this.tourQueue = [...stops];
    this.tourTimer = 0;
    if (this.tourQueue.length) {
      const next = this.tourQueue.shift();
      this.focus(next.id, { distanceMultiplier: next.multiplier ?? 1, duration: 1.4 });
    }
  }

  cancelTour() {
    this.tourQueue = [];
  }

  setAutoOrbit(enabled) {
    this.autoOrbit = enabled;
  }

  /**
   * Gesture / programmatic orbit.
   *
   * Degrees of rotation to apply this frame. Rather than reaching into OrbitControls'
   * private rotate helpers (the public `rotate`/`rotateLeft` methods no longer exist
   * in three r169), this seeds the same delta inputs that pointer dragging feeds, so
   * OrbitControls' own damping shapes the motion and gesture nudges compose with mouse
   * dragging instead of fighting the internal spherical state.
   *
   * `update()` calls `updateDelta()` internally, which is what consumes the seed, so
   * this must not call it directly.
   */
  orbitBy(degreesX, degreesY) {
    if (!degreesX && !degreesY) return;
    if (this.mode === 'transition' || this.mode === 'focus') {
      // Keep tracking the focused body; a hand on the system outranks a camera move.
      this.tracking = true;
    }
    this.lastInteraction = performance.now();
    const azimuth = THREE.MathUtils.degToRad(degreesY);
    const polar = THREE.MathUtils.degToRad(degreesX);
    // Mirror a drag: moving the hand right turns the system left.
    this.controls._sphericalDelta.theta += -azimuth;
    this.controls._sphericalDelta.phi += -polar;
  }

  /**
   * Gesture / programmatic dolly. `amount` is scene units along the current view
   * direction; positive moves away from the target.
   *
   * Applied to the camera position directly and then re-clamped by OrbitControls on
   * the next update, which keeps it consistent with wheel zoom.
   */
  dollyBy(amount) {
    if (!amount) return;
    this.lastInteraction = performance.now();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = offset.length() || 1;
    const next = THREE.MathUtils.clamp(distance + amount, this.controls.minDistance, this.controls.maxDistance);
    offset.setLength(next);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  /** True while a scripted flight is still settling. */
  get isFlying() {
    return this.mode === 'transition';
  }

  /** Temporarily stop auto-rotation (used while the user reads a panel). */
  pauseAutoOrbit() {
    this.controls.autoRotate = false;
  }

  /**
   * Rotate the camera around the pivot toward `_viewDirection`, in place.
   *
   * Sets the camera position directly rather than going through OrbitControls, so the
   * whole operation is cancelled by wrapping it: any drag delta the user produced this
   * frame is stashed, the internal delta is zeroed for the duration of `run()`, and the
   * stash is restored afterwards. That guarantees this can never fight a drag.
   */
  _withManualControlSuspended(run) {
    const spherical = this.controls._sphericalDelta;
    const savedTheta = spherical.theta;
    const savedPhi = spherical.phi;
    const manual = savedTheta !== 0 || savedPhi !== 0;
    if (manual) {
      spherical.theta = 0;
      spherical.phi = 0;
    }
    try {
      run();
    } finally {
      if (manual) {
        spherical.theta = savedTheta;
        spherical.phi = savedPhi;
      }
    }
  }

  /**
   * Ease the camera's orbital direction toward `_viewDirection` (a unit vector from the
   * body toward the Sun).
   *
   * Focus mode otherwise preserves whatever angle the previous shot left behind, which
   * regularly puts the camera on the night side of the body it just flew to. Turning
   * partway toward the lit hemisphere is the "最终自动调整观察方向" part of the brief.
   *
   * The correction is deliberately *partial*: rotating all the way onto the Sun vector
   * points the camera straight down the Sun–body axis, which puts the Sun directly
   * behind the subject and lets its disc swallow the frame. Converging to a fixed
   * angle off that axis keeps the body lit and keeps the Sun out of the shot.
   */
  _orientTowardSun(delta) {
    const controls = this.controls;
    _offset.copy(this.camera.position).sub(controls.target);
    const distance = _offset.length();
    if (!Number.isFinite(distance) || distance < 1e-4) return;
    if (!Number.isFinite(_viewDirection.x) || _viewDirection.lengthSq() < 1e-12) return;

    // Current direction in the orbit's own spherical coordinates (azimuth, polar).
    const currentTheta = Math.atan2(_offset.x, _offset.z);
    const currentPhi = Math.acos(THREE.MathUtils.clamp(_offset.y / distance, -1, 1));

    const targetTheta = Math.atan2(_viewDirection.x, _viewDirection.z);
    const targetPhi = Math.acos(THREE.MathUtils.clamp(_viewDirection.y, -1, 1));

    // Take the short way around.
    let deltaTheta = targetTheta - currentTheta;
    if (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
    if (deltaTheta < -Math.PI) deltaTheta += Math.PI * 2;

    // Slow enough to read as a camera move rather than a spin.
    const lambda = 1.1;
    const step = (1 - Math.exp(-lambda * delta)) * this.orientBias;
    const theta = currentTheta + deltaTheta * step;
    const phi = THREE.MathUtils.clamp(currentPhi + (targetPhi - currentPhi) * step, 0.05, Math.PI - 0.05);

    _offset.setFromSphericalCoords(distance, phi, theta);
    this.camera.position.copy(controls.target).add(_offset);
  }

  update(delta) {
    const idle = performance.now() - this.lastInteraction;
    const controls = this.controls;

    if (this.mode === 'focus' || this.mode === 'transition') {
      const id = this.focusId;
      this.getBodyPosition(id, _targetPosition);
      const lambda = this.focusLambda;

      // Preserve the viewing angle the user (or the previous shot) established:
      // only the pivot and the radius animate, never the orbital direction.
      _offset.copy(this.camera.position).sub(controls.target);
      const currentDistance = _offset.length() || this.focusDistance;
      if (currentDistance > 1e-4) _offset.multiplyScalar(1 / currentDistance);

      const distance = damp(currentDistance, this.focusDistance, lambda, delta);

      /**
       * Keep OrbitControls out of the pilot's seat.
       *
       * `focusDistance` is the *destination*, but the clamp has to admit the journey:
       * when focus() is called from the wide shot the camera is far outside it, and a
       * maxDistance derived only from the destination pinned the camera at the old
       * distance — the flight silently never arrived. The clamp therefore always admits
       * the current distance while the camera flies inward, and collapses to the
       * destination once the shot has settled.
       */
      controls.maxDistance = Math.max(currentDistance, distance, this.focusDistance * 1.25);

      if (this.mode === 'transition') {
        controls.target.lerp(_targetPosition, 1 - Math.exp(-lambda * delta));
      } else {
        controls.target.lerp(_targetPosition, 1 - Math.exp(-4.5 * delta));
      }

      this.camera.position.copy(controls.target).addScaledVector(_offset, distance);
      controls.minDistance = Math.max(0.05, this.getBodyRadius(id) * 1.05);

      // Bring the lit hemisphere into view, but only while the user is idle and not
      // driving the camera by hand — a drag or a gesture always outranks the framing.
      const userDriving = idle < 1800 || this.tracking;
      if (!userDriving) {
        // Unit vector from the body toward the Sun; the Sun sits at the origin.
        _viewDirection.copy(_targetPosition).multiplyScalar(-1).normalize();
        this._withManualControlSuspended(() => this._orientTowardSun(delta));
      }

      this._applyFocusBias();

      const settled = Math.abs(distance - this.focusDistance) < Math.max(0.02, this.focusDistance * 0.03);
      if (this.mode === 'transition' && settled) this.mode = 'focus';
      if (this.mode === 'focus') {
        // Settled: the clamp can now tighten to the destination so the user cannot
        // dolly out past a sane framing, while the pivot tracking stays live.
        controls.maxDistance = Math.max(this.focusDistance * 1.35, 6);
        if (this.tourQueue.length) {
          this.tourTimer += delta;
          // Settle for a beat, then continue the tour.
          if (this.tourTimer > 4.2 && settled) {
            this.tourTimer = 0;
            const next = this.tourQueue.shift();
            this.focus(next.id, { distanceMultiplier: next.multiplier ?? 1, duration: 1.4 });
          }
        }
        // Cinematic drift once the shot has settled and the user is idle.
        controls.autoRotate = this.autoOrbit && idle > 2600;
      }
    } else if (this.mode === 'escape') {
      /**
       * The departure. Distance is driven by elapsed time rather than eased toward a
       * target, so the shot is deterministic and always completes:
       *
       *   progress p = t / duration, eased in then softened at the end
       *   distance  = start + (cruise - start) * ease(p)
       *
       * `ease` is a smoothstep on p^power, which gives a slow release, a long coast and a
       * gentle arrival — the pacing the brief asks for.
       */
      this._voyageElapsed += delta;
      const p = Math.min(1, this._voyageElapsed / this._voyageDuration);
      const ramp = Math.pow(p, this._voyagePower);
      const eased = ramp * ramp * (3 - 2 * ramp);
      const distance = this._voyageStart + (this._voyageCruise - this._voyageStart) * eased;
      this.voyageDistance = distance;

      controls.target.lerp(this._voyageOrigin, 1 - Math.exp(-6 * delta));
      this.camera.position.copy(controls.target).addScaledVector(this._voyageDirection, distance);
      // Nothing may clamp the departure back into the system.
      controls.minDistance = 0.1;
      controls.maxDistance = distance * 1.5;
      controls.autoRotate = false;
      if (p >= 1) this._voyageComplete = true;
    } else if (this.mode === 'system') {
      // Wide establishing shot: ease the pivot home and ease the radius out.
      const pivotDistance = controls.target.length();
      if (pivotDistance > 0.02) {
        controls.target.multiplyScalar(damp(pivotDistance, 0, 1.1, delta) / pivotDistance);
      } else {
        controls.target.set(0, 0, 0);
      }

      const systemDistance = this.systemDistance ?? 78;
      _offset.copy(this.camera.position).sub(controls.target);
      const currentDistance = _offset.length() || systemDistance;
      const distance = damp(currentDistance, systemDistance, 1.1, delta);
      controls.maxDistance = Math.max(180, systemDistance * 2);
      if (currentDistance > 1e-4) _offset.multiplyScalar(1 / currentDistance);
      this.camera.position.copy(controls.target).addScaledVector(_offset, distance);

      controls.autoRotate = this.autoOrbit && idle > 4200;
    } else if (this.mode === 'cosmic') {
      /**
       * Cosmic-scale flight.
       *
       * Distance is interpolated in *log* space: the ladder runs from 3.4 units to 1500, and
       * a linear ease spends nearly all of its time near the end, which reads as a jump
       * rather than a recession. Interpolating the exponent makes each doubling take the
       * same time, so the pull-back feels even and slow.
       */
      this._cosmicElapsed += delta;
      const p = Math.min(1, this._cosmicElapsed / this._cosmicDuration);
      const eased = p * p * (3 - 2 * p);

      const from = Math.log(Math.max(0.5, this._cosmicStart));
      const to = Math.log(Math.max(0.5, this._cosmicTarget));
      const distance = Math.exp(from + (to - from) * eased);
      this._cosmicDistance = distance;

      controls.target.lerp(this._cosmicOrigin, 1 - Math.exp(-5 * delta));
      this.camera.position.copy(controls.target).addScaledVector(this._cosmicDirection, distance);
      controls.minDistance = 0.1;
      controls.maxDistance = distance * 2.5;
      controls.autoRotate = false;

      if (p >= 1) {
        // Settle into free look at the new scale, so the user can orbit the galaxy. The
        // stage stays selected — the scene keeps applying depth compensation either way.
        this.mode = 'system';
        this.systemDistance = distance;
        controls.maxDistance = distance * 3;
      }
    } else if (this.mode === 'transition' && !this.focusId) {
      // Returning to the wide shot: same interpolation, then hand back to free look.
      const systemDistance = this.systemDistance ?? 78;
      _offset.copy(this.camera.position).sub(controls.target);
      const currentDistance = _offset.length() || systemDistance;

      const pivotDistance = controls.target.length();
      if (pivotDistance > 0.02) {
        controls.target.multiplyScalar(damp(pivotDistance, 0, 1.6, delta) / pivotDistance);
      }

      const distance = damp(currentDistance, systemDistance, this.focusLambda, delta);
      controls.maxDistance = Math.max(180, systemDistance * 2);
      if (currentDistance > 1e-4) _offset.multiplyScalar(1 / currentDistance);
      this.camera.position.copy(controls.target).addScaledVector(_offset, distance);

      controls.autoRotate = false;
      const pivotSettled = controls.target.length() < 0.4;
      if (pivotSettled && Math.abs(distance - systemDistance) < systemDistance * 0.04) {
        this.mode = 'system';
      }
    }

    controls.update();
  }

  dispose() {
    this._domElement.removeEventListener('pointerdown', this._markInteraction);
    this._domElement.removeEventListener('wheel', this._markInteraction);
    this.controls.dispose();
  }
}

export { damp };
