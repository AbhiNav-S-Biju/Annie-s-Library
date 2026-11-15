// @ts-check
// Merge the same book coming from different sources into one card, rank, and sort.
// Two records are the same book only if their titles (any part) are near-identical AND their
// authors agree; different Internet Archive scans are always kept apart (they are editions).
import { titleParts, authorParts } from './relevanceScorer.js';
import { skeletonCompact } from './transliteration.js';
import { levenshtein } from './fuzzyMatcher.js';

/** @typedef {import('./searchTypes.js').Book} Book */

export const STATE_RANK = { READ: 0, PREVIEW: 1, BUY: 2 };

const sim = (x, y) => (x && y ? 1 - levenshtein(x, y) / Math.max(x.length, y.length) : 0);
const bestSim = (xs, ys) => Math.max(0, ...xs.flatMap((x) => ys.map((y) => sim(x, y))));

export function sameBook(a, b) {
  if (a.archiveId && b.archiveId) return a.archiveId === b.archiveId;
  const ta = titleParts(a.title).map(skeletonCompact).filter((x) => x.length > 2);
  const tb = titleParts(b.title).map(skeletonCompact).filter((x) => x.length > 2);
  const tsim = bestSim(ta, tb);
  if (tsim < 0.85) return false;
  const aa = authorParts(a.author).map(skeletonCompact).filter(Boolean);
  const ab = authorParts(b.author).map(skeletonCompact).filter(Boolean);
  if (!aa.length || !ab.length) return tsim > 0.95; // no author to confirm: only near-identical titles
  return aa.some((x) => ab.some((y) => x.includes(y) || y.includes(x))) || bestSim(aa, ab) > 0.7;
}

function mergeInto(base, extra) {
  const better = STATE_RANK[extra.state] < STATE_RANK[base.state];
  const m = better ? { ...extra, featured: base.featured || extra.featured } : { ...base };
  const other = better ? base : extra;
  for (const k of ['coverUrl', 'description', 'year', 'author', 'previewLink', 'archiveId', 'olKey', 'googleId', 'link']) {
    if (!m[k] && other[k]) m[k] = other[k];
  }
  if (m.category === 'other' && other.category && other.category !== 'other') m.category = other.category;
  m.altTitles = [...new Set([...(m.altTitles || []), ...(other.altTitles || []), other.title].filter((t) => t && t !== m.title))];
  m.sources = [...new Set([...(base.sources || [base.source]), ...(extra.sources || [extra.source])])];
  if (base.featured) { m.title = base.title; m.author = base.author; m.featured = true; m.key = base.key; }
  return m;
}

/** @param {Book[][]} lists  in priority order (featured first) */
export function mergeResults(lists) {
  /** @type {Book[]} */
  const out = [];
  for (const list of lists) {
    for (const b of list || []) {
      if (!b) continue;
      const i = out.findIndex((x) => sameBook(x, b));
      if (i >= 0) out[i] = mergeInto(out[i], b);
      else out.push({ ...b, sources: b.sources || [b.source] });
    }
  }
  return out;
}

/**
 * Featured first, then READ > PREVIEW > BUY, then relevance, then popularity.
 * @param {Book[]} books
 * @param {Map<string, {score: number}>} [scores]
 */
export function rankBooks(books, scores) {
  const s = (b) => scores?.get(b.key)?.score ?? 0;
  return [...books].sort((x, y) =>
    (y.featured ? 1 : 0) - (x.featured ? 1 : 0) ||
    STATE_RANK[x.state] - STATE_RANK[y.state] ||
    s(y) - s(x) ||
    (y.downloads || 0) - (x.downloads || 0));
}

// ---------- sorting (user-selected) ----------
export const SORTS = [
  { id: 'relevance', label: 'Best match' },
  { id: 'year-asc', label: 'Oldest first' },
  { id: 'year-desc', label: 'Newest first' },
];

/** Stable sort by year; books with no known year always go last. */
export function sortBooks(books, sort) {
  if (sort !== 'year-asc' && sort !== 'year-desc') return books;
  const dir = sort === 'year-asc' ? 1 : -1;
  return books
    .map((b, i) => ({ b, i, y: Number.isFinite(+b.year) && +b.year > 0 ? +b.year : null }))
    .sort((x, y) => (x.y == null ? 1 : 0) - (y.y == null ? 1 : 0) || (x.y != null && y.y != null ? (x.y - y.y) * dir : 0) || x.i - y.i)
    .map((x) => x.b);
}
