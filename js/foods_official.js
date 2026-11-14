// Numbers taken from a company's own published nutrition information, used instead of the estimates in the other
// food files. A food named here shows an "official" tag in the picker.
//
// McDonald's India: from mcdonaldsindia.com (spicy-delights and happy-price-menu pages, read 2026-11-15). Those pages
// print the figures jumbled and labelled oddly, so each item was kept only if its energy agreed with 4×protein +
// 4×carbs + 9×fat. The page's "saturated fat" column turned out to hold the total fat for the wraps and the McSpicy
// Paneer (its "fat" column repeated 22 g for everything), so total fat is the figure that makes the energy add up.
// Serving weights are not printed there, so the grams on those foods are estimates. Sodium is in mg as printed.
//
// Format: 'Brand|Food name': { kcal, p, c, f, na, sug?, fib?, src }.
// Names must match the food's name exactly. Rows that don't exist yet are added in foods_menus.js.

const MCD = "McDonald's India website";

export const OFFICIAL = {
  "McDonald's|McAloo Tikki Burger": { kcal: 353, p: 8, c: 50, f: 14, na: 790, src: MCD },
  "McDonald's|McSpicy Chicken Burger": { kcal: 481, p: 22, c: 49, f: 22, na: 1330, src: MCD },
  "McDonald's|McSpicy Paneer Burger": { kcal: 705, p: 21, c: 52, f: 46, na: 940, src: MCD },
  "McDonald's|McEgg Burger": { kcal: 281, p: 12, c: 32, f: 12, na: 700, src: MCD },
  "McDonald's|Chicken McGrill Burger": { kcal: 282, p: 12, c: 33, f: 11, na: 570, src: MCD },
  "McDonald's|Veg Pizza McPuff": { kcal: 226, p: 4, c: 24, f: 13, na: 580, src: MCD },
  "McDonald's|BigSpicy Chicken Wrap": { kcal: 638, p: 25, c: 57, f: 34, na: 2030, src: MCD },
  "McDonald's|BigSpicy Paneer Wrap": { kcal: 808, p: 24, c: 63, f: 51, na: 1830, src: MCD },
  "McDonald's|Egg Wrap with Chipotle Sauce": { kcal: 310, p: 10, c: 24, f: 20, na: 570, src: MCD },
  "McDonald's|McAloo Wrap with Chipotle Sauce": { kcal: 357, p: 5, c: 39, f: 20, na: 820, src: MCD },
  "McDonald's|Mexican Aloo Wrap": { kcal: 365, p: 6, c: 39, f: 20, na: 692, src: MCD },
  "McDonald's|Green Chilli Aloo Naan": { kcal: 350, p: 7.8, c: 45.8, f: 15.1, na: 568, sug: 4.5, src: MCD },
  "McDonald's|Green Chilli Kabab Naan": { kcal: 392, p: 15, c: 41.8, f: 18.3, na: 912, sug: 4.3, src: MCD },
  "McDonald's|Cheesy Rice Bowl (Veg)": { kcal: 574, p: 12.3, c: 70.9, f: 26.8, na: 1985, src: MCD },
  "McDonald's|Spicy Rice Bowl (Veg)": { kcal: 523, p: 11.7, c: 79.1, f: 17.8, na: 2462, src: MCD },
  "McDonald's|Cheesy Rice Bowl with Chicken Nuggets": { kcal: 751, p: 23.5, c: 82.3, f: 36.4, na: 2303, src: MCD },
  "McDonald's|Spicy Rice Bowl with Chicken Nuggets": { kcal: 701, p: 23, c: 90.6, f: 27.3, na: 2780, src: MCD },
  "McDonald's|Cheesy Rice Bowl with Chicken Strips": { kcal: 699, p: 21.6, c: 78.2, f: 33.3, na: 2444, src: MCD },
  "McDonald's|Spicy Rice Bowl with Chicken Strips": { kcal: 648, p: 21, c: 86.5, f: 24.3, na: 2920, src: MCD },
  "McDonald's|Soft Serve (Regular)": { kcal: 127, p: 2, c: 21, f: 4, na: 410, src: MCD },
  "McDonald's|Coke Float": { kcal: 139, p: 2, c: 29, f: 2, na: 390, src: MCD },
  "McDonald's|Iced Tea": { kcal: 133, p: 0, c: 33, f: 0, na: 0, src: MCD },
  "McDonald's|Chocolate Shake": { kcal: 175, p: 4, c: 30, f: 4, na: 120, src: MCD },
  "McDonald's|Chocolate Shake (Medium)": { kcal: 241, p: 6, c: 42, f: 6, na: 170, src: MCD },
  "McDonald's|Chocolate Shake (Large)": { kcal: 349, p: 8, c: 60, f: 8, na: 240, src: MCD },
  "McDonald's|McFlurry Choco Crunch": { kcal: 336, p: 5, c: 42, f: 16, na: 700, src: MCD },
  "McDonald's|McFlurry Choco Crunch (Small)": { kcal: 153, p: 3, c: 23, f: 5, na: 420, src: MCD },
};
