// Offline books: save a book's pages on this device so it can be read with no connection,
// in the same page-flip reader.
//
// How pages are saved
//  - Internet Archive books: every page is fetched as a JPEG from IA's IIIF image service
//    (iiif.archive.org), which allows the site to read the bytes (the reader's normal page
//    endpoint does not). Pages go into IndexedDB as Blobs, about 0.15-0.2 MB each, so a 200-page
//    book is roughly 35 MB. IIIF is slow and flaky for some sizes, so each page is retried at
//    slightly different widths (a page that times out at 1000px usually works at 800px), the
//    download runs a few pages at a time, and an interrupted download resumes where it stopped.
//  - Shared (public) books are PDFs on this site: the PDF is saved with the existing PDF store.
//
// The small index (which books, sizes, status) lives in localStorage so cards can show an
// "offline" mark instantly; the page data lives in IndexedDB.
import * as store from './storage.js';
import { getBookManifest } from './sources/ia.js';
import { savePdf, getPdf, deletePdf, pdfSource } from './pdf.js';
import { fetchPublicPdf } from './publicBooks.js';

const DB_NAME = 'mlib-offline';
const PAGES = 'pages';
const INDEX_KEY = 'offline-index';

export const OFFLINE = {
  widths: [1000, 800, 900, 700], // tried in this order for each page
  concurrency: 4,
  pageTimeoutMs: 30000,
  hedgeMs: 6000,                 // if a width hasn't answered in this long, also try the next one
  estimatePageBytes: 190 * 1024,
  minPageBytes: 4000,            // anything smaller is an error image, not a page
};

export class OfflineError extends Error {}

// ---------------------------------------------------------------- index (sync, localStorage)
/** @typedef {{key: string, kind: 'pages'|'pdf', count: number, have: number, bytes: number, complete: boolean, at: number, aspect?: number, archiveId?: string, book: any}} OfflineRecord */

/** @returns {Record<string, OfflineRecord>} */
function readIndex() { return store.get(INDEX_KEY, {}) || {}; }
function writeIndex(idx) { store.set(INDEX_KEY, idx); }
function putRecord(rec, { silent = false } = {}) { const idx = readIndex(); idx[rec.key] = rec; writeIndex(idx); if (!silent) notify(); }
function dropRecord(key) { const idx = readIndex(); delete idx[key]; writeIndex(idx); notify(); }

export const offlineInfo = (key) => readIndex()[key] || null;
export const isDownloaded = (key) => !!readIndex()[key]?.complete;
export const listOffline = () => Object.values(readIndex()).sort((a, b) => b.at - a.at);
export const totalOfflineBytes = () => listOffline().reduce((n, r) => n + (r.bytes || 0), 0);
export const canDownload = (book) => !!book && !book.isLocal && ((book.state === 'READ' && !!book.archiveId) || !!book.shared);

const listeners = new Set();
export function onOfflineChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }

// ---------------------------------------------------------------- IndexedDB (pages)
/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(PAGES);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}
const pageKey = (bookKey, i) => `${bookKey}|${String(i).padStart(5, '0')}`;

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(PAGES, mode);
    const out = fn(tx.objectStore(PAGES));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const putPage = (bookKey, i, blob) => idb('readwrite', (s) => s.put(blob, pageKey(bookKey, i)));
export const getPage = (bookKey, i) => idb('readonly', (s) => s.get(pageKey(bookKey, i)));

