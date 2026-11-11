// Sound effects, synthesized with Web Audio — no audio files to download.
// Everything is short on purpose; turn it off in Settings.
//
// iPhone notes (why sounds used to go missing):
//  • Audio may only start from a tap. unlock() runs on the first touch and wakes the audio engine.
//  • After the app has been in the background the engine is left "interrupted", not "suspended";
//    it has to be resumed again on the next tap, or rebuilt if it won't wake.
//  • The ring/silent switch mutes web sounds unless the page asks for the "playback" audio
//    session (iOS 16.4+). That's the "Play on silent" setting; it can pause music from other apps.

let ctx = null;
let master = null;
let enabled = true;
let playOnSilent = true;
export const log = []; // names of the last sounds played (handy when testing)

export function setEnabled(v) { enabled = !!v; }
export function setPlayOnSilent(v) {
  playOnSilent = !!v;
  try { if (navigator.audioSession) navigator.audioSession.type = playOnSilent && enabled ? 'playback' : 'auto'; } catch { /* not supported */ }
}

function build() {
  const A = window.AudioContext || window.webkitAudioContext;
  if (!A) return null;
  ctx = new A();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  return ctx;
}
function audio() {
  if (!ctx || ctx.state === 'closed') { if (!build()) return null; }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

/** Wake the audio engine from inside a tap. Safe to call on every tap. */
let stuck = 0;
export function unlock() {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  // an engine that stays asleep through several taps is dead (seen after long backgrounding): rebuild it
  if (c.state !== 'running') { if (++stuck >= 3) { try { c.close(); } catch { /* ignore */ } ctx = null; stuck = 0; audio(); } } else stuck = 0;
  try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch { /* ignore */ }
}
if (typeof document !== 'undefined') {
  for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, unlock, { capture: true, passive: true });
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
  vol.gain.exponentialRampToValueAtTime(g, t + 0.006);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + d);
  osc.connect(vol).connect(master);
  osc.start(t);
  osc.stop(t + d + 0.03);
}

/** A coin hitting something hard: a few high partials that don't line up, ringing out fast. */
function clink(base, at = 0, g = 0.11, ring = 0.32) {
  [[1, 1], [1.51, 0.7], [2.02, 0.5], [2.76, 0.32], [3.9, 0.18]].forEach(([m, a], i) =>
    tone({ f: base * m, d: ring * (1 - i * 0.13), g: g * a, at }));
  tone({ f: base * 5.4, to: base * 3, d: 0.03, type: 'square', g: g * 0.25, at }); // the tick of the hit
}

const SOUNDS = {
  tick: () => tone({ f: 1500, to: 1100, d: 0.035, g: 0.07 }),
  key: () => tone({ f: 880, to: 760, d: 0.045, type: 'triangle', g: 0.09 }),
  tab: () => tone({ f: 520, to: 780, d: 0.07, g: 0.08 }),
  on: () => tone({ f: 600, to: 920, d: 0.08, g: 0.08 }),
  off: () => tone({ f: 820, to: 520, d: 0.08, g: 0.08 }),
  open: () => tone({ f: 300, to: 600, d: 0.14, g: 0.06 }),
  close: () => tone({ f: 520, to: 280, d: 0.11, g: 0.055 }),
  success: () => { tone({ f: 660, d: 0.1, g: 0.1 }); tone({ f: 990, d: 0.16, g: 0.1, at: 0.08 }); },
  income: () => [784, 988, 1319].forEach((f, i) => { tone({ f, d: 0.16, type: 'triangle', g: 0.1, at: i * 0.07 }); tone({ f: f * 2, d: 0.1, g: 0.03, at: i * 0.07 }); }),
  // money into the balance: two bright coins, the second higher (ch-ching)
  coinIn: () => { clink(2050, 0, 0.1, 0.22); clink(2730, 0.09, 0.13, 0.42); },
  // money out of the balance: one duller coin dropping away
  coinOut: () => { clink(1650, 0, 0.11, 0.26); clink(1240, 0.1, 0.08, 0.3); tone({ f: 190, to: 120, d: 0.12, type: 'triangle', g: 0.07, at: 0.1 }); },
  delete: () => tone({ f: 240, to: 110, d: 0.18, type: 'triangle', g: 0.11 }),
  error: () => { tone({ f: 170, d: 0.07, type: 'square', g: 0.045 }); tone({ f: 150, d: 0.1, type: 'square', g: 0.045, at: 0.1 }); },
  unlock: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: 0.14, g: 0.09, at: i * 0.055 })),
};

// Short vibration to go with the sound on phones that support it (Android).
const BUZZ = { tick: 6, key: 6, tab: 8, on: 8, off: 8, success: 14, income: [10, 40, 14], coinIn: [10, 50, 16], coinOut: [22, 40, 10], delete: 22, error: [18, 50, 18], unlock: 14 };

export function play(name) {
  if (!enabled || !SOUNDS[name]) return;
  log.push(name);
  if (log.length > 50) log.shift();
  try { SOUNDS[name](); } catch { /* audio not available: stay silent */ }
  try { if (BUZZ[name]) navigator.vibrate?.(BUZZ[name]); } catch { /* ignore */ }
}
export const state = () => ctx?.state || 'none';
