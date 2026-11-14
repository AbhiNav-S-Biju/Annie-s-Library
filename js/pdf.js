// "Add my PDF": render a user-owned PDF with PDF.js into the same flip reader.
// Nothing is uploaded. Files are optionally kept in IndexedDB (this device only) so they can be reopened.
import { loadPdfJs } from './vendor.js';

export function pdfKey(file) { return `pdf:${file.name}:${file.size}:${file.lastModified || 0}`; }

/** Build a reader page source from a File/Blob. */
export async function pdfSource(file) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  const first = await doc.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const aspect = vp1.width / vp1.height;

  // Render one page at a time: keeps memory flat on phones.
  let queue = Promise.resolve();
  const render = (i, width) => {
    const job = queue.then(async () => {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, width / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
      canvas.width = canvas.height = 0; // free the backing store now
      return URL.createObjectURL(blob);
    });
    queue = job.catch(() => {});
    return job;
  };

  return {
    count: doc.numPages,
    aspect: aspect > 0.3 && aspect < 2 ? aspect : 0.7,
    load: (i, { width }) => render(i, width),
    release: (i, url) => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); },
    destroy: () => { try { doc.destroy(); } catch { /* ignore */ } },
  };
}

// ---------- IndexedDB store for "My PDFs" ----------
const DB = 'mlib-pdfs', STORE = 'files';
function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export async function savePdf(file) {
  try {
    const key = pdfKey(file);
    await tx('readwrite', (s) => s.put({ key, name: file.name, size: file.size, added: Date.now(), blob: file }));
    return true;
  } catch { return false; }
}
export async function getPdf(key) {
  try { const r = await tx('readonly', (s) => s.get(key)); return r?.blob || null; } catch { return null; }
}
export async function deletePdf(key) {
  try { await tx('readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
}
