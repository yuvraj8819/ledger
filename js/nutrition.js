// Nutrition maths: body targets, scaling foods, reading labels and barcode results.
// Pure: no DOM, no storage, no network.
import { addDays } from './calc.js';

export const NUTRIENTS = [
  ['kcal', 'Calories', 'kcal'], ['p', 'Protein', 'g'], ['c', 'Carbs', 'g'], ['f', 'Fat', 'g'],
  ['fib', 'Fibre', 'g'], ['sug', 'Sugar', 'g'], ['na', 'Sodium', 'mg'],
];
const KEYS = NUTRIENTS.map((n) => n[0]);
const r1 = (x) => Math.round(x * 10) / 10;
export const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

/** Sum nutrients over logged items (missing values count as 0). */
export function totals(items) {
  const t = zero();
  for (const it of items || []) for (const k of KEYS) t[k] += Number(it[k]) || 0;
  for (const k of KEYS) t[k] = k === 'kcal' || k === 'na' ? Math.round(t[k]) : r1(t[k]);
  return t;
}

/**
 * Nutrients for an amount of a food. A food is { serving: { label, g }, n: {kcal,p,c,f,fib,sug,na} per serving }.
 * amount is { servings } or { g }.
 */
export function scale(food, amount) {
  const f = amount.g != null && food.serving?.g ? amount.g / food.serving.g : Number(amount.servings ?? 1);
  const out = {};
  for (const k of KEYS) {
    const v = food.n?.[k];
    out[k] = v == null ? null : k === 'kcal' || k === 'na' ? Math.round(v * f) : r1(v * f);
  }
  return out;
}

export function amountLabel(food, amount) {
  if (amount.g != null) return `${Math.round(amount.g)} ${food.unit || 'g'}`;
  const s = Number(amount.servings ?? 1);
  const q = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1.5: '1½' }[s] || String(r1(s));
  return `${q} × ${food.serving?.label || 'serving'}`;
}

// ---------------------------------------------------------------- body & targets
export const ACTIVITY = {
  sedentary: { label: 'Mostly sitting', sub: 'Desk, school, little walking', x: 1.2 },
  light: { label: 'Lightly active', sub: 'On your feet some of the day, or light exercise 1–3×/week', x: 1.375 },
  moderate: { label: 'Active', sub: 'Exercise 3–5×/week', x: 1.55 },
  very: { label: 'Very active', sub: 'Hard training 6–7×/week', x: 1.725 },
};
export const GOALS = { lose: 'Lose weight', maintain: 'Stay the same', gain: 'Gain weight' };

export function bmi(p) {
  if (!p?.heightCm || !p?.weightKg) return null;
  const m = p.heightCm / 100;
  return r1(p.weightKg / (m * m));
}
/** Adult BMI label. Under 18 it needs a growth chart, so there's no label. */
export function bmiLabel(b, age) {
  if (b == null || age < 18) return null;
  return b < 18.5 ? 'Underweight' : b < 25 ? 'Healthy' : b < 30 ? 'Overweight' : 'Obese';
}

/**
 * Daily targets from a profile:
 * { sex: 'male'|'female', age, heightCm, weightKg, bodyFat?, activity, goal, pace (kg/week) }
 * Returns calories, macros and the reasoning behind them, with safety limits applied:
 *   • never below the resting burn (BMR)
 *   • weight loss capped at 1% of body weight a week (0.5%, max 0.5 kg, under 18)
 *   • under 18: carbs held at 130 g minimum
 */
