// State, persistence, snapshots. Everything lives in this browser's localStorage.
import { isoDate, toPaise, pad, addDays } from './calc.js';

const KEY = 'ledger.v1';
const SNAP_KEY = 'ledger.snapshots';
export const VERSION = '1.2.3';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function defaultState() {
  return {
    schema: 1,
    settings: {
      theme: 'dark', hideAmounts: false, pinHash: null, lockAfter: 60,
      openingCash: 0, openingBank: 0, monthlyBudget: 0,
      rewind: 'weekly', lastRewind: null, showHidden: false, sound: true, onboarded: false, name: '',
    },
    accounts: [{ id: 'acc_savings', name: 'Savings' }, { id: 'acc_personal', name: 'Personal' }],
    sources: [
      { id: 'src_pocket', name: 'Pocket money' }, { id: 'src_salary', name: 'Salary' },
      { id: 'src_gift', name: 'Gift' }, { id: 'src_family', name: 'Family' },
    ],
    categories: [
      { id: 'cat_food', name: 'Food', icon: '🍜' }, { id: 'cat_travel', name: 'Travel', icon: '🚕' },
      { id: 'cat_shop', name: 'Shopping', icon: '🛍️' }, { id: 'cat_bills', name: 'Bills', icon: '🧾' },
      { id: 'cat_fun', name: 'Fun', icon: '🎬' }, { id: 'cat_health', name: 'Health', icon: '💊' },
      { id: 'cat_study', name: 'Study', icon: '📚' }, { id: 'cat_other', name: 'Other', icon: '•' },
    ],
    people: [],
    recurring: [],
    entries: [],
  };
}

function migrate(s) {
  const d = defaultState();
  return {
    ...d, ...s,
    settings: { ...d.settings, ...(s.settings || {}) },
    entries: Array.isArray(s.entries) ? s.entries : [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('Could not read saved data', e); }
  return defaultState();
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch (e) { console.error('Save failed', e); return false; }
}

// ---------- snapshots: one per day, last 10 kept ----------
export function listSnapshots() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch { return []; }
}
export function autoSnapshot(state) {
  const snaps = listSnapshots();
  const today = isoDate();
  if (snaps[0]?.date === today) snaps[0] = { date: today, at: Date.now(), count: state.entries.length, data: state };
  else snaps.unshift({ date: today, at: Date.now(), count: state.entries.length, data: state });
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(snaps.slice(0, 10))); } catch { /* storage full: skip */ }
}
export function clearAll() { localStorage.removeItem(KEY); localStorage.removeItem(SNAP_KEY); }

// ---------- backup files ----------
export function backupBlob(state) {
  return new Blob([JSON.stringify({ app: 'ledger', version: VERSION, exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
}
export function parseBackup(text) {
  const j = JSON.parse(text);
  const s = j.state || j;
  if (!s || !Array.isArray(s.entries) || !Array.isArray(s.accounts)) throw new Error('This file is not a Ledger backup.');
  return migrate(s);
}

// ---------- PIN ----------
export async function hashPin(pin) {
  const data = new TextEncoder().encode('ledger:' + pin);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const b of data) h = ((h << 5) + h + b) >>> 0; return 'djb2:' + h.toString(16);
}

// ---------- demo data ----------
export function demoState() {
  const s = defaultState();
  s.settings.onboarded = true;
  s.settings.openingCash = toPaise(4200);
  s.settings.openingBank = toPaise(18500);
  s.settings.monthlyBudget = toPaise(15000);
  s.accounts = [{ id: 'acc_personal', name: 'Personal' }, { id: 'acc_savings', name: 'Savings' }, { id: 'acc_trip', name: 'Goa trip' }];
  s.people = [
    { id: 'p_aman', name: 'Aman', vpa: 'aman@okaxis' },
    { id: 'p_riya', name: 'Riya', vpa: 'riya@ybl' },
    { id: 'p_chai', name: 'Sharma Chai Stall', vpa: 'sharmachai@paytm' },
  ];
  s.recurring = [{ id: 'r_phone', name: 'Phone recharge', amount: toPaise(299), method: 'upi', accountId: 'acc_personal', categoryId: 'cat_bills', day: 5, lastPosted: null, startMonth: isoDate().slice(0, 7) }];
  const today = isoDate();
  const mk = (daysAgo, type, rupees, extra) => ({
    id: uid(), type, amount: toPaise(rupees), date: addDays(today, -daysAgo),
    time: `${pad(9 + (daysAgo * 7) % 12)}:${pad((daysAgo * 13) % 60)}`, method: 'upi', accountId: 'acc_personal', createdAt: Date.now() - daysAgo * 864e5, ...extra,
  });
  s.entries = [
    mk(0, 'spent', 60, { categoryId: 'cat_food', note: 'Chai + samosa', method: 'cash', personId: 'p_chai' }),
    mk(0, 'spent', 240, { categoryId: 'cat_travel', note: 'Auto to college' }),
    mk(1, 'spent', 1299, { categoryId: 'cat_shop', note: 'Headphones', method: 'credit' }),
    mk(1, 'forSomeone', 450, { categoryId: 'cat_food', note: 'Dinner for Aman', personId: 'p_aman', expectBack: true }),
    mk(2, 'received', 5000, { sourceId: 'src_pocket', accountId: 'acc_personal', note: 'Monthly pocket money' }),
    mk(3, 'spent', 180, { categoryId: 'cat_fun', note: 'Movie snacks', method: 'cash' }),
    mk(4, 'spent', 899, { categoryId: 'cat_study', note: 'Books' , method: 'debit'}),
    mk(5, 'transfer', 2000, { kind: 'account', accountId: 'acc_personal', toAccountId: 'acc_trip', note: 'Saving for Goa' }),
    mk(6, 'spent', 320, { categoryId: 'cat_food', note: 'Pizza', method: 'upi' }),
    mk(8, 'received', 2100, { sourceId: 'src_gift', accountId: 'acc_savings', method: 'cash', note: 'Shagan from Nani' }),
    mk(9, 'spent', 150, { categoryId: 'cat_health', note: 'Medicines', method: 'cash' }),
    mk(10, 'transfer', 1000, { kind: 'toCash', note: 'ATM' }),
    mk(12, 'spent', 2200, { categoryId: 'cat_travel', note: 'Train tickets', offBalance: true, note2: 'Dad paid' }),
    mk(14, 'spent', 560, { categoryId: 'cat_food', note: 'Groceries' }),
  ];
  return s;
}
