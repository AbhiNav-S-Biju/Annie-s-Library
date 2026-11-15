// Safe wrappers around localStorage. Every access is in try/catch: storage can be missing,
// full, or throw in private mode. The app must keep working with none of it.
const PREFIX = 'mlib:';
const mem = new Map(); // fallback when localStorage is unavailable

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return mem.has(key) ? mem.get(key) : fallback;
    return JSON.parse(raw);
  } catch {
    return mem.has(key) ? mem.get(key) : fallback;
  }
}

export function set(key, value) {
  mem.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    // Quota full: drop cached API responses and retry once.
    try {
      purgeCache();
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch { return false; }
  }
}

export function remove(key) {
  mem.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

// ---- API response cache (TTL) ----
const CPREFIX = 'cache:';
const hot = new Map();

export function cacheGet(key) {
  if (hot.has(key)) {
    const e = hot.get(key);
    if (e.exp > Date.now()) return e.v;
    hot.delete(key);
  }
  const e = get(CPREFIX + key);
  if (e && e.exp > Date.now()) { hot.set(key, e); return e.v; }
  if (e) remove(CPREFIX + key);
  return undefined;
}

export function cachePut(key, v, ttlMs) {
  const e = { v, exp: Date.now() + ttlMs };
  hot.set(key, e);
  try {
    localStorage.setItem(PREFIX + CPREFIX + key, JSON.stringify(e));
  } catch {
    purgeCache();
  }
}

function purgeCache() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + CPREFIX)) drop.push(k);
    }
    drop.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ---- Reading progress ----
export function getProgress(bookKey) { return get('progress:' + bookKey, null); }
export function setProgress(bookKey, page, total) {
  set('progress:' + bookKey, { page, total, at: Date.now() });
}

// ---- Shelf: { [bookKey]: { status, book, bookmarks: [page], updated } } ----
export const STATUSES = [
  { id: 'want', label: 'Want to read', ml: 'വായിക്കണം' },
  { id: 'reading', label: 'Reading', ml: 'വായിക്കുന്നു' },
  { id: 'finished', label: 'Finished', ml: 'വായിച്ചു' },
];

export function getShelf() { return get('shelf', {}) || {}; }
function saveShelf(s) { set('shelf', s); }

export function shelfEntry(bookKey) { return getShelf()[bookKey] || null; }

export function setStatus(book, status) {
  const s = getShelf();
  const e = s[book.key] || { bookmarks: [] };
  e.book = slimBook(book);
  e.status = status || null;
  e.updated = Date.now();
  if (!e.status && !e.bookmarks.length) delete s[book.key]; else s[book.key] = e;
  saveShelf(s);
}

export function toggleBookmark(book, page) {
  const s = getShelf();
  const e = s[book.key] || { bookmarks: [], status: null };
  e.book = slimBook(book);
  const i = e.bookmarks.indexOf(page);
  if (i >= 0) e.bookmarks.splice(i, 1); else e.bookmarks.push(page);
  e.bookmarks.sort((a, b) => a - b);
  e.updated = Date.now();
  if (!e.status && !e.bookmarks.length) delete s[book.key]; else s[book.key] = e;
  saveShelf(s);
  return i < 0;
}

function slimBook(b) {
  const { key, source, archiveId, title, author, category, coverUrl, state, year, previewLink, isLocal, shared, sharedId, pdfUrl, pdfFallbackUrl, size } = b;
  return { key, source, archiveId, title, author, category, coverUrl, state, year, previewLink, isLocal, shared, sharedId, pdfUrl, pdfFallbackUrl, size };
}

// ---- Settings ----
export function getSettings() {
  return { theme: 'system', flip: true, ...get('settings', {}) };
}
export function setSetting(k, v) { const s = getSettings(); s[k] = v; set('settings', s); }
