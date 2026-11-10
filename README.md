# Ledger

A private money ledger for cash, UPI and cards. It runs in the browser as an installable phone app (PWA), keeps everything on the device, and needs no account, server or build step.

## What it does

| Screen | What's there |
|---|---|
| **Home** | Total balance split into cash and bank·UPI (plus credit card due), **safe to spend today** with a 7-day spending chart, this month's spent / for others / received, people who owe you, rewind prompt, recent entries |
| **Ledger** | Today / 7 days / 30 days / month / all. Spent vs received, spending by category, money received by source, by account, and the full day-by-day list with cash, bank·card, spent, for others, received and transfer filters |
| **Accounts** | Buckets such as Savings, Personal or Goa trip, each with in / out / left. Transfers between accounts, cash ↔ bank and card bill payments. People you've paid for and what they still owe, with a one-tap "paid me back". Totals by whose money it was |
| **Pay** | Pay any UPI ID or pasted `upi://` link, or a saved payee. Opens the phone's UPI app with the amount filled in, then asks whether it went through and logs it. Upcoming recurring bills |
| **Settings** | Money & bills (opening balances, monthly budget, recurring bills) · Accounts & tags (accounts, whose money, categories, people) · Rewind (off / weekly / monthly) · Privacy & lock (4-digit passcode, auto-lock, hide amounts, hidden entries) · Export & backup (CSV for Excel, JSON backup, restore) · This device (daily snapshots, demo data, erase) |

Also: a **new entry** sheet for spent, received or *for someone* (with "they'll pay me back"), with "not from my balance" and "hide this entry" options. There's a **calculator** (the `=` button) whose answer becomes an entry, **search** by note, person, category or exact amount, undo after deleting, and light and dark themes.

### How the numbers work

- **Cash in hand / Bank · UPI**: opening balance plus received, minus spent. Cash entries move cash. UPI and debit card entries move the bank. Credit card spending doesn't touch either until you log a *card bill* transfer; until then it shows as **credit card due**.
- **Not from my balance**: counts as spending in reports, but doesn't change any balance (someone else paid).
- **Safe to spend today**: with a monthly budget, it's what's left of the budget split over the days left in the month, today included. Without a budget, it's your balance at the start of today split the same way. Spending under today's figure raises tomorrow's.
- **Accounts** are buckets inside your total. Opening balances land in the first account. Account totals equal the Home total, minus any credit card due.
- Amounts are stored as whole paise, so totals never drift.

### Look, motion and sound

- **Glass:** cards, the tab bar, sheets and the lock screen are translucent and blur a slow-moving colour wash behind them. The tokens are the `--g-*` variables in the "v1.1" block of `css/app.css`.
- **Motion:** screens rise in card by card, the balance counts up, meters and chart bars grow, the tab pill slides, and the theme switch opens out from its button. All of it is off when the phone has "reduce motion" turned on.
- **Sound:** short taps, a chime when you save, a brighter one for money received, a low note for delete, a buzz for mistakes and a run of notes on unlock. They're generated in `js/sfx.js` with Web Audio, so there are no audio files. Android also gets a small vibration. Turn it all off in Settings → Sounds & haptics.

### Passcode, hiding and updates

- **Passcode:** the lock button at the top locks Ledger straight away, or sets a passcode if there isn't one yet. With a passcode, Ledger also locks when it's been in the background (Settings → Privacy & lock sets how long).
- **Hide amounts:** the eye button blurs every number on screen, including totals, counts, dates and numbers inside sentences, in sheets, search results and messages. The digits you're typing and the passcode/calculator keys stay readable.
- **Updates:** the installed app checks for a new version whenever it comes back to the front, and reloads into it. It waits if you're in the middle of filling in a sheet, then shows "Updated to version …". The running version is at the bottom of Settings.

## Run it

Any static file server works. The bundled one turns caching off so edits show up on reload:

```bash
python3 scripts/serve.py          # http://127.0.0.1:5178
python3 scripts/serve.py --lan    # reachable from a phone on the same Wi-Fi
```

**On your phone:** open https://yuvraj8819.github.io/ledger/ , then on iPhone use Safari → **Share → Add to Home Screen**; on Android use the browser menu → **Install app**. It then opens full-screen like a normal app and works offline. Installing needs HTTPS, which GitHub Pages provides.

On iPhone, Pay offers GPay, PhonePe and Paytm buttons, because iOS doesn't route a plain `upi://` link.

## Tests

Open http://127.0.0.1:5178/tests/ with the server running. The page runs about 20 checks on the money logic: balances, transfers, safe to spend, people owed, recurring bills, rewind, calculator, UPI links, CSV and backups, and prints a pass/fail list.

## Code map

```
index.html            page shell
css/app.css           all styles; theme tokens at the top (dark default, [data-theme=light])
js/calc.js            pure money logic, no DOM; everything the tests cover
js/store.js           saved data shape, localStorage, snapshots, backups, PIN hashing, demo data
js/app.js             screens, sheets, events
js/icons.js           inline SVG icons
js/sfx.js             sound effects (Web Audio) and haptics
sw.js                 offline cache (bump VERSION when shipping changes)
manifest.webmanifest  install metadata
scripts/serve.py      no-cache dev server
tests/index.html      browser test runner
```

### Data shape (`localStorage["ledger.v1"]`)

```js
{
  settings:   { theme, hideAmounts, pinHash, lockAfter, openingCash, openingBank, monthlyBudget, rewind, showHidden, onboarded },
  accounts:   [{ id, name }],
  sources:    [{ id, name }],               // "whose money": pocket money, grandmother…
  categories: [{ id, name, icon }],
  people:     [{ id, name, vpa? }],         // vpa = UPI ID
  recurring:  [{ id, name, amount, method, accountId, categoryId, day, lastPosted, startMonth, paused? }],
  entries:    [{ id, type: 'spent'|'received'|'forSomeone'|'transfer', amount /* paise */, date: 'YYYY-MM-DD', time: 'HH:MM',
                 method: 'cash'|'upi'|'debit'|'credit', accountId, toAccountId?, kind?: 'account'|'toBank'|'toCash'|'cardBill',
                 sourceId?, categoryId?, personId?, note, offBalance?, hidden?, expectBack?, settles?, recurringId? }]
}
```

## Privacy and limits

- Data never leaves the device unless you export it. Clearing the browser's site data deletes it, so keep a backup file. A snapshot is also kept for each of the last 10 days you made changes.
- The PIN is a privacy screen, not encryption. It's stored as a SHA-256 hash, and the data in localStorage is readable by anyone with access to the unlocked device's browser tools.
- Pay only hands off to your UPI app through a `upi://` link. It never handles PINs or bank details. On a computer there's no UPI app, so use **Just log it**.
- Not built yet: reading receipts from a photo, sync between devices, multiple currencies.
