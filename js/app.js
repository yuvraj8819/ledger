import * as C from './calc.js';
import * as S from './store.js';
import { I } from './icons.js';
import * as X from './sfx.js';
import * as H from './health.js';
import * as N from './nutrition.js';
import * as F from './foods.js';
import * as SC from './scan.js';

// ================================================================ state
let state = S.load();
const ui = {
  tab: (location.hash.slice(1) || 'home'),
  period: 'month',
  filter: 'all',
  locked: !!state.settings.pinHash,
  hiddenAt: 0,
  hday: null, // day shown on the Health tab (null = today)
};
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = !!navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const hintKey = 'ledger.installHint';
const showInstallHint = () => { if (STANDALONE) return false; try { return !localStorage.getItem(hintKey) && (IOS || /Android/.test(navigator.userAgent)); } catch { return false; } };
const FINE = matchMedia('(pointer: fine)').matches; // mouse/trackpad, not a phone
const TABS = ['home', 'ledger', 'health', 'accounts', 'pay', 'settings'];
const bootHash = location.hash;
if (!TABS.includes(ui.tab)) ui.tab = 'home';

function commit(msg, sound = 'success') {
  S.save(state);
  S.autoSnapshot(state);
  if (msg) ui.fresh = true;
  render();
  if (msg) { toast(msg); X.play(sound); }
}
/** A toast for "you missed something", with the error sound. */
function warn(msg) { toast(msg); X.play('error'); }
function countUp(el, from, to) {
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now(), dur = 750;
  const step = (now) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    el.textContent = nf0.format(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // frames pause when the app is in the background; never leave a half-counted number
  setTimeout(() => { if (el.isConnected) el.textContent = nf0.format(to); }, dur + 60);
}

// ================================================================ helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ₹ string from paise. */
function rs(p, { sign = false } = {}) {
  const abs = Math.abs(p);
  const body = abs % 100 ? nf2.format(abs / 100) : nf0.format(abs / 100);
  const pre = p < 0 ? '−' : sign && p > 0 ? '+' : '';
  return `${pre}₹${body}`;
}
/** Money that blurs in privacy mode. */
const money = (p, opts) => `<span class="num money">${rs(p, opts)}</span>`;
const byId = (list, id) => list.find((x) => x.id === id);
const nameOf = (list, id) => byId(list, id)?.name || '';
const today = () => C.isoDate();
const nowTime = () => { const d = new Date(); return `${C.pad(d.getHours())}:${C.pad(d.getMinutes())}`; };
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${C.pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtDay(d) {
  const t = today();
  if (d === t) return 'Today';
  if (d === C.addDays(t, -1)) return 'Yesterday';
  const dt = C.parseDate(d);
  const sameYear = d.slice(0, 4) === t.slice(0, 4);
  return dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
const visibleEntries = () => state.entries.filter((e) => !e.hidden || state.settings.showHidden);
const sortEntries = (list) => list.slice().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.createdAt || 0) - (a.createdAt || 0));

function entryTitle(e) {
  if (e.type === 'transfer') {
    if (e.kind === 'account') return `${nameOf(state.accounts, e.accountId)} → ${nameOf(state.accounts, e.toAccountId)}`;
    return { toBank: 'Cash deposited', toCash: 'Cash withdrawn', cardBill: 'Card bill paid' }[e.kind] || 'Transfer';
  }
  return e.note || (e.type === 'received' ? nameOf(state.sources, e.sourceId) : '') || nameOf(state.people, e.personId)
    || nameOf(state.categories, e.categoryId) || ({ spent: 'Spent', received: 'Received', forSomeone: 'For someone' }[e.type]);
}
function entrySub(e) {
  const bits = [];
  if (e.type !== 'transfer') bits.push(C.METHODS[e.method]?.label || '');
  if (e.type === 'forSomeone' && e.personId) bits.push(`for ${nameOf(state.people, e.personId)}`);
  else if (e.personId && e.type !== 'received') bits.push(nameOf(state.people, e.personId));
  if (e.sourceId) bits.push(nameOf(state.sources, e.sourceId));
  if (e.type !== 'transfer' || e.kind === 'account') { if (e.type !== 'transfer') bits.push(nameOf(state.accounts, e.accountId)); }
  if (e.time) bits.push(fmtTime(e.time));
  return bits.filter(Boolean).map(esc).join(' · ');
}
function entryIcon(e) {
  if (e.type === 'received') return `<div class="ic in">${I.down}</div>`;
  if (e.type === 'transfer') return `<div class="ic mv">${I.swap}</div>`;
  if (e.type === 'forSomeone') return `<div class="ic out">${I.gift}</div>`;
  const cat = byId(state.categories, e.categoryId);
  return `<div class="ic out">${cat?.icon ? esc(cat.icon) : I.up}</div>`;
}
function entryRow(e) {
  const cls = e.type === 'received' ? 'in' : e.offBalance ? 'off' : '';
  const amt = e.type === 'received' ? money(e.amount, { sign: true }) : e.type === 'transfer' ? money(e.amount) : money(-e.amount);
  const tags = [e.hidden ? '<span class="tag">hidden</span>' : '', e.offBalance ? '<span class="tag">not mine</span>' : '',
    e.expectBack ? '<span class="tag warn">owed</span>' : '', e.recurringId ? '<span class="tag">auto</span>' : '', e.health ? '<span class="tag">health</span>' : ''].join('');
  return `<button class="row" data-act="open-entry" data-id="${e.id}">
    ${entryIcon(e)}
    <div class="mid"><div class="t">${esc(entryTitle(e))}${tags}</div><div class="s">${entrySub(e)}</div></div>
    <div class="amt ${cls}">${amt}</div></button>`;
}
function groupedList(entries, { showDayTotal = true } = {}) {
  if (!entries.length) return `<div class="empty"><b>Nothing here yet</b>Tap + to add your first entry.</div>`;
  let out = '', cur = null, buf = [];
  const flush = () => {
    if (!cur) return;
    const net = buf.reduce((s, e) => s + (e.type === 'received' ? e.amount : C.isSpend(e) ? -e.amount : 0), 0);
    out += `<div class="day-head"><span>${fmtDay(cur)}</span>${showDayTotal ? `<span>${money(net, { sign: true })}</span>` : ''}</div><div class="list">${buf.map(entryRow).join('')}</div>`;
  };
  for (const e of sortEntries(entries)) {
    if (e.date !== cur) { flush(); cur = e.date; buf = []; }
    buf.push(e);
  }
  flush();
  return out;
}

// ================================================================ shell
function topbar() {
  const s = state.settings;
  return `<header class="topbar">
    <div class="brand"><h1>Ledger</h1><p>Cash · UPI · Cards</p></div>
    <div class="top-actions">
      <button class="icon-btn" data-act="search" aria-label="Search">${I.search}</button>
      <button class="icon-btn ${s.hideAmounts ? 'on' : ''}" data-act="toggle-hide" aria-label="${s.hideAmounts ? 'Show amounts' : 'Hide amounts'}">${s.hideAmounts ? I.eyeOff : I.eye}</button>
      <button class="icon-btn ${s.pinHash ? '' : 'dim'}" data-act="lock-now" aria-label="${s.pinHash ? 'Lock now' : 'Set a passcode'}">${I.lock}</button>
      <button class="icon-btn" data-act="toggle-theme" aria-label="Switch theme">${I.theme}</button>
    </div></header>`;
}
function tabbar() {
  const t = (id, label) => `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}" aria-label="${label}">${I[id]}<span>${label}</span></button>`;
  return `<nav class="tabbar"><i class="ind" style="--i:${TABS.indexOf(ui.tab)}"></i>${t('home', 'Home')}${t('ledger', 'Ledger')}${t('health', 'Health')}${t('accounts', 'Accounts')}${t('pay', 'Pay')}${t('settings', 'Settings')}</nav>
    <button class="fab" data-act="new-entry" aria-label="New entry">${I.plus}</button>
    <button class="calc-fab" data-act="calc" aria-label="Calculator">=</button>`;
}

/** The tab bar and floating buttons are built once; later renders only move the highlight.
 *  Rebuilding them made the frosted bar flash and the + button's glow restart on every tap. */
function syncChrome() {
  let nav = $('#chrome .tabbar');
  if (!nav) { $('#chrome').innerHTML = tabbar(); nav = $('#chrome .tabbar'); }
  $$('.tab', nav).forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('.ind', nav).style.setProperty('--i', TABS.indexOf(ui.tab));
}

function render() {
  const s = state.settings;
  document.documentElement.dataset.theme = s.theme;
  X.setEnabled(s.sound !== false);
  document.body.classList.toggle('privacy', !!s.hideAmounts);
  $('meta[name="theme-color"]')?.setAttribute('content', s.theme === 'light' ? '#f3f2ee' : '#08090a');
  const app = $('#app');
  if (!s.onboarded) { app.innerHTML = welcomeView(); $('#chrome').innerHTML = ''; return; }
  const views = { home: homeView, ledger: ledgerView, health: healthView, accounts: accountsView, pay: payView, settings: settingsView };
  const scroll = window.scrollY;
  const same = app.dataset.tab === ui.tab;
  app.innerHTML = topbar() + `<main class="view ${same ? (ui.fresh ? 'refresh' : '') : 'enter'}">${views[ui.tab]()}</main>`;
  app.dataset.tab = ui.tab;
  syncChrome();
  const tn = $('#total-num');
  if (tn) {
    const v = Number(tn.dataset.v);
    if (!same) countUp(tn, 0, v); else if (ui.lastTotal != null && ui.lastTotal !== v) countUp(tn, ui.lastTotal, v);
    ui.lastTotal = v;
  }
  ui.fresh = false;
  maskDigits(app);
  if (same) window.scrollTo(0, scroll);
  renderLock();
}

// ================================================================ views
function welcomeView() {
  return `<div class="welcome view">
    <div class="lock" style="position:static;padding:0;background:none;backdrop-filter:none;animation:none;align-items:flex-start"><div class="logo" style="width:68px;height:68px"><img src="icons/icon-192.png" alt="Ledger"></div></div>
    <h1>Every rupee,<br>accounted for.</h1>
    <p>A private ledger for cash, UPI and cards. It lives on this device only — no account, no cloud.</p>
    <div class="feature-list">
      <div><span>${I.rupee}</span>Know what's safe to spend today</div>
      <div><span>${I.accounts}</span>Split money into accounts like Savings or Trip</div>
      <div><span>${I.pay}</span>Pay by UPI and log it in one go</div>
      <div><span>${I.lock}</span>Passcode lock and hide amounts</div>
    </div>
    <div class="card">
      <div class="eyebrow">Start with what you have now</div>
      <div class="opts" style="margin-top:12px">
        <div><label class="eyebrow" for="w-cash">Cash in hand</label><input class="input num" id="w-cash" inputmode="decimal" placeholder="₹0" style="margin-top:8px"></div>
        <div><label class="eyebrow" for="w-bank">Bank · UPI</label><input class="input num" id="w-bank" inputmode="decimal" placeholder="₹0" style="margin-top:8px"></div>
      </div>
      <button class="btn accent" data-act="onboard" style="margin-top:16px">Start my ledger</button>
    </div>
    <button class="btn ghost" data-act="demo" style="margin-top:10px">Explore with demo data</button>
  </div>`;
}

function homeView() {
  const b = C.balances(state);
  const safe = C.safeToSpend(state);
  const month = C.summarize(state.entries.filter((e) => C.inRange(e, C.periodRange('month'))));
  const spark = C.dailySpend(state.entries, 7);
  const maxSpark = Math.max(1, ...spark.map((d) => d.amount));
  const recent = sortEntries(visibleEntries()).slice(0, 6);
  const meterCls = safe.left < 0 ? 'over' : safe.progress < .25 ? 'low' : '';
  const rw = state.settings.rewind !== 'off' ? C.rewindWindow(state.settings.rewind) : null;
  const showRewindCta = rw && state.settings.lastRewind !== rw.to && state.entries.some((e) => e.date >= rw.from && e.date <= rw.to);
  const owed = C.peopleSummary(state).reduce((s, p) => s + p.owes, 0);
  const wd = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return `
  ${showInstallHint() ? `<section class="card install"><img class="logo-sm" src="icons/icon-192.png" alt=""><div><div class="t">Install Ledger</div><div class="s">${IOS ? `Tap Share ${I.up} then <b>Add to Home Screen</b> to open it like an app.` : 'Open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.'}</div></div><button class="x" data-act="dismiss-install" aria-label="Dismiss">${I.x}</button></section>` : ''}
  ${!state.settings.pinHash && (() => { try { return !localStorage.getItem('ledger.passcodeHint'); } catch { return false; } })() ? `<section class="card install"><div class="ic-lock">${I.lock}</div><div><div class="t">Add a passcode</div><div class="s">Lock Ledger so only you can open it.</div></div><button class="btn sm accent" data-act="lock-now" style="margin-left:auto">Set</button><button class="x" data-act="dismiss-passcode" aria-label="Dismiss" style="margin-left:4px">${I.x}</button></section>` : ''}
  <section class="card hero">
    <div class="eyebrow">Total balance</div>
    <div class="total num money">${b.total < 0 ? '−' : ''}<span class="cur">₹</span><span id="total-num" data-v="${Math.abs(Math.round(b.total / 100))}">${nf0.format(Math.abs(Math.round(b.total / 100)))}</span></div>
    <div class="delta">${month.count ? `${month.net >= 0 ? 'Up' : 'Down'} ${money(Math.abs(month.net))} this month` : 'Nothing in or out this month yet'}</div>
    <div class="split">
      <div class="pill"><div class="eyebrow"><i class="dot d-cash"></i>Cash</div><div class="v">${money(b.cash)}</div></div>
      <div class="pill"><div class="eyebrow"><i class="dot d-bank"></i>Bank · UPI</div><div class="v">${money(b.bank)}</div></div>
      ${b.card > 0 ? `<div class="pill wide"><div class="eyebrow"><i class="dot d-card"></i>Credit card due</div><div class="v">${money(b.card)}</div></div>` : ''}
    </div>
  </section>

  <section class="card safe tap" data-act="safe-help" style="margin-top:12px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="eyebrow">${safe.left < 0 ? 'Over today’s limit' : 'Safe to spend today'}</div><span class="help">?</span>
    </div>
    <div class="big num ${safe.left < 0 ? 'neg' : ''}">${rs(safe.left)}<small>of ${rs(safe.perDay)}</small></div>
    <div class="meter ${meterCls}"><i style="width:${(safe.progress * 100).toFixed(1)}%"></i></div>
    <div class="foot">${rs(safe.spentToday)} spent today · ${safe.daysLeft} day${safe.daysLeft === 1 ? '' : 's'} left${safe.usedBudget ? ' · from your budget' : ''}</div>
    <div class="spark" aria-label="Spending, last 7 days">${spark.map((d, i) => `<div class="b ${i === 6 ? 'today' : ''} ${d.amount ? 'has' : ''}" tabindex="0" data-tip="${esc(fmtDay(d.date))}: ${rs(d.amount)}"><i style="height:${Math.max(4, (d.amount / maxSpark) * 46)}px"></i><span>${wd[C.parseDate(d.date).getDay()]}</span></div>`).join('')}</div>
  </section>

  <div class="eyebrow" style="margin:18px 4px 0">This month</div>
  <div class="stats" style="margin-top:8px">
    <button class="stat" data-act="goto-ledger" data-filter="spent" style="text-align:left"><div class="eyebrow">Spent</div><div class="v neg">${money(month.spent)}</div></button>
    <button class="stat" data-act="goto-ledger" data-filter="forSomeone" style="text-align:left"><div class="eyebrow">For others</div><div class="v">${money(month.forOthers)}</div></button>
    <button class="stat" data-act="goto-ledger" data-filter="received" style="text-align:left"><div class="eyebrow">Received</div><div class="v pos">${money(month.received)}</div></button>
  </div>

  ${healthHomeRow()}
  ${owed > 0 ? `<button class="row" data-act="tab" data-tab="accounts" style="margin-top:12px"><div class="ic" style="background:rgba(244,183,64,.14);color:var(--warn)">${I.user}</div><div class="mid"><div class="t">People owe you ${money(owed)}</div><div class="s">Tap to settle up</div></div><span class="chev">${I.chev}</span></button>` : ''}
  ${showRewindCta ? `<button class="row rw-cta" data-act="rewind" style="margin-top:12px"><div class="ic" style="background:var(--accent-soft);color:var(--accent)">${I.sparkle}</div><div class="mid"><div class="t">Your ${rw.label.toLowerCase() === 'last week' ? 'week' : rw.label} rewind is ready</div><div class="s">See where the money went</div></div><span class="chev">${I.chev}</span></button>` : ''}

  <div class="section-head"><h2>Recent</h2><button class="link" data-act="tab" data-tab="ledger">See all →</button></div>
  ${recent.length ? `<div class="list">${recent.map(entryRow).join('')}</div>` : `<div class="empty"><b>No entries yet</b>Tap the red + to log money in or out.</div>`}`;
}

function ledgerView() {
  const range = C.periodRange(ui.period);
  const inPeriod = visibleEntries().filter((e) => C.inRange(e, range));
  const sum = C.summarize(inPeriod);
  const filters = {
    all: () => true, cash: (e) => e.method === 'cash', bank: (e) => ['upi', 'debit', 'credit'].includes(e.method),
    spent: (e) => e.type === 'spent', forSomeone: (e) => e.type === 'forSomeone', received: (e) => e.type === 'received', transfer: (e) => e.type === 'transfer',
  };
  const shown = inPeriod.filter(filters[ui.filter] || filters.all);
  const byCat = C.groupSum(inPeriod.filter(C.isSpend), (e) => e.categoryId || 'none');
  const bySrc = C.groupSum(inPeriod.filter((e) => e.type === 'received'), (e) => e.sourceId || 'none');
  const accts = C.accountBalances({ ...state, entries: inPeriod, settings: ui.period === 'all' ? state.settings : {} }).filter((a) => a.in || a.spent);
  const bar = (label, r, inc) => `<div class="bar-row ${inc ? 'inc' : ''}"><div class="top"><span>${label}</span>${money(r.amount)}</div><div class="track"><i style="width:${(r.share * 100).toFixed(1)}%"></i></div><div class="sub">${Math.round(r.share * 100)}% · ${r.count} entr${r.count === 1 ? 'y' : 'ies'}</div></div>`;
  const chip = (k, label, act, cur) => `<button class="chip ${cur === k ? 'on' : ''}" data-act="${act}" data-v="${k}">${label}</button>`;

  return `
  <div class="chips">${Object.entries(C.PERIODS).map(([k, p]) => chip(k, p.label, 'period', ui.period)).join('')}</div>
  <section class="card" style="margin-top:12px">
    <div style="display:flex;justify-content:space-between"><div class="eyebrow">${C.PERIODS[ui.period].label === 'All' ? 'All time' : C.PERIODS[ui.period].label}</div><div class="eyebrow">${sum.count} entr${sum.count === 1 ? 'y' : 'ies'}</div></div>
    <div class="kv" style="margin-top:14px">
      <div><div class="eyebrow">Spent</div><div class="v neg">${money(sum.spent)}</div></div>
      <div><div class="eyebrow">Received</div><div class="v">${money(sum.received)}</div></div>
    </div>
    ${byCat.length ? `<div class="divider"></div><div class="eyebrow" style="margin-bottom:14px">Spent by category</div><div class="bars">${byCat.slice(0, 6).map((r) => { const c = byId(state.categories, r.key); return bar(c ? `${esc(c.icon || '')} ${esc(c.name)}` : 'Uncategorised', r); }).join('')}</div>` : ''}
    ${bySrc.length ? `<div class="divider"></div><div class="eyebrow" style="margin-bottom:14px">Received from</div><div class="bars">${bySrc.slice(0, 6).map((r) => bar(esc(nameOf(state.sources, r.key) || 'Not set'), r, true)).join('')}</div>` : ''}
    ${accts.length ? `<div class="divider"></div><div class="eyebrow" style="margin-bottom:6px">By account</div>${accts.map((a) => `<div class="line-item"><div class="grow"><div class="t">${esc(a.name)}</div><div class="s">in ${rs(a.in)} · out ${rs(a.spent)}</div></div><div class="num money" style="font-weight:650">${rs(a.left, { sign: true })}</div></div>`).join('')}` : ''}
  </section>
  <div class="chips" style="margin-top:16px">${chip('all', 'All', 'filter', ui.filter)}${chip('cash', 'Cash', 'filter', ui.filter)}${chip('bank', 'Bank · Card', 'filter', ui.filter)}${chip('spent', 'Spent', 'filter', ui.filter)}${chip('forSomeone', 'For others', 'filter', ui.filter)}${chip('received', 'Received', 'filter', ui.filter)}${chip('transfer', 'Transfers', 'filter', ui.filter)}</div>
  ${groupedList(shown)}`;
}

function accountsView() {
  const all = C.accountBalances(state);
  const b = C.balances(state);
  const totIn = all.reduce((s, a) => s + a.in, 0), totOut = all.reduce((s, a) => s + a.spent, 0);
  const people = C.peopleSummary(state).filter((p) => p.spentFor || p.owes);
  const sources = C.sourcesSummary(state);
  const maxLeft = Math.max(1, ...all.map((a) => Math.max(0, a.left)));
  return `
  <div class="section-head" style="margin-top:4px"><h2>Accounts</h2><div style="display:flex;gap:16px"><button class="link" data-act="transfer">⇄ Transfer</button><button class="link" data-act="new-account">+ New</button></div></div>
  <section class="card acct hero">
    <div class="head"><div class="name">All accounts</div><div class="bal num money">${rs(totIn - totOut)}</div></div>
    <div class="meta"><div>In<b>${money(totIn)}</b></div><div>Out<b>${money(totOut)}</b></div><div>Accounts<b>${all.length}</b></div></div>
    <div class="s faint" style="margin-top:12px;font-size:12.5px">${b.card > 0 ? `Home shows ${rs(b.total)} because ${rs(b.card)} is still due on your credit card.` : 'Matches your Home balance.'}</div>
  </section>
  ${all.map((a) => `<section class="card acct tap" data-act="open-account" data-id="${a.id}">
    <div class="head"><div class="name">${esc(a.name)}</div><div class="bal num money">${rs(a.left)}</div></div>
    <div class="meta"><div>In<b>${money(a.in)}</b></div><div>Out<b>${money(a.spent)}</b></div><div>Entries<b>${a.entries}</b></div></div>
    <div class="share"><i style="width:${Math.max(0, a.left) / maxLeft * 100}%"></i></div>
  </section>`).join('')}

  <div class="section-head"><h2>People</h2><button class="link" data-act="new-person">+ Add</button></div>
  ${people.length ? `<div class="card" style="padding:4px 18px">${people.map((p) => `<div class="line-item">
      <div class="ic" style="width:36px;height:36px;border-radius:12px;background:var(--surface-3);display:grid;place-items:center;font-weight:700">${esc(p.name[0] || '?')}</div>
      <div class="grow"><div class="t">${esc(p.name)}</div><div class="s">Spent for them ${rs(p.spentFor)}${p.paidBack ? ` · paid back ${rs(p.paidBack)}` : ''}</div></div>
      ${p.owes ? `<button class="btn sm ghost" data-act="settle" data-id="${p.id}">Owes ${money(p.owes)}</button>` : '<span class="faint" style="font-size:13px">Settled</span>'}
    </div>`).join('')}</div>` : `<div class="empty"><b>No one owes you</b>Use “For someone” when you pay for a friend.</div>`}

  ${sources.length ? `<div class="section-head"><h2>Whose money</h2></div><div class="card" style="padding:4px 18px">${sources.map((r) => `<div class="line-item"><div class="grow"><div class="t">${esc(nameOf(state.sources, r.key))}</div><div class="s">${r.count} entr${r.count === 1 ? 'y' : 'ies'} · ${Math.round(r.share * 100)}%</div></div>${money(r.amount)}</div>`).join('')}</div>` : ''}`;
}

function payView() {
  const payees = state.people.filter((p) => p.vpa);
  const upcoming = (state.recurring || []).filter((r) => !r.paused).map((r) => {
    const t = today(); let m = C.monthKey(t);
    if (r.lastPosted === m) m = C.nextMonth(m);
    const date = `${m}-${C.pad(Math.min(r.day, C.daysInMonth(m + '-01')))}`;
    return { ...r, next: date };
  }).sort((a, b) => a.next.localeCompare(b.next));
  return `
  <div class="section-head" style="margin-top:4px"><h2>Pay</h2></div>
  <section class="card hero">
    <div class="eyebrow">Pay anyone by UPI</div>
    <p class="muted" style="margin:8px 0 14px;font-size:14px">Opens your UPI app with the amount filled in, then logs the payment here.</p>
    <div class="search-box">${I.qr}<input id="pay-vpa" placeholder="UPI ID or paste a upi:// link" autocapitalize="off" autocomplete="off" spellcheck="false"></div>
    <button class="btn accent" data-act="pay-new" style="margin-top:12px">Continue</button>
  </section>

  <div class="section-head"><h2>Saved</h2><button class="link" data-act="new-person" data-upi="1">+ Add payee</button></div>
  ${payees.length ? `<div class="list">${payees.map((p) => `<button class="row" data-act="pay-person" data-id="${p.id}">
      <div class="ic" style="font-weight:750">${esc(p.name[0] || '?')}</div>
      <div class="mid"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.vpa)}</div></div><span class="chev">${I.chev}</span></button>`).join('')}</div>`
    : `<div class="empty"><b>No saved payees</b>Add the shop, friend or bill you pay most.</div>`}

  <div class="section-head"><h2>Bills</h2><button class="link" data-act="settings-page" data-page="money">Manage</button></div>
  ${upcoming.length ? `<div class="list">${upcoming.map((r) => `<div class="row" style="cursor:default">
      <div class="ic">${I.repeat}</div>
      <div class="mid"><div class="t">${esc(r.name)}</div><div class="s">Next on ${esc(fmtDay(r.next))} · added for you automatically</div></div>
      <div class="amt">${money(r.amount)}</div></div>`).join('')}</div>`
    : `<div class="empty"><b>No recurring bills</b>Add rent, recharges or subscriptions in Settings → Money & bills.</div>`}`;
}

function settingsView() {
  const item = (page, icon, t, s) => `<section class="card tap" data-act="settings-page" data-page="${page}"><div class="set-row"><div class="ic">${I[icon]}</div><div><div class="t">${t}</div><div class="s">${s}</div></div><span class="go">${I.arrow}</span></div></section>`;
  return `<div class="section-head" style="margin-top:4px"><h2>Settings</h2></div>
    ${item('money', 'rupee', 'Money & bills', 'Opening balances, monthly budget, recurring bills')}
    ${item('tags', 'tag', 'Accounts & tags', 'Accounts, whose money, categories, people')}
    ${item('rewind', 'clock', 'Rewind', 'How often you get a wrap-up')}
    ${item('privacy', 'lock', 'Privacy & lock', 'Passcode, hide amounts, hidden entries')}
    ${item('export', 'download', 'Export & backup', 'Excel, backup file, restore')}
    ${item('device', 'device', 'This device', 'Snapshots, demo data, erase, version')}
    <section class="card tap" data-act="toggle-sound"><div class="set-row"><div class="ic">${I.sound}</div><div><div class="t">Sounds & haptics</div><div class="s">Soft taps and chimes as you use the app</div></div><span class="switch ${state.settings.sound !== false ? 'on' : ''}" style="margin-left:auto"></span></div></section>
    <p class="foot-note">Everything lives on this device only — no cloud, no account. Keep a backup now and then.<br><button class="link" data-act="check-update" style="font-size:13px">Version ${S.VERSION} · check for updates</button></p>`;
}

// ================================================================ sheets
let sheetStack = [];
// iOS Safari ignores overflow:hidden on body, so the page behind a sheet kept scrolling and jumping.
// Pinning the body in place (and putting it back where it was) is the reliable fix.
let lockedY = 0;
function lockScroll() {
  lockedY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${lockedY}px`, left: '0', right: '0', width: '100%' });
  document.body.classList.add('sheet-open');
}
function unlockScroll() {
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
  document.body.classList.remove('sheet-open');
  window.scrollTo(0, lockedY);
}
function openSheet(title, body, { onMount, wide } = {}) {
  const bd = document.createElement('div'); bd.className = 'backdrop';
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
  sh.innerHTML = `<div class="grab"></div><div class="sheet-head"><h3>${esc(title)}</h3><button class="x" data-act="close-sheet" aria-label="Close">${I.x}</button></div><div class="sheet-body">${body}</div>`;
  document.body.append(bd, sh);
  if (!sheetStack.length) lockScroll();
  requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
  bd.addEventListener('click', () => closeSheet());
  const rec = { bd, sh };
  sheetStack.push(rec);
  X.play('open');
  onMount?.(sh);
  return sh;
}
function closeSheet() {
  const rec = sheetStack.pop();
  if (!rec) return;
  rec.onClose?.();
  X.play('close');
  rec.bd.classList.remove('show'); rec.sh.classList.remove('show');
  setTimeout(() => { rec.bd.remove(); rec.sh.remove(); }, 480);
  if (!sheetStack.length) { unlockScroll(); if (reloadWhenFree) setTimeout(() => location.reload(), 500); }
}
function closeAllSheets() { while (sheetStack.length) closeSheet(); }
function replaceSheet(title, body, opts) { const r = sheetStack.pop(); if (r) { r.bd.remove(); r.sh.remove(); } const sh = openSheet(title, body, opts); sh.classList.add('show'); sheetStack.at(-1).bd.classList.add('show'); return sh; }

function ask(title, text, ok = 'OK', danger = false) {
  return new Promise((resolve) => {
    const sh = openSheet(title, `<p class="lead">${text}</p><div class="btn-row"><button class="btn ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : 'accent'}" data-r="1">${esc(ok)}</button></div>`);
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (sheetStack.at(-1)?.sh === sh) closeSheet(); resolve(v); };
    sh.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) finish(b.dataset.r === '1'); });
    sheetStack.at(-1).onClose = () => finish(false);
  });
}
function prompt1(title, label, value = '', { placeholder = '', inputmode = 'text', ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    const sh = openSheet(title, `<div class="field" style="margin-top:0"><label class="eyebrow" for="p1">${esc(label)}</label><input class="input" id="p1" value="${esc(value)}" placeholder="${esc(placeholder)}" inputmode="${inputmode}"></div><div class="btn-row"><button class="btn ghost" data-r="0">Cancel</button><button class="btn accent" data-r="1">${esc(ok)}</button></div>`);
    const inp = $('#p1', sh); if (FINE) setTimeout(() => inp.focus(), 300);
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (sheetStack.at(-1)?.sh === sh) closeSheet(); resolve(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(inp.value.trim()); });
    sh.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) finish(b.dataset.r === '1' ? inp.value.trim() : null); });
    sheetStack.at(-1).onClose = () => finish(null);
  });
}

let toastTimer;
function toast(msg, action) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { action.run(); t.classList.remove('show'); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2400);
}

// ---------------------------------------------------------------- entry sheet
function entrySheet(existing, preset = {}) {
  const e = existing ? { ...existing } : {
    type: 'spent', amount: 0, date: today(), time: nowTime(), method: 'upi', accountId: state.accounts[0]?.id,
    sourceId: null, categoryId: null, personId: null, note: '', offBalance: false, hidden: false, expectBack: false, ...preset,
  };
  if (e.type === 'transfer') return transferSheet(existing);
  const title = existing ? 'Edit entry' : 'New entry';

  const opt = (group, val, label, cur) => `<button class="opt ${cur === val ? 'on' : ''}" data-pick="${group}" data-v="${esc(val ?? '')}">${esc(label)}</button>`;
  function body() {
    const spendy = e.type !== 'received';
    const methods = spendy ? [['cash', 'Cash'], ['upi', 'UPI'], ['credit', 'Credit card'], ['debit', 'Debit card']] : [['cash', 'Cash'], ['upi', 'Bank · UPI']];
    if (!spendy && !['cash', 'upi'].includes(e.method)) e.method = 'upi';
    return `
    <div class="seg" role="tablist">${[['spent', 'Spent'], ['received', 'Received'], ['forSomeone', 'For someone']].map(([v, l]) => `<button class="${e.type === v ? 'on' : ''}" data-pick="type" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="field"><label class="eyebrow" for="f-amt">Amount</label>
      <div class="amount-box"><span class="cur">₹</span><input id="f-amt" class="num" inputmode="decimal" placeholder="0" value="${e.amount ? (e.amount / 100).toString() : ''}" autocomplete="off"><button class="calc-btn" data-act="calc-into" aria-label="Calculator">=</button></div></div>
    <div class="field"><label class="eyebrow" for="f-note">${spendy ? 'What for?' : 'What was it?'} <span class="faint">— optional</span></label><input class="input" id="f-note" value="${esc(e.note)}" placeholder="${spendy ? 'Lunch, auto, books…' : 'Pocket money, salary…'}"></div>
    ${spendy ? `<div class="field"><div class="eyebrow label">Category</div><div class="cats">${state.categories.map((c) => `<button class="cat ${e.categoryId === c.id ? 'on' : ''}" data-pick="categoryId" data-v="${c.id}"><span class="e">${esc(c.icon || '•')}</span>${esc(c.name)}</button>`).join('')}</div></div>` : ''}
    ${e.type === 'forSomeone' ? `<div class="field"><div class="eyebrow label">For whom</div><div class="opts">${state.people.map((p) => opt('personId', p.id, p.name, e.personId)).join('')}<button class="opt add" data-act="add-inline" data-kind="people">+ New</button></div>
      <div class="check ${e.expectBack ? 'on' : ''}" data-toggle="expectBack"><span class="box">${e.expectBack ? I.check : ''}</span><div><div class="t">They'll pay me back</div><div class="s">Shows up under People until it's settled.</div></div></div></div>` : ''}
    <div class="field"><div class="eyebrow label">When</div><div class="opts"><input class="input num" type="date" id="f-date" value="${e.date}" max="${C.addDays(today(), 366)}"><input class="input num" type="time" id="f-time" value="${e.time || ''}"></div></div>
    <div class="field"><div class="eyebrow label">${spendy ? 'Paid via' : 'Got it in'}</div><div class="opts">${methods.map(([v, l]) => opt('method', v, l, e.method)).join('')}</div></div>
    <div class="field"><div class="eyebrow label">${spendy ? 'Whose money' : 'From'} <span class="faint">— optional</span></div><div class="opts">${state.sources.map((s) => opt('sourceId', s.id, s.name, e.sourceId)).join('')}<button class="opt add" data-act="add-inline" data-kind="sources">+ New</button></div></div>
    <div class="field"><div class="eyebrow label">Account</div><div class="opts">${state.accounts.map((a) => opt('accountId', a.id, a.name, e.accountId)).join('')}</div></div>
    ${spendy ? `<div class="check ${e.offBalance ? 'on' : ''}" data-toggle="offBalance" style="margin-top:18px"><span class="box">${e.offBalance ? I.check : ''}</span><div><div class="t">Not from my balance</div><div class="s">Paid with someone else's card or cash — track it, but don't deduct it.</div></div></div>` : ''}
    <div class="check ${e.hidden ? 'on' : ''}" data-toggle="hidden"><span class="box">${e.hidden ? I.check : ''}</span><div><div class="t">Hide this entry</div><div class="s">Still counts in totals, but stays out of lists.</div></div></div>
    <div class="btn-row">${existing ? `<button class="btn danger" data-act="delete-entry" style="flex:0 0 auto;width:auto;padding:16px 20px" aria-label="Delete">${I.trash}</button>` : ''}<button class="btn accent" data-act="save-entry">${existing ? 'Save changes' : 'Add entry'}</button></div>`;
  }
  const sh = openSheet(title, body());
  const bodyEl = $('.sheet-body', sh);
  const pull = () => {
    const a = $('#f-amt', sh); if (a) e.amount = C.toPaise(a.value.replace(/,/g, ''));
    e.note = $('#f-note', sh)?.value.trim() || ''; e.date = $('#f-date', sh)?.value || today(); e.time = $('#f-time', sh)?.value || '';
  };
  const redraw = () => { pull(); const y = sh.scrollTop; bodyEl.innerHTML = body(); sh.scrollTop = y; };
  if (!existing) if (FINE) setTimeout(() => $('#f-amt', sh)?.focus(), 350);

  sh.addEventListener('click', async (ev) => {
    const pick = ev.target.closest('[data-pick]');
    if (pick) {
      const k = pick.dataset.pick, v = pick.dataset.v || null;
      e[k] = (k !== 'type' && k !== 'method' && k !== 'accountId' && e[k] === v) ? null : v;
      if (k === 'type') { if (v !== 'forSomeone') e.expectBack = false; return redraw(); }
      $$(`[data-pick="${k}"]`, sh).forEach((b) => b.classList.toggle('on', (b.dataset.v || null) === e[k]));
      return;
    }
    const tg = ev.target.closest('[data-toggle]');
    if (tg) {
      const k = tg.dataset.toggle; e[k] = !e[k];
      tg.classList.toggle('on', e[k]); $('.box', tg).innerHTML = e[k] ? I.check : '';
      return;
    }
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-inline') {
      const kind = ev.target.closest('[data-act]').dataset.kind;
      pull();
      const name = await prompt1(kind === 'people' ? 'New person' : 'Whose money', 'Name', '', { placeholder: kind === 'people' ? 'Aman' : 'Grandmother, Shagan…', ok: 'Add' });
      if (name) { const item = { id: S.uid(), name }; state[kind].push(item); S.save(state); e[kind === 'people' ? 'personId' : 'sourceId'] = item.id; bodyEl.innerHTML = body(); }
    } else if (act === 'calc-into') {
      pull();
      openCalc(e.amount ? String(e.amount / 100) : '', (v) => { e.amount = C.toPaise(v); bodyEl.innerHTML = body(); });
    } else if (act === 'save-entry') {
      pull();
      if (!(e.amount > 0)) { $('.amount-box', sh).style.borderColor = 'var(--accent)'; $('#f-amt', sh).focus(); return warn('Enter an amount'); }
      if (e.type === 'forSomeone' && !e.personId) return warn('Pick who it was for');
      if (e.type === 'received') { e.offBalance = false; e.categoryId = null; }
      if (e.type !== 'forSomeone') e.expectBack = false;
      if (existing) Object.assign(byId(state.entries, existing.id), e);
      else state.entries.push({ ...e, id: S.uid(), createdAt: Date.now() });
      closeSheet();
      commit(existing ? 'Saved' : `${e.type === 'received' ? 'Received' : 'Spent'} ${rs(e.amount)} logged`, e.type === 'received' ? 'income' : 'success');
    } else if (act === 'delete-entry') {
      deleteEntry(existing.id);
    }
  });
}

function deleteEntry(id) {
  const idx = state.entries.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [removed] = state.entries.splice(idx, 1);
  closeAllSheets();
  commit();
  X.play('delete');
  toast('Entry deleted', { label: 'Undo', run: () => { state.entries.push(removed); commit('Restored'); } });
}

// ---------------------------------------------------------------- transfer
function transferSheet(existing) {
  const t = existing ? { ...existing } : { type: 'transfer', kind: 'account', amount: 0, date: today(), time: nowTime(), accountId: state.accounts[0]?.id, toAccountId: state.accounts[1]?.id || state.accounts[0]?.id, note: '' };
  const kinds = [['account', 'Accounts'], ['toBank', 'Cash → Bank'], ['toCash', 'Bank → Cash'], ['cardBill', 'Card bill']];
  const hint = { account: 'Move money between your accounts. Cash and bank totals stay the same.', toBank: 'You deposited cash into the bank.', toCash: 'You withdrew cash from an ATM or bank.', cardBill: 'You paid your credit card bill from the bank.' };
  const body = () => `
    <div class="seg">${kinds.map(([v, l]) => `<button class="${t.kind === v ? 'on' : ''}" data-k="${v}" style="font-size:10.5px;letter-spacing:.05em">${l}</button>`).join('')}</div>
    <p class="muted" style="font-size:13.5px;margin:12px 2px 0">${hint[t.kind]}</p>
    <div class="field"><label class="eyebrow" for="t-amt">Amount</label><div class="amount-box"><span class="cur">₹</span><input id="t-amt" class="num" inputmode="decimal" placeholder="0" value="${t.amount ? t.amount / 100 : ''}"></div></div>
    ${t.kind === 'account' ? `<div class="field"><div class="eyebrow label">From</div><div class="opts">${state.accounts.map((a) => `<button class="opt ${t.accountId === a.id ? 'on' : ''}" data-from="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>
    <div class="field"><div class="eyebrow label">To</div><div class="opts">${state.accounts.map((a) => `<button class="opt ${t.toAccountId === a.id ? 'on' : ''}" data-to="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>` : ''}
    <div class="field"><div class="eyebrow label">When</div><div class="opts"><input class="input num" type="date" id="t-date" value="${t.date}"><input class="input num" type="time" id="t-time" value="${t.time || ''}"></div></div>
    <div class="field"><label class="eyebrow" for="t-note">Note <span class="faint">— optional</span></label><input class="input" id="t-note" value="${esc(t.note || '')}"></div>
    <div class="btn-row">${existing ? `<button class="btn danger" data-del style="flex:0 0 auto;width:auto;padding:16px 20px" aria-label="Delete">${I.trash}</button>` : ''}<button class="btn accent" data-save>${existing ? 'Save changes' : 'Transfer'}</button></div>`;
  const sh = openSheet(existing ? 'Edit transfer' : 'Transfer', body());
  const el = $('.sheet-body', sh);
  const pull = () => { t.amount = C.toPaise(($('#t-amt', sh).value || '').replace(/,/g, '')); t.date = $('#t-date', sh).value || today(); t.time = $('#t-time', sh).value; t.note = $('#t-note', sh).value.trim(); };
  sh.addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-k],[data-from],[data-to],[data-save],[data-del]');
    if (!g) return;
    if (g.dataset.k) { pull(); t.kind = g.dataset.k; el.innerHTML = body(); }
    else if (g.dataset.from) { pull(); t.accountId = g.dataset.from; el.innerHTML = body(); }
    else if (g.dataset.to) { pull(); t.toAccountId = g.dataset.to; el.innerHTML = body(); }
    else if (g.hasAttribute('data-del')) deleteEntry(existing.id);
    else {
      pull();
      if (!(t.amount > 0)) return warn('Enter an amount');
      if (t.kind === 'account' && t.accountId === t.toAccountId) return warn('Pick two different accounts');
      if (t.kind !== 'account') { delete t.toAccountId; t.accountId = t.accountId || state.accounts[0]?.id; }
      if (existing) Object.assign(byId(state.entries, existing.id), t);
      else state.entries.push({ ...t, id: S.uid(), createdAt: Date.now() });
      closeSheet(); commit(existing ? 'Saved' : 'Transfer logged');
    }
  });
}

// ---------------------------------------------------------------- calculator
function openCalc(initial = '', onUse) {
  let expr = initial;
  const draw = (sh) => {
    let res = '';
    try { res = expr ? nf2.format(C.evaluate(expr)).replace(/\.00$/, '') : '0'; } catch { res = '…'; }
    $('.expr', sh).textContent = expr || ' ';
    $('.res', sh).textContent = '₹' + res;
  };
  const keys = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '%', '0', '.', '⌫'];
  const sh = openSheet('Calculator', `<div class="calc-display"><div class="expr"></div><div class="res num">₹0</div></div>
    <div class="keys">${keys.map((k) => `<button class="key ${'÷×−+'.includes(k) ? 'op' : ''} ${'C()%⌫'.includes(k) ? 'fn' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="btn-row"><button class="btn ghost" data-k="=">=</button><button class="btn accent" data-use>${onUse ? 'Use amount' : 'Log as entry'}</button></div>`);
  draw(sh);
  sh.addEventListener('click', (ev) => {
    const k = ev.target.closest('[data-k]')?.dataset.k;
    if (ev.target.closest('[data-use]')) {
      let v; try { v = C.evaluate(expr); } catch { return warn('Check the sum'); }
      if (!(v > 0)) return warn('Result must be more than ₹0');
      closeSheet();
      if (onUse) onUse(v); else entrySheet(null, { amount: C.toPaise(v) });
      return;
    }
    if (!k) return;
    if (k === 'C') expr = '';
    else if (k === '⌫') expr = expr.slice(0, -1);
    else if (k === '=') { try { expr = String(C.evaluate(expr)); } catch { warn('Check the sum'); } }
    else expr += k;
    draw(sh);
  });
}

// ---------------------------------------------------------------- search
function openSearch() {
  const sh = openSheet('Search', `<div class="search-box">${I.search}<input id="q" placeholder="Note, person, category, amount…" autocomplete="off"></div><div id="q-res" style="margin-top:6px"></div>`);
  const inp = $('#q', sh), out = $('#q-res', sh);
  const run = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { out.innerHTML = `<p class="faint" style="text-align:center;margin:30px 0">Try “chai”, “Aman” or “500”.</p>`; return; }
    const amt = Number(q.replace(/[₹,]/g, ''));
    const hits = visibleEntries().filter((e) => {
      if (!Number.isNaN(amt) && amt > 0 && Math.abs(e.amount / 100 - amt) < 0.005) return true;
      const hay = [entryTitle(e), e.note, nameOf(state.categories, e.categoryId), nameOf(state.people, e.personId), nameOf(state.sources, e.sourceId), nameOf(state.accounts, e.accountId), C.METHODS[e.method]?.label].join(' ').toLowerCase();
      return hay.includes(q);
    });
    const sum = C.summarize(hits);
    out.innerHTML = hits.length ? `<p class="faint" style="margin:14px 4px 0;font-size:13px">${hits.length} match${hits.length === 1 ? '' : 'es'} · spent ${rs(sum.spent)} · received ${rs(sum.received)}</p>${groupedList(hits.slice(0, 80), { showDayTotal: false })}`
      : `<p class="faint" style="text-align:center;margin:30px 0">No matches.</p>`;
  };
  inp.addEventListener('input', run); run();
  if (FINE) setTimeout(() => inp.focus(), 300);
}

// ---------------------------------------------------------------- accounts
function accountSheet(id) {
  const a = byId(state.accounts, id);
  const bal = C.accountBalances(state).find((x) => x.id === id);
  const ents = visibleEntries().filter((e) => e.accountId === id || e.toAccountId === id);
  openSheet(a.name, `
    <div class="card hero acct"><div class="eyebrow">Left in ${esc(a.name)}</div><div class="total num money" style="font:750 36px/1.1 var(--display);margin-top:8px">${rs(bal.left)}</div>
      <div class="meta"><div>In<b>${money(bal.in)}</b></div><div>Out<b>${money(bal.spent)}</b></div><div>Entries<b>${bal.entries}</b></div></div></div>
    <div class="btn-row" style="margin-top:12px"><button class="btn ghost sm" data-act="rename-account" data-id="${id}" style="flex:1">${I.edit} Rename</button><button class="btn ghost sm" data-act="transfer" style="flex:1">${I.swap} Transfer</button>${state.accounts.length > 1 ? `<button class="btn danger sm" data-act="delete-account" data-id="${id}" aria-label="Delete account">${I.trash}</button>` : ''}</div>
    ${groupedList(ents)}`);
}

// ---------------------------------------------------------------- pay
function payFlow(target) {
  const p = { amount: target.amount || 0, note: '', categoryId: null, accountId: state.accounts[0]?.id };
  const sh = openSheet(`Pay ${target.name || target.vpa}`, `
    <div class="row" style="cursor:default"><div class="ic" style="font-weight:750">${esc((target.name || target.vpa)[0])}</div><div class="mid"><div class="t">${esc(target.name || target.vpa)}</div><div class="s">${esc(target.vpa)}</div></div></div>
    <div class="field"><label class="eyebrow" for="pay-amt">Amount</label><div class="amount-box"><span class="cur">₹</span><input id="pay-amt" class="num" inputmode="decimal" placeholder="0" value="${p.amount ? p.amount / 100 : ''}"></div></div>
    <div class="field"><label class="eyebrow" for="pay-note">Note <span class="faint">— shows in UPI too</span></label><input class="input" id="pay-note" placeholder="Chai, rent, split…"></div>
    <div class="field"><div class="eyebrow label">Category</div><div class="cats">${state.categories.map((c) => `<button class="cat" data-cat="${c.id}"><span class="e">${esc(c.icon)}</span>${esc(c.name)}</button>`).join('')}</div></div>
    <div class="field"><div class="eyebrow label">Account</div><div class="opts">${state.accounts.map((a, i) => `<button class="opt ${i === 0 ? 'on' : ''}" data-acc="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>
    ${IOS ? `<div class="eyebrow" style="margin:20px 2px 8px">Pay with</div><div class="opts three">${['gpay', 'phonepe', 'paytm'].map((a) => `<button class="btn accent" data-upi="${a}" style="padding:14px 4px;font-size:14px">${C.UPI_APPS[a].label}</button>`).join('')}</div><button class="btn ghost" data-log style="margin-top:10px">Just log it</button>`
      : `<div class="btn-row"><button class="btn ghost" data-log>Just log it</button><button class="btn accent" data-upi="default">Open UPI app</button></div>`}
    <p class="faint" style="font-size:12.5px;text-align:center;margin-top:14px">Your UPI app does the paying. Ledger never sees your PIN or bank details.</p>`);
  if (FINE) setTimeout(() => $('#pay-amt', sh).focus(), 300);
  const build = () => ({ id: S.uid(), createdAt: Date.now(), type: 'spent', method: 'upi', date: today(), time: nowTime(),
    amount: C.toPaise(($('#pay-amt', sh).value || '').replace(/,/g, '')), note: $('#pay-note', sh).value.trim() || target.name || target.vpa,
    personId: target.personId || null, categoryId: p.categoryId, accountId: p.accountId });
  sh.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-cat]');
    if (c) { p.categoryId = p.categoryId === c.dataset.cat ? null : c.dataset.cat; $$('[data-cat]', sh).forEach((b) => b.classList.toggle('on', b.dataset.cat === p.categoryId)); return; }
    const a = ev.target.closest('[data-acc]');
    if (a) { p.accountId = a.dataset.acc; $$('[data-acc]', sh).forEach((b) => b.classList.toggle('on', b === a)); return; }
    const upiBtn = ev.target.closest('[data-upi]'), isUpi = !!upiBtn, isLog = ev.target.closest('[data-log]');
    if (!isUpi && !isLog) return;
    const entry = build();
    if (!(entry.amount > 0)) return warn('Enter an amount');
    closeSheet();
    if (isLog) { state.entries.push(entry); return commit(`Paid ${rs(entry.amount)} logged`); }
    try { sessionStorage.setItem('ledger.pendingPay', JSON.stringify(entry)); } catch { /* ignore */ }
    location.href = C.upiLink({ vpa: target.vpa, name: target.name, amount: entry.amount, note: entry.note }, upiBtn.dataset.upi);
    setTimeout(checkPendingPay, 1500);
  });
}
function checkPendingPay() {
  let pending; try { pending = JSON.parse(sessionStorage.getItem('ledger.pendingPay') || 'null'); } catch { pending = null; }
  if (!pending || sheetStack.some((s) => s.sh.dataset.pending)) return;
  ask('Did it go through?', `Log the ${rs(pending.amount)} payment for “${esc(pending.note)}”?`, 'Yes, log it').then((yes) => {
    sessionStorage.removeItem('ledger.pendingPay');
    if (yes) { state.entries.push(pending); commit('Payment logged'); }
  });
  sheetStack.at(-1).sh.dataset.pending = '1';
}

// ---------------------------------------------------------------- rewind
function openRewind() {
  const freq = state.settings.rewind === 'off' ? 'weekly' : state.settings.rewind;
  const w = C.rewindWindow(freq);
  const r = C.rewind(state, w.from, w.to);
  const cat = r.topCat && byId(state.categories, r.topCat.key);
  const ch = r.change == null ? 'Nothing to compare with yet.' : `${r.change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(r.change * 100))}% vs the ${freq === 'monthly' ? 'month' : 'week'} before (${rs(r.prevSpent)}).`;
  openSheet(`${w.label} rewind`, `
    <div class="rewind-hero"><div class="eyebrow">${esc(fmtDay(w.from))} – ${esc(fmtDay(w.to))}</div>
      <div class="big num money">${rs(r.spent)}</div><div class="muted">spent across ${r.days} days</div>
      <p class="faint" style="font-size:13.5px;margin-top:10px">${ch}</p></div>
    <div class="rw-grid">
      <div class="stat"><div class="eyebrow">Received</div><div class="v pos">${money(r.received)}</div></div>
      <div class="stat"><div class="eyebrow">Per day</div><div class="v">${money(r.avgPerDay)}</div></div>
      <div class="stat"><div class="eyebrow">Top category</div><div class="v">${cat ? `${esc(cat.icon)} ${esc(cat.name)}` : '—'}</div></div>
      <div class="stat"><div class="eyebrow">No-spend days</div><div class="v">${r.noSpendDays}</div></div>
    </div>
    ${r.biggest ? `<div class="eyebrow" style="margin:22px 2px 10px">Biggest spend</div>${entryRow(r.biggest)}` : ''}
    <div class="btn-row"><button class="btn accent" data-act="close-sheet">Nice</button></div>`);
  state.settings.lastRewind = w.to; S.save(state);
}

// ---------------------------------------------------------------- settings pages
function settingsPage(page) {
  const s = state.settings;
  const sw = (key, t, sub) => `<div class="line-item" data-switch="${key}" style="cursor:pointer"><div class="grow"><div class="t">${t}</div><div class="s">${sub}</div></div><span class="switch ${s[key] ? 'on' : ''}"></span></div>`;
  let title = '', html = '', mount;
  if (page === 'money') {
    title = 'Money & bills';
    const rupeeField = (id, label, val, hint) => `<div class="field"><label class="eyebrow" for="${id}">${label}</label><div class="amount-box"><span class="cur">₹</span><input id="${id}" class="num" inputmode="decimal" value="${val ? val / 100 : ''}" placeholder="0" style="font-size:24px"></div>${hint ? `<p class="faint" style="font-size:12.5px;margin:6px 2px 0">${hint}</p>` : ''}</div>`;
    html = `${rupeeField('m-cash', 'Opening cash', s.openingCash, 'What you had in hand before your first entry.')}
      ${rupeeField('m-bank', 'Opening bank · UPI', s.openingBank)}
      ${rupeeField('m-budget', 'Monthly budget', s.monthlyBudget, 'Leave empty to work out “safe to spend” from your balance instead.')}
      <button class="btn accent" data-save-money style="margin-top:16px">Save</button>
      <div class="section-head"><h2>Recurring bills</h2><button class="link" data-add-bill>+ Add</button></div>
      <div class="card" style="padding:2px 18px">${(state.recurring || []).length ? state.recurring.map((r) => `<div class="line-item"><div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${rs(r.amount)} · day ${r.day} of each month · ${esc(C.METHODS[r.method]?.label)}</div></div><button class="btn sm ghost" data-pause="${r.id}">${r.paused ? 'Resume' : 'Pause'}</button><button class="btn sm danger" data-del-bill="${r.id}" aria-label="Delete bill">${I.trash}</button></div>`).join('') : '<p class="faint" style="padding:14px 0;margin:0">Rent, recharges, subscriptions — added for you on the day.</p>'}</div>`;
    mount = (sh) => sh.addEventListener('click', async (ev) => {
      const get = (id) => C.toPaise(($(id, sh).value || '').replace(/,/g, ''));
      if (ev.target.closest('[data-save-money]')) { s.openingCash = get('#m-cash'); s.openingBank = get('#m-bank'); s.monthlyBudget = get('#m-budget'); closeSheet(); commit('Saved'); }
      else if (ev.target.closest('[data-add-bill]')) billSheet();
      else if (ev.target.closest('[data-pause]')) { const r = byId(state.recurring, ev.target.closest('[data-pause]').dataset.pause); r.paused = !r.paused; S.save(state); closeSheet(); settingsPage('money'); render(); }
      else if (ev.target.closest('[data-del-bill]')) {
        const id = ev.target.closest('[data-del-bill]').dataset.delBill;
        if (await ask('Delete bill?', 'Entries it already added stay in your ledger.', 'Delete', true)) { state.recurring = state.recurring.filter((r) => r.id !== id); S.save(state); closeSheet(); settingsPage('money'); render(); }
      }
    });
  } else if (page === 'tags') {
    title = 'Accounts & tags';
    const group = (kind, label, hint) => `<div class="section-head"><h2>${label}</h2><button class="link" data-add="${kind}">+ Add</button></div>
      <div class="card" style="padding:2px 18px">${state[kind].length ? state[kind].map((x) => `<div class="line-item"><div class="grow"><div class="t">${kind === 'categories' ? esc(x.icon) + ' ' : ''}${esc(x.name)}</div>${x.vpa ? `<div class="s">${esc(x.vpa)}</div>` : ''}</div><button class="btn sm ghost" data-ren="${kind}:${x.id}" aria-label="Rename">${I.edit}</button>${kind !== 'accounts' || state.accounts.length > 1 ? `<button class="btn sm danger" data-rm="${kind}:${x.id}" aria-label="Delete">${I.trash}</button>` : ''}</div>`).join('') : `<p class="faint" style="padding:14px 0;margin:0">${hint}</p>`}</div>`;
    html = group('accounts', 'Accounts', '') + group('sources', 'Whose money', 'Pocket money, grandmother, salary…') + group('categories', 'Categories', '') + group('people', 'People', 'Friends you pay for, or pay by UPI.');
    mount = (sh) => sh.addEventListener('click', async (ev) => {
      const add = ev.target.closest('[data-add]')?.dataset.add;
      const ren = ev.target.closest('[data-ren]')?.dataset.ren;
      const rm = ev.target.closest('[data-rm]')?.dataset.rm;
      if (add) await addTag(add);
      else if (ren) await renameTag(...ren.split(':'));
      else if (rm) await removeTag(...rm.split(':'));
      else return;
      closeSheet(); settingsPage('tags');
    });
  } else if (page === 'rewind') {
    title = 'Rewind';
    html = `<p class="lead">A short wrap-up of where your money went: total spent, top category, biggest spend and no-spend days.</p>
      <div class="field"><div class="eyebrow label">How often</div><div class="opts three">${[['off', 'Off'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => `<button class="opt ${s.rewind === v ? 'on' : ''}" data-rw="${v}">${l}</button>`).join('')}</div></div>
      <button class="btn ghost" data-act="rewind" style="margin-top:18px">${I.sparkle} See a rewind now</button>`;
    mount = (sh) => sh.addEventListener('click', (ev) => { const v = ev.target.closest('[data-rw]')?.dataset.rw; if (v) { s.rewind = v; s.lastRewind = null; S.save(state); $$('[data-rw]', sh).forEach((b) => b.classList.toggle('on', b.dataset.rw === v)); render(); } });
  } else if (page === 'privacy') {
    title = 'Privacy & lock';
    html = `<div class="card" style="padding:2px 18px">
      <div class="line-item"><div class="grow"><div class="t">Passcode</div><div class="s">${s.pinHash ? 'On — asked when you open Ledger' : 'Off'}</div></div>${s.pinHash ? `<button class="btn sm ghost" data-pin="change">Change</button><button class="btn sm danger" data-pin="off">Turn off</button>` : `<button class="btn sm accent" data-pin="set">Set passcode</button>`}</div>
      ${s.pinHash ? `<div class="line-item"><div class="grow"><div class="t">Lock again after</div><div class="s">Time away from the app</div></div><select class="input" data-lock-after style="width:auto;padding:8px 10px;font-size:14px">${[[0, 'Immediately'], [60, '1 minute'], [300, '5 minutes'], [1800, '30 minutes']].map(([v, l]) => `<option value="${v}" ${Number(s.lockAfter) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      ${sw('hideAmounts', 'Hide amounts', 'Blur balances until you tap the eye')}
      ${sw('showHidden', 'Show hidden entries', `${state.entries.filter((e) => e.hidden).length} hidden — they always count in totals`)}
    </div>`;
    mount = (sh) => {
      sh.addEventListener('click', async (ev) => {
        const k = ev.target.closest('[data-switch]')?.dataset.switch;
        if (k) { s[k] = !s[k]; S.save(state); render(); closeSheet(); return settingsPage('privacy'); }
        const p = ev.target.closest('[data-pin]')?.dataset.pin;
        if (p === 'off') { if (await ask('Turn off passcode?', 'Anyone with this device could open your ledger.', 'Turn off', true)) { s.pinHash = null; S.save(state); closeSheet(); settingsPage('privacy'); toast('Passcode removed'); } }
        else if (p) setPinFlow(() => { closeSheet(); settingsPage('privacy'); });
      });
      sh.addEventListener('change', (ev) => { if (ev.target.matches('[data-lock-after]')) { s.lockAfter = Number(ev.target.value); S.save(state); toast('Saved'); } });
    };
  } else if (page === 'export') {
    title = 'Export & backup';
    html = `<div class="card tap" data-x="csv"><div class="set-row"><div class="ic">${I.download}</div><div><div class="t">Excel / CSV</div><div class="s">Every entry as a spreadsheet</div></div></div></div>
      <div class="card tap" data-x="json"><div class="set-row"><div class="ic">${I.download}</div><div><div class="t">Backup file</div><div class="s">Everything, to restore later or on another phone</div></div></div></div>
      <label class="card tap" style="display:block"><div class="set-row"><div class="ic">${I.up}</div><div><div class="t">Restore from backup</div><div class="s">Replaces what's on this device</div></div></div><input type="file" accept="application/json,.json" data-restore hidden></label>`;
    mount = (sh) => {
      sh.addEventListener('click', (ev) => {
        const x = ev.target.closest('[data-x]')?.dataset.x;
        if (x === 'csv') download(`ledger-${today()}.csv`, new Blob(['﻿' + C.toCSV(state)], { type: 'text/csv;charset=utf-8' }));
        if (x === 'json') download(`ledger-backup-${today()}.json`, S.backupBlob(state));
      });
      sh.addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0]; if (!f) return;
        try {
          const next = S.parseBackup(await f.text());
          if (await ask('Restore this backup?', `${next.entries.length} entries from “${esc(f.name)}” will replace the ${state.entries.length} on this device. A snapshot of the current data is kept.`, 'Restore', true)) {
            S.autoSnapshot(state); state = next; state.settings.onboarded = true; closeAllSheets(); commit('Backup restored');
          }
        } catch (err) { toast(err.message || 'Could not read that file'); }
        ev.target.value = '';
      });
    };
  } else if (page === 'device') {
    title = 'This device';
    const snaps = S.listSnapshots();
    let used = 0; try { used = (localStorage.getItem('ledger.v1') || '').length + (localStorage.getItem('ledger.snapshots') || '').length; } catch { /* ignore */ }
    html = `<div class="section-head" style="margin-top:0"><h2>Daily snapshots</h2></div>
      <div class="card" style="padding:2px 18px">${snaps.length ? snaps.map((sn, i) => `<div class="line-item"><div class="grow"><div class="t">${esc(fmtDay(sn.date))}</div><div class="s">${sn.count} entries · ${new Date(sn.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div></div><button class="btn sm ghost" data-snap="${i}">Restore</button></div>`).join('') : '<p class="faint" style="padding:14px 0;margin:0">A snapshot is kept each day you make changes.</p>'}</div>
      <div class="btn-row" style="flex-direction:column"><button class="btn accent" data-act="check-update">Check for updates</button><button class="btn ghost" data-demo>Load demo data</button><button class="btn danger" data-erase>Erase everything</button></div>
      <p class="foot-note">Ledger ${S.VERSION} · ${(used / 1024).toFixed(1)} KB stored · ${state.entries.length} entries</p>`;
    mount = (sh) => sh.addEventListener('click', async (ev) => {
      const sn = ev.target.closest('[data-snap]')?.dataset.snap;
      if (sn != null) { const snap = S.listSnapshots()[Number(sn)]; if (await ask('Restore snapshot?', `Go back to ${esc(fmtDay(snap.date))} (${snap.count} entries)? What you have now is replaced.`, 'Restore', true)) { state = S.parseBackup(JSON.stringify(snap.data)); closeAllSheets(); commit('Snapshot restored'); } }
      if (ev.target.closest('[data-demo]')) { if (await ask('Load demo data?', 'This replaces everything on this device with sample entries. Back up first if you need your data.', 'Load demo', true)) { state = S.demoState(); closeAllSheets(); ui.tab = 'home'; commit('Demo data loaded'); } }
      if (ev.target.closest('[data-erase]')) { if (await ask('Erase everything?', 'All entries, accounts, snapshots and your passcode are deleted from this device. This can’t be undone.', 'Erase', true)) { S.clearAll(); state = S.defaultState(); ui.locked = false; closeAllSheets(); render(); toast('Erased'); } }
    });
  }
  openSheet(title, html, { onMount: mount });
}

function billSheet() {
  const b = { name: '', amount: 0, method: 'upi', day: new Date().getDate(), accountId: state.accounts[0]?.id, categoryId: 'cat_bills' };
  const sh = openSheet('New recurring bill', `
    <div class="field" style="margin-top:0"><label class="eyebrow" for="b-name">Name</label><input class="input" id="b-name" placeholder="Rent, Netflix, phone recharge…"></div>
    <div class="field"><label class="eyebrow" for="b-amt">Amount</label><div class="amount-box"><span class="cur">₹</span><input id="b-amt" class="num" inputmode="decimal" placeholder="0" style="font-size:24px"></div></div>
    <div class="field"><label class="eyebrow" for="b-day">Day of the month</label><input class="input num" id="b-day" type="number" min="1" max="31" value="${b.day}"></div>
    <div class="field"><div class="eyebrow label">Paid via</div><div class="opts">${Object.entries(C.METHODS).map(([v, m]) => `<button class="opt ${v === b.method ? 'on' : ''}" data-m="${v}">${m.label}</button>`).join('')}</div></div>
    <div class="field"><div class="eyebrow label">Account</div><div class="opts">${state.accounts.map((a, i) => `<button class="opt ${i === 0 ? 'on' : ''}" data-a="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>
    <p class="faint" style="font-size:12.5px;margin:14px 2px 0">It's added to your ledger on that day each month, starting this month if the day hasn't passed.</p>
    <button class="btn accent" data-save-bill style="margin-top:16px">Add bill</button>`);
  sh.addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-m]'), a = ev.target.closest('[data-a]');
    if (m) { b.method = m.dataset.m; $$('[data-m]', sh).forEach((x) => x.classList.toggle('on', x === m)); }
    if (a) { b.accountId = a.dataset.a; $$('[data-a]', sh).forEach((x) => x.classList.toggle('on', x === a)); }
    if (ev.target.closest('[data-save-bill]')) {
      b.name = $('#b-name', sh).value.trim(); b.amount = C.toPaise(($('#b-amt', sh).value || '').replace(/,/g, '')); b.day = Math.max(1, Math.min(31, Number($('#b-day', sh).value) || 1));
      if (!b.name || !(b.amount > 0)) return warn('Add a name and an amount');
      const t = today(); const thisMonth = C.monthKey(t);
      const startMonth = b.day >= Number(t.slice(8)) ? thisMonth : C.nextMonth(thisMonth);
      state.recurring.push({ ...b, id: S.uid(), lastPosted: null, startMonth });
      S.save(state); closeSheet(); closeSheet(); settingsPage('money'); toast('Bill added');
    }
  });
}

async function addTag(kind) {
  const labels = { accounts: ['New account', 'Savings, Trip, Gifts…'], sources: ['Whose money', 'Grandmother, Shagan…'], categories: ['New category', 'Gym, Pets…'], people: ['New person', 'Aman'] };
  const name = await prompt1(labels[kind][0], 'Name', '', { placeholder: labels[kind][1], ok: 'Add' });
  if (!name) return null;
  const item = { id: S.uid(), name };
  if (kind === 'categories') item.icon = (await prompt1('Pick an emoji', 'Emoji', '🏷️', { ok: 'Done' })) || '•';
  if (kind === 'people') { const v = await prompt1('UPI ID', 'UPI ID — optional', '', { placeholder: 'name@okaxis', ok: 'Done' }); if (v) item.vpa = v; }
  state[kind].push(item); commit(`${name} added`);
  return item;
}
async function renameTag(kind, id) {
  const x = byId(state[kind], id);
  const name = await prompt1('Rename', 'Name', x.name);
  if (name) x.name = name;
  if (kind === 'people') { const v = await prompt1('UPI ID', 'UPI ID — optional', x.vpa || '', { placeholder: 'name@okaxis' }); if (v !== null) x.vpa = v || undefined; }
  if (kind === 'categories') { const e = await prompt1('Emoji', 'Emoji', x.icon || ''); if (e) x.icon = e; }
  commit('Saved');
}
async function removeTag(kind, id) {
  const x = byId(state[kind], id);
  const used = state.entries.filter((e) => [e.accountId, e.toAccountId, e.sourceId, e.categoryId, e.personId].includes(id)).length;
  if (kind === 'accounts') {
    const rest = state.accounts.filter((a) => a.id !== id);
    if (!rest.length) return;
    if (!(await ask(`Delete ${esc(x.name)}?`, used ? `Its ${used} entr${used === 1 ? 'y moves' : 'ies move'} to ${esc(rest[0].name)}.` : 'It has no entries.', 'Delete', true))) return;
    state.entries.forEach((e) => { if (e.accountId === id) e.accountId = rest[0].id; if (e.toAccountId === id) e.toAccountId = rest[0].id; });
    state.entries = state.entries.filter((e) => !(e.type === 'transfer' && e.kind === 'account' && e.accountId === e.toAccountId));
    state.recurring.forEach((r) => { if (r.accountId === id) r.accountId = rest[0].id; });
  } else {
    if (!(await ask(`Delete ${esc(x.name)}?`, used ? `${used} entr${used === 1 ? 'y keeps its' : 'ies keep their'} amount but lose this tag.` : 'Nothing uses it yet.', 'Delete', true))) return;
    const field = { sources: 'sourceId', categories: 'categoryId', people: 'personId' }[kind];
    state.entries.forEach((e) => { if (e[field] === id) e[field] = null; });
  }
  state[kind] = state[kind].filter((t) => t.id !== id);
  commit('Deleted');
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`Saved ${name}`);
}

// ================================================================ health: steps + food
// Steps come from Apple Health through an iPhone Shortcut (see "Connect Apple Watch"), or are typed in.
// Food is logged here. Each finished day is settled into the ledger by health.js: +₹500 for the step
// goal, and one −₹1,000 if you missed it or overate. Never two penalties on one day.
const healthDay = () => { const t = today(); return ui.hday && ui.hday < t ? ui.hday : t; };
const dayRec = (d) => (state.health.days[d] ||= { steps: null, meals: [] });
const kcal = (n) => `${nf0.format(n)} kcal`;
function openHealthDay(d) { ui.tab = 'health'; ui.hday = d; history.replaceState(null, '', '#health'); render(); window.scrollTo(0, 0); }

/** Runs the rules and saves. Returns the summed ledger change, in paise, of the days that moved. */
function runHealthRules() {
  if (!state.health.enabled) return null;
  H.ensureTags(state);
  const changes = H.syncHealth(state, today(), S.uid);
  return changes.length ? { changes, net: changes.reduce((s, c) => s + c.delta, 0) } : null;
}
function healthCommit(msg) {
  const r = runHealthRules();
  if (r) msg += ` · ledger ${rs(r.net, { sign: true })}`;
  commit(msg, r ? (r.net >= 0 ? 'income' : 'delete') : 'success');
}
/** Settles days that just finished (on open, on return to the app, and at midnight). */
function settleHealth({ quietRender = false } = {}) {
  const r = runHealthRules();
  if (!state.health.enabled) return;
  S.save(state);
  if (!r) return;
  S.autoSnapshot(state);
  if (!quietRender && !sheetStack.length) { ui.fresh = true; render(); }
  const msg = r.changes.length === 1 ? `${fmtDay(r.changes[0].day)} settled: ${rs(r.net, { sign: true })}` : `${r.changes.length} days settled: ${rs(r.net, { sign: true })}`;
  setTimeout(() => { toast(msg); X.play(r.net >= 0 ? 'income' : 'delete'); }, quietRender ? 800 : 0);
}
function scheduleMidnight() {
  const n = new Date(), next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5);
  setTimeout(() => { settleHealth(); if (!sheetStack.length) render(); scheduleMidnight(); }, next - n);
}

function applySteps(map, from) {
  const t = today(); let n = 0, last = null;
  for (const [d, steps] of Object.entries(map)) {
    if (d > t) continue;
    Object.assign(dayRec(d), { steps, stepsAt: Date.now(), stepsFrom: from }); n++; last = d;
  }
  if (!n) return warn('Those steps are for a day that hasn’t happened yet');
  healthCommit(n === 1 ? `${fmtDay(last)}: ${nf0.format(map[last])} steps saved` : `Steps saved for ${n} days`);
}
/** A link like …/ledger/#steps=2026-11-10=12034 (from a Shortcut, on Android or in Safari). */
function importStepsFromLink() {
  const m = bootHash.match(/^#steps=(.+)$/);
  if (!m) return;
  ui.tab = 'health'; history.replaceState(null, '', '#health');
  const got = H.parseSteps(decodeURIComponent(m[1]));
  if (!Object.keys(got).length) return;
  if (!state.health.enabled) { setTimeout(() => toast('Set up Health first, then sync your steps again'), 700); return; }
  const t = today();
  for (const [d, steps] of Object.entries(got)) if (d <= t) Object.assign(dayRec(d), { steps, stepsAt: Date.now(), stepsFrom: 'health' });
  S.save(state);
  setTimeout(() => toast(`Steps synced from Apple Health`), 700);
}
async function pasteSteps(d) {
  let text = null;
  try { text = await navigator.clipboard.readText(); } catch { text = null; }
  const got = text ? H.parseSteps(text) : {};
  if (Object.keys(got).length) return applySteps(got, 'health');
  const bare = text && H.parseSteps(text, d)[d];
  stepsSheet(d, bare != null ? { value: bare, note: `The clipboard has ${nf0.format(bare)} but no date. Is that ${fmtDay(d)}'s count?` }
    : { note: text == null ? 'Couldn’t read the clipboard here. Paste what the shortcut copied into the box below.' : 'No step count on the clipboard. Run your “Ledger steps” shortcut first, or type the number.' });
}

function rulesList(h) {
  return `<ul class="rule-list">
    <li><span class="e">👟</span><div>Walk <b>${nf0.format(h.stepGoal)} steps</b> → <b class="plus">+${rs(h.reward)}</b></div></li>
    <li><span class="e">🛋️</span><div>Fall short → <b class="minus">−${rs(h.penalty)}</b></div></li>
    <li><span class="e">🍕</span><div>A cheat meal, or eating <b>${nf0.format(h.overMargin)}+ kcal</b> over your ${kcal(h.calorieGoal)} goal → <b class="minus">−${rs(h.penalty)}</b></div></li>
    <li><span class="e">🛡️</span><div>Miss steps <i>and</i> overeat? Still just one <b class="minus">−${rs(h.penalty)}</b>.</div></li>
  </ul>`;
}

function healthHomeRow() {
  const h = state.health;
  if (!h.enabled) return `<button class="row" data-act="tab" data-tab="health" style="margin-top:12px"><div class="ic" style="background:var(--pos-soft);color:var(--pos)">${I.steps}</div><div class="mid"><div class="t">Earn ${rs(h.reward)} a day for walking</div><div class="s">Link steps and food to your balance</div></div><span class="chev">${I.chev}</span></button>`;
  const t = today(), d = h.days[t] || {};
  const v = H.verdict(d, H.rulesOf(h));
  const waiting = H.waitingDays(h);
  const sub = waiting.length ? `${fmtDay(waiting[0])} is waiting for its steps` : `If today ended now: ${v.net ? rs(v.net, { sign: true }) : 'nothing in or out'}`;
  return `<button class="row" data-act="tab" data-tab="health" style="margin-top:12px"><div class="ic" style="background:var(--pos-soft);color:var(--pos)">${I.steps}</div><div class="mid"><div class="t">${v.stepsKnown ? nf0.format(v.steps) : '—'} steps · ${kcal(v.kcal)} today</div><div class="s">${esc(sub)}</div></div>${waiting.length ? '<span class="tag warn">sync</span>' : ''}<span class="chev">${I.chev}</span></button>`;
}

function healthIntro() {
  const h = state.health;
  return `<div class="section-head" style="margin-top:4px"><h2>Health</h2></div>
  <section class="card hero">
    <div class="eyebrow">Steps and food that move your money</div>
    <p class="muted" style="margin:8px 0 0;font-size:14.5px">Your Apple Watch steps and the food you log here settle into your ledger at the end of every day.</p>
    ${rulesList(h)}
    <button class="btn accent" data-act="h-setup" style="margin-top:14px">Set it up</button>
  </section>
  <p class="foot-note">Steps arrive from Apple Health through a Shortcut on your iPhone. Setup shows you how.</p>`;
}

function verdictCard(d, day, rules) {
  const h = state.health, t = today();
  const v = H.verdict(day, rules);
  const amts = (x) => `<div class="amts">${x.reward ? `<span class="plus num">+${rs(x.reward)}</span>` : ''}${x.penalty ? `<span class="minus num">−${rs(x.penalty)}</span>` : ''}${!x.reward && !x.penalty ? '<span class="num">₹0</span>' : ''}</div>`;
  const why = v.reasons.length ? `Lost for ${v.reasons.join(' + ')}.` : '';
  let t1, s1, show = true;
  if (d < h.startDate) { t1 = 'Before your rules started'; s1 = `Rules count from ${fmtDay(h.startDate)}.`; show = false; }
  else if (d === t) {
    t1 = 'If today ended now';
    s1 = v.stepsKnown ? `${why} Settles into your ledger after midnight.` : 'Steps not synced yet today. Settles after midnight once they are.';
    if (!v.stepsKnown) show = false;
  } else if (!H.stepsFinal(d, day, rules.stepGoal)) {
    t1 = 'Waiting for the final step count'; show = false;
    s1 = day.steps != null ? `Only ${nf0.format(day.steps)} steps were synced, at ${new Date(day.stepsAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Sync again or type the day's total to settle it.` : 'Sync from Apple Health or type the steps to settle this day.';
  } else { t1 = 'Settled in your ledger'; s1 = `${why} Change anything here and the ledger updates to match.`; }
  return `<section class="card verdict"><div class="eyebrow">Money</div><div class="t" style="margin-top:6px">${t1}</div>${show ? amts(v) : ''}<div class="s">${esc(s1.trim())}</div></section>`;
}

function healthView() {
  const h = state.health;
  if (!h.enabled) return healthIntro();
  const t = today(), d = healthDay();
  const day = h.days[d] || { steps: null, meals: [] };
  const rules = day.rules || H.rulesOf(h);
  const v = H.verdict(day, rules);
  const limit = rules.calorieGoal + rules.overMargin;
  const stepPct = v.stepsKnown ? Math.min(1, v.steps / rules.stepGoal) : 0;
  const kcalPct = limit ? Math.min(1, v.kcal / limit) : 0;
  const meals = (day.meals || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const month = H.healthSummary(state, `${C.monthKey(t)}-01`, t);
  const waiting = H.waitingDays(h);
  const hist = [];
  for (let x = C.addDays(t, -1); x >= h.startDate && hist.length < 14; x = C.addDays(x, -1)) hist.push(x);
  const histRow = (x) => {
    const r = h.days[x] || {}; const rr = r.rules || H.rulesOf(h); const vv = H.verdict(r, rr);
    const done = H.stepsFinal(x, r, rr.stepGoal);
    return `<button class="row" data-act="h-day" data-d="${x}"><div class="ic ${done ? (vv.net >= 0 ? 'in' : 'out') : ''}">${done ? (vv.penalty ? '✕' : '✓') : '…'}</div>
      <div class="mid"><div class="t">${esc(fmtDay(x))}</div><div class="s">${vv.stepsKnown ? nf0.format(vv.steps) : '—'} steps · ${kcal(vv.kcal)}${vv.cheat ? ' · cheat meal' : ''}</div></div>
      <div class="amt ${done && vv.net > 0 ? 'in' : ''}">${done ? money(vv.net, { sign: true }) : '<span class="tag warn">sync</span>'}</div></button>`;
  };
  return `
  <div class="h-nav">
    <button class="icon-btn" data-act="h-shift" data-n="-1" aria-label="Previous day" ${d <= h.startDate && !h.days[C.addDays(d, -1)] ? 'disabled' : ''}>${I.back}</button>
    <div class="when"><b>${esc(fmtDay(d))}</b><span>${d === t ? 'so far' : C.parseDate(d).toLocaleDateString('en-IN', { weekday: 'long' })}</span></div>
    <button class="icon-btn fwd" data-act="h-shift" data-n="1" aria-label="Next day" ${d >= t ? 'disabled' : ''}>${I.back}</button>
  </div>

  ${waiting.length && d === t ? `<button class="row" data-act="h-day" data-d="${waiting[0]}"><div class="ic" style="background:rgba(244,183,64,.14);color:var(--warn)">${I.watch}</div><div class="mid"><div class="t">${waiting.length === 1 ? `${esc(fmtDay(waiting[0]))} needs its steps` : `${waiting.length} days need their steps`}</div><div class="s">They settle once the day's count is in</div></div><span class="chev">${I.chev}</span></button>` : ''}

  <section class="card h-card">
    <div class="head"><div class="eyebrow">${I.steps} Steps</div><span class="faint" style="font-size:12px">${day.stepsFrom === 'health' ? 'from Apple Health' : day.stepsFrom === 'typed' ? 'typed in' : ''}</span></div>
    <div class="h-big num">${v.stepsKnown ? nf0.format(v.steps) : '—'}<small>/ ${nf0.format(rules.stepGoal)}</small></div>
    <div class="meter ${v.stepsMet ? 'good' : stepPct < .5 && d !== t ? 'over' : ''}" style="margin-top:12px"><i style="width:${(stepPct * 100).toFixed(1)}%"></i></div>
    <div class="foot">${v.stepsMet ? `Goal hit · <b class="pos">+${rs(rules.reward)}</b>` : v.stepsKnown ? `${nf0.format(rules.stepGoal - v.steps)} to go` : 'Not synced yet'}</div>
    <div class="h-btns"><button class="btn accent" data-act="h-paste" data-d="${d}">${I.watch} Paste from Health</button><button class="btn ghost" data-act="h-steps" data-d="${d}">Type steps</button></div>
  </section>

  ${foodCard(d, day, rules, v, limit, kcalPct, meals)}
  ${waterCard(d)}

  ${verdictCard(d, day, rules)}
  ${d === t ? weightCard() : ''}

  <div class="eyebrow" style="margin:18px 4px 0">This month</div>
  <div class="stats" style="margin-top:8px">
    <div class="stat"><div class="eyebrow">Earned</div><div class="v pos">${money(month.earned)}</div></div>
    <div class="stat"><div class="eyebrow">Lost</div><div class="v neg">${money(month.lost)}</div></div>
    <div class="stat"><div class="eyebrow">Good days</div><div class="v">${month.good}/${month.good + month.bad}</div></div>
  </div>

  ${hist.length ? `<div class="section-head"><h2>Past days</h2></div><div class="list">${hist.map(histRow).join('')}</div>` : ''}

  <div class="section-head"><h2>Setup</h2></div>
  <section class="card tap" data-act="h-body"><div class="set-row"><div class="ic">${I.scale}</div><div><div class="t">Body & goal</div><div class="s">${h.profile ? `${h.profile.weightKg} kg · ${esc(N.GOALS[h.profile.goal])} · ${kcal(TG()?.target || h.calorieGoal)} target` : 'Work out your calories, protein, carbs and fat'}</div></div><span class="go">${I.arrow}</span></div></section>
  <section class="card tap" data-act="h-recipes"><div class="set-row"><div class="ic">${I.bowl}</div><div><div class="t">Your meals & foods</div><div class="s">${state.health.recipes.length} meals · ${state.health.foods.length} scanned or added foods</div></div><span class="go">${I.arrow}</span></div></section>
  <section class="card tap" data-act="h-connect"><div class="set-row"><div class="ic">${I.watch}</div><div><div class="t">Connect Apple Watch</div><div class="s">Send your steps from Apple Health with a Shortcut</div></div><span class="go">${I.arrow}</span></div></section>
  <section class="card tap" data-act="h-rules"><div class="set-row"><div class="ic">${I.rupee}</div><div><div class="t">Goals & money</div><div class="s">${nf0.format(h.stepGoal)} steps · ${kcal(h.calorieGoal)} · +${rs(h.reward)} / −${rs(h.penalty)}</div></div><span class="go">${I.arrow}</span></div></section>`;
}

function rulesSheet(first = false) {
  const h = state.health;
  const r = { ...h, accountId: h.accountId || state.accounts[0]?.id };
  const num = (id, label, val, hint, suffix = '') => `<div class="field"><label class="eyebrow" for="${id}">${label}</label><div class="amount-box">${suffix === '₹' ? '<span class="cur">₹</span>' : ''}<input id="${id}" class="num" inputmode="numeric" value="${val}" style="font-size:24px">${suffix && suffix !== '₹' ? `<span class="faint" style="font-size:15px;padding-right:6px">${suffix}</span>` : ''}</div>${hint ? `<p class="faint" style="font-size:12.5px;margin:6px 2px 0">${hint}</p>` : ''}</div>`;
  const body = () => `
    ${first ? `<p class="lead" style="margin-top:0">Your calorie goal comes from your body & goal. The rest is set the way you described, and you can change any of it.</p>` : ''}
    ${num('r-kcal', 'Daily calorie goal', r.calorieGoal, TG() ? `Your target from Body & goal is ${nf0.format(TG().target)} kcal. Change it here to set your own.` : '', 'kcal')}
    ${num('r-margin', 'Overeating starts at', r.overMargin, 'Calories over your goal that cost the penalty. A cheat meal always does.', 'kcal over')}
    ${num('r-steps', 'Daily step goal', r.stepGoal, '', 'steps')}
    <div class="opts" style="margin-top:0">
      <div>${num('r-reward', 'Reward', r.reward / 100, '', '₹')}</div>
      <div>${num('r-penalty', 'Penalty', r.penalty / 100, '', '₹')}</div>
    </div>
    <div class="field"><div class="eyebrow label">Money moves in</div><div class="opts">${[['upi', 'Bank · UPI'], ['cash', 'Cash']].map(([v, l]) => `<button class="opt ${r.method === v ? 'on' : ''}" data-rm="${v}">${l}</button>`).join('')}</div></div>
    <div class="field"><div class="eyebrow label">Account</div><div class="opts">${state.accounts.map((a) => `<button class="opt ${r.accountId === a.id ? 'on' : ''}" data-ra="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>
    <p class="faint" style="font-size:12.5px;margin:14px 2px 0">${first ? 'Rules start today. Each day settles into your ledger after midnight.' : 'Changes count from today. Days already settled keep the rules they had.'}</p>
    <div class="btn-row">${!first ? `<button class="btn ghost" data-off style="flex:0 0 auto;width:auto;padding:16px 18px">Turn off</button>` : ''}<button class="btn accent" data-save-rules>${first ? 'Start' : 'Save'}</button></div>`;
  const sh = openSheet(first ? 'Set up Health' : 'Goals & money', body());
  const el = $('.sheet-body', sh);
  const int = (id) => Math.round(Number(($(id, sh).value || '').replace(/[,₹\s]/g, '')));
  const pull = () => { r.calorieGoal = int('#r-kcal'); r.overMargin = int('#r-margin'); r.stepGoal = int('#r-steps'); r.reward = C.toPaise(int('#r-reward')); r.penalty = C.toPaise(int('#r-penalty')); };
  sh.addEventListener('click', async (ev) => {
    const m = ev.target.closest('[data-rm]'), a = ev.target.closest('[data-ra]');
    if (m || a) { pull(); if (m) r.method = m.dataset.rm; if (a) r.accountId = a.dataset.ra; el.innerHTML = body(); return; }
    if (ev.target.closest('[data-off]')) {
      if (await ask('Turn off Health?', 'Days stop settling. Money already added or taken stays in your ledger, and your step and food log is kept.', 'Turn off', true)) { h.enabled = false; closeAllSheets(); commit('Health rules off'); }
      return;
    }
    if (!ev.target.closest('[data-save-rules]')) return;
    pull();
    if (!(r.calorieGoal >= 800 && r.calorieGoal <= 6000)) return warn('Calorie goal should be between 800 and 6,000');
    if (!(r.stepGoal >= 1000) || !(r.overMargin >= 0) || !(r.reward >= 0) || !(r.penalty >= 0)) return warn('Check the numbers');
    if (TG()) h.autoGoal = r.calorieGoal === TG().target;
    Object.assign(h, { calorieGoal: r.calorieGoal, overMargin: r.overMargin, stepGoal: r.stepGoal, reward: r.reward, penalty: r.penalty, method: r.method, accountId: r.accountId });
    if (!h.enabled) { h.enabled = true; h.startDate = h.startDate && !first ? h.startDate : today(); }
    // today isn't settled yet, so it picks up the new rules too
    if (h.days[today()]) delete h.days[today()].rules;
    closeSheet();
    ui.tab = 'health'; history.replaceState(null, '', '#health');
    healthCommit(first ? 'Health is on. Today counts.' : 'Saved');
    if (first) setTimeout(() => connectSheet(), 700);
  });
}

function stepsSheet(d, { note = '', value } = {}) {
  const r = state.health.days[d];
  const sh = openSheet(`Steps · ${fmtDay(d)}`, `
    ${note ? `<p class="lead" style="margin-top:0">${esc(note)}</p>` : ''}
    <div class="field" style="margin-top:0"><label class="eyebrow" for="st-n">Steps on ${esc(fmtDay(d))}</label><input class="input num" id="st-n" inputmode="numeric" placeholder="${nf0.format(state.health.stepGoal)}" value="${value ?? r?.steps ?? ''}" style="font-size:22px"></div>
    <div class="field"><label class="eyebrow" for="st-paste">Or paste what the shortcut copied <span class="faint">— optional</span></label><textarea class="input" id="st-paste" placeholder="2026-11-10=12034"></textarea></div>
    <p class="faint" style="font-size:12.5px;margin:10px 2px 0">The day's total is in the Fitness app on your iPhone (Activity → Steps), or Health → Steps.</p>
    <div class="btn-row"><button class="btn ghost" data-act="close-sheet">Cancel</button><button class="btn accent" data-st-save>Save steps</button></div>`);
  if (FINE) setTimeout(() => $('#st-n', sh)?.focus(), 300);
  sh.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-st-save]')) return;
    const pasted = $('#st-paste', sh).value.trim();
    if (pasted) {
      const got = H.parseSteps(pasted, d);
      if (!Object.keys(got).length) return warn('Couldn’t find a step count in that text');
      closeSheet(); return applySteps(got, 'health');
    }
    const n = Math.round(Number(($('#st-n', sh).value || '').replace(/[,\s]/g, '')));
    if (!Number.isFinite(n) || n < 0 || n > 200000 || $('#st-n', sh).value.trim() === '') return warn('Enter the number of steps');
    closeSheet(); applySteps({ [d]: n }, 'typed');
  });
}

function foodSheet(d, meal) {
  const h = state.health;
  const m = meal ? { ...meal } : { name: '', kcal: '', cheat: false, time: d === today() ? nowTime() : '13:00' };
  const freq = meal ? [] : H.frequentFoods(h);
  const rules = h.days[d]?.rules || H.rulesOf(h);
  const before = H.caloriesOf(h.days[d]) - (meal ? Number(meal.kcal) || 0 : 0);
  const sh = openSheet(meal ? 'Edit food' : 'Quick add', `
    ${freq.length ? `<div class="eyebrow label" style="margin-top:0">Again?</div><div class="opts" style="flex-wrap:wrap">${freq.map((f, i) => `<button class="opt" data-ff="${i}">${esc(f.name)} · ${nf0.format(f.kcal)}</button>`).join('')}</div>` : ''}
    <div class="field" ${freq.length ? '' : 'style="margin-top:0"'}><label class="eyebrow" for="fd-name">What did you eat?</label><input class="input" id="fd-name" value="${esc(m.name)}" placeholder="Dal rice, 2 rotis, chai…" autocomplete="off"></div>
    <div class="field"><label class="eyebrow" for="fd-kcal">Calories</label><div class="amount-box"><input id="fd-kcal" class="num" inputmode="numeric" placeholder="0" value="${m.kcal}" style="font-size:26px"><span class="faint" style="font-size:15px;padding-right:6px">kcal</span></div>
      <p class="faint" id="fd-left" style="font-size:12.5px;margin:6px 2px 0"></p></div>
    <div class="nf-grid three">${[['p', 'Protein'], ['c', 'Carbs'], ['f', 'Fat']].map(([k, l]) => `<div><label class="eyebrow" for="fd-${k}">${l} <span class="faint">g</span></label><input class="input num" id="fd-${k}" inputmode="decimal" placeholder="—" value="${m[k] ?? ''}" style="margin-top:6px"></div>`).join('')}</div>
    <div class="field"><label class="eyebrow" for="fd-time">Time</label><input class="input num" type="time" id="fd-time" value="${m.time || ''}"></div>
    <div class="check ${m.cheat ? 'on' : ''}" data-cheat style="margin-top:18px"><span class="box">${m.cheat ? I.check : ''}</span><div><div class="t">Cheat meal</div><div class="s">Counts as overeating for the day, whatever the calories: −${rs(rules.penalty)} (only once a day).</div></div></div>
    <div class="btn-row">${meal ? `<button class="btn danger" data-fd-del style="flex:0 0 auto;width:auto;padding:16px 20px" aria-label="Delete">${I.trash}</button>` : ''}<button class="btn accent" data-fd-save>${meal ? 'Save' : 'Add food'}</button></div>`);
  const left = () => {
    const k = Math.round(Number(($('#fd-kcal', sh).value || '0').replace(/,/g, ''))) || 0;
    const total = before + k, lim = rules.calorieGoal + rules.overMargin;
    $('#fd-left', sh).textContent = total >= lim ? `That makes ${nf0.format(total)} kcal today, over the ${nf0.format(lim)} limit (−${rs(rules.penalty)}).` : `That makes ${nf0.format(total)} kcal today. ${nf0.format(lim - total)} left before the ${nf0.format(lim)} limit.`;
  };
  left();
  $('#fd-kcal', sh).addEventListener('input', left);
  if (FINE && !meal) setTimeout(() => $('#fd-name', sh)?.focus(), 300);
  sh.addEventListener('click', async (ev) => {
    const ff = ev.target.closest('[data-ff]');
    if (ff) { const f = freq[Number(ff.dataset.ff)]; $('#fd-name', sh).value = f.name; $('#fd-kcal', sh).value = f.kcal; left(); return; }
    const ch = ev.target.closest('[data-cheat]');
    if (ch) { m.cheat = !m.cheat; ch.classList.toggle('on', m.cheat); $('.box', ch).innerHTML = m.cheat ? I.check : ''; return; }
    if (ev.target.closest('[data-fd-del]')) {
      const rec = dayRec(d); rec.meals = rec.meals.filter((x) => x.id !== meal.id);
      closeSheet(); X.play('delete'); return healthCommit(`${meal.name} removed`);
    }
    if (!ev.target.closest('[data-fd-save]')) return;
    m.name = $('#fd-name', sh).value.trim() || (m.cheat ? 'Cheat meal' : '');
    const raw = ($('#fd-kcal', sh).value || '').replace(/[,\s]/g, '');
    m.kcal = Math.round(Number(raw));
    m.time = $('#fd-time', sh).value || '';
    for (const k of ['p', 'c', 'f']) { const v = $(`#fd-${k}`, sh).value.trim().replace(',', '.'); m[k] = v === '' ? null : Math.max(0, Number(v) || 0); }
    if (!m.name) return warn('Say what you ate');
    if (raw === '' && !m.cheat) return warn('Add the calories (a guess is fine)');
    if (!Number.isFinite(m.kcal) || m.kcal < 0 || m.kcal > 10000) m.kcal = 0;
    const rec = dayRec(d);
    if (meal) Object.assign(rec.meals.find((x) => x.id === meal.id), m);
    else rec.meals.push({ ...m, id: S.uid() });
    closeSheet();
    healthCommit(meal ? 'Saved' : `${m.name} · ${kcal(m.kcal)} added`);
  });
}

function connectSheet() {
  const site = location.origin + location.pathname;
  openSheet('Connect Apple Watch', `
    <p class="lead" style="margin-top:0">Websites can't read Apple Health directly, so a Shortcut on your iPhone does it. Your Watch syncs steps to the iPhone's Health app. The Shortcut reads them and copies them, and Ledger pastes them in.</p>
    <div class="eyebrow label">1 · Make the shortcut (once)</div>
    <ol class="steps-guide">
      <li>Open <b>Shortcuts</b> → <b>+</b>. Name it <b>Ledger steps</b>.</li>
      <li>Add <b>Find Health Samples</b>: Type <b>Steps</b>, Start Date <b>is today</b>. Tap it and set <b>Group By: Day</b>.</li>
      <li>Add <b>Calculate Statistics</b>: <b>Sum</b> of the Health Samples.</li>
      <li>Add <b>Format Date</b>: Current Date, Custom format <code>yyyy-MM-dd</code>.</li>
      <li>Add <b>Text</b>: the Formatted Date, then <code>=</code>, then the Statistics result. It reads like <code>2026-11-10=12034</code>.</li>
      <li>Add <b>Copy to Clipboard</b> (the Text), then <b>Show Notification</b> “Steps ready for Ledger”.</li>
      <li>Run it once and tap <b>Allow</b> when it asks for Health access.</li>
    </ol>
    <div class="eyebrow label" style="margin-top:20px">2 · Run it at 11:59 PM every day</div>
    <ol class="steps-guide">
      <li>Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b> → <b>11:59 PM</b>, <b>Daily</b>.</li>
      <li>Choose <b>Run Immediately</b>, then pick <b>Ledger steps</b>.</li>
    </ol>
    <div class="eyebrow label" style="margin-top:20px">3 · Paste it in</div>
    <ol class="steps-guide">
      <li>Open Ledger → <b>Health</b> → <b>Paste from Health</b>, and tap <b>Paste</b> when iPhone asks. That day settles straight away.</li>
      <li>Missed it? Run the shortcut by hand the next morning, but change its Start Date to <b>yesterday</b> and its date to yesterday too. Or just type the steps.</li>
    </ol>
    <p class="faint" style="font-size:12.5px;margin:16px 2px 0">iPhone hides Health data while the phone is locked, so the 11:59 PM run can fail if your phone is locked. If it does, Ledger simply waits. It never fines a day without a final count. A count taken before 11:30 PM only counts if it already hits your goal.</p>
    <p class="faint" style="font-size:12.5px;margin:10px 2px 0">On Android or a computer, a link works too: <span class="code-line">${esc(site)}#steps=2026-11-10=12034</span></p>
    <div class="btn-row"><button class="btn accent" data-act="close-sheet">Done</button></div>`);
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act^="h-"]');
  if (!el) return;
  const d = el.dataset.d;
  switch (el.dataset.act) {
    case 'h-rules': rulesSheet(el.dataset.first === '1'); break;
    case 'h-setup': profileSheet(true); break;
    case 'h-connect': connectSheet(); break;
    case 'h-shift': { const n = C.addDays(healthDay(), Number(el.dataset.n)); ui.hday = n >= today() ? null : n; ui.fresh = false; render(); break; }
    case 'h-day': openHealthDay(d); break;
    case 'h-paste': pasteSteps(d); break;
    case 'h-steps': stepsSheet(d); break;
    case 'h-food': pickFood({ day: d }); break;
    case 'h-meal': { const m = state.health.days[d]?.meals.find((x) => x.id === el.dataset.id); const fd = m?.ref && anyFood(m.ref); if (fd) amountSheet(fd, { day: d, existing: m }); else if (m) foodSheet(d, m); break; }
  }
});

// ================================================================ food: targets, picker, scanning
// Body & goal works out calories and macros (nutrition.js). The food picker searches the built-in list
// (foods.js) and your own foods, meals, barcodes and label photos. Every logged item keeps its calories,
// so the ₹1,000 overeating rule keeps working on the day's total.
const TG = () => N.targets(state.health.profile);
const myFoods = () => state.health.foods;
const g1 = (x) => (x == null ? '—' : Math.round(x * 10) / 10);
const recipeFood = (r) => {
  const t = N.totals(r.items); const k = Math.max(1, Number(r.servings) || 1);
  const n = {}; for (const [key] of N.NUTRIENTS) n[key] = key === 'kcal' || key === 'na' ? Math.round(t[key] / k) : Math.round((t[key] / k) * 10) / 10;
  const grams = r.items.reduce((s, i) => s + (Number(i.g) || 0), 0);
  return { id: `rec:${r.id}`, name: r.name, brand: '', source: 'recipe', recipeId: r.id, serving: { label: '1 serving', g: grams ? Math.round(grams / k) : null }, n, count: r.items.length };
};
const anyFood = (id) => (id?.startsWith('rec:') ? (() => { const r = state.health.recipes.find((x) => `rec:${x.id}` === id); return r ? recipeFood(r) : null; })() : F.foodById(id, myFoods()));

/** Recently and most logged foods, as foods you can tap again. */
function loggedFoods() {
  const seen = new Map();
  const days = Object.keys(state.health.days).sort().reverse();
  let order = 0;
  for (const d of days) for (const m of (state.health.days[d].meals || []).slice().reverse()) {
    const key = m.ref || `quick:${m.name.toLowerCase()}|${m.kcal}`;
    const r = seen.get(key) || { key, count: 0, order: order++, m };
    r.count++; seen.set(key, r);
  }
  const toFood = (r) => (r.m.ref && anyFood(r.m.ref)) || { id: r.key, name: r.m.name, brand: '', source: 'quick', serving: { label: '1 serving', g: null }, n: { kcal: r.m.kcal, p: r.m.p ?? null, c: r.m.c ?? null, f: r.m.f ?? null, fib: r.m.fib ?? null, sug: r.m.sug ?? null, na: r.m.na ?? null } };
  const all = [...seen.values()];
  return { recent: all.sort((a, b) => a.order - b.order).slice(0, 8).map(toFood), most: all.slice().sort((a, b) => b.count - a.count).filter((r) => r.count > 1).slice(0, 8).map(toFood) };
}

function macroBars(t, tg, { compact = false } = {}) {
  const bar = (label, v, goal, cls) => `<div class="mac ${cls}"><div class="top"><span>${label}</span><b class="num">${g1(v)}<small> / ${goal}g</small></b></div><div class="track"><i style="width:${goal ? Math.min(100, (v / goal) * 100).toFixed(1) : 0}%"></i></div></div>`;
  if (!tg) return '';
  return `<div class="macs ${compact ? 'compact' : ''}">${bar('Protein', t.p, tg.protein, 'pro')}${bar('Carbs', t.c, tg.carbs, 'carb')}${bar('Fat', t.f, tg.fat, 'fat')}</div>`;
}

function foodCard(d, day, rules, v, limit, kcalPct, meals) {
  const tg = TG(); const t = N.totals(meals);
  const quick = (act, icon, label) => `<button class="qa" data-act="${act}" data-d="${d}">${icon}<span>${label}</span></button>`;
  return `<section class="card h-card">
    <div class="head"><div class="eyebrow">${I.food} Food</div><span class="faint" style="font-size:12px">goal ${kcal(rules.calorieGoal)}</span></div>
    <div class="kc-row"><div class="h-big num">${nf0.format(Math.max(0, rules.calorieGoal - v.kcal))}<small>kcal left</small></div><div class="eaten"><span class="eyebrow">Eaten</span><b class="num">${nf0.format(v.kcal)}</b></div></div>
    <div class="meter ${v.overate ? 'over' : kcalPct > .85 ? 'low' : ''}" style="margin-top:12px"><i style="width:${(kcalPct * 100).toFixed(1)}%"></i></div>
    <div class="foot">${v.cheat ? `Cheat meal logged · <b class="neg">−${rs(rules.penalty)}</b>` : v.overByCalories ? `${kcal(v.over)} over your goal · <b class="neg">−${rs(rules.penalty)}</b>` : `${kcal(Math.max(0, limit - v.kcal))} left before the ${kcal(limit)} limit`}</div>
    ${macroBars(t, tg)}
    ${tg ? `<button class="link" data-act="h-breakdown" data-d="${d}" style="margin-top:10px;font-size:13px">Full breakdown →</button>` : `<button class="link" data-act="h-body" style="margin-top:10px;font-size:13px">Set your body & goal for protein, carbs and fat targets →</button>`}
    <div class="qas">${quick('h-scan', I.barcode, 'Scan')}${quick('h-label', I.camera, 'Label')}${quick('h-recipes', I.bowl, 'Meal')}${quick('h-food', I.plus, 'Food')}</div>
    ${meals.length ? `<div class="list" style="margin-top:12px">${meals.map((m) => `<button class="row" data-act="h-meal" data-d="${d}" data-id="${m.id}"><div class="ic ${m.cheat ? 'out' : ''}">${m.cheat ? '🍕' : m.src === 'scanned' ? '▥' : m.src === 'recipe' ? '🥘' : '🍽️'}</div><div class="mid"><div class="t">${esc(m.name)}${m.cheat ? '<span class="tag warn">cheat</span>' : ''}</div><div class="s">${esc([m.amount, fmtTime(m.time), m.p != null ? `P ${g1(m.p)} · C ${g1(m.c)} · F ${g1(m.f)}` : ''].filter(Boolean).join(' · '))}</div></div><div class="amt">${kcal(m.kcal)}</div></button>`).join('')}</div>` : ''}
  </section>`;
}

function waterCard(d) {
  const adds = state.health.water[d] || []; const ml = adds.reduce((s, x) => s + x, 0);
  const goal = Math.round((TG()?.water || 3) * 1000); const cups = Math.ceil(goal / 250);
  return `<section class="card h-card">
    <div class="head"><div class="eyebrow">${I.drop} Water</div><span class="num" style="font-size:14px">${(ml / 1000).toFixed(2)} / ${(goal / 1000).toFixed(1)} L</span></div>
    <div class="cups">${Array.from({ length: cups }, (_, i) => `<i class="${(i + 1) * 250 <= ml ? 'on' : ''}"></i>`).join('')}</div>
    <div class="h-btns"><button class="btn ghost" data-act="h-water" data-d="${d}" data-ml="250">+ 250 ml</button><button class="btn ghost" data-act="h-water" data-d="${d}" data-ml="500">+ 500 ml</button><button class="btn ghost" data-act="h-water" data-d="${d}" data-ml="undo" ${adds.length ? '' : 'disabled'}>Undo</button></div>
  </section>`;
}

function weightCard() {
  const w = state.health.weights.slice().sort((a, b) => a.date.localeCompare(b.date));
  const last = w.at(-1); const trend = N.weightTrend(w, today());
  const pts = w.slice(-14);
  const lo = Math.min(...pts.map((x) => x.kg)), hi = Math.max(...pts.map((x) => x.kg));
  const spark = pts.length > 1 ? `<svg class="wspark" viewBox="0 0 300 60" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((x, i) => `${(i / (pts.length - 1)) * 300},${hi === lo ? 30 : 54 - ((x.kg - lo) / (hi - lo)) * 48}`).join(' ')}"/></svg>` : '';
  return `<section class="card h-card">
    <div class="head"><div class="eyebrow">${I.scale} Weight</div><span class="faint" style="font-size:12px">${w.length} weigh-in${w.length === 1 ? '' : 's'}</span></div>
    ${last ? `<div class="kc-row"><div><div class="h-big num">${last.kg}<small>kg</small></div><div class="faint" style="font-size:12.5px;margin-top:2px">${esc(fmtDay(last.date))}</div></div>${trend != null ? `<div class="eaten"><span class="eyebrow">10-day avg</span><b class="num">${trend}</b></div>` : ''}</div>${spark}` : '<p class="faint" style="font-size:13.5px;margin:8px 0 0">Weigh in first thing in the morning for numbers you can compare.</p>'}
    <div class="h-btns"><input class="input num" id="h-wkg" inputmode="decimal" placeholder="${last ? last.kg : 'kg'}" style="flex:1"><button class="btn accent" data-act="h-weigh" style="flex:0 0 auto;width:auto;padding:12px 22px">Log</button></div>
  </section>`;
}

// ---------------------------------------------------------------- body & goal
function profileSheet(first = false) {
  const h = state.health;
  const p = { sex: 'male', age: '', heightCm: '', weightKg: '', bodyFat: '', activity: 'light', goal: 'lose', pace: 0.5, ...(h.profile || {}) };
  const lastW = h.weights.slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (lastW && !h.profile) p.weightKg = lastW.kg;
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(p[key]) === String(v) ? 'on' : ''}" data-pp="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const field = (id, label, val, unit, mode = 'decimal') => `<div><label class="eyebrow" for="${id}">${label}</label><div class="amount-box" style="margin-top:8px"><input id="${id}" class="num" inputmode="${mode}" value="${val ?? ''}" style="font-size:22px"><span class="faint" style="font-size:14px;padding-right:6px">${unit}</span></div></div>`;
  const result = () => {
    const tg = N.targets({ ...p, age: +p.age, heightCm: +p.heightCm, weightKg: +p.weightKg, bodyFat: +p.bodyFat || null, pace: +p.pace });
    if (!tg) return '<p class="faint" style="margin:18px 2px 0">Fill in age, height and weight to see your numbers.</p>';
    const b = N.bmi({ heightCm: +p.heightCm, weightKg: +p.weightKg }); const bl = N.bmiLabel(b, +p.age);
    return `<div class="card hero" style="margin-top:18px">
      <div class="kc-row"><div><div class="eyebrow">Daily target</div><div class="h-big num">${nf0.format(tg.target)}<small>kcal</small></div></div><div class="eaten"><span class="eyebrow">Maintenance</span><b class="num">${nf0.format(tg.maintenance)}</b></div></div>
      <div class="tg-grid"><div><span>Protein</span><b class="num">${tg.protein} g</b></div><div><span>Carbs</span><b class="num">${tg.carbs} g</b></div><div><span>Fat</span><b class="num">${tg.fat} g</b></div><div><span>Fibre</span><b class="num">${tg.fibre} g</b></div><div><span>Sugar max</span><b class="num">${tg.sugarMax} g</b></div><div><span>Water</span><b class="num">${tg.water} L</b></div></div>
      <div class="divider"></div>
      <div class="line-item" style="padding:0"><div class="grow"><div class="t">BMI ${b}</div><div class="s">${bl ? bl : 'Under 18 BMI is read on a growth chart for your age, so there’s no adult label.'}${+p.bodyFat ? ` · ${p.bodyFat}% body fat says more than BMI.` : ''}</div></div></div>
      <div class="notes">${tg.notes.map((n) => `<div class="note ${n.warn ? 'warn' : ''}"><b>${esc(n.t)}</b><span>${esc(n.s)}</span></div>`).join('')}</div>
    </div>`;
  };
  const body = () => `
    ${first ? '<p class="lead" style="margin-top:0">Tell Ledger about you. It works out your calories, protein, carbs, fat and water, and your calorie target becomes the limit for the overeating rule.</p>' : ''}
    <div class="eyebrow label">Sex</div>${seg('sex', [['male', 'Male'], ['female', 'Female']])}
    <div class="opts" style="margin-top:16px">${field('pp-age', 'Age', p.age, 'years', 'numeric')}${field('pp-h', 'Height', p.heightCm, 'cm')}</div>
    <div class="opts" style="margin-top:12px">${field('pp-w', 'Weight', p.weightKg, 'kg')}${field('pp-bf', 'Body fat (optional)', p.bodyFat, '%')}</div>
    <div class="field"><div class="eyebrow label">How active</div><div class="opts" style="grid-template-columns:1fr;display:grid">${Object.entries(N.ACTIVITY).map(([k, a]) => `<button class="opt ${p.activity === k ? 'on' : ''}" data-pp="activity" data-v="${k}" style="text-align:left;text-transform:none;letter-spacing:0;font-size:14px;padding:12px 14px"><b>${a.label}</b><br><span style="opacity:.7;font-weight:500">${a.sub}</span></button>`).join('')}</div></div>
    <div class="field"><div class="eyebrow label">Goal</div>${seg('goal', Object.entries(N.GOALS))}</div>
    ${p.goal !== 'maintain' ? `<div class="field"><div class="eyebrow label">Pace</div>${seg('pace', (p.goal === 'gain' ? [0.25, 0.5] : [0.25, 0.5, 0.75, 1]).map((x) => [x, `${x} kg/wk`]))}</div>` : ''}
    <div id="pp-res">${result()}</div>
    <div class="btn-row"><button class="btn accent" data-pp-save>${first ? 'Use these targets' : 'Save'}</button></div>`;
  const sh = openSheet(first ? 'Your body & goal' : 'Body & goal', body());
  const el = $('.sheet-body', sh);
  const pull = () => { p.age = $('#pp-age', sh).value.trim(); p.heightCm = $('#pp-h', sh).value.trim(); p.weightKg = $('#pp-w', sh).value.trim(); p.bodyFat = $('#pp-bf', sh).value.trim(); };
  sh.addEventListener('input', () => { pull(); $('#pp-res', sh).innerHTML = result(); });
  sh.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pp]');
    if (b) { pull(); p[b.dataset.pp] = b.dataset.pp === 'pace' ? Number(b.dataset.v) : b.dataset.v; if (b.dataset.pp === 'goal' && p.goal === 'gain' && p.pace > 0.5) p.pace = 0.25; const y = sh.scrollTop; el.innerHTML = body(); sh.scrollTop = y; return; }
    if (!ev.target.closest('[data-pp-save]')) return;
    pull();
    const prof = { sex: p.sex, age: Math.round(+p.age), heightCm: +p.heightCm, weightKg: +p.weightKg, bodyFat: +p.bodyFat || null, activity: p.activity, goal: p.goal, pace: +p.pace };
    if (!(prof.age >= 10 && prof.age <= 100)) return warn('Enter your age');
    if (!(prof.heightCm >= 100 && prof.heightCm <= 250)) return warn('Height in cm, like 170');
    if (!(prof.weightKg >= 25 && prof.weightKg <= 300)) return warn('Weight in kg, like 70');
    h.profile = prof;
    const t = today(); const ex = h.weights.find((w) => w.date === t);
    if (!lastW || lastW.kg !== prof.weightKg) { if (ex) ex.kg = prof.weightKg; else h.weights.push({ date: t, kg: prof.weightKg }); }
    const tg = TG();
    if (h.autoGoal !== false && tg) { h.calorieGoal = tg.target; if (h.days[t]) delete h.days[t].rules; }
    closeSheet();
    if (first) { S.save(state); render(); setTimeout(() => rulesSheet(true), 350); }
    else healthCommit(`Targets updated · ${kcal(h.calorieGoal)} a day`);
  });
}

