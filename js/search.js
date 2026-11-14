// Search orchestration: query all sources in parallel, merge, de-duplicate, rank.
// Ranking: featured > free-to-read (READ) > PREVIEW > catalog-only (BUY), then relevance.
// Manglish support hooks in via expandQuery(): it returns extra spellings sent to sources.
import { CONFIG } from './config.js';
import { searchIA } from './sources/ia.js';
import { searchGoogle } from './sources/google.js';
import { searchOpenLibrary } from './sources/openlibrary.js';
import { skeleton, manglishToMalayalam, toOldChillu, hasMalayalam, looksManglish } from './translit.js';
import { isAbort } from './net.js';

// ---------- fuzzy matching ----------
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1: how well query tokens are covered by target tokens (prefix, then edit distance). */
export function fuzzyScore(query, target) {
  const q = skeleton(query).split(' ').filter(Boolean);
  const t = skeleton(target).split(' ').filter(Boolean);
  if (!q.length || !t.length) return 0;
  const joined = t.join('');
  let total = 0;
  for (const w of q) {
    let best = 0;
    for (const x of t) {
      if (x === w) { best = 1; break; }
      if (x.startsWith(w) && w.length >= 2) best = Math.max(best, 0.9);
      else if (w.length >= 4) {
        const d = lev(w, x.slice(0, Math.max(w.length, Math.min(x.length, w.length + 2))));
        best = Math.max(best, 1 - d / Math.max(w.length, 1));
      }
    }
    // compound words: "aadujeevitham" vs "aadu jeevitham"
    if (best < 0.9 && w.length >= 4 && joined.includes(w)) best = Math.max(best, 0.85);
    total += best;
  }
  return total / q.length;
}

export function bookScore(query, b, field = 'all') {
  if (field === 'author') return fuzzyScore(query, b.author || '');
  return Math.max(fuzzyScore(query, b.title || ''), 0.9 * fuzzyScore(query, b.author || ''),
    0.8 * fuzzyScore(query, `${b.title} ${b.author}`));
}

// ---------- query expansion (Manglish phase) ----------
export function expandQuery(text) {
  const t = text.trim();
  if (!t || hasMalayalam(t) || !looksManglish(t)) return [];
  const ml = manglishToMalayalam(t);
  const old = toOldChillu(ml);
  return [...new Set([ml, old])].filter((x) => x !== t);
}

// ---------- merge / dedupe ----------
const STATE_RANK = { READ: 0, PREVIEW: 1, BUY: 2 };

// Featured titles are bilingual: "ഇന്ദുലേഖ (Indulekha)". Compare each part separately.
function variants(s) {
  const parts = String(s || '').split(/[()]/).map((x) => skeleton(x)).filter((x) => x.length > 1);
  return parts.length ? parts : [skeleton(s || '')];
}
const sim = (x, y) => (x && y ? 1 - lev(x, y) / Math.max(x.length, y.length) : 0);
const bestSim = (xs, ys) => Math.max(0, ...xs.flatMap((x) => ys.map((y) => sim(x, y))));

function sameBook(a, b) {
  if (a.archiveId && b.archiveId) return a.archiveId === b.archiveId; // different scans = different editions
  const tsim = bestSim(variants(a.title), variants(b.title));
  if (tsim < 0.85) return false;
  const aa = variants(a.author), ab = variants(b.author);
  if (!aa[0] || !ab[0]) return tsim > 0.95;
  const surname = (v) => v.split(' ').pop();
  return aa.some((x) => ab.some((y) => x.includes(surname(y)) || y.includes(surname(x)))) || bestSim(aa, ab) > 0.6;
}

function mergeInto(base, extra) {
  const better = STATE_RANK[extra.state] < STATE_RANK[base.state];
  const m = better ? { ...extra, featured: base.featured || extra.featured } : { ...base };
  const other = better ? base : extra;
  for (const k of ['coverUrl', 'description', 'year', 'author', 'previewLink', 'archiveId', 'olKey', 'googleId']) {
    if (!m[k] && other[k]) m[k] = other[k];
  }
  if (m.category === 'other' && other.category && other.category !== 'other') m.category = other.category;
  m.sources = [...new Set([...(base.sources || [base.source]), ...(extra.sources || [extra.source])])];
  if (base.featured) { m.title = base.title; m.author = base.author; m.featured = true; m.key = base.key; }
  return m;
}

export function mergeResults(lists) {
  const out = [];
  for (const list of lists) {
    for (const b of list) {
      if (!b) continue;
      const i = out.findIndex((x) => sameBook(x, b));
      if (i >= 0) out[i] = mergeInto(out[i], b);
      else out.push({ ...b, sources: b.sources || [b.source] });
    }
  }
  return out;
}

export function rank(books, query, field = 'all') {
  return books
    .map((b) => ({ b, s: query ? bookScore(query, b, field) : 0 }))
    .sort((x, y) =>
      (y.b.featured ? 1 : 0) - (x.b.featured ? 1 : 0) ||
      STATE_RANK[x.b.state] - STATE_RANK[y.b.state] ||
      y.s - x.s ||
      (y.b.downloads || 0) - (x.b.downloads || 0))
    .map((x) => x.b);
}

/**
 * Run a search. Calls onUpdate({books, pending, errors}) every time a source returns,
 * so the grid fills progressively.
 */
export function runSearch({ text, category, featured, field = 'all', sort = 'relevance', signal, onUpdate }) {
  const alt = expandQuery(text);
  const results = {};
  const errors = {};
  const pending = new Set();

  const featuredHits = (featured || []).filter((b) =>
    !text || bookScore(text, b, field) >= 0.6 || alt.some((a) => bookScore(a, b, field) >= 0.6));
  results.featured = featuredHits;

  const emit = () => {
    if (signal?.aborted) return;
    let merged = mergeResults([results.featured, results.ia, results.ol, results.google].filter(Boolean));
    if (category && category !== 'all') merged = merged.filter((b) => b.category === category);
    // drop remote junk that matches neither spelling (catalog APIs can be loose)
    if (text) {
      const min = field === 'author' ? 0.55 : 0.35; // author mode: the author must actually match
      merged = merged.filter((b) => (b.featured && field !== 'author') || (b.source === 'ia' && field !== 'author') ||
        bookScore(text, b, field) >= min || alt.some((a) => bookScore(a, b, field) >= 0.5));
    }
    onUpdate({ books: rank(merged, text, field), pending: [...pending], errors: { ...errors }, alt });
  };

  const run = (name, enabled, fn) => {
    if (!enabled) return;
    pending.add(name);
    fn()
      .then((r) => { results[name] = r; })
      .catch((e) => { if (!isAbort(e)) errors[name] = e; })
      .finally(() => { pending.delete(name); emit(); });
  };

  const S = CONFIG.sources;
  run('ia', S.internetArchive, () => searchIA({ text, altTexts: alt, category, field, sort, signal }));
  if (text) {
    run('ol', S.openLibrary, () => searchOpenLibrary({ text, field, signal }));
    run('google', S.googleBooks, () => searchGoogle({ text, field, signal }));
  }
  emit();
}

// ---------- sorting ----------
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
    .sort((x, y) => (x.y == null) - (y.y == null) || (x.y != null && y.y != null ? (x.y - y.y) * dir : 0) || x.i - y.i)
    .map((x) => x.b);
}
