// Camera barcode scanning, barcode lookup and reading nutrition labels from a photo.
// The scanning and OCR libraries load from a CDN the first time you use them, then the
// browser caches them. Barcode lookups ask Open Food Facts (only the barcode number is sent).
import { parseLabel } from './nutrition.js';
const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const loaded = {};
function loadScript(src) {
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Couldn’t load the scanner. Check your internet connection.')); };
    document.head.append(s);
  }));
}
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const valid = (t) => /^\d{8,14}$/.test(t);

/** Starts the back camera in `video` and calls onCode(code) once for a barcode. Returns stop(). */
export async function startBarcode(video, onCode) {
  let stopped = false, done = false;
  const hit = (t) => { if (!done && !stopped && valid(t)) { done = true; onCode(t); } };
  if ('BarcodeDetector' in window) {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const det = new BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream; await video.play();
      const tick = async () => {
        if (stopped || done) return;
        try { const r = await det.detect(video); if (r[0]) hit(r[0].rawValue); } catch { /* frame not ready */ }
        setTimeout(tick, 200);
      };
      tick();
      return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); };
    } catch (e) { if (e.name === 'NotAllowedError') throw e; /* fall through to ZXing */ }
  }
  await loadScript(ZXING);
  const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
  const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, (res) => { if (res) hit(res.getText()); });
  return () => { stopped = true; try { controls.stop(); } catch { /* already stopped */ } };
}

/** Finds a barcode in a photo. Returns the number or null. */
export async function barcodeFromPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    if ('BarcodeDetector' in window) {
      try {
        const bmp = await createImageBitmap(file);
        const r = await new BarcodeDetector({ formats: FORMATS }).detect(bmp);
        if (r[0] && valid(r[0].rawValue)) return r[0].rawValue;
      } catch { /* try ZXing */ }
    }
    await loadScript(ZXING);
    const res = await new window.ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(url);
    const t = res?.getText();
    return valid(t) ? t : null;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** Open Food Facts product for a barcode, or null when it isn't listed. Throws when offline. */
export async function lookupBarcode(code) {
  const fields = 'product_name,brands,quantity,nutriments,serving_size,serving_quantity,ingredients_analysis_tags,allergens_tags';
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('The food database didn’t answer. Try again in a moment.');
  const j = await res.json();
  return j.status === 1 || j.product ? j.product : null;
}

// ---------------------------------------------------------------- reading a nutrition label
// Phone photos are the hard case: tilted, shadowed, a little blurry, or sideways. So the photo is straightened out
// and its contrast stretched, then read in up to four ways, keeping whichever pass finds the most nutrients.
// (This used a canvas filter before, which Safari ignores, so on iPhone the photo was never actually cleaned up.)
let ocrWorker = null, ocrIdle = null, ocrProgress = null;
async function getWorker() {
  clearTimeout(ocrIdle);
  await loadScript(TESS);
  if (!ocrWorker) {
    try {
      ocrWorker = await window.Tesseract.createWorker('eng', 1, { logger: (m) => { if (m.status === 'recognizing text') ocrProgress?.(m.progress); } });
      await ocrWorker.setParameters({ preserve_interword_spaces: '1' });
    } catch { ocrWorker = null; throw new Error('The label reader couldn’t start. Check your connection and try again.'); }
  }
  return ocrWorker;
}
/** Rejects if p takes longer than ms, so nothing can leave the reader spinning forever. */
const within = (p, ms, msg) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t)); };
const releaseWorker = () => { clearTimeout(ocrIdle); ocrIdle = setTimeout(() => { ocrWorker?.terminate().catch(() => {}); ocrWorker = null; }, 60000); };

