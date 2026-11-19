// "New book" notifications.
//
// There is no server, so "new" means: a book that appears in the featured list or the shared
// (public) books that this device hasn't seen before. The app re-checks those lists when it opens,
// when you come back to it, and every few minutes while it's open. The very first time the app runs
// on a device, everything already in the library counts as seen, so you aren't flooded.
import * as store from './storage.js';

const KEY = 'notifications';
const MAX_ITEMS = 40;
const MAX_SEEN = 3000;

/** @typedef {{key: string, title: string, author: string, coverUrl: string|null, at: number, read: boolean, book: any}} Notice */

function load() {
  const s = store.get(KEY, null);
  return s && typeof s === 'object' ? { seeded: !!s.seeded, seen: Array.isArray(s.seen) ? s.seen : [], items: Array.isArray(s.items) ? s.items : [] }
    : { seeded: false, seen: [], items: [] };
}
function save(s) {
  s.seen = s.seen.slice(-MAX_SEEN);
  s.items = s.items.slice(0, MAX_ITEMS);
  store.set(KEY, s);
}

const slim = (b) => ({
  key: b.key, source: b.source, archiveId: b.archiveId, title: b.title, author: b.author, year: b.year,
  category: b.category, coverUrl: b.coverUrl, state: b.state, link: b.link, featured: b.featured, shared: b.shared,
  sharedId: b.sharedId, pdfUrl: b.pdfUrl, pdfFallbackUrl: b.pdfFallbackUrl, size: b.size, description: b.description, added: b.added,
});

/**
 * Compare the current library with what this device has seen. Returns the new notices (newest first).
 * @param {any[]} books featured + shared books
 */
export function syncNewBooks(books) {
  const s = load();
  const seen = new Set(s.seen);
  const fresh = books.filter((b) => b?.key && !seen.has(b.key));
  if (!s.seeded) {
    s.seeded = true;
    s.seen = [...seen, ...fresh.map((b) => b.key)];
    save(s);
    return [];
  }
  if (!fresh.length) return [];
  const now = Date.now();
  /** @type {Notice[]} */
  const notices = fresh
    .map((b) => ({ key: b.key, title: b.title, author: b.author || '', coverUrl: b.coverUrl || null, at: b.added && b.added < now ? b.added : now, read: false, book: slim(b) }))
    .sort((a, b) => b.at - a.at);
  s.seen = [...s.seen, ...fresh.map((b) => b.key)];
  s.items = [...notices, ...s.items.filter((n) => !fresh.some((b) => b.key === n.key))];
  save(s);
  return notices;
}

/** Books you added yourself shouldn't notify you. */
export function markSeen(keys) {
  const s = load();
  const set = new Set(s.seen);
  for (const k of keys) set.add(k);
  s.seen = [...set];
  save(s);
}

export const listNotices = () => load().items;
export const unreadCount = () => load().items.filter((n) => !n.read).length;

export function markRead(key) {
  const s = load();
  s.items = s.items.map((n) => (n.key === key ? { ...n, read: true } : n));
  save(s);
}
export function markAllRead() {
  const s = load();
  s.items = s.items.map((n) => ({ ...n, read: true }));
  save(s);
}
export function clearNotices() {
  const s = load();
  s.items = [];
  save(s);
}

/** "5 min ago", "3 h ago", "2 days ago", or a date. */
export function timeAgo(t, now = Date.now()) {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
