// Pure money logic. No DOM, no storage — everything here is testable on its own.
// Amounts are stored as integer paise (₹1 = 100) so sums never drift.

export const METHODS = {
  cash: { label: 'Cash', wallet: 'cash' },
  upi: { label: 'UPI', wallet: 'bank' },
  debit: { label: 'Debit card', wallet: 'bank' },
  credit: { label: 'Credit card', wallet: 'card' },
};

export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
export const toRupees = (paise) => paise / 100;

// ---------- dates (local time, YYYY-MM-DD strings) ----------
export const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
export const monthKey = (s) => s.slice(0, 7);
export const daysInMonth = (s) => { const d = parseDate(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
/** Days left in the month, counting today. */
export const daysLeftInMonth = (s) => daysInMonth(s) - parseDate(s).getDate() + 1;

// ---------- what an entry does to the wallets ----------
/**
 * Returns the change an entry makes to { cash, bank, card } (card = credit card due).
 * Spending is counted as "spent" even when off-balance; it just doesn't move a wallet.
 */
export function walletEffect(e) {
  const fx = { cash: 0, bank: 0, card: 0 };
  const a = e.amount;
  if (e.type === 'received') {
    fx[METHODS[e.method]?.wallet === 'cash' ? 'cash' : 'bank'] += a;
  } else if (e.type === 'spent' || e.type === 'forSomeone') {
    if (e.offBalance) return fx;
    const w = METHODS[e.method]?.wallet || 'cash';
    if (w === 'card') fx.card += a; else fx[w] -= a;
  } else if (e.type === 'transfer') {
    if (e.kind === 'toBank') { fx.cash -= a; fx.bank += a; }
    else if (e.kind === 'toCash') { fx.bank -= a; fx.cash += a; }
    else if (e.kind === 'cardBill') { fx.bank -= a; fx.card -= a; }
    // kind 'account' moves money between buckets only
  }
  return fx;
}

export function balances(state) {
  const s = state.settings || {};
  const out = { cash: s.openingCash || 0, bank: s.openingBank || 0, card: 0 };
  for (const e of state.entries) {
    const fx = walletEffect(e);
    out.cash += fx.cash; out.bank += fx.bank; out.card += fx.card;
  }
  out.total = out.cash + out.bank;
  return out;
}

/** Money each account (bucket) holds. Opening balances land in the first account. */
export function accountBalances(state) {
  const map = new Map(state.accounts.map((a) => [a.id, { id: a.id, name: a.name, in: 0, spent: 0, entries: 0 }]));
  const first = state.accounts[0]?.id;
  const opening = (state.settings?.openingCash || 0) + (state.settings?.openingBank || 0);
  if (first && opening) map.get(first).in += opening;
  const get = (id) => map.get(id) || map.get(first);
  for (const e of state.entries) {
    if (e.type === 'received') { const r = get(e.accountId); if (r) { r.in += e.amount; r.entries++; } }
    else if (e.type === 'spent' || e.type === 'forSomeone') {
      if (e.offBalance) continue;
      const r = get(e.accountId); if (r) { r.spent += e.amount; r.entries++; }
    } else if (e.type === 'transfer' && e.kind === 'account') {
      const from = get(e.accountId), to = get(e.toAccountId);
      if (from) { from.spent += e.amount; from.entries++; }
      if (to) { to.in += e.amount; to.entries++; }
    } else if (e.type === 'transfer' && e.kind === 'cardBill') {
      // paying the card bill doesn't change bucket totals — the spend was already counted
    }
  }
  return [...map.values()].map((r) => ({ ...r, left: r.in - r.spent }));
}

// ---------- periods & filters ----------
export const PERIODS = {
  today: { label: 'Today' },
  '7d': { label: '7 days' },
  '30d': { label: '30 days' },
  month: { label: 'Month' },
  all: { label: 'All' },
};

export function periodRange(period, today = isoDate()) {
  switch (period) {
    case 'today': return [today, today];
    case '7d': return [addDays(today, -6), today];
    case '30d': return [addDays(today, -29), today];
    case 'month': return [`${monthKey(today)}-01`, today];
    default: return ['0000-01-01', '9999-12-31'];
  }
}

export const inRange = (e, [from, to]) => e.date >= from && e.date <= to;
export const isSpend = (e) => e.type === 'spent' || e.type === 'forSomeone';

export function summarize(entries) {
  let spent = 0, received = 0, forOthers = 0;
  for (const e of entries) {
    if (e.type === 'received') received += e.amount;
    else if (e.type === 'spent') spent += e.amount;
    else if (e.type === 'forSomeone') { spent += e.amount; forOthers += e.amount; }
  }
  return { spent, received, forOthers, net: received - spent, count: entries.length };
}

/** Group sum by a key function; returns [{ key, amount, count, share }] largest first. */
export function groupSum(entries, keyFn) {
  const m = new Map();
  let total = 0;
  for (const e of entries) {
    const k = keyFn(e);
    if (k == null) continue;
    const r = m.get(k) || { key: k, amount: 0, count: 0 };
    r.amount += e.amount; r.count++; total += e.amount;
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ ...r, share: total ? r.amount / total : 0 })).sort((a, b) => b.amount - a.amount);
}

