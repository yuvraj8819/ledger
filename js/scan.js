// Camera barcode scanning, barcode lookup and reading nutrition labels from a photo.
// The scanning and OCR libraries load from a CDN the first time you use them, then the
// browser caches them. Barcode lookups ask Open Food Facts (only the barcode number is sent).
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
  const fields = 'product_name,brands,quantity,nutriments,serving_size,serving_quantity';
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('The food database didn’t answer. Try again in a moment.');
  const j = await res.json();
  return j.status === 1 || j.product ? j.product : null;
}

/** Text from a photo of a nutrition label. onProgress gets 0..1. */
export async function readLabel(file, onProgress) {
  await loadScript(TESS);
  const img = await shrink(file, 1800);
  const { data } = await window.Tesseract.recognize(img, 'eng', {
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  return data.text || '';
}

/** Downscales and greys a photo so OCR is faster and steadier. */
async function shrink(file, max) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.filter = 'grayscale(1) contrast(1.35)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** Opens the camera / photo picker. Must be called straight from a tap. */
export function pickPhoto() {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment');
    i.style.display = 'none';
    i.addEventListener('change', () => { resolve(i.files?.[0] || null); i.remove(); }, { once: true });
    document.body.append(i); i.click();
  });
}
