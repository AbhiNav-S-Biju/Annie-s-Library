// @ts-check
// Query expansion: turn one query into a few spellings worth searching for.
//   original -> normalised -> without spaces -> Manglish transliterations -> dictionary matches
//   -> Malayalam encoding alternatives (old chillu forms used by older catalogue records).
// Variants are deduplicated and capped (CONFIG.search.maxVariants); low-confidence rule-only
// transliterations are kept out so we don't send junk to the APIs.
import { CONFIG } from '../config.js';
import { normaliseQuery, normaliseText, hasMalayalam } from './normaliseQuery.js';
import { manglishCandidates, looksManglish, skeletonCompact, toOldChillu } from './transliteration.js';
import { DICTIONARY } from './lexicon.js';
import { createMatcher, usingFuse, levenshtein } from './fuzzyMatcher.js';

/** @typedef {import('./searchTypes.js').SearchQuery} SearchQuery */
/** @typedef {import('./searchTypes.js').SearchVariant} SearchVariant */
/** @typedef {import('./lexicon.js').DictEntry} DictEntry */

// ---------------------------------------------------------------- dictionary matching
/** @type {{matcher: ReturnType<typeof createMatcher>, fuse: boolean, docs: any[]} | null} */
let dict = null;
function dictIndex() {
  if (!dict || dict.fuse !== usingFuse()) {
    const docs = DICTIONARY.map((e) => ({
      entry: e,
      keys: [...new Set([e.ml, e.en, ...e.aliases].map(skeletonCompact).filter(Boolean))],
      norms: [...new Set([e.ml, e.en, ...e.aliases].map(normaliseText))],
    }));
    dict = { matcher: createMatcher(docs, [{ name: 'keys' }, { name: 'norms' }]), fuse: usingFuse(), docs };
  }
  return dict;
}

/**
 * Dictionary entries close to the query.
 *  exact      the query is this entry, spelled another way (Manglish / spacing / encoding)
 *  correction a near miss of similar length ("aadjeevitham" -> ആടുജീവിതം)
 *  completion the query is the start/part of a longer entry ("aadu" -> ആടുജീവിതം)
 * @param {SearchQuery} q
 * @param {{types?: Array<'title'|'author'>, limit?: number}} [opts]
 * @returns {Array<{entry: DictEntry, score: number, kind: 'exact'|'correction'|'completion'}>}
 */
export function findDictionaryMatches(q, { types = ['title', 'author'], limit = 5 } = {}) {
  if (q.isEmpty) return [];
  const { matcher, docs } = dictIndex();
  const qs = skeletonCompact(q.normalised);
  if (qs.length < 2) return [];
  const out = new Map();
  const add = (doc, score, kind) => {
    if (!types.includes(doc.entry.type)) return;
    const prev = out.get(doc);
    const rank = { exact: 0, correction: 1, completion: 2 };
    if (!prev || rank[kind] < rank[prev.kind] || (kind === prev.kind && score < prev.score)) out.set(doc, { entry: doc.entry, score, kind });
  };
  for (const doc of docs) {
    if (doc.keys.includes(qs) || doc.norms.includes(q.normalised)) add(doc, 0, 'exact');
  }
  const hasExact = out.size > 0;
  // Completions: the typed text really is the start or a part of a known title/author (no fuzz).
  const qn = q.normalised.replace(/ /g, '');
  if (qs.length >= 3 || qn.length >= 3) {
    for (const doc of docs) {
      if (out.has(doc)) continue;
      const inKey = qs.length >= 3 && doc.keys.some((k) => k.length > qs.length && k.includes(qs));
      const inNorm = qn.length >= 2 && doc.norms.some((n) => n.replace(/ /g, '').length > qn.length && n.replace(/ /g, '').includes(qn));
      if (inKey || inNorm) add(doc, doc.keys.some((k) => k.startsWith(qs)) ? 0.05 : 0.15, 'completion');
    }
  }
  // Corrections: near misses of similar length. Never offered when the query already matches exactly.
  // Fuse finds candidates; a normalised edit distance on the phonetic key confirms them (Fuse is
  // generous with very short strings, e.g. "zzqx" vs "yaksi").
  if (!hasExact && qs.length >= 4) {
    for (const r of matcher.search(qs, 12).concat(hasMalayalam(q.normalised) ? matcher.search(q.normalised, 12) : [])) {
      const doc = r.item;
      const dist = Math.min(...doc.keys.map((k) => levenshtein(qs, k) / Math.max(qs.length, k.length)));
      if (dist <= CONFIG.search.fuzzy.correctionMax && r.score <= CONFIG.search.fuzzy.threshold) add(doc, dist, 'correction');
    }
  }
  return [...out.values()]
    .sort((a, b) => ({ exact: 0, correction: 1, completion: 2 }[a.kind] - { exact: 0, correction: 1, completion: 2 }[b.kind]) || a.score - b.score)
    .slice(0, limit);
}