// ---------------------------------------------------------------- picker
/** Search and pick a food. mode 'log' adds it to the day; mode 'build' hands it to a meal being made. */
function pickFood({ day, mode = 'log', onPick } = {}) {
  let q = '', brand = null;
  const lf = loggedFoods();
  const row = (f) => `<button class="row" data-pick-food="${esc(f.id)}"><div class="ic">${f.source === 'recipe' ? '🥘' : f.source === 'scanned' ? '▥' : f.source === 'label' ? '📷' : f.source === 'hand' ? '✎' : '🍽️'}</div><div class="mid"><div class="t">${esc(f.name)}</div><div class="s">${esc([f.brand, f.serving?.label, f.count ? `${f.count} items` : ''].filter(Boolean).join(' · '))}</div></div><div class="amt">${f.n?.kcal != null ? kcal(f.n.kcal) : ''}</div></button>`;
  const pool = new Map();
  const list = (title, foods, extra = '') => { foods.forEach((f) => pool.set(f.id, f)); return foods.length ? `<div class="section-head"><h2>${title}</h2>${extra}</div><div class="list">${foods.map(row).join('')}</div>` : ''; };
  const content = () => {
    pool.clear();
    if (q || brand) {
      const res = F.searchFoods(q, [...myFoods(), ...state.health.recipes.map(recipeFood)], { brandGroup: brand, limit: 60 });
      res.forEach((f) => pool.set(f.id, f));
      return `${brand ? `<div class="chips" style="margin-top:12px"><button class="chip on" data-brand="">${esc(brand === 'Mine' ? 'Your foods' : brand)} ✕</button></div>` : ''}
        ${res.length ? `<div class="list" style="margin-top:12px">${res.map(row).join('')}</div>` : `<div class="empty"><b>Nothing called “${esc(q)}”</b>Scan its barcode, read the label, or add it by hand.</div>`}
        <div class="h-btns"><button class="btn ghost" data-fp="create">${I.edit} Add “${esc(q || 'a food')}” by hand</button></div>`;
    }
    const recipes = state.health.recipes.map(recipeFood);
    return `${list('Your meals', recipes, '<button class="link" data-fp="new-meal">+ New meal</button>')}
      ${!recipes.length && mode === 'log' ? '<div class="section-head"><h2>Your meals</h2><button class="link" data-fp="new-meal">+ New meal</button></div><p class="faint" style="font-size:13px;margin:0 4px">Save dishes you make often, like your fried rice, and log them in one tap.</p>' : ''}
      ${list('Recent', lf.recent)}${list('Most eaten', lf.most)}
      ${list('Your foods', myFoods().slice(-8).reverse())}
      <div class="section-head"><h2>Browse</h2></div>
      <div class="chips wrap">${['Indian', 'Quick foods', 'Drinks', 'Basics', ...F.BRAND_GROUPS.filter((b) => !['Indian', 'Quick foods', 'Drinks', 'Basics'].includes(b)), ...(myFoods().length ? ['Mine'] : [])].map((b) => `<button class="chip" data-brand="${esc(b)}">${esc(b === 'Mine' ? 'Your foods' : b)}</button>`).join('')}</div>
      <p class="faint" style="font-size:12px;margin:14px 4px 0">${F.FOODS.length} foods built in. Restaurant and home values are good estimates. Scan or read the label for exact numbers on packets.</p>`;
  };
  const sh = openSheet(mode === 'build' ? 'Add to meal' : `Add food · ${fmtDay(day)}`, `
    <div class="search-box">${I.search}<input id="fp-q" placeholder="Search: dal tadka, Maggi, Farmhouse…" autocomplete="off" autocapitalize="off"></div>
    ${mode === 'log' ? `<div class="qas" style="margin-top:12px"><button class="qa" data-fp="scan">${I.barcode}<span>Scan</span></button><button class="qa" data-fp="label">${I.camera}<span>Label</span></button><button class="qa" data-fp="create">${I.edit}<span>By hand</span></button><button class="qa" data-fp="quick">${I.bolt}<span>Quick</span></button></div>` : ''}
    <div id="fp-res">${content()}</div>`);
  const inp = $('#fp-q', sh), out = $('#fp-res', sh);
  if (FINE) setTimeout(() => inp.focus(), 300);
  inp.addEventListener('input', () => { q = inp.value.trim(); out.innerHTML = content(); });
  const done = (food) => amountSheet(food, { day, mode, onPick });
  sh.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-brand]');
    if (b) { brand = b.dataset.brand || null; out.innerHTML = content(); sh.scrollTop = 0; return; }
    const pf = ev.target.closest('[data-pick-food]');
    if (pf) { const f = pool.get(pf.dataset.pickFood); if (f) done(f); return; }
    const a = ev.target.closest('[data-fp]')?.dataset.fp;
    if (a === 'scan') scanSheet(day);
    else if (a === 'label') labelFlow(day, { mode, onPick });
    else if (a === 'create') createFoodSheet({ name: q }, { onSaved: done });
    else if (a === 'quick') foodSheet(day);
    else if (a === 'new-meal') recipeSheet();
  });
  return sh;
}

