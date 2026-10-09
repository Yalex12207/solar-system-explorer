/**
 * Fetches the MediaPipe Hand Landmarker model and wasm runtime into
 * `public/mediapipe/` so gesture control runs entirely from this project —
 * no CDN dependency, no CORS surprises, and it works offline once installed.
 *
 * Run with: node tools/fetch-mediapipe.mjs
 * The vendored files are committed with the project; this script only needs to
 * run again to change versions.
 */

import { createWriteStream, mkdirSync, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const MP_VERSION = '0.10.14';

const TARGETS = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    path: 'public/mediapipe/hand_landmarker.task',
    minBytes: 5_000_000,
  },
  {
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm/vision_wasm_internal.js`,
    path: 'public/mediapipe/wasm/vision_wasm_internal.js',
    minBytes: 100_000,
  },
  {
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm/vision_wasm_internal.wasm`,
    path: 'public/mediapipe/wasm/vision_wasm_internal.wasm',
    minBytes: 1_000_000,
  },
  {
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm/vision_wasm_nosimd_internal.js`,
    path: 'public/mediapipe/wasm/vision_wasm_nosimd_internal.js',
    minBytes: 100_000,
  },
  {
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm/vision_wasm_nosimd_internal.wasm`,
    path: 'public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
    minBytes: 1_000_000,
  },
];

mkdirSync('public/mediapipe/wasm', { recursive: true });

let failed = 0;
for (const target of TARGETS) {
  if (existsSync(target.path) && statSync(target.path).size >= target.minBytes) {
    console.log(`skip   ${target.path} (${statSync(target.path).size} bytes)`);
    continue;
  }
  try {
    const response = await fetch(target.url);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target.path));
    const size = statSync(target.path).size;
    console.log(`${size >= target.minBytes ? 'ok    ' : 'SHORT '} ${target.path} (${size} bytes)`);
    if (size < target.minBytes) failed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${target.path}: ${error.message}`);
  }
}

console.log(failed === 0 ? '\nAll MediaPipe assets vendored.' : `\n${failed} asset(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
