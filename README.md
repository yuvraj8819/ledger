# Balance

Money, steps and food in one private app (formerly **Ledger**). It runs in the browser as an installable phone app (PWA), keeps everything on the device, and needs no account, server or build step. Inside it are three apps: **Ledger** for cash, UPI and cards, **Health** for Apple Watch steps with rewards and fines, and **Diet & food**.

The logo is three arcs around a balance point: red for money, green for steps, amber for food. The source is `icons/icon-full.svg` (full-bleed, for the iPhone home screen and Android) and `icons/icon.svg` (rounded, for the favicon). The PNGs are rendered from the full-bleed SVG.

The rename only changes what you see. Saved data keys (`ledger.v1`), backups and the web address (`/ledger/`) are unchanged, so existing data carries over.
## What it does

Opening Ledger shows a launcher with three apps, each with today's headline: **Ledger** (money), **Health** (steps, with rewards and fines) and **Diet & food** (calories, macros, water). Tapping one opens just that app, with its own tabs. The back button, or the phone's back gesture, returns to the launcher. They share one set of data on the device, so steps and food still settle into the ledger balance every night.

| App | Tabs |
|---|---|
| Ledger | Home · Ledger · Accounts · Pay · Settings |
| Health | Today (steps, the day's money) · Days (every settled day) · Setup (Apple Watch, goals & money) |
| Diet & food | Today (food, macros, water) · Meals (your meals and scanned foods) · Body (targets, weight) |


| Screen | What's there |
|---|---|
| **Home** | Total balance split into cash and bank·UPI (plus credit card due), **safe to spend today** with a 7-day spending chart, this month's spent / for others / received, people who owe you, rewind prompt, recent entries |
| **Ledger** | Today / 7 days / 30 days / month / all. Spent vs received, spending by category, money received by source, by account, and the full day-by-day list with cash, bank·card, spent, for others, received and transfer filters |
| **Accounts** | Buckets such as Savings, Personal or Goa trip, each with in / out / left. Transfers between accounts, cash ↔ bank and card bill payments. People you've paid for and what they still owe, with a one-tap "paid me back". Totals by whose money it was |
| **Health** | Today's steps (from your Apple Watch via Apple Health) and the food you've logged, the money the day will earn or cost, this month's earned / lost, and past days. Walk back through days to fix steps or meals |
| **Pay** | Pay any UPI ID or pasted `upi://` link, or a saved payee. Opens the phone's UPI app with the amount filled in, then asks whether it went through and logs it. Upcoming recurring bills |
| **Settings** | Money & bills (opening balances, monthly budget, recurring bills) · Accounts & tags (accounts, whose money, categories, people) · Rewind (off / weekly / monthly) · Privacy & lock (4-digit passcode, auto-lock, hide amounts, hidden entries) · Export & backup (CSV for Excel, JSON backup, restore) · This device (daily snapshots, demo data, erase) |

Also: a **new entry** sheet for spent, received or *for someone* (with "they'll pay me back"), with "not from my balance" and "hide this entry" options. There's a **calculator** (the button in the amount field) whose answer fills the amount, **search** by note, person, category or exact amount, undo after deleting, and light and dark themes.

### How the numbers work

- **Cash in hand / Bank · UPI**: opening balance plus received, minus spent. Cash entries move cash. UPI and debit card entries move the bank. Credit card spending doesn't touch either until you log a *card bill* transfer; until then it shows as **credit card due**.
- **Not from my balance**: counts as spending in reports, but doesn't change any balance (someone else paid).
- **Safe to spend today**: with a monthly budget, it's what's left of the budget split over the days left in the month, today included. Without a budget, it's your balance at the start of today split the same way. Spending under today's figure raises tomorrow's.
- **Accounts** are buckets inside your total. Opening balances land in the first account. Account totals equal the Home total, minus any credit card due.
- Amounts are stored as whole paise, so totals never drift.

### Health: steps and food that move money

Each finished day settles into the ledger as entries dated that day at 11:59 PM:

| The day | Ledger |
|---|---|
| 10,000+ steps | **+₹500** (received, "Fitness reward") |
| Under 10,000 steps | **−₹1,000** (spent, "Fitness penalty") |
| A cheat meal, or calories ≥ goal + 500 | **−₹1,000** |
| Missed steps *and* overate | still one **−₹1,000** |

Hitting the steps and overeating on the same day gives +₹500 and −₹1,000. All numbers are editable in Health → Goals & money. Rule changes count from today on, and settled days keep the rules they were settled with. Editing a past day's steps or meals re-settles that day. Settling runs on open, on return to the app and at midnight, and never posts a day twice.

**Steps from Apple Watch.** A website can't read Apple Health, so an iPhone Shortcut reads the day's steps and copies `2026-11-10=12034` to the clipboard, and **Paste from Health** reads it in. A daily 11:59 PM automation runs the Shortcut. The full steps are in Health → Connect Apple Watch. A `#steps=2026-11-10=12034` link also works where the link opens the installed app (Android, desktop). On iPhone the home-screen app keeps its own storage apart from Safari, which is why it pastes instead.

A day with no step count waits. So does a count taken before 11:30 PM that's under the goal, because that count isn't final yet. Nothing is fined without a final count.

### Food: targets, search, barcodes and labels

- **Body & goal** (first thing in setup): sex, age, height, weight, optional body fat, activity and goal. Ledger works out maintenance (Katch-McArdle with body fat, Mifflin-St Jeor without), a daily target, protein / carbs / fat, fibre, a sugar cap and water. Safety limits: never below your resting burn, weight loss capped at 1% of body weight a week, and under 18 at 0.5% (max 0.5 kg) with carbs held at 130 g or more and no adult BMI label. The target becomes the calorie goal for the overeating rule, and logging a new weight updates it.
- **Built-in foods** (`js/foods.js` and `js/foods_more.js`, about 1,000): browse by group or search by name, Hindi name or dish type.
  - **Indian:** rice and biryani, dal, rajma, chole, kadhi (with and without pakoda), sabzi and paneer dishes, non-veg curries and kebabs, rotis and breads (jowar, bajra, makki, missi, kulcha, naan), breakfast (besan, moong and oats chilla, dosa and idli varieties, thepla, parathas, poha and upma), chaat and street food, sweets and desserts.
  - **Momos:** steamed, fried, pan-fried, kurkure, tandoori, afghani, peri peri, schezwan, chilli and jhol, in veg, chicken and paneer, plus chutney and mayo dips.
  - **WOW! Momo:** its momo formats, MoBurgs, chocolate momo, and the Wow! China noodles, rice, starters, soups and drinks. WOW! doesn't publish a complete menu with nutrition, so these are the formats its outlets list, with estimated numbers.
  - **Indo-Chinese:** chowmein and hakka noodles, fried rice, manchurian dry and gravy, chilli paneer, chilli chicken, dragon chicken, lollipop, spring rolls, chopsuey, soups, thukpa and dim sum.
  - **Vegetables and fruits** per 100 g (type grams to log any amount), nuts and seeds, juices and shakes, namkeen and packaged snacks, and cafe and fast food.
  - **Chains:** the Indian menus of Subway, Domino's, Pizza Hut, Taco Bell, California Burrito, McDonald's, KFC, Burger King and Starbucks.
  These are estimates for typical Indian portions. Home cooking varies with oil and quantity, and chains change recipes. A test checks that every row's calories agree with its protein, carbs and fat. For anything in a packet, scan the barcode or read the label for exact numbers.
- **Log by servings or grams**, with protein, carbs, fat, fibre, sugar and sodium. **Meals**: build a dish from ingredients once and log it in one tap. **Quick add** takes calories alone. There's also **water** and **weight** with a 10-day average.
- **Scan a barcode** with the camera, a photo or the typed number. The lookup goes to [Open Food Facts](https://world.openfoodfacts.org), a free public database, and only the barcode number is sent. Products are saved to your foods, so a second scan works offline.
- **Read a label**: photograph the nutrition table and on-device OCR ([Tesseract.js](https://tesseract.projectnaptha.com)) fills in the numbers for you to check. Then you enter the grams you ate.
- The scanner and OCR libraries load from jsDelivr the first time you use them.

### Weight goal planner

Diet & food → Body → **Plan my weight goal**. Set the weight you have now, the weight you want, the date, how many calories a workout burns and how many days a week you do it, and optionally what you plan to eat on Sundays. It shows how much to eat each day to land on that date.

- **What you burn:** resting burn × 1.2 (a normal day without workouts) plus the average daily exercise burn. Example: 900 kcal of exercise a day on top of a 2,129 kcal normal day is 3,029 kcal burned.
- **The deficit:** a kilo of body weight is taken as 7,700 kcal. Losing 6 kg in 56 days is 825 kcal a day under your burn, so about 2,200 kcal a day to eat.
- **Sundays:** the plan counts the Sundays between now and the date. If you plan to eat 2,500 kcal on Sundays, the other days come down just enough that the whole period still adds up. A Sunday figure so big that it would push the other days under your resting burn is capped, and the plan says so.
- **Safety:** it never plans below your resting burn, never asks for more than 1% of body weight a week (0.5% under 18), and holds gain to 0.5 kg a week. If the date asks for more than that, it shows the pace that is safe and the date that reaches your target at that pace.
- **It follows you:** the plan is worked out from today and from your latest weigh-in, so each weigh-in adjusts the daily number. Ahead of plan gives you a little more, behind gives you a little less.
- **Daily calorie goal:** switched on by default. Your Today screen and the overeating rule then use the plan's number, and Sundays get their own goal. Turn it off in the plan, or edit the goal by hand in Health → Setup, and the goal goes back to the target from Body & goal.

The 7,700 figure is the usual rule of thumb, not a law. Water, salt and muscle move the scale around, so look at the trend over a week or two.

### Look, motion and sound (2.0)

The design idea is a **passbook**. The balance sits on a ruled page with a red margin line, lists are ledger lines inside one surface, and every figure is set in its own condensed face (Bricolage Grotesque, digits and money signs only, bundled in `fonts/figures.woff2`, OFL). Text uses the phone's own typeface. Each app wears its logo colour: red for money, green for steps, amber for food.

- **Glass and depth:** only things that float (tab bar, + button, sheets, toasts, the lock) blur what's behind them and cast a shadow. Everything in the scrolling page is flat glass, which also keeps scrolling smooth on iPhone.
- **Theme:** Settings → Theme has Dark, Light and Auto (follows the phone).
- **Sound:** short taps, coins for money in and out, a low note for delete, a buzz for mistakes and a run of notes on unlock, generated in `js/sfx.js`. Turn it off in Settings → Sounds and haptics.

The interface follows a checklist of UX and animation principles. Where each one shows up:

| Principle | In the app |
|---|---|
| Squash & stretch | Buttons squash a little on press and spring back; the switch knob stretches as it travels |
| Anticipation | The + turns as you press it, before the sheet opens |
| Staging | A sheet dims everything behind it; the floating buttons step aside |
| Follow through | The tab pill and toasts settle with a small overshoot |
| Slow in & slow out | Everything eases; sheets arrive on an ease-out and leave on an ease-in |
| Arcs | When money moves, a coin travels in an arc between the + button and the balance |
| Secondary action | The balance counts to its new value and bumps as the coin lands |
| Snappy timing | Presses answer in 70 ms; sheets open in about a third of a second and leave faster than they arrive |
| Exaggerated feedback | The balance flashes green or red when it changes; a wrong amount or passcode shakes |
| Solid drawing / depth | Shadows and blur mean "this floats". Flat means "this is the page" |
| Fitts's law | The + button and the tab bar sit under the thumb; a long form's main button stays pinned at the bottom |
| Bigger hit areas | Every button is at least 44 px; text links have padded touch areas |
| Hick's law | A new entry shows amount, category, note and method; date, whose money and account are folded under one row. The top bar has three buttons, not four |
| Miller's law | Settings is three short groups instead of nine loose cards |
| Doherty threshold | Every tap gets an immediate visible or audible answer; long jobs (label reading) show progress |
| Postel's law | Amount fields accept `1,200`, `₹500/-`, `Rs 80`, `1.5k`, `2 lakh` and sums like `120+80` |
| Jakob's law | iOS-style grouped lists, switches, sheets you pull down, a back button top-left |
| Frequency of use | Categories, whose-money tags, people and payees are listed most-used first; a new entry starts on the method and account you use most |

Motion is off when the phone has "reduce motion" turned on. Switching tabs only fades; nothing slides.

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

Open http://127.0.0.1:5178/tests/ with the server running. The page runs about 45 checks on the money, health and nutrition logic: balances, transfers, safe to spend, people owed, recurring bills, rewind, calculator, UPI links, CSV and backups, and prints a pass/fail list.

## Code map

```
index.html            page shell
css/app.css           all styles, one system; tokens at the top (dark default, [data-theme=light], per-app accent)
fonts/figures.woff2   the figures typeface (digits, ₹ and signs only)
js/calc.js            pure money logic, no DOM; everything the tests cover
js/nutrition.js       targets from body & goal, scaling foods, label text and barcode results (pure, tested)
js/foods.js           built-in food list and search
js/foods_more.js      about 600 more foods: Indian, Indo-Chinese, momos, vegetables, fruits, snacks, fast food
js/scan.js            camera barcode scanning, Open Food Facts lookup, label OCR
js/health.js          steps + food rules: verdicts, settling into entries, step parsing (pure, tested)
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
                 sourceId?, categoryId?, personId?, note, offBalance?, hidden?, expectBack?, settles?, recurringId?, health?: { day, kind: 'reward'|'penalty' } }],
  health:     { enabled, startDate, stepGoal, calorieGoal, overMargin, reward, penalty /* paise */, method, accountId,
                days: { 'YYYY-MM-DD': { steps, stepsAt, stepsFrom, meals: [{ id, name, kcal, time, cheat }], rules? } } }
}
```

## Privacy and limits

- Data never leaves the device unless you export it. Clearing the browser's site data deletes it, so keep a backup file. A snapshot is also kept for each of the last 10 days you made changes.
- The PIN is a privacy screen, not encryption. It's stored as a SHA-256 hash, and the data in localStorage is readable by anyone with access to the unlocked device's browser tools.
- Pay only hands off to your UPI app through a `upi://` link. It never handles PINs or bank details. On a computer there's no UPI app, so use **Just log it**.
- Not built yet: reading receipts from a photo, sync between devices, multiple currencies.
