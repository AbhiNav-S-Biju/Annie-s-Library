// @ts-check
// Caches for the search engine.
//  - resultCache: final merged+ranked results per (query, field, category, sort), in memory, short TTL.
//    (Raw API responses are cached separately for 24h by net.js in localStorage.)
//  - seenBooks: a small corpus of books the user has already seen in results, so typing
//    suggestions can offer real books instantly without an API call.
import { CONFIG } from '../config.js';
import * as store from '../storage.js';

/** @template V */
export class LruCache {
  /** @param {number} max @param {number} ttlMs */
  constructor(max, ttlMs) {
    this.max = max;
    this.ttl = ttlMs;
    /** @type {Map<string, {v: V, exp: number}>} */
    this.map = new Map();
  }
  /** @param {string} k @returns {V | undefined} */
  get(k) {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.map.delete(k); return undefined; }
    this.map.delete(k); this.map.set(k, e); // refresh LRU position
    return e.v;
  }
  /** @param {string} k @param {V} v */
  set(k, v) {
    this.map.delete(k);
    this.map.set(k, { v, exp: Date.now() + this.ttl });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  clear() { this.map.clear(); }
}

export const resultCache = new LruCache(40, CONFIG.search.resultCacheTtlMs);
export const resultKey = (normalised, field, category, sort) => JSON.stringify([normalised, field, category, sort]);

// ---------- seen-books corpus (for suggestions) ----------
const SEEN_KEY = 'seen-books';
const SEEN_MAX = 300;
/** @type {Map<string, any> | null} */
let seen = null;

function load() {
  if (seen) return seen;
  seen = new Map();
  const saved = store.get(SEEN_KEY, []);
  if (Array.isArray(saved)) for (const b of saved) if (b && b.key) seen.set(b.key, b);
  return seen;
}

function slim(b) {
  const { key, source, archiveId, olKey, googleId, title, author, year, category, coverUrl, state, previewLink, link, featured, altTitles, sources } = b;
  return { key, source, archiveId, olKey, googleId, title, author, year, category, coverUrl, state, previewLink, link, featured, altTitles, sources };
}

let saveTimer = null;
/** Remember real books that came back from searches. */
export function rememberBooks(books) {
  const m = load();
  for (const b of books) {
    if (!b?.key || b.isLocal) continue;
    m.delete(b.key);
    m.set(b.key, slim(b));
  }
  while (m.size > SEEN_MAX) m.delete(m.keys().next().value);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(SEEN_KEY, [...m.values()]), 1000);
}

export function seenBooks() { return [...load().values()]; }