/** Text from a photo of a nutrition label. onProgress gets 0..1. */
export async function readLabel(file, onProgress) {
  const worker = await within(getWorker(), 90000, 'The label reader couldn’t start. Check your connection and try again.');
  try {
    let gray = await prepare(file, 2400);
    let bin = binarize(gray); // black text on white: evens out shadows, and wipes out table borders
    // a photo taken at a slight angle: straighten it, so rows read as rows and table borders are straight enough to remove
    const skew = skewAngle(bin);
    if (Math.abs(skew) >= 0.75) { gray = turn(gray, skew); bin = binarize(gray); }
    const binary = () => bin;
    const best = { text: '', score: -1, trusted: false };
    let pass = 0; const planned = 6;
    ocrProgress = (p) => onProgress?.(Math.min(0.98, (pass + p) / planned));
    const run = async (cv, psm) => {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      let data;
      try { ({ data } = await within(worker.recognize(cv), 45000, 'slow')); }
      catch (e) { if (e.message === 'slow') { ocrWorker?.terminate().catch(() => {}); ocrWorker = null; throw new Error('Reading took too long. Try a closer photo of just the nutrition table.'); } throw e; }
      pass++;
      const text = data.text || '', r = parseLabel(text);
      // a pass wins if its numbers add up; otherwise by how many it found
      const score = r.found + (r.check.ok === true ? 20 : 0);
      if (score > best.score) { best.text = text; best.score = score; best.trusted = r.check.ok === true && r.found >= 5; }
      return best.trusted;
    };
    // psm 6 = one block of text (best for tables), 4 = a single column, 11 = scattered text
    const plan = bin.boxed ? [[binary, '6'], [() => gray, '6'], [binary, '4'], [binary, '11']] : [[() => gray, '6'], [binary, '6'], [binary, '4'], [() => gray, '4']];
    for (const [img, psm] of plan) if (await run(img(), psm)) { onProgress?.(1); return best.text; }
    for (const deg of [90, 270]) if (await run(rotated(binary(), deg), '6')) break; // photo taken sideways
    onProgress?.(1);
    return best.text;
  } finally { ocrProgress = null; releaseWorker(); }
}

