/**
 * AmbientAudio — a tiny, dependency-free ambient bed for Solar System Explorer.
 *
 * Everything is synthesised with the Web Audio API (no assets, no libraries): a
 * detuned two-oscillator drone, a looping white-noise "space wind" layer behind
 * a slowly sweeping lowpass filter, and LFOs on wind gain and cutoff. Audio is
 * OFF by default, built lazily and resumed from a user gesture, and every public
 * call is a no-op (never a throw) when unsupported or closed.
 */

/** Root drone note per body, in Hz. Unknown ids fall back to the "space" bed. */
const BODY_TONES = Object.freeze({
  space: 55, sun: 48, mercury: 132, venus: 118, earth: 96, moon: 110, iss: 124,
  mars: 104, jupiter: 64, saturn: 72, uranus: 84, neptune: 78, pluto: 138, halley: 128,
});
const BODY_ORDER = Object.keys(BODY_TONES);
const MASTER = 0.09; // barely-there bed, not music
const DUCK = MASTER * 0.25;
const FADE_IN = 2.5;
const FADE_OUT = 0.8;
const DRONE = 0.34;
const DRONE_ACCENT = 0.14;
const WIND = 0.5;
const WIND_CUTOFF = 420;
const hasDocument = typeof document !== 'undefined';
const now = (ctx) => ctx.currentTime;

/** Normalise "Earth", "earth-1", "SOL_3" … to a BODY_TONES key (or null). */
function resolveBodyKey(id) {
  if (typeof id !== 'string') return null;
  const key = id.trim().toLowerCase();
  if (!key) return null;
  if (BODY_TONES[key] !== undefined) return key;
  return BODY_ORDER.find((name) => key.includes(name)) ?? null;
}

/** Map an accent colour to a 0..1 brightness factor (absent => 0). */
function brightnessOf(accentHex) {
  const hex = String(accentHex ?? '').trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)?.[1];
  if (!hex) return 0;
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return Math.min(1, 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
}