// ---------------------------------------------------------------- amount
function amountSheet(food, { day, mode = 'log', onPick, existing } = {}) {
  const perGram = !!food.serving?.g;
  const startG = existing ? (existing.servings != null ? null : existing.g ?? null) : (['scanned', 'label'].includes(food.source) ? food.usualG || food.serving.g : null);
  const a = { useG: perGram && startG != null, g: startG ?? food.serving?.g ?? 100, servings: existing?.servings ?? 1, cheat: !!existing?.cheat, time: existing?.time || (day === today() ? nowTime() : '13:00') };
  const unit = food.unit || 'g';
  const amount = () => (a.useG ? { g: a.g } : { servings: a.servings });
  const preview = () => {
    const n = N.scale(food, amount());
    return `<div class="amt-hero"><div class="h-big num">${nf0.format(n.kcal || 0)}<small>kcal</small></div><div class="s faint">${esc(N.amountLabel(food, amount()))}</div></div>
      <div class="tg-grid">${N.NUTRIENTS.slice(1).map(([k, l, u]) => `<div><span>${l}</span><b class="num">${n[k] == null ? '—' : `${n[k]} ${u}`}</b></div>`).join('')}</div>`;
  };
  const body = () => `
    <div class="row" style="cursor:default"><div class="ic">${food.source === 'recipe' ? '🥘' : '🍽️'}</div><div class="mid"><div class="t">${esc(food.name)}</div><div class="s">${esc([food.brand, food.serving?.label && `per ${food.serving.label}${food.serving.g ? ` (${food.serving.g} ${unit})` : ''}`].filter(Boolean).join(' · '))}</div></div></div>
    ${perGram ? `<div class="seg" style="margin-top:16px"><button class="${!a.useG ? 'on' : ''}" data-am="serv">Servings</button><button class="${a.useG ? 'on' : ''}" data-am="g">${unit === 'ml' ? 'Millilitres' : 'Grams'}</button></div>` : ''}
    ${a.useG ? `<div class="field"><label class="eyebrow" for="am-g">How much did you eat?</label><div class="amount-box"><input id="am-g" class="num" inputmode="decimal" value="${a.g}" style="font-size:26px"><span class="faint" style="font-size:15px;padding-right:6px">${unit}</span></div></div>`
      : `<div class="field"><div class="eyebrow label">How many</div><div class="opts three">${[0.25, 0.5, 1, 1.5, 2, 3].map((x) => `<button class="opt ${a.servings === x ? 'on' : ''}" data-sv="${x}">${{ 0.25: '¼', 0.5: '½', 1.5: '1½' }[x] || x}</button>`).join('')}</div>
        <div class="amount-box" style="margin-top:10px"><input id="am-s" class="num" inputmode="decimal" value="${a.servings}" style="font-size:22px"><span class="faint" style="font-size:14px;padding-right:6px">× ${esc(food.serving?.label || 'serving')}</span></div></div>`}
    <div id="am-prev">${preview()}</div>
    ${mode === 'log' ? `<div class="field"><label class="eyebrow" for="am-t">Time</label><input class="input num" type="time" id="am-t" value="${a.time}"></div>
      <div class="check ${a.cheat ? 'on' : ''}" data-am-cheat style="margin-top:16px"><span class="box">${a.cheat ? I.check : ''}</span><div><div class="t">Cheat meal</div><div class="s">Counts as overeating for the day whatever the calories: −${rs(state.health.penalty)}, once a day at most.</div></div></div>` : ''}
    <div class="btn-row">${existing ? `<button class="btn danger" data-am-del style="flex:0 0 auto;width:auto;padding:16px 20px" aria-label="Delete">${I.trash}</button>` : ''}<button class="btn accent" data-am-ok>${existing ? 'Save' : mode === 'build' ? 'Add to meal' : 'Add food'}</button></div>`;
  const sh = openSheet(existing ? 'Edit food' : 'How much?', body());
  const el = $('.sheet-body', sh);
  const pull = () => {
    const gi = $('#am-g', sh), si = $('#am-s', sh), ti = $('#am-t', sh);
    if (gi) a.g = Math.max(0, Number(gi.value.replace(',', '.')) || 0);
    if (si) a.servings = Math.max(0, Number(si.value.replace(',', '.')) || 0);
    if (ti) a.time = ti.value;
  };
  const redraw = () => { const y = sh.scrollTop; el.innerHTML = body(); sh.scrollTop = y; };
  sh.addEventListener('input', () => { pull(); $('#am-prev', sh).innerHTML = preview(); });
  sh.addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-am]'); if (m) { pull(); a.useG = m.dataset.am === 'g'; return redraw(); }
    const sv = ev.target.closest('[data-sv]'); if (sv) { a.servings = Number(sv.dataset.sv); return redraw(); }
    const ch = ev.target.closest('[data-am-cheat]'); if (ch) { a.cheat = !a.cheat; ch.classList.toggle('on', a.cheat); $('.box', ch).innerHTML = a.cheat ? I.check : ''; return; }
    if (ev.target.closest('[data-am-del]')) {
      const rec = dayRec(day); rec.meals = rec.meals.filter((x) => x.id !== existing.id);
      closeSheet(); X.play('delete'); return healthCommit(`${existing.name} removed`);
    }
    if (!ev.target.closest('[data-am-ok]')) return;
    pull();
    if (a.useG ? !(a.g > 0) : !(a.servings > 0)) return warn('How much did you have?');
    const amt = amount(); const n = N.scale(food, amt);
    const item = { name: food.brand && !food.name.includes(food.brand) ? `${food.name} · ${food.brand}` : food.name, ref: food.id, src: food.source, amount: N.amountLabel(food, amt), ...amt, ...n, kcal: n.kcal || 0 };
    if (a.useG) item.g = a.g; else if (food.serving?.g) item.g = Math.round(food.serving.g * a.servings);
    if (mode === 'build') { closeSheet(); closeSheet(); onPick?.(item); return; }
    const rec = dayRec(day);
    if (existing) Object.assign(rec.meals.find((x) => x.id === existing.id), item, { time: a.time, cheat: a.cheat });
    else rec.meals.push({ ...item, id: S.uid(), time: a.time, cheat: a.cheat });
    closeAllSheets();
    if (!existing && day !== healthDay()) ui.hday = day;
    healthCommit(existing ? 'Saved' : `${food.name} · ${kcal(item.kcal)} added`);
  });
}

