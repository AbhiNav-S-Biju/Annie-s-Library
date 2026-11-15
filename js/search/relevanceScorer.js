// @ts-check
// Relevance scoring. Each book gets the best score over all query variants, using these tiers
// (weights live in CONFIG.search.weights):
//   exact title > normalised title > exact alternate title > transliteration (phonetic) match
//   > fuzzy title > exact author > partial title > fuzzy author > category > description
// A variant's confidence scales its score, so a guessed transliteration never beats what the
// user literally typed.
import { CONFIG } from '../config.js';
import { normaliseText } from './normaliseQuery.js';
import { skeleton, skeletonCompact } from './transliteration.js';
import { createMatcher } from './fuzzyMatcher.js';
import { MATCH } from './searchTypes.js';

/** @typedef {import('./searchTypes.js').Book} Book */
/** @typedef {import('./searchTypes.js').SearchVariant} SearchVariant */
/** @typedef {import('./searchTypes.js').MatchType} MatchType */

/**
 * Split a catalogue title into [main, ...alternates].
 * "1889 - ഇന്ദുലെഖ - ഒന്നാം പതിപ്പ്"   -> ["ഇന്ദുലെഖ", "ഒന്നാം പതിപ്പ്", ...]
 * "ഇന്ദുലേഖ (Indulekha)"               -> ["ഇന്ദുലേഖ", "Indulekha"]
 * "Aadujeevitham By Benyamin"          -> ["Aadujeevitham By Benyamin", "Aadujeevitham"]
 * "Wild Life Asset / വന്യ ജീവി സമ്പത്ത്" -> ["Wild Life Asset", "വന്യ ജീവി സമ്പത്ത്"]
 */
export function titleParts(title, altTitles = []) {
  const t = String(title || '').replace(/^\s*\d{4}\s*[-–—:]\s*/, '').trim();
  const parts = [];
  const add = (s) => { const x = String(s || '').trim(); if (x.length > 1 && !parts.includes(x)) parts.push(x); };
  const segs = t.split(/\s*[()\/|]\s*|\s+[-–—]\s+/).filter((s) => s.trim().length > 1);
  if (segs.length > 1) segs.forEach(add); else add(t);
  for (const s of [...parts]) {
    const noBy = s.replace(/\s+by\s+.+$/i, '');
    if (noBy !== s) add(noBy);
    const main = s.split(/\s*:\s*/)[0];
    if (main !== s) add(main);
  }
  [].concat(altTitles || []).forEach(add);
  if (!parts.length) add(t || title);
  return parts;
}