/**
 * Best "Did you mean" correction, or null when nothing is confidently better than what was typed.
 * @param {SearchQuery|string} input
 * @param {{field?: 'all'|'author'}} [opts]
 */
export function didYouMean(input, { field = 'all' } = {}) {
  const q = typeof input === 'string' ? normaliseQuery(input) : input;
  const m = findDictionaryMatches(q, { types: field === 'author' ? ['author'] : ['title', 'author'], limit: 3 })
    .find((x) => x.kind === 'correction');
  return m || null;
}

// ---------------------------------------------------------------- variants
/**
 * @param {SearchQuery|string} input
 * @param {{field?: 'all'|'author'}} [opts]
 * @returns {SearchVariant[]}
 */
export function generateSearchVariants(input, { field = 'all' } = {}) {
  const q = typeof input === 'string' ? normaliseQuery(input) : input;
  if (q.isEmpty) return [];
  /** @type {SearchVariant[]} */
  const out = [];
  const seen = new Set();
  /** @param {string} text @param {SearchVariant['kind']} kind @param {number} confidence @param {string} [note] */
  const add = (text, kind, confidence, note) => {
    const t = String(text || '').trim();
    if (!t) return;
    const key = normaliseText(t) + (kind === 'spelling' ? '|enc' : '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, kind, confidence, script: hasMalayalam(t) ? 'malayalam' : 'latin', ...(note ? { note } : {}) });
  };

  add(q.display, 'original', 1);
  add(q.normalised, 'normalised', 1);
  if (q.tokens.length > 1) add(q.compact, 'compact', 0.85);

  // Dictionary: exact (other spelling of a known title/author) and close corrections
  for (const m of findDictionaryMatches(q, { types: field === 'author' ? ['author'] : ['title', 'author'], limit: 3 })) {
    if (m.kind === 'completion') continue; // completions broaden the search too much; shown as suggestions instead
    const conf = m.kind === 'exact' ? 0.97 : Math.max(0.5, 1 - m.score * 2);
    const kind = m.kind === 'exact' ? 'dictionary' : 'correction';
    add(m.entry.ml, kind, conf, m.entry.en);
    add(m.entry.en, kind, conf - 0.02, m.entry.ml);
  }

  // Manglish -> Malayalam candidates (only the Latin words of a mixed query are transliterated)
  if ((q.script === 'latin' || q.script === 'mixed') && q.tokens.some((t) => looksManglish(t))) {
    let ruleOnly = 0;
    for (const c of manglishCandidates(q.normalised, { limit: 4 })) {
      if (c.fromLexicon) add(c.text, 'transliteration', c.confidence);
      else if (c.confidence >= CONFIG.search.minTranslitConfidence && ruleOnly++ < 2) add(c.text, 'transliteration', c.confidence);
    }
  }

  // Older catalogue encodings of Malayalam text (ന്‍ instead of ൻ): same text, different bytes.
  for (const v of [...out]) {
    if (v.script !== 'malayalam') continue;
    const old = toOldChillu(v.text);
    if (old !== v.text) add(old, 'spelling', v.confidence * 0.9, 'older chillu encoding');
  }

  const order = { original: 0, normalised: 1, dictionary: 2, correction: 3, compact: 4, transliteration: 5, spelling: 6 };
  return out
    .sort((a, b) => order[a.kind] - order[b.kind] || b.confidence - a.confidence)
    .slice(0, CONFIG.search.maxVariants);
}