// ---------------------------------------------------------------- your own foods
function createFoodSheet(pre = {}, { onSaved, note } = {}) {
  const f = { name: pre.name || '', brand: pre.brand || '', per: pre.per || '100', servingG: pre.servingG || '', barcode: pre.barcode || '', source: pre.source || 'hand', n: { ...(pre.n || {}) } };
  const nf = ([k, l, u]) => `<div><label class="eyebrow" for="cf-${k}">${l}</label><div class="amount-box" style="margin-top:6px"><input id="cf-${k}" class="num" inputmode="decimal" value="${f.n[k] ?? ''}" placeholder="—" style="font-size:19px"><span class="faint" style="font-size:13px;padding-right:6px">${u}</span></div></div>`;
  const sh = openSheet(pre.barcode ? 'Add this product' : 'Add a food', `
    ${note ? `<p class="lead" style="margin-top:0">${note}</p>` : ''}
    <div class="field" style="margin-top:0"><label class="eyebrow" for="cf-name">Name</label><input class="input" id="cf-name" value="${esc(f.name)}" placeholder="Paneer wrap from canteen"></div>
    <div class="field"><label class="eyebrow" for="cf-brand">Brand <span class="faint">— optional</span></label><input class="input" id="cf-brand" value="${esc(f.brand)}"></div>
    <div class="field"><div class="eyebrow label">The numbers are per</div><div class="seg"><button class="${f.per === '100' ? 'on' : ''}" data-per="100">100 g / ml</button><button class="${f.per === 'serving' ? 'on' : ''}" data-per="serving">1 serving</button></div>
      <div class="amount-box" id="cf-sbox" style="margin-top:10px;${f.per === 'serving' ? '' : 'display:none'}"><input id="cf-sg" class="num" inputmode="decimal" value="${f.servingG}" placeholder="Serving size" style="font-size:19px"><span class="faint" style="font-size:13px;padding-right:6px">g in a serving</span></div></div>
    <div class="nf-grid">${N.NUTRIENTS.map(nf).join('')}</div>
    ${pre.barcode ? `<p class="faint" style="font-size:12.5px;margin:12px 2px 0">Barcode ${esc(pre.barcode)}. Next time you scan it, it's found straight away.</p>` : ''}
    <div class="btn-row">${!pre.fromLabel ? `<button class="btn ghost" data-cf-label style="flex:0 0 auto;width:auto;padding:16px 16px">${I.camera} Read label</button>` : ''}<button class="btn accent" data-cf-save>Save food</button></div>`);
  if (FINE && !f.name) setTimeout(() => $('#cf-name', sh)?.focus(), 300);
  sh.addEventListener('click', async (ev) => {
    const p = ev.target.closest('[data-per]');
    if (p) { f.per = p.dataset.per; $$('[data-per]', sh).forEach((b) => b.classList.toggle('on', b === p)); $('#cf-sbox', sh).style.display = f.per === 'serving' ? '' : 'none'; return; }
    if (ev.target.closest('[data-cf-label]')) {
      const file = await SC.pickPhoto(); if (!file) return;
      const res = await runOCR(file); if (!res) return;
      for (const [k] of N.NUTRIENTS) { const v = res.n[k]; if (v != null) $(`#cf-${k}`, sh).value = v; }
      f.per = res.per100 || !res.servingG ? '100' : 'serving'; if (res.servingG) $('#cf-sg', sh).value = res.servingG;
      $$('[data-per]', sh).forEach((b) => b.classList.toggle('on', b.dataset.per === f.per)); $('#cf-sbox', sh).style.display = f.per === 'serving' ? '' : 'none';
      toast(`Read ${res.found} values. Check them against the label.`); return;
    }
    if (!ev.target.closest('[data-cf-save]')) return;
    const name = $('#cf-name', sh).value.trim(); if (!name) return warn('Give it a name');
    const n = {}; for (const [k] of N.NUTRIENTS) { const raw = $(`#cf-${k}`, sh).value.trim().replace(',', '.'); n[k] = raw === '' ? null : Number(raw); if (n[k] != null && !(n[k] >= 0)) return warn('Check the numbers'); }
    if (n.kcal == null) return warn('Calories are needed');
    const sg = Number($('#cf-sg', sh).value) || null;
    if (f.per === 'serving' && !sg) return warn('How many grams in a serving?');
    const food = { id: `my:${S.uid()}`, name, brand: $('#cf-brand', sh).value.trim(), source: f.source, barcode: f.barcode || undefined, serving: f.per === '100' ? { label: '100 g', g: 100 } : { label: `1 serving (${sg} g)`, g: sg }, n, usualG: pre.usualG || (f.per === 'serving' ? sg : null) };
    const h = state.health;
    if (food.barcode) h.foods = h.foods.filter((x) => x.barcode !== food.barcode);
    h.foods.push(food); S.save(state);
    closeSheet(); toast(`${name} saved to your foods`);
    onSaved?.(food);
  });
}