/** Daily spend totals for the last `days` days ending today, oldest first. */
export function dailySpend(entries, days = 7, today = isoDate()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ date: d, amount: entries.filter((e) => e.date === d && isSpend(e)).reduce((s, e) => s + e.amount, 0) });
  }
  return out;
}

// ---------- safe to spend ----------
/**
 * With a monthly budget: (budget − spent before today) spread over the days left.
 * Without one: today's opening balance spread over the days left.
 */
export function safeToSpend(state, today = isoDate()) {
  const daysLeft = daysLeftInMonth(today);
  const month = monthKey(today);
  const spendsThisMonth = state.entries.filter((e) => isSpend(e) && monthKey(e.date) === month);
  const spentToday = spendsThisMonth.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const spentBefore = spendsThisMonth.filter((e) => e.date < today).reduce((s, e) => s + e.amount, 0);
  const budget = state.settings?.monthlyBudget || 0;
  let pool;
  if (budget > 0) pool = budget - spentBefore;
  else {
    // balance as it stood at the start of today (add back today's on-balance spending)
    const b = balances(state).total;
    const todayOnBalance = spendsThisMonth.filter((e) => e.date === today && !e.offBalance && METHODS[e.method]?.wallet !== 'card')
      .reduce((s, e) => s + e.amount, 0);
    pool = b + todayOnBalance;
  }
  const perDay = Math.max(0, Math.floor(pool / daysLeft / 100) * 100); // whole rupees
  const left = perDay - spentToday;
  return { perDay, spentToday, left, daysLeft, usedBudget: budget > 0, progress: perDay ? Math.max(0, Math.min(1, left / perDay)) : 0 };
}

// ---------- people (IOUs) ----------
export function peopleSummary(state) {
  const map = new Map(state.people.map((p) => [p.id, { id: p.id, name: p.name, spentFor: 0, owed: 0, paidBack: 0 }]));
  for (const e of state.entries) {
    if (!e.personId || !map.has(e.personId)) continue;
    const r = map.get(e.personId);
    if (e.type === 'forSomeone') { r.spentFor += e.amount; if (e.expectBack) r.owed += e.amount; }
    if (e.type === 'received' && e.settles) r.paidBack += e.amount;
  }
  return [...map.values()].map((r) => ({ ...r, owes: Math.max(0, r.owed - r.paidBack) }));
}

export function sourcesSummary(state) {
  return groupSum(state.entries.filter((e) => e.type === 'received' && e.sourceId), (e) => e.sourceId);
}