/** "ഒ. ചന്തുമേനോൻ (O. Chandu Menon)", "Vishnu Sharma, Kunjan Nambiar" -> individual names */
export function authorParts(author) {
  return String(author || '')
    .split(/\s*[(),;&\/]\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** @type {WeakMap<object, any>} */
const prepared = new WeakMap();
export function prepare(book) {
  let p = prepared.get(book);
  if (p) return p;
  const parts = titleParts(book.title, book.altTitles);
  const authors = authorParts(book.author);
  p = {
    book,
    parts,
    norms: parts.map(normaliseText),
    compacts: parts.map((x) => normaliseText(x).replace(/ /g, '')),
    skels: parts.map(skeletonCompact),
    authorNorms: authors.map(normaliseText),
    authorSkels: authors.map(skeletonCompact),
    authorTokenSkels: authors.map((a) => skeleton(a).split(' ').filter((w) => w.length > 1)),
    category: String(book.category || ''),
    desc: normaliseText(String(book.description || '').slice(0, 400)),
  };
  prepared.set(book, p);
  return p;
}

const W = () => CONFIG.search.weights;
const ML_CONSONANT = /[\u0D15-\u0D39]/;

/**
 * Substring test that respects Malayalam syllables: "ആട്" (goat) must not match inside the conjunct
 * of "ആട്ടക്കഥ" -- a query ending in ് followed by a consonant is half of a conjunct, not a word.
 */
export function containsText(hay, needle) {
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const next = hay[i + needle.length] || '';
    if (!(needle.endsWith('\u0D4D') && ML_CONSONANT.test(next))) return true;
    from = i + 1;
  }
}
const LITERAL = new Set(['original', 'normalised', 'compact']);

/**
 * Score books against query variants.
 * @param {Book[]} books
 * @param {SearchVariant[]} variants
 * @param {{field?: 'all'|'author', categories?: Array<{id: string, label: string, ml: string}>}} [opts]
 * @returns {Map<string, {score: number, matchType: MatchType}>} keyed by book.key
 */
export function scoreBooks(books, variants, { field = 'all', categories = CONFIG.categories } = {}) {
  const w = W();
  const threshold = CONFIG.search.fuzzy.threshold;
  /** @type {Map<string, {score: number, matchType: MatchType}>} */
  const result = new Map();
  if (!books.length || !variants.length) return result;
  const docs = books.map(prepare);
  const titleM = createMatcher(docs, [{ name: 'skels' }, { name: 'norms' }]);
  const authorM = createMatcher(docs, [{ name: 'authorSkels' }, { name: 'authorNorms' }]);
  const descDocs = docs.filter((d) => d.desc);
  const descM = descDocs.length ? createMatcher(descDocs, [{ name: 'desc' }], { threshold: 0.2 }) : null;

  /** @param {any} d @param {number} score @param {MatchType} type */
  const offer = (d, score, type) => {
    const k = d.book.key;
    const prev = result.get(k);
    if (!prev || score > prev.score) result.set(k, { score, matchType: type });
  };

  for (const v of variants) {
    const f = LITERAL.has(v.kind) ? 1 : 0.75 + 0.25 * v.confidence;
    const vn = normaliseText(v.text);
    if (!vn) continue;
    const vc = vn.replace(/ /g, '');
    const vs = skeletonCompact(v.text);
    const vTokens = skeleton(v.text).split(' ').filter((x) => x.length > 1);
    const literal = LITERAL.has(v.kind);

    for (const d of docs) {
      if (field !== 'author') {
        if (d.norms[0] === vn) offer(d, (literal ? w.exactTitle : w.transliteration) * f, literal ? MATCH.EXACT_TITLE : MATCH.TRANSLITERATION);
        else if (d.compacts[0] === vc) offer(d, (literal ? w.normalisedTitle : w.transliteration) * f, literal ? MATCH.NORMALISED_TITLE : MATCH.TRANSLITERATION);
        else if (d.norms.includes(vn) || d.compacts.includes(vc)) offer(d, (literal ? w.exactAltTitle : w.transliteration) * f, literal ? MATCH.EXACT_ALT_TITLE : MATCH.TRANSLITERATION);
        else if (vs.length >= 3 && d.skels.includes(vs)) offer(d, w.transliteration * f, MATCH.TRANSLITERATION);
        else if ((vs.length >= 3 && v.script === 'latin' && d.skels.some((s) => s.includes(vs))) || (vc.length >= 2 && d.compacts.some((c) => containsText(c, vc)))) {
          offer(d, w.partialTitle * f, MATCH.PARTIAL_TITLE);
        }
      }
      // author: whole name, or every typed name-word present ("kumaran asan" in "N. Kumaran Asan")
      if (d.authorNorms.includes(vn) || (vs.length >= 3 && d.authorSkels.includes(vs))) offer(d, w.exactAuthor * f, MATCH.EXACT_AUTHOR);
      else if (vTokens.length && vTokens.some((t) => t.length >= 3) &&
        d.authorTokenSkels.some((toks) => vTokens.every((t) => toks.includes(t) || (t.length >= 4 && toks.join('').includes(t))))) {
        offer(d, w.exactAuthor * 0.95 * f, MATCH.EXACT_AUTHOR);
      }
      if (field !== 'author') {
        const cat = categories.find((c) => c.id === d.category);
        if (cat && [cat.id, normaliseText(cat.label), normaliseText(cat.ml)].includes(vn)) offer(d, w.category * f, MATCH.CATEGORY);
      }
    }

    // Fuzzy (Fuse.js): spelling mistakes, missing/extra letters
    if (field !== 'author' && vs.length >= 3) {
      for (const q of new Set([vs, vn])) {
        for (const r of titleM.search(q, 40)) {
          const d = r.item;
          const target = q === vs ? d.skels : d.norms;
          const best = Math.max(...target.map((t) => Math.min(t.length, q.length) / Math.max(t.length, q.length)));
          if (best >= 0.6) offer(d, w.fuzzyTitle * (1 - 0.45 * (r.score / threshold)) * f, MATCH.FUZZY_TITLE); // whole-title typo
          else if (r.score <= 0.2) offer(d, w.partialTitle * (1 - r.score) * f, MATCH.PARTIAL_TITLE);   // typo inside a longer title
        }
      }
    }
    if (vs.length >= 3) {
      for (const r of authorM.search(vs, 40)) {
        const d = r.item;
        const best = Math.max(0, ...d.authorSkels.map((t) => Math.min(t.length, vs.length) / Math.max(t.length, vs.length)));
        if (best >= 0.5) offer(d, w.fuzzyAuthor * (1 - 0.5 * (r.score / threshold)) * f, MATCH.FUZZY_AUTHOR);
      }
    }
    if (descM && field !== 'author' && vn.length >= 4) {
      for (const r of descM.search(vn, 40)) offer(r.item, w.description * (1 - r.score) * f, MATCH.DESCRIPTION);
    }
  }
  return result;
}