/** Two-second stereo white-noise loop for the wind layer. */
function makeNoiseBuffer(ctx) {
  const frames = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export class AmbientAudio {
  constructor() {
    this._supported = typeof window !== 'undefined' && typeof window.AudioContext === 'function';
    this._ctx = null;
    this._nodes = null;
    this._enabled = false;
    this._gestureBound = false;
    this._base = BODY_TONES.space;
    this._brightness = 0;
    this._onVisibility = () => this._duck();
  }

  /** @returns {boolean} whether the Web Audio API is available. */
  get supported() {
    return this._supported;
  }

  /** @returns {boolean} whether the ambient bed is currently enabled. */
  get enabled() {
    return this._enabled;
  }

  /**
   * Build/resume the context and fade the bed in over ~2.5s. Call from a user
   * gesture. Never throws.
   * @returns {Promise<boolean>} true when the bed is audible and running.
   */
  async enable() {
    if (!this._supported) return false;
    try {
      if (!this._ctx) this._build();
      if (this._ctx.state !== 'running') await this._ctx.resume();
      if (!this._enabled) {
        this._enabled = true;
        this._bindGestureRetry();
        if (hasDocument) document.addEventListener('visibilitychange', this._onVisibility);
        this._ramp(hasDocument && document.visibilityState === 'hidden' ? DUCK : MASTER, FADE_IN);
      }
      return this._ctx.state === 'running';
    } catch {
      this._enabled = false;
      return false;
    }
  }

  /**
   * Fade out over ~0.8s, then suspend the context. Safe to call repeatedly,
   * before the first enable(), or after dispose().
   */
  disable() {
    this._enabled = false;
    if (!this._ctx) return;
    try {
      if (hasDocument) document.removeEventListener('visibilitychange', this._onVisibility);
      this._ramp(0, FADE_OUT);
      const ctx = this._ctx;
      if (ctx.state === 'running') ctx.suspend(now(ctx) + FADE_OUT).catch(() => {});
    } catch {
      /* never surface audio failures to React */
    }
  }

  /** @returns {Promise<boolean>} the resulting enabled state. */
  async toggle() {
    if (this._enabled) {
      this.disable();
      return false;
    }
    return this.enable();
  }

  /**
   * Softly retune the drone to a body and shift harmonic brightness when an
   * accent colour is supplied. Never a hard jump.
   * @param {string} id body id or display name, e.g. "earth", "Jupiter".
   * @param {string} [accentHex] accent colour, e.g. "#4da3ff".
   */
  setBodyTone(id, accentHex) {
    const key = resolveBodyKey(id);
    this._base = key ? BODY_TONES[key] : BODY_TONES.space;
    this._brightness = accentHex === undefined ? 0 : brightnessOf(accentHex);
    if (!this._ctx || !this._nodes) return;
    try {
      const { oscA, oscB, accent, accentFilter } = this._nodes;
      const t = now(this._ctx);
      oscA.frequency.setTargetAtTime(this._base, t, 0.9);
      oscB.frequency.setTargetAtTime(this._base * 1.5, t, 0.9);
      accent.gain.setTargetAtTime(this._brightness * DRONE_ACCENT, t, 0.6);
      accentFilter.frequency.setTargetAtTime(500 + this._brightness * 1400, t, 0.8);
    } catch {
      /* ignore */
    }
  }

  /** Very short, quiet sine blip (880 Hz) for selection feedback. */
  ping() {
    if (!this._nodes || this._ctx.state !== 'running') return;
    try {
      const t = now(this._ctx);
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      osc.connect(gain).connect(this._nodes.master);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.03, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.start(t);
      osc.stop(t + 0.14);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch {
      /* ignore */
    }
  }

  /** Close the context and release every node; the instance becomes inert. */
  dispose() {
    const ctx = this._ctx;
    this._enabled = false;
    this._ctx = null;
    if (hasDocument) document.removeEventListener('visibilitychange', this._onVisibility);
    for (const node of Object.values(this._nodes || {})) {
      try {
        if (typeof node.stop === 'function') node.stop();
      } catch {
        /* already stopped */
      }
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    this._nodes = null;
    if (ctx && ctx.state !== 'closed') Promise.resolve(ctx.close()).catch(() => {});
  }

  /** @private Fade the master gain to `value` over `seconds` via AudioParam. */
  _ramp(value, seconds) {
    const param = this._nodes && this._nodes.master.gain;
    if (!param) return;
    const t = now(this._ctx);
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + seconds);
  }

  /** @private Late resume if enabled before the first real gesture. */
  _bindGestureRetry() {
    if (this._gestureBound) return;
    this._gestureBound = true;
    const retry = () => {
      const ctx = this._ctx;
      if (this._enabled && ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(type, retry, { once: true, passive: true });
    }
  }

  /** @private Duck while the tab is hidden, restore on return. */
  _duck() {
    if (!this._enabled || !this._nodes) return;
    try {
      this._ramp(document.visibilityState === 'hidden' ? DUCK : MASTER, 0.15);
    } catch {
      /* ignore */
    }
  }

  /** @private Build the whole node graph once, at master gain 0. */
  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = now(ctx);
    const source = (type, freq) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.start(t);
      return osc;
    };
    const filter = (freq, q) => {
      const biquad = ctx.createBiquadFilter();
      biquad.type = 'lowpass';
      biquad.frequency.value = freq;
      biquad.Q.value = q;
      return biquad;
    };

    // master bed (near silent) + shared drone bus
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t);
    master.connect(ctx.destination);
    const droneBus = ctx.createGain();
    droneBus.gain.value = DRONE;
    droneBus.connect(master);

    // drone bed: base sine plus a slightly detuned fifth above, straight to master
    const oscA = source('sine', this._base);
    const oscB = source('triangle', this._base * 1.5);
    oscB.detune.value = 6;
    oscA.connect(master);
    oscB.connect(master);

    // accent lowpass: a body colour opens a second, brighter drone voice
    const accent = ctx.createGain();
    accent.gain.value = 0;
    const accentFilter = filter(500, 0.7);
    droneBus.connect(accent).connect(accentFilter).connect(master);

    // space wind: looping white noise -> lowpass ~420 Hz, slowly modulated
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx);
    noise.loop = true;
    noise.start(t);
    const windFilter = filter(WIND_CUTOFF, 0.6);
    const wind = ctx.createGain();
    wind.gain.value = WIND;
    noise.connect(windFilter).connect(wind).connect(master);

    // gentle LFOs: slow cutoff sweep and gain breathing (no setInterval)
    const lfoCutoffGain = ctx.createGain();
    lfoCutoffGain.gain.value = 160;
    source('sine', 0.045).connect(lfoCutoffGain).connect(windFilter.frequency);
    const lfoWindGain = ctx.createGain();
    lfoWindGain.gain.value = WIND * 0.45;
    source('sine', 0.07).connect(lfoWindGain).connect(wind.gain);

    this._ctx = ctx;
    this._nodes = {
      master, droneBus, accent, accentFilter, oscA, oscB, noise,
      windFilter, wind, lfoCutoffGain, lfoWindGain,
    };
  }
}

let singleton = null;

/** @returns {AmbientAudio} the lazily created process-wide singleton. */
export function getAudio() {
  if (!singleton) singleton = new AmbientAudio();
  return singleton;
}

export default getAudio();