/** Loads a photo upright (the browser applies the camera's rotation), scales it, and stretches its contrast. */
async function prepare(file, max) {
  let src, w, h, done = () => {};
  try {
    // img.decode() can wait forever in some browsers when the page isn't being drawn; onload with a time limit can't
    const url = URL.createObjectURL(file); done = () => URL.revokeObjectURL(url);
    const img = await within(new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }), 10000, 'load');
    src = img; w = img.naturalWidth; h = img.naturalHeight;
  } catch { done(); done = () => {}; src = await within(createImageBitmap(file), 10000, 'Couldn’t open that photo. Try taking it again.'); w = src.width; h = src.height; }
  const k = Math.min(3, max / Math.max(w, h)); // small photos are enlarged (OCR drops decimal points on small print); big ones shrunk
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height); done();
  return stretch(c);
}
/** Greyscale, then spread the 2nd–98th percentile of brightness over the full range so faint print stands out. */
export function stretch(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = d[i + 1] = d[i + 2] = y; hist[y]++; }
  const total = d.length / 4; let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  if (hi - lo > 20) { const m = 255 / (hi - lo); for (let i = 0; i < d.length; i += 4) { const y = Math.max(0, Math.min(255, (d[i] - lo) * m)) | 0; d[i] = d[i + 1] = d[i + 2] = y; } }
  // white print on a dark label (common on packs): flip it, since the reader wants dark text on light
  let mean = 0; for (let v = 0; v < 256; v++) mean += v * hist[v]; mean /= total;
  if (mean < 105) for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 - d[i]; }
  g.putImageData(im, 0, 0);
  return c;
}
/** Black-and-white by local brightness (a window around each pixel), so shadows and uneven light stop mattering. */
export function binarize(c) {
  const w = c.width, h = c.height, g = c.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, w, h), d = im.data;
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += d[(y * w + x) * 4]; integ[(y + 1) * (w + 1) + x + 1] = integ[y * (w + 1) + x + 1] + row; } }
  const r = Math.max(8, Math.round(Math.min(w, h) / 24)); // window radius
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0)), i = (y * w + x) * 4;
      const v = d[i] < mean * 0.86 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  // Boxed tables: wipe out long straight runs of black (the cell borders) so only the print is left. A straightened
  // photo's borders come out slightly ragged, so a run may jump gaps of 2 px, and the ragged edge 2 px either side
  // of a found line goes too. Letters never make a run this long: the holes in o, a, e and d break it up.
  const black = new Uint8Array(w * h);
  for (let i = 0; i < black.length; i++) black[i] = d[i * 4] === 0 ? 1 : 0;
  const kill = new Uint8Array(w * h);
  const minH = Math.round(w * 0.12), minV = Math.round(h * 0.12), GAP = 2, EDGE = 2; let wiped = 0;
  // A border is thin: just above and below it (or either side, for upright ones) the page is light. A shadow or a
  // speckled dark patch is black there too, and must be left alone, or the print inside it gets wiped with it.
  const T = Math.max(6, Math.round(Math.min(w, h) / 150));
  const thinH = (y, x0, x1) => { let n = 0, both = 0; for (let k = x0; k < x1; k += 3) { n++; if (y - T >= 0 && y + T < h && black[(y - T) * w + k] && black[(y + T) * w + k]) both++; } return both < n * 0.3; };
  const thinV = (x, y0, y1) => { let n = 0, both = 0; for (let k = y0; k < y1; k += 3) { n++; if (x - T >= 0 && x + T < w && black[k * w + x - T] && black[k * w + x + T]) both++; } return both < n * 0.3; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w;) {
    if (!black[y * w + x]) { x++; continue; }
    const x0 = x; let gap = 0;
    while (x < w && gap <= GAP) { gap = black[y * w + x] ? 0 : gap + 1; x++; }
    const x1 = x - gap;
    if (x1 - x0 >= minH && thinH(y, x0, x1)) { wiped += x1 - x0; for (let yy = Math.max(0, y - EDGE); yy <= Math.min(h - 1, y + EDGE); yy++) for (let k = x0; k < x1; k++) kill[yy * w + k] = 1; }
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
    if (!black[y * w + x]) { y++; continue; }
    const y0 = y; let gap = 0;
    while (y < h && gap <= GAP) { gap = black[y * w + x] ? 0 : gap + 1; y++; }
    const y1 = y - gap;
    if (y1 - y0 >= minV && thinV(x, y0, y1)) { wiped += y1 - y0; for (let xx = Math.max(0, x - EDGE); xx <= Math.min(w - 1, x + EDGE); xx++) for (let k = y0; k < y1; k++) kill[k * w + xx] = 1; }
  }
  for (let i = 0; i < kill.length; i++) if (kill[i]) { const j = i * 4; d[j] = d[j + 1] = d[j + 2] = 255; }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').putImageData(im, 0, 0);
  out.boxed = wiped > w * h * 0.0015; // enough line to be a table
  return out;
}
/** The small turn (−6° to 6°) that makes the rows of print line up best: rows are sharpest when their edges are crisp. */
export function skewAngle(bin) {
  const k = 500 / Math.max(bin.width, bin.height), w = Math.round(bin.width * k), h = Math.round(bin.height * k);
  const t = document.createElement('canvas'); t.width = w; t.height = h; const g = t.getContext('2d', { willReadFrequently: true });
  let best = 0, bestScore = -1;
  for (let a = -6; a <= 6.001; a += 0.5) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2); g.rotate((a * Math.PI) / 180); g.drawImage(bin, -w / 2, -h / 2, w, h);
    const d = g.getImageData(0, 0, w, h).data; let prev = 0, score = 0;
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 128) row++; score += (row - prev) ** 2; prev = row; }
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}
/** Turn by a small angle, growing the canvas so no corner is cut off, and filling the new edges with white. */
function turn(c, deg) {
  const r = (deg * Math.PI) / 180, cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
  const o = document.createElement('canvas'); o.width = Math.round(c.width * cos + c.height * sin); o.height = Math.round(c.width * sin + c.height * cos);
  const g = o.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, o.width, o.height);
  g.translate(o.width / 2, o.height / 2); g.rotate(r); g.drawImage(c, -c.width / 2, -c.height / 2);
  return o;
}
function rotated(c, deg) {
  const r = document.createElement('canvas'); const swap = deg % 180 !== 0;
  r.width = swap ? c.height : c.width; r.height = swap ? c.width : c.height;
  const g = r.getContext('2d'); g.translate(r.width / 2, r.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(c, -c.width / 2, -c.height / 2);
  return r;
}

/** Opens the camera / photo picker. Must be called straight from a tap. */
export function pickPhoto() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment');
    i.style.display = 'none';
    i.addEventListener('change', () => { resolve(i.files?.[0] || null); i.remove(); }, { once: true });
    // closing the picker without choosing used to leave the caller waiting forever
    i.addEventListener('cancel', () => { resolve(null); i.remove(); }, { once: true });
    document.body.append(i); i.click();
  });
}