// ---------- recurring bills ----------
/** Entries that recurring bills should have created up to `today` but haven't yet. */
export function dueRecurring(state, today = isoDate()) {
  const out = [];
  const tm = monthKey(today);
  for (const r of state.recurring || []) {
    if (r.paused) continue;
    let m = r.lastPosted ? nextMonth(r.lastPosted) : (r.startMonth || tm);
    while (m <= tm) {
      const day = Math.min(r.day, daysInMonth(`${m}-01`));
      const date = `${m}-${pad(day)}`;
      if (date > today) break;
      out.push({ recurringId: r.id, month: m, date });
      m = nextMonth(m);
    }
  }
  return out;
}
export function nextMonth(m) { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${pad(mo)}`; }

// ---------- rewind ----------
export function rewindWindow(freq, today = isoDate()) {
  if (freq === 'monthly') {
    const d = parseDate(today); d.setDate(0); // last day of previous month
    const to = isoDate(d);
    return { from: `${monthKey(to)}-01`, to, label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
  }
  // weekly: the last full Monday–Sunday week
  const d = parseDate(today);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  const to = addDays(today, -dow - 1);
  return { from: addDays(to, -6), to, label: 'Last week' };
}

export function rewind(state, from, to) {
  const ents = state.entries.filter((e) => e.date >= from && e.date <= to);
  const days = Math.round((parseDate(to) - parseDate(from)) / 864e5) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -days);
  const prev = summarize(state.entries.filter((e) => e.date >= prevFrom && e.date <= prevTo));
  const sum = summarize(ents);
  const spends = ents.filter(isSpend);
  const topCat = groupSum(spends, (e) => e.categoryId || null)[0] || null;
  const biggest = spends.slice().sort((a, b) => b.amount - a.amount)[0] || null;
  const daily = groupSum(spends, (e) => e.date);
  const noSpendDays = days - daily.length;
  return { ...sum, days, prevSpent: prev.spent, change: prev.spent ? (sum.spent - prev.spent) / prev.spent : null, topCat, biggest, noSpendDays, avgPerDay: Math.round(sum.spent / days / 100) * 100 };
}

// ---------- calculator ----------
/** Evaluates + − × ÷ % and parentheses. Returns a number or throws. No eval(). */
export function evaluate(expr) {
  const src = String(expr).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '').replace(/\s+/g, '');
  if (!src) return 0;
  let i = 0;
  const peek = () => src[i];
  function number() {
    const start = i;
    while (i < src.length && /[0-9.]/.test(src[i])) i++;
    if (start === i) throw new Error('Expected a number');
    const n = Number(src.slice(start, i));
    if (Number.isNaN(n)) throw new Error('Bad number');
    return n;
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    let v;
    if (peek() === '(') { i++; v = expression(); if (peek() !== ')') throw new Error('Missing )'); i++; }
    else v = number();
    if (peek() === '%') { i++; v = v / 100; }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++]; const r = factor();
      if (op === '/' && r === 0) throw new Error('Divide by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expression() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      // "200 + 10%" means 10% of 200
      const save = i; let r = term();
      if (src[i - 1] === '%' && /^[0-9.]+%$/.test(src.slice(save, i))) r = v * r;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = expression();
  if (i < src.length) throw new Error('Unexpected ' + src[i]);
  return Math.round(v * 100) / 100;
}

// ---------- UPI ----------
// iPhones don't route a plain upi:// link, so each app gets its own scheme.
export const UPI_APPS = {
  default: { label: 'UPI app', prefix: 'upi://pay?' },
  gpay: { label: 'GPay', prefix: 'tez://upi/pay?' },
  phonepe: { label: 'PhonePe', prefix: 'phonepe://pay?' },
  paytm: { label: 'Paytm', prefix: 'paytmmp://pay?' },
};
export function upiLink({ vpa, name, amount, note }, app = 'default') {
  const p = new URLSearchParams({ pa: vpa, pn: name || vpa, cu: 'INR' });
  if (amount) p.set('am', (amount / 100).toFixed(2));
  if (note) p.set('tn', note);
  return (UPI_APPS[app] || UPI_APPS.default).prefix + p.toString();
}
export function parseUpi(text) {
  const t = String(text || '').trim();
  if (t.startsWith('upi://')) {
    const q = new URLSearchParams(t.split('?')[1] || '');
    return { vpa: q.get('pa') || '', name: q.get('pn') || '', amount: q.get('am') ? toPaise(q.get('am')) : 0 };
  }
  if (/^[\w.\-]+@[\w.\-]+$/.test(t)) return { vpa: t, name: '', amount: 0 };
  return null;
}

// ---------- forgiving amounts ----------
/**
 * Reads an amount the way people type it: "1,200", "₹500/-", "Rs 80", "1.5k", "2 lakh", "120+80".
 * Returns paise, or NaN when it can't be read.
 */
export function parseAmount(text) {
  const t = String(text ?? '').toLowerCase().replace(/₹|rs\.?|inr|\/-|,|\s/g, '');
  if (!t) return NaN;
  const units = { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7 };
  const u = t.match(/^(\d+(?:\.\d+)?)(k|lakhs?|lac|l|crore|cr)$/);
  let v;
  if (u) v = parseFloat(u[1]) * units[u[2]];
  else { try { v = evaluate(t.replace(/x/g, '×')); } catch { return NaN; } }
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : NaN;
}

// ---------- most used first ----------
/** How often each value of `field` shows up in the latest entries: Map(value → count). */
export function usage(entries, field, recent = 300) {
  const m = new Map();
  for (const e of entries.slice(-recent)) { const k = e[field]; if (k) m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
/** `list` with the most used items first. Items never used keep their original order. */
export const byUsage = (list, counts) => list.map((x, i) => [x, i])
  .sort((a, b) => (counts.get(b[0].id) || 0) - (counts.get(a[0].id) || 0) || a[1] - b[1]).map(([x]) => x);
/** The single most used value, or `fallback`. */
export function mostUsed(counts, fallback, allowed = null) {
  let best = fallback, n = 0;
  for (const [k, c] of counts) if (c > n && (!allowed || allowed.includes(k))) { best = k; n = c; }
  return best;
}

/** The next date a recurring bill will be added to the ledger. */
export function nextBillDate(r, today = isoDate()) {
  const tm = monthKey(today);
  let m = r.lastPosted ? nextMonth(r.lastPosted) : (r.startMonth || tm);
  if (m < tm) m = tm;
  return `${m}-${pad(Math.min(r.day, daysInMonth(`${m}-01`)))}`;
}

// ---------- export ----------
export function toCSV(state) {
  const name = (list, id) => list.find((x) => x.id === id)?.name || '';
  const rows = [['Date', 'Time', 'Type', 'Amount (₹)', 'Method', 'Account', 'To account', 'Whose money', 'Category', 'Person', 'Note', 'Off balance']];
  for (const e of [...state.entries].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    rows.push([e.date, e.time || '', e.type === 'transfer' ? `transfer:${e.kind}` : e.type, (e.amount / 100).toFixed(2), e.method || '',
      name(state.accounts, e.accountId), name(state.accounts, e.toAccountId), name(state.sources, e.sourceId),
      name(state.categories, e.categoryId), name(state.people, e.personId), e.note || '', e.offBalance ? 'yes' : '']);
  }
  return rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\n');
}