async function runOCR(file) {
  const sh = openSheet('Reading the label…', `<p class="lead" style="margin-top:0" id="ocr-msg">Getting the reader ready. The first time takes a little longer.</p><div class="meter"><i id="ocr-bar" style="width:4%"></i></div>`);
  try {
    const text = await SC.readLabel(file, (p) => { const b = $('#ocr-bar', sh); if (b) { b.style.width = `${Math.max(4, p * 100)}%`; $('#ocr-msg', sh).textContent = 'Reading the numbers…'; } });
    if (sheetStack.at(-1)?.sh === sh) closeSheet();
    const res = N.parseLabel(text);
    if (!res.found) { warn('Couldn’t read the numbers. Try a sharper, straight-on photo of the table.'); return null; }
    return res;
  } catch (e) { if (sheetStack.at(-1)?.sh === sh) closeSheet(); warn(e.message || 'Couldn’t read the label'); return null; }
}

async function labelFlow(day, { mode = 'log', onPick } = {}) {
  const file = await SC.pickPhoto(); if (!file) return;
  const res = await runOCR(file); if (!res) return;
  createFoodSheet({ n: res.n, per: res.per100 || !res.servingG ? '100' : 'serving', servingG: res.servingG, source: 'label', fromLabel: true }, {
    note: `Read ${res.found} of 7 values from the photo. Check each one against the label, fix any misreads, and name it.`,
    onSaved: (food) => amountSheet(food, { day, mode, onPick }),
  });
}