export function targets(p) {
  if (!p || !(p.weightKg > 0) || !(p.heightCm > 0) || !(p.age > 0)) return null;
  const notes = [];
  const lbm = p.bodyFat > 0 && p.bodyFat < 70 ? p.weightKg * (1 - p.bodyFat / 100) : null;
  const bmr = Math.round(lbm ? 370 + 21.6 * lbm : 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'female' ? -161 : 5));
  const act = ACTIVITY[p.activity] || ACTIVITY.light;
  const maintenance = Math.round(bmr * act.x);
  notes.push({ t: `Maintenance ${maintenance} kcal a day`, s: `${lbm ? 'Katch-McArdle, from your lean mass' : 'Mifflin-St Jeor, from height, weight and age'}: resting burn ${bmr} kcal × ${act.x} for “${act.label.toLowerCase()}”.` });
  const teen = p.age < 18;
  let pace = Math.abs(Number(p.pace) || 0);
  let target = maintenance;
  if (p.goal === 'lose' && pace > 0) {
    const cap = teen ? Math.min(0.5, p.weightKg * 0.005) : p.weightKg * 0.01;
    if (pace > cap) {
      notes.push({ t: `Pace held at ${r1(cap)} kg a week`, s: teen ? `You're ${p.age}, still growing. ${r1(cap)} kg a week (0.5% of your weight) is the safe ceiling. Losing slowly, or holding your weight while you grow taller, works well.` : `${pace} kg a week is more than 1% of your body weight. Faster than that mostly costs muscle.` , warn: true });
      pace = cap;
    }
    target = Math.round(maintenance - (pace * 7700) / 7);
    if (target < bmr) {
      notes.push({ t: 'Held at your resting burn', s: `That pace works out to ${target} kcal, below the ${bmr} kcal your body uses just existing. Eating under that for weeks costs muscle and stalls progress, so the target stays at ${bmr}.`, warn: true });
      target = bmr;
    }
  } else if (p.goal === 'gain' && pace > 0) {
    pace = Math.min(pace, 0.5);
    target = Math.round(maintenance + (pace * 7700) / 7);
  }
  if (p.goal === 'lose' || p.goal === 'gain') notes.push({ t: `Target ${target} kcal`, s: p.goal === 'lose' ? `About ${r1(((maintenance - target) * 7) / 7700)} kg a week down.` : `About ${r1(((target - maintenance) * 7) / 7700)} kg a week up.` });
  // protein: per kg of lean mass when known, otherwise of a reference weight (BMI 25) for heavier bodies
  const refKg = Math.min(p.weightKg, 25 * (p.heightCm / 100) ** 2);
  const protein = Math.round(lbm ? lbm * 2.0 : refKg * (p.goal === 'maintain' ? 1.4 : 1.6));
  const fat = Math.round((target * 0.28) / 9);
  let carbs = Math.round((target - protein * 4 - fat * 9) / 4);
  if (teen && carbs < 130) { notes.push({ t: 'Carbs held at 130 g', s: 'Under 18, carbs stay at 130 g or more for growth and energy.' }); carbs = 130; }
  if (carbs < 50) carbs = 50;
  const fibre = Math.round((target / 1000) * 14);
  const sugarMax = Math.round((target * 0.1) / 4);
  const water = Math.round(Math.min(4.5, Math.max(2, p.weightKg * 0.035)) * 10) / 10;
  if (teen) notes.push({ t: 'Check with a doctor', s: 'Under 18, BMI is read on a growth chart, and any weight-loss plan is best agreed with a doctor.' });
  return { bmr, maintenance, target, pace, protein, carbs, fat, fibre, sugarMax, sodiumMax: 2300, water, teen, notes };
}

// ---------------------------------------------------------------- weight trend
/** Average of weigh-ins in the last `days` days (by date string), or null. */
export function weightTrend(weights, today, days = 10) {
  const f = addDays(today, -(days - 1));
  const xs = (weights || []).filter((w) => w.date >= f && w.date <= today);
  return xs.length ? r1(xs.reduce((s, w) => s + w.kg, 0) / xs.length) : null;
}

