// Steps + food rules that move money in the ledger. Pure logic: no DOM, no storage.
//
// Each finished day (from the start date up to yesterday) that has a step count gets settled:
//   • steps ≥ goal                                  → reward  (+₹500 by default)
//   • steps < goal  OR  overate (cheat meal, or calories ≥ goal + margin) → ONE penalty (−₹1,000 by default)
// Missing steps and overeating on the same day still cost one penalty, never two.
// The rules in force on the day it's first settled are frozen onto that day, so changing
// the rules later only affects future days. Editing a settled day (say, adding a meal you
// forgot) re-settles it with its frozen rules.
import { addDays, isoDate, parseDate } from './calc.js';

export const REWARD_SOURCE = { id: 'src_fitness', name: 'Fitness reward' };
export const PENALTY_CATEGORY = { id: 'cat_fitness', name: 'Fitness penalty', icon: '🏃' };

export function defaultHealth() {
  return {
    enabled: false,
    startDate: null,         // first day the rules count
    stepGoal: 10000,
    calorieGoal: 2000,       // kcal per day
    overMargin: 500,         // overeating = calories ≥ goal + this
    reward: 50000,           // paise
    penalty: 100000,         // paise
    method: 'upi',           // 'upi' moves the bank balance, 'cash' moves cash in hand
    accountId: null,         // bucket the money lands in (first account if empty)
    days: {},                // 'YYYY-MM-DD': { steps, stepsAt, stepsFrom, meals: [{ id, name, kcal, time, cheat }], rules? }
  };
}

export const rulesOf = (h) => ({ stepGoal: h.stepGoal, calorieGoal: h.calorieGoal, overMargin: h.overMargin, reward: h.reward, penalty: h.penalty });
export const caloriesOf = (day) => (day?.meals || []).reduce((s, m) => s + (Number(m.kcal) || 0), 0);

/** What a day earns or costs under the given rules. Works for unfinished days too (a preview). */
export function verdict(day, rules) {
  const steps = day?.steps ?? null;
  const kcal = caloriesOf(day);
  const cheat = (day?.meals || []).some((m) => m.cheat);
  const stepsKnown = steps != null;
  const stepsMet = stepsKnown && steps >= rules.stepGoal;
  const over = rules.calorieGoal > 0 ? kcal - rules.calorieGoal : 0;
  const overByCalories = rules.calorieGoal > 0 && over >= rules.overMargin;
  const overate = cheat || overByCalories;
  const reward = stepsMet ? rules.reward : 0;
  const penalty = (stepsKnown && !stepsMet) || overate ? rules.penalty : 0;
  const reasons = [];
  if (stepsKnown && !stepsMet) reasons.push('missed steps');
  if (cheat) reasons.push('cheat meal');
  if (overByCalories) reasons.push(`${over} kcal over`);
  return { steps, stepsKnown, stepsMet, kcal, cheat, over, overByCalories, overate, reward, penalty, net: reward - penalty, reasons };
}

/**
 * Is this day's step count the final one? A count synced early in the day (say 4,000 at 3 PM)
 * can only go up, so it's final if it already meets the goal, or if it was taken at 11:30 PM
 * or later. Otherwise the day waits for a later sync instead of being fined on half a day.
 */
export function stepsFinal(date, day, stepGoal) {
  if (day?.steps == null) return false;
  if (day.steps >= stepGoal || !day.stepsAt) return true;
  const cutoff = parseDate(date); cutoff.setHours(23, 30, 0, 0);
  return day.stepsAt >= cutoff.getTime();
}

/** Days from the start date up to yesterday that still have no step count (newest first). */
export function waitingDays(health, today = isoDate()) {
  if (!health?.enabled || !health.startDate) return [];
  const out = [];
  for (let d = addDays(today, -1); d >= health.startDate && out.length < 60; d = addDays(d, -1)) {
    const day = health.days[d];
    if (!stepsFinal(d, day, day?.rules?.stepGoal ?? health.stepGoal)) out.push(d);
  }
  return out;
}

const fmtSteps = (n) => new Intl.NumberFormat('en-IN').format(n);

/** The ledger entries the rules call for, keyed "day:kind". Freezes rules onto newly settled days. */
export function desiredEntries(state, today = isoDate()) {
  const h = state.health;
  const out = new Map();
  if (!h?.enabled || !h.startDate) return out;
  const accountId = state.accounts.some((a) => a.id === h.accountId) ? h.accountId : state.accounts[0]?.id;
  for (const [date, day] of Object.entries(h.days)) {
    if (date < h.startDate || date >= today || !stepsFinal(date, day, day.rules?.stepGoal ?? h.stepGoal)) continue;
    if (!day.rules) day.rules = rulesOf(h);
    const v = verdict(day, day.rules);
    const base = { date, time: '23:59', method: h.method === 'cash' ? 'cash' : 'upi', accountId };
    if (v.reward) out.set(`${date}:reward`, { ...base, type: 'received', amount: v.reward, sourceId: REWARD_SOURCE.id,
      note: `Step goal hit · ${fmtSteps(v.steps)} steps`, health: { day: date, kind: 'reward' } });
    if (v.penalty) out.set(`${date}:penalty`, { ...base, type: 'spent', amount: v.penalty, categoryId: PENALTY_CATEGORY.id,
      note: `Health penalty · ${v.reasons.join(' + ')}`, health: { day: date, kind: 'penalty' } });
  }
  return out;
}

