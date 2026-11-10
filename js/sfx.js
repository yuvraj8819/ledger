// Sound effects, synthesized with Web Audio — no audio files to download.
// Everything is short and quiet on purpose; turn it off in Settings.

let ctx = null;
let master = null;
let enabled = true;
export const log = []; // names of the last sounds played (handy when testing)

export function setEnabled(v) { enabled = !!v; }

function audio() {
  if (!ctx) {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    ctx = new A();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** One enveloped oscillator. f → to is an optional pitch glide. */
function tone({ f, to, d = 0.08, type = 'sine', g = 0.08, at = 0 }) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const vol = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + d);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(g, t + 0.008);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + d);
  osc.connect(vol).connect(master);
  osc.start(t);
  osc.stop(t + d + 0.03);
}

const SOUNDS = {
  tick: () => tone({ f: 1500, to: 1100, d: 0.035, g: 0.05 }),
  key: () => tone({ f: 880, to: 760, d: 0.045, type: 'triangle', g: 0.07 }),
  tab: () => tone({ f: 520, to: 780, d: 0.07, g: 0.06 }),
  on: () => tone({ f: 600, to: 920, d: 0.08, g: 0.06 }),
  off: () => tone({ f: 820, to: 520, d: 0.08, g: 0.06 }),
  open: () => tone({ f: 300, to: 600, d: 0.14, g: 0.045 }),
  close: () => tone({ f: 520, to: 280, d: 0.11, g: 0.04 }),
  success: () => { tone({ f: 660, d: 0.1, g: 0.08 }); tone({ f: 990, d: 0.16, g: 0.08, at: 0.08 }); },
  income: () => [784, 988, 1319].forEach((f, i) => { tone({ f, d: 0.16, type: 'triangle', g: 0.08, at: i * 0.07 }); tone({ f: f * 2, d: 0.1, g: 0.02, at: i * 0.07 }); }),
  delete: () => tone({ f: 240, to: 110, d: 0.18, type: 'triangle', g: 0.09 }),
  error: () => { tone({ f: 170, d: 0.07, type: 'square', g: 0.035 }); tone({ f: 150, d: 0.1, type: 'square', g: 0.035, at: 0.1 }); },
  unlock: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: 0.14, g: 0.07, at: i * 0.055 })),
};

// Short vibration to go with the sound on phones that support it (Android).
const BUZZ = { tick: 6, key: 6, tab: 8, on: 8, off: 8, success: 14, income: [10, 40, 14], delete: 22, error: [18, 50, 18], unlock: 14 };

export function play(name) {
  if (!enabled || !SOUNDS[name]) return;
  log.push(name);
  if (log.length > 50) log.shift();
  try { SOUNDS[name](); } catch { /* audio not available: stay silent */ }
  try { if (BUZZ[name]) navigator.vibrate?.(BUZZ[name]); } catch { /* ignore */ }
}
