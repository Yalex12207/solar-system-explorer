/**
 * Device capability detection and runtime quality selection.
 *
 * Quality is picked from coarse but reliable signals (pointer type, core count,
 * device memory, hardware concurrency) plus a live frame-time probe that can step
 * the preset down if the device cannot hold a smooth frame budget.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Detect WebGL 2 availability without leaking a context. */
function detectWebGL() {
  if (typeof document === 'undefined') return { supported: false, version: null };
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      gl2.getExtension('WEBGL_lose_context')?.loseContext();
      return { supported: true, version: 2 };
    }
    const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl1) {
      gl1.getExtension('WEBGL_lose_context')?.loseContext();
      return { supported: true, version: 1 };
    }
    return { supported: false, version: null };
  } catch (error) {
    return { supported: false, version: null, error: String(error) };
  }
}

export function useDeviceProfile() {
  const [profile, setProfile] = useState(() => ({
    webgl: { supported: true, version: 2 },
    ready: false,
    isTouch: false,
    isMobile: false,
    cores: 8,
    memory: 8,
    pixelRatio: 1,
  }));

  useEffect(() => {
    const webgl = detectWebGL();
    const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const isMobile = isTouch && Math.min(window.innerWidth, window.innerHeight) < 820;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    setProfile({
      webgl,
      ready: true,
      isTouch,
      isMobile,
      cores,
      memory,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    });
  }, []);

  return profile;
}

/** Choose a starting preset that the device can actually sustain. */
export function useAutoQuality(profile) {
  return useMemo(() => {
    if (!profile.ready) return 'balanced';
    if (!profile.webgl.supported) return 'performance';
    if (profile.isMobile) return profile.cores >= 8 && profile.memory >= 6 ? 'balanced' : 'performance';
    if (profile.cores <= 4 || profile.memory <= 4) return 'balanced';
    return 'high';
  }, [profile]);
}

/**
 * Frame-budget watchdog. Reports an average FPS and suggests a downgrade when the
 * device persistently misses the target — the caller decides whether to apply it.
 */
export function usePerformanceGuard({ enabled = false, onDowngrade, sampleMs = 2600 } = {}) {
  const frames = useRef([]);
  const [fps, setFps] = useState(60);
  const downgrades = useRef(0);
  const callback = useRef(onDowngrade);
  callback.current = onDowngrade;

  useEffect(() => {
    if (!enabled) return undefined;
    let raf = 0;
    let last = performance.now();
    let windowStart = last;

    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const delta = now - last;
      last = now;
      if (delta > 0 && delta < 400) frames.current.push(delta);
      if (now - windowStart >= sampleMs) {
        const samples = frames.current;
        frames.current = [];
        windowStart = now;
        if (!samples.length) return;
        const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        const measured = 1000 / average;
        setFps(measured);
        if (measured < 34 && downgrades.current < 2) {
          downgrades.current += 1;
          callback.current?.(measured);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, sampleMs]);

  return fps;
}

/** Match a CSS media query reactively. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const handler = (event) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Pointer-drag detection that does not fire on taps or multi-touch. */
export function useTapGesture({ onTap, onDoubleTap, threshold = 6, doubleTapMs = 280 }) {
  const state = useRef({ x: 0, y: 0, time: 0, moved: false, lastTap: 0 });
  const handlers = useRef({ onTap, onDoubleTap });
  handlers.current = { onTap, onDoubleTap };

  const onPointerDown = useCallback((event) => {
    if (event.pointerType === 'touch' && event.isPrimary === false) return;
    state.current.x = event.clientX;
    state.current.y = event.clientY;
    state.current.moved = false;
  }, []);

  const onPointerMove = useCallback(
    (event) => {
      const dx = Math.abs(event.clientX - state.current.x);
      const dy = Math.abs(event.clientY - state.current.y);
      if (dx > threshold || dy > threshold) state.current.moved = true;
    },
    [threshold],
  );

  const onPointerUp = useCallback(
    (event) => {
      if (state.current.moved) return;
      const now = performance.now();
      const isDouble = now - state.current.lastTap < doubleTapMs;
      state.current.lastTap = isDouble ? 0 : now;
      if (isDouble && handlers.current.onDoubleTap) handlers.current.onDoubleTap(event);
      else handlers.current.onTap?.(event);
    },
    [doubleTapMs],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}

/** Window key bindings used for shortcuts (Esc, Space, /, 1-5). */
export function useKeyBindings(bindings, { enabled = true } = {}) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && /input|textarea|select/i.test(target.tagName);
      if (typing && event.key !== 'Escape') return;
      const mapped = ref.current[event.key] || ref.current[event.key.toLowerCase()];
      if (mapped) {
        event.preventDefault();
        mapped(event);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
