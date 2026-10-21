/**
 * Optional success chime + haptic "phone tap" for app-wide feedback.
 *
 * Fired from celebrate() (lib/celebrate.js) on every successful save/update/
 * delete, with a slightly richer cue for milestone wins. Fully user-toggleable
 * from Settings → Sound & Haptics; default ON. All playback is best-effort and
 * silently no-ops when unsupported (e.g. no Web Audio, no vibration, locked
 * audio context before the first user gesture).
 */

const STORAGE_KEY = "finflow_sound_haptics";

const subscribers = new Set();

export function isSoundEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0"; // default ON
  } catch {
    return true;
  }
}

export function setSoundEnabled(v) {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  subscribers.forEach((fn) => {
    try { fn(!!v); } catch { /* noop */ }
  });
}

export function subscribeSoundPref(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// --- Web Audio: created lazily on first play (needs a user gesture to unlock).
let audioCtx = null;
function getCtx() {
  if (audioCtx) return audioCtx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

function tone(ctx, { freq, start, duration, gain = 0.08, type = "sine" }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  // Soft attack + exponential release so it reads as a gentle "ding", not a beep.
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

function playChime(milestone) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    if (milestone) {
      // Bright ascending arpeggio for a big win.
      tone(ctx, { freq: 659.25, start: 0, duration: 0.18, gain: 0.07 });   // E5
      tone(ctx, { freq: 783.99, start: 0.09, duration: 0.2, gain: 0.07 }); // G5
      tone(ctx, { freq: 1046.5, start: 0.19, duration: 0.28, gain: 0.08 }); // C6
    } else {
      // Subtle two-note confirmation for routine saves.
      tone(ctx, { freq: 587.33, start: 0, duration: 0.12, gain: 0.05 });    // D5
      tone(ctx, { freq: 880.0, start: 0.075, duration: 0.16, gain: 0.055 }); // A5
    }
  } catch {
    /* ignore */
  }
}

function vibrate(milestone) {
  try {
    if (navigator?.vibrate) {
      navigator.vibrate(milestone ? [18, 40, 28] : 18);
    }
  } catch {
    /* ignore */
  }
}

/** Play the success cue if the user hasn't turned it off. */
export function playSuccessCue({ milestone = false } = {}) {
  if (!isSoundEnabled()) return;
  playChime(milestone);
  vibrate(milestone);
}