/**
 * Brings the ledger's health entries in line with the rules. Mutates state.entries (and freezes
 * rules onto newly settled days). Safe to run as often as you like: it never posts a day twice.
 * Returns the days whose money changed, with their net effect in paise.
 */
export function syncHealth(state, today = isoDate(), newId = () => Math.random().toString(36).slice(2)) {
  const h = state.health;
  if (!h?.enabled || !h.startDate) return [];
  const want = desiredEntries(state, today);
  const touched = new Map();
  const bump = (day, delta) => touched.set(day, (touched.get(day) || 0) + delta);
  const signed = (e) => (e.type === 'received' ? e.amount : -e.amount);
  const kept = [];
  for (const e of state.entries) {
    if (!e.health) { kept.push(e); continue; }
    const key = `${e.health.day}:${e.health.kind}`;
    const w = want.get(key);
    if (!w) {
      // only take back money for days the rules cover
      if (e.health.day >= h.startDate) { bump(e.health.day, -signed(e)); continue; }
      kept.push(e); continue;
    }
    want.delete(key);
    if (e.amount !== w.amount || e.note !== w.note || e.method !== w.method || e.accountId !== w.accountId) {
      bump(e.health.day, signed(w) - signed(e));
      Object.assign(e, w);
    }
    kept.push(e);
  }
  for (const w of want.values()) { kept.push({ ...w, id: newId(), createdAt: Date.now() }); bump(w.date, signed(w)); }
  state.entries = kept;
  return [...touched].filter(([, d]) => d !== 0).map(([day, delta]) => ({ day, delta })).sort((a, b) => a.day.localeCompare(b.day));
}

/** Makes sure the reward source and penalty category exist, so entries have names. */
export function ensureTags(state) {
  if (!state.sources.some((s) => s.id === REWARD_SOURCE.id)) state.sources.push({ ...REWARD_SOURCE });
  if (!state.categories.some((c) => c.id === PENALTY_CATEGORY.id)) state.categories.push({ ...PENALTY_CATEGORY });
}

/**
 * Reads step counts out of pasted text or a link. Understands:
 *   "2026-11-10=12034"   "2026-11-10: 12,034"   "steps 2026-11-10 12034.0"   several pairs separated by , ; or new lines
 * A bare number with no date is returned under `fallbackDay` (if given).
 */
export function parseSteps(text, fallbackDay = null) {
  const out = {};
  const t = String(text || '');
  const re = /(\d{4}-\d{2}-\d{2})[^\d]{0,12}?([\d][\d,]*(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(t))) {
    const n = Math.round(parseFloat(m[2].replace(/,/g, '')));
    if (Number.isFinite(n) && n >= 0 && n < 200000) out[m[1]] = n;
  }
  if (!Object.keys(out).length && fallbackDay) {
    const bare = t.trim().match(/^([\d][\d,]*(?:\.\d+)?)$/);
    if (bare) { const n = Math.round(parseFloat(bare[1].replace(/,/g, ''))); if (n >= 0 && n < 200000) out[fallbackDay] = n; }
  }
  return out;
}

/** Totals over a date range: money earned, lost, and days that hit the goal. */
export function healthSummary(state, from, to) {
  let earned = 0, lost = 0, good = 0, bad = 0;
  for (const e of state.entries) {
    if (!e.health || e.health.day < from || e.health.day > to) continue;
    if (e.health.kind === 'reward') earned += e.amount; else lost += e.amount;
  }
  for (const [d, day] of Object.entries(state.health?.days || {})) {
    if (d < from || d > to || !day.rules) continue;
    const v = verdict(day, day.rules); if (v.penalty) bad++; else good++;
  }
  return { earned, lost, net: earned - lost, good, bad };
}

/** Foods logged before, most used first, for one-tap re-adding. */
export function frequentFoods(health, limit = 8) {
  const m = new Map();
  for (const day of Object.values(health?.days || {})) for (const f of day.meals || []) {
    const k = `${f.name.toLowerCase()}|${f.kcal}`;
    const r = m.get(k) || { name: f.name, kcal: f.kcal, count: 0 };
    r.count++; m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
