/**
 * Canvas-drawn text sprites.
 *
 * Text is rendered to a 2D canvas and used as a sprite map — no font files, no
 * DOM overlays to keep in sync with the 3D scene, and it scales on any DPI.
 */

import * as THREE from 'three';

const DPR = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

/**
 * @returns {{canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, aspect: number}}
 */
export function bodyLabelTexture(text, { color = '#dfe6f2', fontSize = 64, letterSpacing = 10, weight = 500 } = {}) {
  const font = `${weight} ${fontSize * DPR}px "Helvetica Neue", Inter, system-ui, sans-serif`;
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = font;
  const spacing = letterSpacing * DPR;
  const characters = [...text.toUpperCase()];
  const width = characters.reduce((sum, char) => sum + measureCtx.measureText(char).width + spacing, 0);
  const height = fontSize * DPR * 1.6;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(width));
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 8 * DPR;

  let cursor = 0;
  for (const char of characters) {
    ctx.fillText(char, cursor, canvas.height / 2);
    cursor += ctx.measureText(char).width + spacing;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { canvas, texture, aspect: canvas.width / canvas.height };
}

/**
 * A planet label that always faces the camera and keeps a constant on-screen
 * size. Height is in world units at the reference distance.
 */
export function createBodyLabel(definition, radius) {
  const { texture, aspect } = bodyLabelTexture(definition.name, {
    color: definition.accent ? shade(definition.accent, 0.35) : '#dfe6f2',
    fontSize: 58,
    letterSpacing: 12,
  });
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = `${definition.name}Label`;
  // Anchored at the bottom edge so the text always floats clear of the body.
  sprite.center.set(0.5, 0);
  sprite.userData.gap = Math.max(0.3, radius * 1.55);
  const height = Math.max(0.26, radius * 0.5) * 3.4;
  sprite.userData.aspect = aspect;
  sprite.userData.height = height;
  sprite.renderOrder = 10;
  sprite.visible = false;
  return sprite;
}

/** Lighten a hex colour toward white by `amount` (0..1). */
function shade(hex, amount) {
  const value = hex.replace('#', '');
  const int = parseInt(value.length === 3 ? value.split('').map((c) => c + c).join('') : value, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * Keep a label at a constant pixel size and fade it by distance.
 * Called once per frame per visible label.
 */
export function updateLabelScale(sprite, camera, { minPixels = 26, fadeNear = 26, fadeFar = 150 } = {}) {
  const distance = camera.position.distanceTo(sprite.getWorldPosition(TEMP));
  const worldHeight = (minPixels / window.innerHeight) * 2 * Math.tan((camera.fov * Math.PI) / 360) * distance;
  const height = Math.max(sprite.userData.height, worldHeight);
  sprite.scale.set(height * sprite.userData.aspect, height, 1);
  const fade = THREE.MathUtils.clamp((distance - fadeNear) / (fadeFar - fadeNear), 0, 1);
  sprite.material.opacity = fade * 0.78;
  sprite.visible = fade > 0.02;
  return distance;
}

const TEMP = new THREE.Vector3();