// ---------------------------------------------------------------- barcode
function scanSheet(day) {
  let stop = null;
  const sh = openSheet('Scan a barcode', `
    <div class="scan-box"><video id="sc-v" playsinline muted autoplay></video><i class="aim"></i></div>
    <p class="faint" id="sc-msg" style="text-align:center;font-size:13.5px;margin:10px 0 0">Starting the camera…</p>
    <div class="h-btns"><button class="btn ghost" data-sc-photo>${I.camera} Photo of barcode</button></div>
    <div class="field"><label class="eyebrow" for="sc-num">Or type the number</label><div class="opts"><input class="input num" id="sc-num" inputmode="numeric" placeholder="8901058000290" style="flex:1"><button class="btn accent" data-sc-go style="flex:0 0 auto;width:auto;padding:12px 18px">Look up</button></div></div>
    <p class="faint" style="font-size:12px;margin:14px 2px 0">Looks the barcode up in Open Food Facts, a free public food database. Only the barcode number is sent.</p>`);
  const msg = (t) => { const m = $('#sc-msg', sh); if (m) m.textContent = t; };
  sheetStack.at(-1).onClose = () => stop?.();
  const found = async (code) => {
    stop?.(); stop = null; X.play('success'); msg(`Found ${code}. Looking it up…`);
    const mine = myFoods().find((f) => f.barcode === code);
    if (mine) { closeSheet(); return amountSheet(mine, { day }); }
    try {
      const prod = await SC.lookupBarcode(code);
      const food = N.offToFood(code, prod);
      closeSheet();
      if (food) {
        food.id = `my:${S.uid()}`; state.health.foods.push(food); S.save(state);
        toast(`${food.name}${food.brand ? ` · ${food.brand}` : ''}`);
        return amountSheet(food, { day });
      }
      createFoodSheet({ name: prod?.product_name || '', brand: (prod?.brands || '').split(',')[0], barcode: code, source: 'scanned' }, { note: prod ? 'This product is listed but has no nutrition numbers. Read the label to fill them in.' : 'This barcode isn’t in the database yet. Read the label once and it’s saved for next time.', onSaved: (f) => amountSheet(f, { day }) });
    } catch (e) { msg(e.message || 'Lookup failed. Check your connection.'); }
  };
  SC.startBarcode($('#sc-v', sh), found).then((s) => { stop = s; if (!sheetStack.some((r) => r.sh === sh)) s(); else msg('Point the camera at the barcode'); })
    .catch((e) => msg(e.name === 'NotAllowedError' ? 'Camera access is off. Allow it in Settings → Safari → Camera, or type the number.' : (e.message || 'The camera isn’t available here. Take a photo or type the number.')));
  sh.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-sc-photo]')) {
      const file = await SC.pickPhoto(); if (!file) return;
      msg('Reading the photo…');
      const code = await SC.barcodeFromPhoto(file);
      if (code) found(code); else msg('No barcode found in that photo. Get closer, with the lines sharp.');
    }
    if (ev.target.closest('[data-sc-go]')) {
      const code = $('#sc-num', sh).value.replace(/\D/g, '');
      if (code.length < 8) return warn('Barcodes have 8 to 14 digits');
      found(code);
    }
  });
}

