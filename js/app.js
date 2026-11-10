import * as C from './calc.js';
import * as S from './store.js';
import { I } from './icons.js';

// ================================================================ state
let state = S.load();
const ui = {
  tab: (location.hash.slice(1) || 'home'),
  period: 'month',
  filter: 'all',
  locked: !!state.settings.pinHash,
  hiddenAt: 0,
};
const TABS = ['home', 'ledger', 'accounts', 'pay', 'settings'];
if (!TABS.includes(ui.tab)) ui.tab = 'home';

function commit(msg) {
  S.save(state);
  S.autoSnapshot(state);
  render();
  if (msg) toast(msg);
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
    e.expectBack ? '<span class="tag warn">owed</span>' : '', e.recurringId ? '<span class="tag">auto</span>' : ''].join('');
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
      <button class="icon-btn" data-act="toggle-theme" aria-label="Switch theme">${I.theme}</button>
    </div></header>`;
}
function tabbar() {
  const t = (id, label) => `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}" aria-label="${label}">${I[id]}<span>${label}</span></button>`;
  return `<nav class="tabbar">${t('home', 'Home')}${t('ledger', 'Ledger')}${t('accounts', 'Accounts')}${t('pay', 'Pay')}${t('settings', 'Settings')}</nav>
    <button class="fab" data-act="new-entry" aria-label="New entry">${I.plus}</button>
    <button class="calc-fab" data-act="calc" aria-label="Calculator">=</button>`;
}

function render() {
  const s = state.settings;
  document.documentElement.dataset.theme = s.theme;
  document.body.classList.toggle('privacy', !!s.hideAmounts);
  $('meta[name="theme-color"]')?.setAttribute('content', s.theme === 'light' ? '#f3f2ee' : '#08090a');
  const app = $('#app');
  if (!s.onboarded) { app.innerHTML = welcomeView(); $('#chrome').innerHTML = ''; return; }
  const views = { home: homeView, ledger: ledgerView, accounts: accountsView, pay: payView, settings: settingsView };
  const scroll = window.scrollY;
  const same = app.dataset.tab === ui.tab;
  app.innerHTML = topbar() + `<main class="view" ${same ? 'style="animation:none"' : ''}>${views[ui.tab]()}</main>`;
  app.dataset.tab = ui.tab;
  $('#chrome').innerHTML = tabbar();
  if (same) window.scrollTo(0, scroll);
  renderLock();
}

// ================================================================ views
function welcomeView() {
  return `<div class="welcome view">
    <div class="lock" style="position:static;padding:0;background:none;align-items:flex-start"><div class="logo">${I.wallet}</div></div>
    <h1>Every rupee,<br>accounted for.</h1>
    <p>A private ledger for cash, UPI and cards. It lives on this device only — no account, no cloud.</p>
    <div class="feature-list">
      <div><span>${I.rupee}</span>Know what's safe to spend today</div>
      <div><span>${I.accounts}</span>Split money into accounts like Savings or Trip</div>
      <div><span>${I.pay}</span>Pay by UPI and log it in one go</div>
      <div><span>${I.lock}</span>PIN lock and hide amounts</div>
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
  <section class="card hero">
    <div class="eyebrow">Total balance</div>
    <div class="total num money">${b.total < 0 ? '−' : ''}<span class="cur">₹</span>${nf0.format(Math.abs(Math.round(b.total / 100)))}</div>
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
    ${item('privacy', 'lock', 'Privacy & lock', 'PIN, hide amounts, hidden entries')}
    ${item('export', 'download', 'Export & backup', 'Excel, backup file, restore')}
    ${item('device', 'device', 'This device', 'Snapshots, demo data, erase, version')}
    <p class="foot-note">Everything lives on this device only — no cloud, no account. Keep a backup now and then.</p>`;
}