// ---------------------------------------------------------------- Open Food Facts
/** Turns an Open Food Facts product into a food (per 100 g), or null if it has no calories. */
export function offToFood(code, product) {
  if (!product) return null;
  const nm = product.nutriments || {};
  const v = (k) => nm[`${k}_100g`] ?? nm[`${k}_prepared_100g`] ?? null;
  let kcal = v('energy-kcal');
  if (kcal == null && v('energy-kj') != null) kcal = v('energy-kj') / 4.184;
  if (kcal == null && v('energy') != null) kcal = v('energy') / 4.184; // energy is kJ
  if (kcal == null) return null;
  const sodium = v('sodium') != null ? v('sodium') * 1000 : v('salt') != null ? (v('salt') / 2.5) * 1000 : null;
  const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
  const n = { kcal: Math.round(kcal), p: num(v('proteins')), c: num(v('carbohydrates')), f: num(v('fat')), fib: num(v('fiber')), sug: num(v('sugars')), na: sodium == null ? null : Math.round(sodium) };
  for (const k of ['p', 'c', 'f', 'fib', 'sug']) if (n[k] != null) n[k] = r1(n[k]);
  const sq = Number(product.serving_quantity) || null;
  return {
    name: (([product.product_name, /^\d+(\.\d+)?$/.test(String(product.quantity || '')) ? `${product.quantity} g` : product.quantity].filter(Boolean).join(' ').trim() || `Barcode ${code}`).replace(/^./, (c) => c.toUpperCase())),
    brand: (product.brands || '').split(',')[0].trim(), barcode: code, source: 'scanned',
    serving: { label: '100 g', g: 100 }, n, usualG: sq && sq < 2000 ? sq : null, servingText: product.serving_size || '',
  };
}

// ---------------------------------------------------------------- nutrition labels (OCR text)
/**
 * Reads nutrients out of OCR'd label text. Takes the first number after each nutrient's name,
 * which on Indian and most other labels is the "per 100 g" column. Returns { n, per100, found }.
 * Always shown to you to check before saving: OCR misreads happen.
 */
export function parseLabel(text) {
  const lines = String(text || '').replace(/[|]/g, ' ').replace(/(\d),(\d)/g, '$1.$2').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const n = { kcal: null, p: null, c: null, f: null, fib: null, sug: null, na: null };
  const first = (s) => { const m = s.match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };
  const after = (line, re) => { const i = line.search(re); return i < 0 ? null : first(line.slice(i).replace(re, ' ')); };
  const rules = [
    ['p', /protein/i], ['fib', /(dietary\s*)?fib(re|er)/i], ['sug', /(total\s*)?sugars?/i],
    ['c', /carbo\s*hydrates?|carbs?\b/i], ['f', /(total\s*)?fat\b/i], ['na', /sodium/i],
  ];
  for (const line of lines) {
    const low = line.toLowerCase();
    if (n.kcal == null && /energy|calor/i.test(line)) {
      const kc = line.match(/(\d+(?:\.\d+)?)\s*k\s*cal/i) || (/kcal/i.test(low) && !/kj/i.test(low) ? [null, first(line.replace(/^[^\d]*/, ''))] : null);
      if (kc && kc[1] != null) n.kcal = Math.round(Number(kc[1]));
      else { const kj = line.match(/(\d+(?:\.\d+)?)\s*k\s*j/i); if (kj) n.kcal = Math.round(Number(kj[1]) / 4.184); else { const v = first(line); if (v != null) n.kcal = Math.round(v); } }
      continue;
    }
    for (const [k, re] of rules) {
      if (n[k] != null || !re.test(line)) continue;
      if (k === 'f' && /saturated|trans|mono|poly/i.test(line)) continue;
      if (k === 'sug' && /added/i.test(line) && n.sug == null) { /* keep looking for total sugars, but take added if that's all there is */ }
      let v = after(line, re);
      if (v == null) continue;
      if (k === 'na' && /\bg\b/.test(line.slice(line.search(re))) && !/mg/i.test(line) && v < 10) v *= 1000;
      n[k] = k === 'na' ? Math.round(v) : r1(v);
      break;
    }
  }
  const per100 = /100\s*(g|ml)/i.test(text);
  const servingM = String(text).match(/serv(?:ing|e)\s*size[^\d]*(\d+(?:\.\d+)?)\s*(g|ml)/i) || String(text).match(/per\s*serv(?:ing|e)[^\d(]*\(?\s*(\d+(?:\.\d+)?)\s*(g|ml)/i);
  const found = Object.values(n).filter((x) => x != null).length;
  return { n, per100, servingG: servingM ? Number(servingM[1]) : null, found };
}