// ---------------------------------------------------------------- meals you make
function recipesSheet(day) {
  const rs_ = state.health.recipes;
  const sh = openSheet('Your meals', `
    ${rs_.length ? `<div class="list">${rs_.map((r) => { const f = recipeFood(r); return `<div class="row" style="cursor:default"><div class="ic">🥘</div><div class="mid"><div class="t">${esc(r.name)}</div><div class="s">${kcal(f.n.kcal)} a serving · ${r.items.length} items${r.servings > 1 ? ` · makes ${r.servings}` : ''}</div></div><button class="btn sm ghost" data-rc-edit="${r.id}">Edit</button><button class="btn sm accent" data-rc-log="${r.id}">Log</button></div>`; }).join('')}</div>`
      : '<p class="lead" style="margin-top:0">Build a dish once from its ingredients, like fried rice with rice, oil, egg and veg, and log it in one tap after that.</p>'}
    <div class="btn-row"><button class="btn accent" data-rc-new>+ New meal</button></div>`);
  sh.addEventListener('click', (ev) => {
    const l = ev.target.closest('[data-rc-log]'), e = ev.target.closest('[data-rc-edit]');
    if (l) { const r = rs_.find((x) => x.id === l.dataset.rcLog); amountSheet(recipeFood(r), { day }); }
    if (e) { closeSheet(); recipeSheet(rs_.find((x) => x.id === e.dataset.rcEdit)); }
    if (ev.target.closest('[data-rc-new]')) { closeSheet(); recipeSheet(); }
  });
}