/** Page numbers already saved for a book (lets an interrupted download resume). */
async function savedPages(bookKey) {
  const keys = await idb('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(`${bookKey}|`, `${bookKey}|￿`)));
  return new Set((keys || []).map((k) => parseInt(String(k).split('|').pop(), 10)));
}
async function deletePages(bookKey) {
  await idb('readwrite', (s) => s.delete(IDBKeyRange.bound(`${bookKey}|`, `${bookKey}|￿`)));
}

// ---------------------------------------------------------------- storage space
export async function storageInfo() {
  try {
    const e = await navigator.storage.estimate();
    return { quota: e.quota || 0, usage: e.usage || 0, free: Math.max(0, (e.quota || 0) - (e.usage || 0)) };
  } catch { return null; }
}
async function ensureSpace(needBytes) {
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  const s = await storageInfo();
  if (s && s.quota && needBytes > s.free * 0.9) {
    throw new OfflineError(`Not enough storage on this device: this book needs about ${fmtBytes(needBytes)} and about ${fmtBytes(s.free)} is free. Remove a download or free up space, then try again.`);
  }
}

export function fmtBytes(n) {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${Math.round(n / 1048576)} MB`;
  return n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : '0 KB';
}

// ---------------------------------------------------------------- downloading
const iiifUrl = (id, i, w) => `https://iiif.archive.org/iiif/${encodeURIComponent(id)}$${i}/full/${w},/0/default.jpg`;

async function fetchPageOnce(id, i, w, signal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), OFFLINE.pageTimeoutMs);
  try {
    const res = await fetch(iiifUrl(id, i, w), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size < OFFLINE.minPageBytes || !/^image\//.test(blob.type)) throw new Error('not a page image');
    return blob;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * One page, trying several widths. A width that errors is replaced by the next one at once, and a
 * width that is merely slow gets a second width started alongside it after `hedgeMs`; the first
 * good answer wins and the rest are cancelled. Resolves a Blob, or null if every width failed.
 * Rejects only when cancelled.
 */
function fetchPage(id, i, signal) {
  const widths = OFFLINE.widths;
  return new Promise((resolve, reject) => {
    const ctrls = [];
    let finished = false, started = 0, failed = 0, timer = null;
    const onAbort = () => { if (!finished) { cleanup(); reject(new DOMException('cancelled', 'AbortError')); } };
    function cleanup() {
      finished = true;
      clearTimeout(timer);
      ctrls.forEach((c) => c.abort());
      signal?.removeEventListener('abort', onAbort);
    }
    function launch() {
      if (finished || started >= widths.length) return;
      const w = widths[started++];
      const c = new AbortController();
      ctrls.push(c);
      fetchPageOnce(id, i, w, c.signal)
        .then((blob) => { if (!finished) { cleanup(); resolve(blob); } })
        .catch(() => {
          if (finished) return;
          failed++;
          if (failed >= widths.length) { cleanup(); resolve(null); } else launch();
        });
      clearTimeout(timer);
      if (started < widths.length) timer = setTimeout(launch, OFFLINE.hedgeMs);
    }
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    launch();
  });
}

const slimBook = (b) => ({
  key: b.key, source: b.source, archiveId: b.archiveId, title: b.title, author: b.author, year: b.year,
  category: b.category, coverUrl: b.coverUrl, state: b.state, link: b.link, shared: b.shared, sharedId: b.sharedId,
  pdfUrl: b.pdfUrl, pdfFallbackUrl: b.pdfFallbackUrl, size: b.size, description: b.description,
});

/**
 * Download a book for offline reading.
 * @param {any} book
 * @param {{onProgress?: (p: {done: number, total: number, bytes: number, failed: number}) => void, signal?: AbortSignal}} [o]
 * @returns {Promise<OfflineRecord>}
 */
export async function downloadBook(book, { onProgress, signal } = {}) {
  if (!canDownload(book)) throw new OfflineError('This book can’t be downloaded.');
  if (!navigator.onLine) throw new OfflineError('You’re offline. Connect to the internet to download.');
  return book.shared ? downloadShared(book, { onProgress, signal }) : downloadPages(book, { onProgress, signal });
}

async function downloadShared(book, { onProgress, signal }) {
  const total = book.size || 1;
  onProgress?.({ done: 0, total, bytes: 0, failed: 0 });
  await ensureSpace((book.size || 20 * 1048576) * 1.2);
  const blob = await fetchPublicPdf(book, { signal });
  if (!(await savePdf(blob, book.key))) throw new OfflineError('This browser couldn’t keep the file. Free up space and try again.');
  onProgress?.({ done: total, total, bytes: blob.size, failed: 0 });
  const rec = { key: book.key, kind: 'pdf', count: 0, have: 0, bytes: blob.size, complete: true, at: Date.now(), book: slimBook(book) };
  putRecord(rec);
  return rec;
}

async function downloadPages(book, { onProgress, signal }) {
  const id = book.archiveId;
  const manifest = await getBookManifest(id, { signal }).catch((e) => { throw new OfflineError(e.message || 'Couldn’t get this book’s page list.'); });
  const count = manifest.count;
  const have = await savedPages(book.key).catch(() => new Set());
  const need = [];
  for (let i = 0; i < count; i++) if (!have.has(i)) need.push(i);
  await ensureSpace(need.length * OFFLINE.estimatePageBytes);

  const prev = offlineInfo(book.key);
  let bytes = prev?.bytes || 0;
  let done = have.size;
  let failedPages = [];
  const base = { key: book.key, kind: 'pages', count, aspect: manifest.aspect || 0, archiveId: id, book: slimBook(book) };
  const report = () => onProgress?.({ done, total: count, bytes, failed: failedPages.length });
  report();

  /** @param {number[]} pages */
  const pass = async (pages) => {
    let next = 0;
    failedPages = [];
    await Promise.all(Array.from({ length: Math.min(OFFLINE.concurrency, pages.length) }, async () => {
      while (next < pages.length) {
        if (signal?.aborted) return;
        const i = pages[next++];
        let blob = null;
        try { blob = await fetchPage(id, i, signal); } catch { return; } // cancelled
        if (!blob) { failedPages.push(i); report(); continue; }
        try { await putPage(book.key, i, blob); } catch (e) {
          throw new OfflineError(/quota/i.test(String(e?.name) + String(e?.message)) ? 'This device ran out of storage space. Remove a download and try again.' : 'This browser couldn’t save the page. Try again.');
        }
        bytes += blob.size; done++;
        if (done % 10 === 0) putRecord({ ...base, have: done, bytes, complete: false, at: prev?.at || Date.now() }, { silent: true });
        report();
      }
    }));
  };

  try {
    await pass(need);
    if (failedPages.length && !signal?.aborted) {
      // second chance for stubborn pages, one at a time (the server is often just busy)
      const again = [...failedPages];
      await new Promise((r) => setTimeout(r, 1500));
      const savedConcurrency = OFFLINE.concurrency;
      OFFLINE.concurrency = 1;
      try { await pass(again); } finally { OFFLINE.concurrency = savedConcurrency; }
    }
  } finally {
    // always record how far we got, so the next attempt resumes
    putRecord({ ...base, have: done, bytes, complete: false, at: prev?.at || Date.now() });
  }
  if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  if (failedPages.length) {
    throw new OfflineError(`${failedPages.length} of ${count} pages couldn’t be downloaded from the Internet Archive just now. Tap “Resume download” to try again.`);
  }
  const rec = { ...base, have: count, bytes, complete: true, at: Date.now() };
  putRecord(rec);
  return rec;
}

// ---------------------------------------------------------------- removing
export async function removeOffline(book) {
  const key = typeof book === 'string' ? book : book.key;
  const rec = offlineInfo(key);
  try {
    if (rec?.kind === 'pdf') {
      // PDFs of shared books published from this device may also be stored for instant opening; removing is fine,
      // the book is re-fetched from the site when needed.
      await deletePdf(key);
    } else {
      await deletePages(key);
    }
  } catch { /* the index entry is what matters to the UI */ }
  dropRecord(key);
}

export async function removeAllOffline() {
  for (const r of listOffline()) await removeOffline(r.key);
}

// ---------------------------------------------------------------- reading
/**
 * Reader page source for a downloaded (or partly downloaded) book.
 * `fallbackUrl(i, width)` lets a partial download use the network for missing pages.
 */
export function offlineSource(rec, fallbackUrl) {
  /** @type {Map<number, string>} */
  const urls = new Map();
  return {
    count: rec.count,
    aspect: rec.aspect || 0,
    async load(i, { width } = {}) {
      if (urls.has(i)) return urls.get(i);
      const blob = await getPage(rec.key, i).catch(() => null);
      if (blob) { const u = URL.createObjectURL(blob); urls.set(i, u); return u; }
      if (fallbackUrl && navigator.onLine) return fallbackUrl(i, width);
      throw new OfflineError('This page wasn’t downloaded.');
    },
    release(i, url) {
      if (urls.get(i) === url) { URL.revokeObjectURL(url); urls.delete(i); }
    },
    destroy() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); },
  };
}

/** Reader source for a downloaded shared PDF. */
export async function offlinePdfSource(book) {
  const blob = await getPdf(book.key);
  if (!blob) throw new OfflineError('The saved copy is missing. Remove the download and download it again.');
  return pdfSource(blob);
}

/** Make sure every index entry still has its data (storage can be cleared by the browser). Returns removed keys. */
export async function reconcile() {
  const gone = [];
  for (const r of listOffline()) {
    try {
      if (r.kind === 'pdf') { if (!(await getPdf(r.key))) gone.push(r.key); }
      else if (r.complete) {
        const have = await savedPages(r.key);
        if (have.size < r.count) { putRecord({ ...r, have: have.size, complete: false }); }
      }
    } catch { /* ignore */ }
  }
  gone.forEach(dropRecord);
  return gone;
}