// ================================================================ sheets
let sheetStack = [];
function openSheet(title, body, { onMount, wide } = {}) {
  const bd = document.createElement('div'); bd.className = 'backdrop';
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
  sh.innerHTML = `<div class="grab"></div><div class="sheet-head"><h3>${esc(title)}</h3><button class="x" data-act="close-sheet" aria-label="Close">${I.x}</button></div><div class="sheet-body">${body}</div>`;
  document.body.append(bd, sh);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
  bd.addEventListener('click', () => closeSheet());
  const rec = { bd, sh };
  sheetStack.push(rec);
  onMount?.(sh);
  return sh;
}
function closeSheet() {
  const rec = sheetStack.pop();
  if (!rec) return;
  rec.onClose?.();
  rec.bd.classList.remove('show'); rec.sh.classList.remove('show');
  setTimeout(() => { rec.bd.remove(); rec.sh.remove(); }, 320);
  if (!sheetStack.length) document.body.style.overflow = '';
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
    const inp = $('#p1', sh); setTimeout(() => inp.focus(), 300);
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
  if (!existing) setTimeout(() => $('#f-amt', sh)?.focus(), 350);

  sh.addEventListener('click', async (ev) => {
    const pick = ev.target.closest('[data-pick]');
    if (pick) {
      const k = pick.dataset.pick, v = pick.dataset.v || null;
      e[k] = (k !== 'type' && k !== 'method' && k !== 'accountId' && e[k] === v) ? null : v;
      if (k === 'type' && v !== 'forSomeone') { e.expectBack = false; }
      return redraw();
    }
    const tg = ev.target.closest('[data-toggle]');
    if (tg) { e[tg.dataset.toggle] = !e[tg.dataset.toggle]; return redraw(); }
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
      if (!(e.amount > 0)) { $('.amount-box', sh).style.borderColor = 'var(--accent)'; $('#f-amt', sh).focus(); return toast('Enter an amount'); }
      if (e.type === 'forSomeone' && !e.personId) return toast('Pick who it was for');
      if (e.type === 'received') { e.offBalance = false; e.categoryId = null; }
      if (e.type !== 'forSomeone') e.expectBack = false;
      if (existing) Object.assign(byId(state.entries, existing.id), e);
      else state.entries.push({ ...e, id: S.uid(), createdAt: Date.now() });
      closeSheet();
      commit(existing ? 'Saved' : `${e.type === 'received' ? 'Received' : 'Spent'} ${rs(e.amount)} logged`);
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
      if (!(t.amount > 0)) return toast('Enter an amount');
      if (t.kind === 'account' && t.accountId === t.toAccountId) return toast('Pick two different accounts');
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
      let v; try { v = C.evaluate(expr); } catch { return toast('Check the sum'); }
      if (!(v > 0)) return toast('Result must be more than ₹0');
      closeSheet();
      if (onUse) onUse(v); else entrySheet(null, { amount: C.toPaise(v) });
      return;
    }
    if (!k) return;
    if (k === 'C') expr = '';
    else if (k === '⌫') expr = expr.slice(0, -1);
    else if (k === '=') { try { expr = String(C.evaluate(expr)); } catch { toast('Check the sum'); } }
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
  setTimeout(() => inp.focus(), 300);
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
    <div class="btn-row"><button class="btn ghost" data-log>Just log it</button><button class="btn accent" data-upi>Open UPI app</button></div>
    <p class="faint" style="font-size:12.5px;text-align:center;margin-top:14px">Your UPI app does the paying. Ledger never sees your PIN or bank details.</p>`);
  setTimeout(() => $('#pay-amt', sh).focus(), 300);
  const build = () => ({ id: S.uid(), createdAt: Date.now(), type: 'spent', method: 'upi', date: today(), time: nowTime(),
    amount: C.toPaise(($('#pay-amt', sh).value || '').replace(/,/g, '')), note: $('#pay-note', sh).value.trim() || target.name || target.vpa,
    personId: target.personId || null, categoryId: p.categoryId, accountId: p.accountId });
  sh.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-cat]');
    if (c) { p.categoryId = p.categoryId === c.dataset.cat ? null : c.dataset.cat; $$('[data-cat]', sh).forEach((b) => b.classList.toggle('on', b.dataset.cat === p.categoryId)); return; }
    const a = ev.target.closest('[data-acc]');
    if (a) { p.accountId = a.dataset.acc; $$('[data-acc]', sh).forEach((b) => b.classList.toggle('on', b === a)); return; }
    const isUpi = ev.target.closest('[data-upi]'), isLog = ev.target.closest('[data-log]');
    if (!isUpi && !isLog) return;
    const entry = build();
    if (!(entry.amount > 0)) return toast('Enter an amount');
    closeSheet();
    if (isLog) { state.entries.push(entry); return commit(`Paid ${rs(entry.amount)} logged`); }
    try { sessionStorage.setItem('ledger.pendingPay', JSON.stringify(entry)); } catch { /* ignore */ }
    location.href = C.upiLink({ vpa: target.vpa, name: target.name, amount: entry.amount, note: entry.note });
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
      <div class="line-item"><div class="grow"><div class="t">PIN lock</div><div class="s">${s.pinHash ? 'On — asked when you open Ledger' : 'Off'}</div></div>${s.pinHash ? `<button class="btn sm ghost" data-pin="change">Change</button><button class="btn sm danger" data-pin="off">Turn off</button>` : `<button class="btn sm accent" data-pin="set">Set PIN</button>`}</div>
      ${s.pinHash ? `<div class="line-item"><div class="grow"><div class="t">Lock again after</div><div class="s">Time away from the app</div></div><select class="input" data-lock-after style="width:auto;padding:8px 10px;font-size:14px">${[[0, 'Immediately'], [60, '1 minute'], [300, '5 minutes'], [1800, '30 minutes']].map(([v, l]) => `<option value="${v}" ${Number(s.lockAfter) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      ${sw('hideAmounts', 'Hide amounts', 'Blur balances until you tap the eye')}
      ${sw('showHidden', 'Show hidden entries', `${state.entries.filter((e) => e.hidden).length} hidden — they always count in totals`)}
    </div>`;
    mount = (sh) => {
      sh.addEventListener('click', async (ev) => {
        const k = ev.target.closest('[data-switch]')?.dataset.switch;
        if (k) { s[k] = !s[k]; S.save(state); render(); closeSheet(); return settingsPage('privacy'); }
        const p = ev.target.closest('[data-pin]')?.dataset.pin;
        if (p === 'off') { if (await ask('Turn off PIN?', 'Anyone with this device could open your ledger.', 'Turn off', true)) { s.pinHash = null; S.save(state); closeSheet(); settingsPage('privacy'); toast('PIN removed'); } }
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
      <div class="btn-row" style="flex-direction:column"><button class="btn ghost" data-demo>Load demo data</button><button class="btn danger" data-erase>Erase everything</button></div>
      <p class="foot-note">Ledger ${S.VERSION} · ${(used / 1024).toFixed(1)} KB stored · ${state.entries.length} entries</p>`;
    mount = (sh) => sh.addEventListener('click', async (ev) => {
      const sn = ev.target.closest('[data-snap]')?.dataset.snap;
      if (sn != null) { const snap = S.listSnapshots()[Number(sn)]; if (await ask('Restore snapshot?', `Go back to ${esc(fmtDay(snap.date))} (${snap.count} entries)? What you have now is replaced.`, 'Restore', true)) { state = S.parseBackup(JSON.stringify(snap.data)); closeAllSheets(); commit('Snapshot restored'); } }
      if (ev.target.closest('[data-demo]')) { if (await ask('Load demo data?', 'This replaces everything on this device with sample entries. Back up first if you need your data.', 'Load demo', true)) { state = S.demoState(); closeAllSheets(); ui.tab = 'home'; commit('Demo data loaded'); } }
      if (ev.target.closest('[data-erase]')) { if (await ask('Erase everything?', 'All entries, accounts, snapshots and your PIN are deleted from this device. This can’t be undone.', 'Erase', true)) { S.clearAll(); state = S.defaultState(); ui.locked = false; closeAllSheets(); render(); toast('Erased'); } }
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
      if (!b.name || !(b.amount > 0)) return toast('Add a name and an amount');
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
  el.innerHTML = `<div class="logo">${I.lock}</div><h2>Ledger</h2><div class="sub">Enter your PIN</div>${pinPad('lk')}`;
  document.body.append(el);
  let tries = 0;
  const press = wirePad(el, 'lk', async (pin) => {
    if ((await S.hashPin(pin)) === state.settings.pinHash) { ui.locked = false; el.remove(); removeEventListener('keydown', lockKeyHandler); lockKeyHandler = null; return true; }
    tries++; if (tries >= 3) $('.sub', el).textContent = 'Wrong PIN. Forgot it? Clear this site’s data, then restore a backup.'; else $('.sub', el).textContent = 'Wrong PIN, try again';
    return false;
  });
  lockKeyHandler = (e) => { if (/^[0-9]$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
  addEventListener('keydown', lockKeyHandler);
}
function setPinFlow(done) {
  const sh = openSheet('Set a PIN', `<div style="display:flex;flex-direction:column;align-items:center"><p class="lead" id="pin-msg">Choose 4 digits</p>${pinPad('sp')}</div>`);
  let first = null;
  wirePad(sh, 'sp', async (pin) => {
    if (!pin) { closeSheet(); return; }
    if (!first) { first = pin; $('#pin-msg', sh).textContent = 'Enter it again'; return true; }
    if (pin !== first) { first = null; $('#pin-msg', sh).textContent = "Didn't match — choose 4 digits"; return false; }
    state.settings.pinHash = await S.hashPin(pin); S.save(state); closeSheet(); toast('PIN set'); done?.(); return true;
  }, { cancelLabel: 'Cancel' });
}

// ================================================================ events
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const inSheet = !!el.closest('.sheet');
  switch (act) {
    case 'tab': closeAllSheets(); ui.tab = el.dataset.tab; history.replaceState(null, '', '#' + ui.tab); render(); window.scrollTo({ top: 0 }); break;
    case 'goto-ledger': ui.tab = 'ledger'; ui.period = 'month'; ui.filter = el.dataset.filter; history.replaceState(null, '', '#ledger'); render(); window.scrollTo({ top: 0 }); break;
    case 'period': ui.period = el.dataset.v; render(); break;
    case 'filter': ui.filter = el.dataset.v; render(); break;
    case 'new-entry': entrySheet(null); break;
    case 'open-entry': { const e = byId(state.entries, el.dataset.id); if (e) { if (inSheet) closeAllSheets(); entrySheet(e); } break; }
    case 'calc': openCalc(); break;
    case 'search': openSearch(); break;
    case 'toggle-hide': state.settings.hideAmounts = !state.settings.hideAmounts; commit(); break;
    case 'toggle-theme': state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light'; commit(); break;
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
      if (amt > 0) { state.entries.push({ id: S.uid(), createdAt: Date.now(), type: 'received', settles: true, personId: p.id, amount: amt, method: 'upi', date: today(), time: nowTime(), accountId: state.accounts[0].id, note: `${p.name} paid back` }); commit(`${rs(amt)} from ${p.name} logged`); }
      break;
    }
    case 'pay-person': { const p = byId(state.people, el.dataset.id); payFlow({ vpa: p.vpa, name: p.name, personId: p.id }); break; }
    case 'pay-new': {
      const raw = $('#pay-vpa').value;
      const parsed = C.parseUpi(raw);
      if (!parsed) { toast('Enter a UPI ID like name@okaxis'); $('#pay-vpa').focus(); break; }
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
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetStack.length) closeSheet(); });
addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t) && t !== ui.tab) { closeAllSheets(); ui.tab = t; render(); window.scrollTo(0, 0); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ui.hiddenAt = Date.now(); return; }
  if (state.settings.pinHash && ui.hiddenAt && Date.now() - ui.hiddenAt >= (state.settings.lockAfter ?? 60) * 1000) { ui.locked = true; renderLock(); }
  checkPendingPay();
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

// ================================================================ boot
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
postRecurring();
render();
checkPendingPay();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__ledger = { get state() { return state; }, C, S };
