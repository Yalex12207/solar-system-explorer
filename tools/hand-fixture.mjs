/**
 * Synthetic hand fixture, shared by the gesture self-test and the end-to-end test.
 *
 * Builds the 21 MediaPipe landmarks for a hand from a small forward-kinematic model,
 * so gesture behaviour can be tested without a camera. Proportions follow a real hand
 * as the model reports it: knuckles sit roughly one palm width above the wrist and a
 * straight middle finger reaches about 0.8 palm widths further.
 *
 * Landmarks are in unmirrored video space — x to the right of the image — which is
 * the space MediaPipe reports.
 */

const FINGER_SEGMENTS = {
  index: [0.34, 0.22, 0.16],
  middle: [0.38, 0.25, 0.17],
  ring: [0.35, 0.24, 0.16],
  pinky: [0.27, 0.17, 0.13],
};

/**
 * @param {object} [options]
 * @param {number} [options.palmX]   palm centre x, 0-1
 * @param {number} [options.palmY]   palm centre y, 0-1
 * @param {number} [options.curl]    0 = fingers straight, 1 = fully folded
 * @param {number|null} [options.indexCurl] override the curl for the index finger
 * @param {number|null} [options.othersCurl] curl for middle/ring/pinky only
 * @param {number} [options.thumbToIndex] 0 = tips touching, 1 = fully apart
 * @param {number} [options.thumbAcross] 1 = thumb folded across the palm (a fist)
 * @param {number} [options.palmWidth] hand size, in normalised units
 * @param {number} [options.jitter] random noise added to every coordinate
 * @param {number} [options.seed] deterministic jitter seed
 * @returns {Array<{x:number,y:number,z:number}>} 21 landmarks
 */
export function synthHand({
  palmX = 0.5,
  palmY = 0.55,
  curl = 0,
  indexCurl = null,
  othersCurl = null,
  thumbToIndex = 1,
  thumbAcross = 0,
  palmWidth = 0.16,
  jitter = 0,
  seed = 1,
} = {}) {
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const n = () => (jitter ? (random() * 2 - 1) * jitter : 0);

  const unit = palmWidth;
  const wrist = { x: palmX, y: palmY + 0.95 * unit, z: 0 };
  const indexBase = { x: palmX - 0.375 * unit, y: palmY, z: 0 };
  const middleBase = { x: palmX - 0.125 * unit, y: palmY, z: 0 };
  const ringBase = { x: palmX + 0.125 * unit, y: palmY, z: 0 };
  const pinkyBase = { x: palmX + 0.375 * unit, y: palmY, z: 0 };

  /**
   * Build one finger as a rotating chain. Direction 0 points away from the wrist;
   * increasing curl rotates each successive joint further toward the palm, so a
   * folded finger's tip comes back closer to the wrist than its first joint — the
   * relationship the recognizer's extension metric measures.
   */
  const buildFinger = (base, fingerCurl, spread, segments) => {
    let direction = Math.atan2(spread * 0.3, -1);
    const bend = fingerCurl * 2.1;
    let current = { x: base.x, y: base.y, z: 0 };
    const points = [];
    for (let i = 0; i < segments.length; i += 1) {
      direction += i === 0 ? bend * 0.3 : bend * 0.66;
      const length = segments[i] * unit;
      current = {
        x: current.x + Math.sin(direction) * length,
        y: current.y - Math.cos(direction) * length,
        z: 0,
      };
      points.push(current);
    }
    return [{ x: base.x, y: base.y, z: 0 }, ...points];
  };

  const others = othersCurl === null ? curl : othersCurl;
  const built = [
    { base: indexBase, curl: indexCurl === null ? curl : indexCurl, spread: -0.5, segments: FINGER_SEGMENTS.index },
    { base: middleBase, curl: others, spread: -0.1, segments: FINGER_SEGMENTS.middle },
    { base: ringBase, curl: others, spread: 0.2, segments: FINGER_SEGMENTS.ring },
    { base: pinkyBase, curl: others, spread: 0.45, segments: FINGER_SEGMENTS.pinky },
  ].map((finger) => buildFinger(finger.base, finger.curl, finger.spread, finger.segments));

  // Thumb: rooted at the side of the palm near the wrist, abducted about 60 degrees.
  const thumbBase = { x: palmX - 0.38 * unit, y: palmY + 0.86 * unit, z: 0 };
  let thumbDirection = -Math.PI / 3;
  let thumbCurrent = thumbBase;
  const thumbPoints = [];
  for (const length of [0.32, 0.24, 0.18]) {
    thumbDirection += 0.12;
    thumbCurrent = {
      x: thumbCurrent.x + Math.sin(thumbDirection) * length * unit,
      y: thumbCurrent.y - Math.cos(thumbDirection) * length * unit,
      z: 0,
    };
    thumbPoints.push(thumbCurrent);
  }
  const thumbMid = thumbPoints[1];
  const thumbDistal = thumbPoints[2];

  // The thumb tip travels from its natural abducted position toward the *current*
  // index tip. A real thumb only reaches an extended index tip during a deliberate
  // pinch, so the reach is partial: this keeps a "point" from measuring the same
  // short thumb-index gap as a pinch.
  const indexTip = built[0][3];
  const middleKnuckle = built[1][0];
  const reach = 0.78;
  const thumbTip = {
    x: thumbDistal.x + (indexTip.x - thumbDistal.x) * (1 - thumbToIndex) * reach,
    y: thumbDistal.y + (indexTip.y - thumbDistal.y) * (1 - thumbToIndex) * reach,
    z: 0,
  };
  if (thumbAcross > 0) {
    thumbTip.x += (middleKnuckle.x - thumbTip.x) * thumbAcross * 0.9;
    thumbTip.y += (middleKnuckle.y - thumbTip.y) * thumbAcross * 0.9;
  }

  const landmarks = new Array(21);
  landmarks[0] = wrist;
  landmarks[1] = thumbBase;
  landmarks[2] = thumbMid;
  landmarks[3] = { x: (thumbMid.x + thumbTip.x) / 2, y: (thumbMid.y + thumbTip.y) / 2, z: 0 };
  landmarks[4] = thumbTip;
  for (let f = 0; f < 4; f += 1) {
    const offset = 5 + f * 4;
    landmarks[offset] = built[f][0];
    landmarks[offset + 1] = built[f][1];
    landmarks[offset + 2] = built[f][2];
    landmarks[offset + 3] = built[f][3];
  }

  return landmarks.map((point) => ({ x: point.x + n(), y: point.y + n(), z: point.z + n() }));
}

/** Named pose fixtures, so both harnesses describe hands the same way. */
export const POSE = {
  open: () => synthHand({ curl: 0, thumbToIndex: 1 }),
  fist: () => synthHand({ curl: 1, thumbToIndex: 0, thumbAcross: 1 }),
  pinchClosed: () => synthHand({ curl: 1, indexCurl: 0.4, othersCurl: 0.8, thumbToIndex: 0.05 }),
  point: (target, palmWidth = 0.16) => {
    const hand = synthHand({ curl: 1, indexCurl: 0, thumbToIndex: 0.4, palmWidth });
    if (!target) return hand;
    // Translate the hand so the index tip lands on the requested screen position.
    const tip = hand[8];
    const dx = (1 - target.x) - tip.x;
    const dy = target.y - tip.y;
    return hand.map((point) => ({ x: point.x + dx, y: point.y + dy, z: point.z }));
  },
};