function recipeSheet(existing) {
  const r = existing ? JSON.parse(JSON.stringify(existing)) : { id: S.uid(), name: '', servings: 1, items: [] };
  const body = () => {
    const t = N.totals(r.items); const k = Math.max(1, Number(r.servings) || 1);
    return `<div class="field" style="margin-top:0"><label class="eyebrow" for="rc-name">Name</label><input class="input" id="rc-name" value="${esc(r.name)}" placeholder="Fried rice, protein shake…"></div>
      <div class="field"><label class="eyebrow" for="rc-k">Makes</label><div class="amount-box"><input id="rc-k" class="num" inputmode="numeric" value="${r.servings}" style="font-size:20px"><span class="faint" style="font-size:14px;padding-right:6px">serving${k === 1 ? '' : 's'}</span></div></div>
      <div class="section-head"><h2>Ingredients</h2><button class="link" data-rc-add>+ Add</button></div>
      ${r.items.length ? `<div class="list">${r.items.map((it, i) => `<div class="row" style="cursor:default"><div class="mid"><div class="t">${esc(it.name)}</div><div class="s">${esc(it.amount || '')}</div></div><div class="amt">${kcal(it.kcal)}</div><button class="btn sm danger" data-rc-rm="${i}" aria-label="Remove">${I.trash}</button></div>`).join('')}</div>` : '<p class="faint" style="font-size:13.5px;margin:0 4px">Add each ingredient with how much went in.</p>'}
      ${r.items.length ? `<div class="card" style="margin-top:12px"><div class="kc-row"><div><div class="eyebrow">Per serving</div><div class="h-big num">${nf0.format(Math.round(t.kcal / k))}<small>kcal</small></div></div><div class="eaten"><span class="eyebrow">Whole dish</span><b class="num">${nf0.format(t.kcal)}</b></div></div><p class="faint" style="font-size:13px;margin:8px 0 0">P ${g1(t.p / k)} g · C ${g1(t.c / k)} g · F ${g1(t.f / k)} g a serving</p></div>` : ''}
      <div class="btn-row">${existing ? `<button class="btn danger" data-rc-del style="flex:0 0 auto;width:auto;padding:16px 20px" aria-label="Delete">${I.trash}</button>` : ''}<button class="btn accent" data-rc-save>Save meal</button></div>`;
  };
  const sh = openSheet(existing ? 'Edit meal' : 'New meal', body());
  const el = $('.sheet-body', sh);
  const pull = () => { r.name = $('#rc-name', sh).value.trim(); r.servings = Math.max(1, Math.round(Number($('#rc-k', sh).value) || 1)); };
  sh.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-rc-add]')) { pull(); pickFood({ mode: 'build', onPick: (item) => { r.items.push(item); el.innerHTML = body(); } }); return; }
    const rm = ev.target.closest('[data-rc-rm]'); if (rm) { pull(); r.items.splice(Number(rm.dataset.rcRm), 1); el.innerHTML = body(); return; }
    if (ev.target.closest('[data-rc-del]')) { if (await ask('Delete this meal?', 'Days you already logged it keep their calories.', 'Delete', true)) { state.health.recipes = state.health.recipes.filter((x) => x.id !== r.id); S.save(state); closeSheet(); toast('Meal deleted'); render(); } return; }
    if (!ev.target.closest('[data-rc-save]')) return;
    pull();
    if (!r.name) return warn('Name the meal');
    if (!r.items.length) return warn('Add at least one ingredient');
    const list = state.health.recipes; const i = list.findIndex((x) => x.id === r.id);
    if (i >= 0) list[i] = r; else list.push(r);
    S.save(state); closeSheet(); toast(`${r.name} saved`); render();
  });
}

function breakdownSheet(d) {
  const meals = state.health.days[d]?.meals || []; const t = N.totals(meals); const tg = TG();
  const goal = { kcal: state.health.calorieGoal, p: tg?.protein, c: tg?.carbs, f: tg?.fat, fib: tg?.fibre, sug: tg?.sugarMax, na: tg?.sodiumMax };
  const missing = meals.filter((m) => m.p == null).length;
  openSheet(`Breakdown · ${fmtDay(d)}`, `
    <div class="card" style="padding:4px 18px">${N.NUTRIENTS.map(([k, l, u]) => { const cap = k === 'sug' || k === 'na'; const over = goal[k] && t[k] > goal[k]; return `<div class="line-item"><div class="grow"><div class="t">${l}</div><div class="track" style="margin-top:8px"><i style="width:${goal[k] ? Math.min(100, (t[k] / goal[k]) * 100) : 0}%;${over && cap ? 'background:var(--accent)' : ''}"></i></div></div><div class="num" style="font-weight:650;text-align:right;min-width:96px">${g1(t[k])} <span class="faint" style="font-weight:500">/ ${goal[k] ?? '—'}${cap ? ' max' : ''} ${u}</span></div></div>`; }).join('')}</div>
    ${missing ? `<p class="faint" style="font-size:12.5px;margin:10px 2px 0">${missing} item${missing === 1 ? ' was' : 's were'} added with calories only, so macros are a little under.</p>` : ''}
    <div class="btn-row"><button class="btn accent" data-act="close-sheet">Done</button></div>`);
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act^="h-"]');
  if (!el) return;
  const d = el.dataset.d || healthDay();
  switch (el.dataset.act) {
    case 'h-body': profileSheet(); break;
    case 'h-scan': scanSheet(d); break;
    case 'h-label': labelFlow(d); break;
    case 'h-recipes': recipesSheet(d); break;
    case 'h-breakdown': breakdownSheet(d); break;
    case 'h-water': {
      const w = state.health.water; const list = (w[d] ||= []);
      if (el.dataset.ml === 'undo') list.pop(); else list.push(Number(el.dataset.ml));
      S.save(state); render(); break;
    }
    case 'h-weigh': {
      const kg = Number(($('#h-wkg')?.value || '').replace(',', '.'));
      if (!(kg >= 25 && kg <= 300)) { warn('Enter your weight in kg'); break; }
      const h = state.health; const t = today(); const ex = h.weights.find((x) => x.date === t);
      if (ex) ex.kg = kg; else h.weights.push({ date: t, kg });
      if (h.profile) { h.profile.weightKg = kg; const tg = TG(); if (h.autoGoal !== false && tg) { h.calorieGoal = tg.target; if (h.days[t]) delete h.days[t].rules; } }
      healthCommit(`${kg} kg logged${h.profile ? ` · target ${kcal(h.calorieGoal)}` : ''}`);
      break;
    }
  }
});

// ================================================================ PIN
function pinPad(id) {
  return `<div class="pin-dots" id="${id}-dots">${'<i></i>'.repeat(4)}</div>
    <div class="pad" id="${id}-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-n="${n}">${n}</button>`).join('')}<button class="ghost" data-n="cancel"></button><button data-n="0">0</button><button class="ghost" data-n="del" aria-label="Delete">⌫</button></div>`;
}
function wirePad(root, id, onComplete, { cancelLabel } = {}) {
  let pin = '';
  const dots = $(`#${id}-dots`, root);
  const cancel = $(`#${id}-pad [data-n="cancel"]`, root);
  if (cancelLabel) cancel.textContent = cancelLabel;
  const draw = () => $$('i', dots).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const press = (n) => {
    if (n === 'del') pin = pin.slice(0, -1);
    else if (n === 'cancel') return cancelLabel && onComplete(null);
    else if (pin.length < 4) pin += n;
    draw();
    if (pin.length === 4) setTimeout(async () => { const ok = await onComplete(pin); if (ok === false) { dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400); } pin = ''; draw(); }, 120);
  };
  $(`#${id}-pad`, root).addEventListener('click', (e) => { const n = e.target.closest('[data-n]')?.dataset.n; if (n) press(n); });
  return press;
}
let lockKeyHandler;
function renderLock() {
  let el = $('.lock#lock');
  if (!ui.locked || !state.settings.pinHash) { el?.remove(); if (lockKeyHandler) { removeEventListener('keydown', lockKeyHandler); lockKeyHandler = null; } return; }
  if (el) return;
  el = document.createElement('div'); el.className = 'lock'; el.id = 'lock';
  el.innerHTML = `<div class="logo"><img src="icons/icon-192.png" alt="Ledger"></div><h2>Ledger</h2><div class="sub">Enter passcode</div>${pinPad('lk')}`;
  document.body.append(el);
  let tries = 0;
  const press = wirePad(el, 'lk', async (pin) => {
    if ((await S.hashPin(pin)) === state.settings.pinHash) { ui.locked = false; X.play('unlock'); el.id = ''; el.classList.add('out'); setTimeout(() => el.remove(), 430); removeEventListener('keydown', lockKeyHandler); lockKeyHandler = null; return true; }
    X.play('error');
    tries++; if (tries >= 3) $('.sub', el).textContent = 'Wrong passcode. Forgot it? Clear this site’s data, then restore a backup.'; else $('.sub', el).textContent = 'Wrong passcode, try again';
    return false;
  });
  lockKeyHandler = (e) => { if (/^[0-9]$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
  addEventListener('keydown', lockKeyHandler);
}
function setPinFlow(done) {
  const sh = openSheet('Set a passcode', `<div style="display:flex;flex-direction:column;align-items:center"><p class="lead" id="pin-msg">Choose 4 digits</p>${pinPad('sp')}</div>`);
  let first = null;
  wirePad(sh, 'sp', async (pin) => {
    if (!pin) { closeSheet(); return; }
    if (!first) { first = pin; $('#pin-msg', sh).textContent = 'Enter it again'; return true; }
    if (pin !== first) { X.play('error'); first = null; $('#pin-msg', sh).textContent = "Didn't match — choose 4 digits"; return false; }
    state.settings.pinHash = await S.hashPin(pin); S.save(state); closeSheet(); toast('Passcode on. Tap the lock at the top to lock Ledger any time.'); done?.(); return true;
  }, { cancelLabel: 'Cancel' });
}

// ================================================================ events
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const inSheet = !!el.closest('.sheet');
  switch (act) {
    case 'tab': closeAllSheets(); if (el.dataset.tab === 'health') ui.hday = null; ui.tab = el.dataset.tab; history.replaceState(null, '', '#' + ui.tab); render(); window.scrollTo({ top: 0 }); break;
    case 'goto-ledger': ui.tab = 'ledger'; ui.period = 'month'; ui.filter = el.dataset.filter; history.replaceState(null, '', '#ledger'); render(); window.scrollTo({ top: 0 }); break;
    case 'period': ui.period = el.dataset.v; render(); break;
    case 'filter': ui.filter = el.dataset.v; render(); break;
    case 'new-entry': if (ui.tab === 'health' && state.health.enabled) pickFood({ day: healthDay() }); else entrySheet(null); break;
    case 'open-entry': { const e = byId(state.entries, el.dataset.id); if (e?.health) { closeAllSheets(); openHealthDay(e.health.day); } else if (e) { if (inSheet) closeAllSheets(); entrySheet(e); } break; }
    case 'calc': openCalc(); break;
    case 'search': openSearch(); break;
    case 'lock-now':
      if (state.settings.pinHash) { closeAllSheets(); ui.locked = true; renderLock(); X.play('off'); }
      else setPinFlow(() => render());
      break;
    case 'check-update': {
      toast('Checking for updates…');
      try {
        const res = await fetch(`./sw.js?check=${Date.now()}`, { cache: 'no-store' });
        const live = (await res.text()).match(/VERSION = 'ledger-([^']+)'/)?.[1];
        if (live && live === S.VERSION) { toast(`You're on the latest version (${S.VERSION})`); X.play('success'); break; }
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update();
        // throw away the old offline copy so the reload can only get the new files
        for (const k of await caches.keys()) await caches.delete(k);
        toast(`Updating to ${live || 'the latest version'}…`);
        setTimeout(() => location.reload(), 600);
      } catch { warn('Couldn’t reach the internet. Try again when you’re online.'); }
      break;
    }
    case 'dismiss-passcode': try { localStorage.setItem('ledger.passcodeHint', '1'); } catch { /* ignore */ } render(); break;
    case 'toggle-hide': state.settings.hideAmounts = !state.settings.hideAmounts; commit(); break;
    case 'toggle-theme': {
      const flip = () => { state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light'; commit(); };
      if (document.startViewTransition) { const vt = document.startViewTransition(flip); vt.ready?.catch(() => {}); vt.finished?.catch(() => {}); } else flip();
      break;
    }
    case 'dismiss-install': try { localStorage.setItem(hintKey, '1'); } catch { /* ignore */ } render(); break;
    case 'toggle-sound': state.settings.sound = state.settings.sound === false; S.save(state); render(); X.play('success'); break;
    case 'close-sheet': if (!el.closest('.sheet-body') || el.classList.contains('btn')) closeSheet(); break;
    case 'safe-help': {
      const sf = C.safeToSpend(state);
      openSheet('Safe to spend', `<p class="lead">${sf.usedBudget ? `Your monthly budget, minus what you've already spent this month, split evenly over the ${sf.daysLeft} days left (today included).` : `Your balance at the start of today, split evenly over the ${sf.daysLeft} days left in the month (today included).`}</p>
        <p class="lead">Spend less today and tomorrow's number goes up. ${sf.usedBudget ? '' : 'Set a monthly budget in Settings → Money & bills to plan around a fixed amount instead.'}</p>
        <div class="btn-row"><button class="btn ghost" data-act="settings-page" data-page="money">Set a budget</button><button class="btn accent" data-act="close-sheet">Got it</button></div>`);
      break;
    }
    case 'transfer': transferSheet(); break;
    case 'new-account': await addTag('accounts'); break;
    case 'open-account': accountSheet(el.dataset.id); break;
    case 'rename-account': await renameTag('accounts', el.dataset.id); closeSheet(); accountSheet(el.dataset.id); break;
    case 'delete-account': { const before = state.accounts.length; await removeTag('accounts', el.dataset.id); if (state.accounts.length < before) closeAllSheets(); break; }
    case 'new-person': await addTag('people'); break;
    case 'settle': {
      const p = byId(state.people, el.dataset.id);
      const ps = C.peopleSummary(state).find((x) => x.id === p.id);
      const v = await prompt1(`${p.name} paid you back`, 'Amount received', String(ps.owes / 100), { inputmode: 'decimal', ok: 'Log it' });
      const amt = v && C.toPaise(v.replace(/,/g, ''));
      if (amt > 0) { state.entries.push({ id: S.uid(), createdAt: Date.now(), type: 'received', settles: true, personId: p.id, amount: amt, method: 'upi', date: today(), time: nowTime(), accountId: state.accounts[0].id, note: `${p.name} paid back` }); commit(`${rs(amt)} from ${p.name} logged`, 'income'); }
      break;
    }
    case 'pay-person': { const p = byId(state.people, el.dataset.id); payFlow({ vpa: p.vpa, name: p.name, personId: p.id }); break; }
    case 'pay-new': {
      const raw = $('#pay-vpa').value;
      const parsed = C.parseUpi(raw);
      if (!parsed) { warn('Enter a UPI ID like name@okaxis'); $('#pay-vpa').focus(); break; }
      const known = state.people.find((p) => p.vpa && p.vpa.toLowerCase() === parsed.vpa.toLowerCase());
      payFlow({ ...parsed, name: parsed.name || known?.name || '', personId: known?.id });
      break;
    }
    case 'settings-page': closeAllSheets(); settingsPage(el.dataset.page); break;
    case 'rewind': closeAllSheets(); openRewind(); break;
    case 'onboard': {
      state.settings.openingCash = C.toPaise(($('#w-cash').value || '').replace(/[₹,]/g, ''));
      state.settings.openingBank = C.toPaise(($('#w-bank').value || '').replace(/[₹,]/g, ''));
      state.settings.onboarded = true; commit('Your ledger is ready'); window.scrollTo(0, 0);
      break;
    }
    case 'demo': state = S.demoState(); commit('Demo data loaded'); window.scrollTo(0, 0); break;
  }
});
// small taps for pickers, keys and tabs (bigger moments play their own sound)
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('.key, .pad button, .tab, .chip, .opt, .seg button, .cat, .check, [data-switch], .icon-btn');
  if (!t) return;
  X.play(t.matches('.key, .pad button') ? 'key' : t.matches('.tab') ? 'tab' : t.matches('.check, [data-switch]') ? (t.querySelector('.on, .switch.on') || t.classList.contains('on') ? 'off' : 'on') : 'tick');
}, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetStack.length) closeSheet(); });
addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t) && t !== ui.tab) { closeAllSheets(); ui.tab = t; render(); window.scrollTo(0, 0); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ui.hiddenAt = Date.now(); return; }
  if (state.settings.pinHash && ui.hiddenAt && Date.now() - ui.hiddenAt >= (state.settings.lockAfter ?? 60) * 1000) { ui.locked = true; renderLock(); }
  checkPendingPay();
  settleHealth();
});

// ================================================================ recurring bills
function postRecurring() {
  const due = C.dueRecurring(state);
  for (const d of due) {
    const r = byId(state.recurring, d.recurringId);
    state.entries.push({ id: S.uid(), createdAt: Date.now(), type: 'spent', amount: r.amount, method: r.method, accountId: r.accountId, categoryId: r.categoryId, note: r.name, date: d.date, time: '09:00', recurringId: r.id });
    r.lastPosted = d.month;
  }
  if (due.length) { S.save(state); setTimeout(() => toast(`${due.length} recurring bill${due.length === 1 ? '' : 's'} added`), 600); }
}

// ================================================================ hide amounts
// With "hide amounts" on, every run of digits on screen is wrapped so it can be blurred: balances,
// counts, dates, times, totals in sentences, sheets, search results and toasts alike.
// Digits you're typing into a field and the keys of the passcode pad / calculator stay readable.
const DIGITS = /[₹+−-]?\d[\d,.:]*%?/g;
const SKIP = '.dg, .pad, .keys, .key, input, textarea, select, script, style, svg, .money, [data-act=period]';
function maskDigits(root) {
  if (!state.settings.hideAmounts || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\d/.test(n.nodeValue) && !n.parentElement?.closest(SKIP)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const frag = document.createDocumentFragment(); let last = 0; const t = n.nodeValue;
    t.replace(DIGITS, (m, i) => {
      if (i > last) frag.append(t.slice(last, i));
      const sp = document.createElement('span'); sp.className = 'dg'; sp.textContent = m; frag.append(sp);
      last = i + m.length; return m;
    });
    if (last < t.length) frag.append(t.slice(last));
    n.replaceWith(frag);
  }
}
new MutationObserver((muts) => {
  if (!state.settings.hideAmounts) return;
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType === 1 && !n.closest(SKIP)) maskDigits(n);
    else if (n.nodeType === 3 && n.parentElement && !n.parentElement.closest(SKIP)) maskDigits(n.parentElement);
  }
}).observe(document.body, { childList: true, subtree: true });

// ================================================================ keyboard
// When the iPhone keyboard opens, the visible area shrinks but fixed elements stay put behind it.
// Track the visible area so sheets sit just above the keyboard instead of jumping under it.
if (window.visualViewport) {
  const vv = window.visualViewport, root = document.documentElement.style;
  const fit = () => {
    root.setProperty('--kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`);
    root.setProperty('--vvh', `${Math.round(vv.height)}px`);
  };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
}

// ================================================================ boot
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
postRecurring();
importStepsFromLink();
settleHealth({ quietRender: true });
render();
checkPendingPay();
scheduleMidnight();
// ================================================================ updates
// A home-screen app on iPhone usually resumes from memory instead of reloading, so it would
// never notice a new version. Check whenever it comes to the front, and reload into the new
// version as soon as it's installed (but never while you're halfway through filling in a sheet).
let reloadWhenFree = false;
function applyUpdate() { if (sheetStack.length) reloadWhenFree = true; else location.reload(); }
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) applyUpdate(); });
}
// Say so once after an update, so it's clear which version is running.
try {
  const seen = localStorage.getItem('ledger.version');
  if (seen && seen !== S.VERSION) setTimeout(() => toast(`Updated to version ${S.VERSION}`), 700);
  localStorage.setItem('ledger.version', S.VERSION);
} catch { /* ignore */ }
window.__ledger = { get state() { return state; }, C, S, X };
