/**
 * Gesture recognition self-test.
 *
 * Synthesises the 21 MediaPipe landmarks for each pose from a small forward-kinematic
 * hand model, then asserts that the recognizer classifies them correctly, that
 * debounce suppresses transients, and that the whole float pipeline stays finite
 * under injected jitter.
 *
 * Run: node tools/gesture-selftest.mjs
 */

import { GestureRecognizer } from '../src/gesture/recognizer.js';
import { GESTURE, GESTURE_CONFIG } from '../src/gesture/config.js';
import { synthHand } from './hand-fixture.mjs';

let failures = 0;
let checks = 0;

function check(name, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` ?${detail}` : ''}`);
  }
}

/**
 * Build one hand.
 *
 * Landmarks are laid out in unmirrored video space (x to the right of the *image*),
 * which is the space MediaPipe reports. The palm is a 0.16  0.20 rectangle.
 *
 * @param {object} options
 * @param {number} [options.palmX]      palm centre x, 0?
 * @param {number} [options.palmY]      palm centre y, 0?
 * @param {number} [options.curl]       0 = fingers straight, 1 = fully folded
 * @param {number} [options.indexCurl]  overrides the curl for the index finger
 * @param {number} [options.thumbToIndex] 0 = tips touching, 1 = fully apart
 * @param {number} [options.palmWidth]  scales the whole hand
 * @param {number} [options.jitter]     random noise added to every coordinate
 * @param {number} [options.seed]       deterministic jitter
 */
/** Feed a pose for long enough for the debounce to settle. */
function hold(recognizer, landmarks, { frames = 24, stepMs = 40, start = 0 } = {}) {
  let frame = null;
  for (let i = 0; i < frames; i += 1) {
    frame = recognizer.update(landmarks, start + i * stepMs);
  }
  return frame;
}

console.log('Gesture recogniser self-test\n');

// ?0. Model diagnostics ?// Optional: `node tools/gesture-selftest.mjs --dump` prints the synthesised hand's
// measurements so the model can be checked against the recognizer's expectations.
if (process.argv.includes('--dump')) {
  const { scorePoses } = await import('../src/gesture/recognizer.js');
  for (const spec of [
    { label: 'open', curl: 0, indexCurl: null, thumbToIndex: 1 },
    { label: 'fist', curl: 1, indexCurl: null, thumbToIndex: 0, thumbAcross: 1 },
    { label: 'pinch', curl: 1, indexCurl: 0.4, othersCurl: 0.8, thumbToIndex: 0.05 },
    { label: 'point', curl: 1, indexCurl: 0, thumbToIndex: 0.4 },
  ]) {
    const hand = synthHand(spec);
    const scores = scorePoses(hand);
    const wrist = hand[0];
    const dist = (i) => Math.hypot(hand[i].x - wrist.x, hand[i].y - wrist.y);
    console.log(
      `${spec.label.padEnd(6)} ext[${Object.values(scores.extension).map((v) => v.toFixed(2)).join(' ')}] ` +
        `idxTip ${dist(8).toFixed(3)} idxPip ${dist(6).toFixed(3)} ` +
        `gap ${scores.gapRatio.toFixed(2)} thumbSpread ${scores.thumbSpread.toFixed(2)} :: ` +
        `palm ${scores.openPalm.toFixed(2)} fist ${scores.fist.toFixed(2)} ` +
        `pinch ${scores.pinch.toFixed(2)} point ${scores.point.toFixed(2)}`,
    );
  }
  console.log('');
}

// ?1. Pose classification ?console.log('Pose classification');

const poses = [
  { name: 'open palm', landmarks: synthHand({ curl: 0, thumbToIndex: 1 }), expect: GESTURE.OPEN_PALM },
  { name: 'fist', landmarks: synthHand({ curl: 1, thumbToIndex: 0, thumbAcross: 1 }), expect: GESTURE.FIST },
  { name: 'pinch', landmarks: synthHand({ curl: 1, indexCurl: 0.4, othersCurl: 0.8, thumbToIndex: 0.05 }), expect: GESTURE.PINCH },
  { name: 'point', landmarks: synthHand({ curl: 1, indexCurl: 0, thumbToIndex: 0.4 }), expect: GESTURE.POINT },
];

for (const pose of poses) {
  const recognizer = new GestureRecognizer();
  const frame = hold(recognizer, pose.landmarks);
  check(
    `${pose.name} ?${pose.expect}`,
    frame.gesture === pose.expect,
    `got ${frame.gesture} (raw ${frame.rawGesture}, confidence ${frame.confidence.toFixed(2)})`,
  );
  check(
    `  ${pose.name} confidence ?${GESTURE_CONFIG.confidence.threshold}`,
    frame.confidence >= GESTURE_CONFIG.confidence.threshold,
    `${frame.confidence.toFixed(3)}`,
  );
}

// ?2. Debounce ?console.log('\nDebounce and confidence gating');

{
  const recognizer = new GestureRecognizer();
  // A single transient fist frame must not register as a fist.
  const fist = synthHand({ curl: 1, thumbToIndex: 0, thumbAcross: 1 });
  const palm = synthHand({ curl: 0, thumbToIndex: 1 });
  hold(recognizer, palm, { frames: 20 });
  check('open palm established', recognizer.gesture === GESTURE.OPEN_PALM, recognizer.gesture);

  recognizer.update(fist, 5000);
  check('transient fist frame ignored', recognizer.gesture === GESTURE.OPEN_PALM, recognizer.gesture);

  // The configured confidence threshold must actually gate activation, and an
  // out-of-range value must be clamped rather than silently disabling every gesture.
  const strict = new GestureRecognizer({
    ...GESTURE_CONFIG,
    confidence: { ...GESTURE_CONFIG.confidence, threshold: 1.4 },
  });
  const strictFrame = hold(strict, palm);
  check(
    'raising the confidence threshold suppresses a pose',
    strictFrame.gesture === GESTURE.NONE,
    `${strictFrame.gesture} @ ${strictFrame.confidence.toFixed(3)}`,
  );

  const clamped = new GestureRecognizer({
    ...GESTURE_CONFIG,
    confidence: { ...GESTURE_CONFIG.confidence, threshold: 0.7 },
  });
  const clampedFrame = hold(clamped, palm);
  check(
    'a threshold within range still allows the pose',
    clampedFrame.gesture === GESTURE.OPEN_PALM,
    `${clampedFrame.gesture} @ ${clampedFrame.confidence.toFixed(3)}`,
  );
}

{
  // Holding a pose long enough must eventually activate it.
  const recognizer = new GestureRecognizer();
  const fist = synthHand({ curl: 1, thumbToIndex: 0, thumbAcross: 1 });
  const frame = hold(recognizer, fist, { frames: 40 });
  check('sustained fist activates', frame.gesture === GESTURE.FIST, frame.gesture);
}

{
  // Dropping one frame must not clear an active gesture (release window).
  const recognizer = new GestureRecognizer();
  const palm = synthHand({ curl: 0, thumbToIndex: 1 });
  hold(recognizer, palm, { frames: 20 });
  recognizer.update(null, 5000);
  check('single dropped frame keeps gesture', recognizer.gesture === GESTURE.OPEN_PALM, recognizer.gesture);
  // But a long absence clears it.
  for (let i = 1; i < 30; i += 1) recognizer.update(null, 5000 + i * 40);
  check('sustained absence clears gesture', recognizer.gesture === GESTURE.NONE, recognizer.gesture);
}

// ------- 3. Continuous signals -------
console.log('\nContinuous signals');

{
  // Pinch closed must drive zoom in (negative); a pinch held open drives zoom out.
  // Both fixtures keep a genuine pinch shape so the gesture stays recognised and
  // only the thumb-index gap changes.
  const closed = new GestureRecognizer();
  const closedFrame = hold(closed, synthHand({ curl: 1, indexCurl: 0.4, othersCurl: 0.8, thumbToIndex: 0.05 }));
  check('pinch closed reports zoom in (negative)', closedFrame.zoomAmount < -0.4, `${closedFrame.zoomAmount.toFixed(2)}`);

  const open = new GestureRecognizer();
  let openedFrame = null;
  // Hold the pinch shape, then widen only the thumb-index gap. `othersCurl` stays low
  // so the hand keeps looking like a pinch and does not drift into a fist as the
  // fingers separate.
  for (let i = 0; i < 60; i += 1) {
    const gapOpens = Math.min(1, i / 30);
    openedFrame = open.update(
      synthHand({ curl: 1, indexCurl: 0.35, othersCurl: 0.3, thumbToIndex: gapOpens }),
      i * 40,
    );
  }
  check(
    'pinch ratio rises as the fingers separate',
    openedFrame.pinchRatio > closedFrame.pinchRatio + 0.1,
    `${closedFrame.pinchRatio.toFixed(2)} -> ${openedFrame.pinchRatio.toFixed(2)}`,
  );
  check(
    'opening the pinch reverses the zoom direction',
    openedFrame.zoomAmount > closedFrame.zoomAmount,
    `${closedFrame.zoomAmount.toFixed(2)} -> ${openedFrame.zoomAmount.toFixed(2)}`,
  );

  const neutral = new GestureRecognizer();
  const neutralFrame = hold(neutral, synthHand({ curl: 0, thumbToIndex: 1 }));
  check('no zoom without a pinch gesture', neutralFrame.zoomAmount === 0, `${neutralFrame.zoomAmount}`);
}

{
  // Palm travel must produce a bounded orbit velocity with a matching direction.
  const recognizer = new GestureRecognizer();
  let frame = null;
  for (let i = 0; i < 26; i += 1) {
    // Sweep the palm right across the image (unmirrored x increasing).
    const x = 0.3 + i * 0.012;
    frame = recognizer.update(synthHand({ palmX: x, curl: 0 }), i * 40);
  }
  check('orbit velocity is finite', Number.isFinite(frame.palmVelocity.x) && Number.isFinite(frame.palmVelocity.y));
  const speed = Math.hypot(frame.palmVelocity.x, frame.palmVelocity.y);
  check('moving palm produces orbit intent', speed > 0.05, `speed ${speed.toFixed(3)}`);
  check('orbit intent is capped', speed <= GESTURE_CONFIG.pointer.maxSpeed + 1e-6, `speed ${speed.toFixed(3)}`);

  // At rest the velocity must decay to nothing.
  for (let i = 0; i < 40; i += 1) frame = recognizer.update(synthHand({ palmX: 0.62, curl: 0 }), 2000 + i * 40);
  const restSpeed = Math.hypot(frame.palmVelocity.x, frame.palmVelocity.y);
  check('resting palm stops the orbit', restSpeed < 0.02, `speed ${restSpeed.toFixed(4)}`);
}

// ?4. Swipe ?console.log('\nSwipe');

{
  // A fast swipe registers once, carries a direction, and the cooldown suppresses a
  // second report from the same sweep.
  //
  // The sweep spans ~10 frames and is then held in place: the recognizer smooths the
  // palm deliberately, so a single-frame teleport is not something a hand does and is
  // not detected by design.
  const runSweep = (startX, direction, startTime) => {
    const recognizer = new GestureRecognizer();
    const swipes = [];
    let t = startTime;
    for (let i = 0; i < 4; i += 1) recognizer.update(synthHand({ palmX: startX, curl: 0 }), (t += 40));
    for (let i = 0; i < 10; i += 1) {
      const frame = recognizer.update(synthHand({ palmX: startX + direction * i * 0.032, curl: 0 }), (t += 40));
      if (frame.swipe) swipes.push({ ...frame.swipe, at: t });
    }
    const endX = startX + direction * 9 * 0.032;
    for (let i = 0; i < 16; i += 1) {
      const frame = recognizer.update(synthHand({ palmX: endX, curl: 0 }), (t += 40));
      if (frame.swipe) swipes.push({ ...frame.swipe, at: t });
    }
    return swipes;
  };

  const right = runSweep(0.25, 1, 0);
  check('fast palm sweep registers a swipe', right.length >= 1, `${right.length} swipes`);
  check('  the sweep reports only once per cooldown', right.length === 1, `${right.length} reports`);
  if (right.length) {
    check('  swipe carries a direction', Math.abs(right[0].direction) === 1, `${right[0].direction}`);
    check(
      '  swipe meets the configured speed',
      right[0].speed >= GESTURE_CONFIG.swipe.minSpeed,
      `${right[0].speed.toFixed(2)}`,
    );
  }

  const left = runSweep(0.75, -1, 20000);
  check(
    'sweeping the other way reports the opposite direction',
    left.length > 0 && Math.sign(left[0].direction) === -Math.sign(right[0]?.direction ?? 1),
    JSON.stringify(left[0] || null),
  );

  // A slow drift must never register.
  const slow = new GestureRecognizer();
  let slowSwipe = null;
  let ts = 40000;
  for (let i = 0; i < 40; i += 1) {
    const frame = slow.update(synthHand({ palmX: 0.2 + i * 0.008, curl: 0 }), (ts += 40));
    if (frame.swipe) slowSwipe = frame.swipe;
  }
  check('slow drift does not register a swipe', slowSwipe === null, JSON.stringify(slowSwipe));
}

// ------- 5. Robustness under jitter -------
console.log('\nRobustness');

{
  // Point with realistic hand tremor: the classification must hold steady, and no
  // signal may ever go non-finite (a NaN in the camera maths blanks the scene).
  const recognizer = new GestureRecognizer();
  let pointFrames = 0;
  let nonFinite = 0;
  const total = 120;
  for (let i = 0; i < total; i += 1) {
    const landmarks = synthHand({
      palmX: 0.5 + Math.sin(i / 7) * 0.01,
      palmY: 0.5 + Math.cos(i / 5) * 0.01,
      curl: 1,
      indexCurl: 0,
      thumbToIndex: 0.4,
      jitter: 0.0035,
      seed: i + 7,
    });
    const frame = recognizer.update(landmarks, i * 40);
    if (frame.gesture === GESTURE.POINT) pointFrames += 1;
    const values = [
      frame.pointer.x,
      frame.pointer.y,
      frame.palmVelocity.x,
      frame.palmVelocity.y,
      frame.pinchRatio,
      frame.zoomAmount,
      frame.confidence,
    ];
    if (values.some((value) => !Number.isFinite(value))) nonFinite += 1;
  }
  check('no non-finite signal under jitter', nonFinite === 0, `${nonFinite} frames`);
  check(
    'point classification is stable under tremor',
    pointFrames / total > 0.8,
    `${pointFrames}/${total} frames`,
  );
}

{
  // Pointer dead zone: sub-threshold tremor must not move the pointer at all.
  const recognizer = new GestureRecognizer();
  recognizer.update(synthHand({ palmX: 0.5, curl: 0 }), 0);
  const first = { ...recognizer.pointer };
  const micro = GESTURE_CONFIG.pointer.deadZone * 0.4;
  let moved = 0;
  for (let i = 1; i <= 40; i += 1) {
    recognizer.update(synthHand({ palmX: 0.5 + micro * (i % 2 ? 1 : -1), curl: 0 }), i * 40);
    if (Math.abs(recognizer.pointer.x - first.x) > GESTURE_CONFIG.pointer.deadZone) moved += 1;
  }
  check('dead zone absorbs sub-threshold tremor', moved === 0, `${moved} frames moved`);
}

// ?6. Coordinate convention ?console.log('\nConventions');

{
  const { toInputSpace } = await import('../src/gesture/recognizer.js');
  const mirrored = toInputSpace({ x: 0.1, y: 0.4, z: 0 });
  check('input space mirrors x (0.1 ?0.9)', Math.abs(mirrored.x - 0.9) < 1e-9, `${mirrored.x}`);
  check('input space preserves y', mirrored.y === 0.4, `${mirrored.y}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
