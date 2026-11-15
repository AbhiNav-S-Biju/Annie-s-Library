// @ts-check
// Orchestrates a search: normalise -> expand -> query sources concurrently -> merge -> score -> rank.
// onUpdate() fires immediately (featured matches) and again as each source answers, so results
// appear progressively and a failing source never blocks the others.
import { CONFIG } from '../config.js';
import { searchIA } from '../sources/ia.js';
import { searchGoogle } from '../sources/google.js';
import { searchOpenLibrary } from '../sources/openlibrary.js';
import { isAbort } from '../net.js';
import { normaliseQuery, hasMalayalam } from './normaliseQuery.js';
import { mlToLibraryRoman } from './transliteration.js';
import { generateSearchVariants, didYouMean } from './queryExpansion.js';
import { scoreBooks } from './relevanceScorer.js';
import { mergeResults, rankBooks } from './mergeResults.js';
import { resultCache, resultKey, rememberBooks } from './searchCache.js';
import { STRONG_MATCHES, MATCH } from './searchTypes.js';
import { loadFuse } from './fuzzyMatcher.js';

/** @typedef {import('./searchTypes.js').Book} Book */
/** @typedef {import('./searchTypes.js').SearchVariant} SearchVariant */
/** @typedef {import('./searchTypes.js').SearchQuery} SearchQuery */

/**
 * @typedef {Object} SearchUpdate
 * @property {SearchQuery} query
 * @property {Book[]} books               ranked
 * @property {Map<string, {score: number, matchType: string}>} scores
 * @property {string[]} pending           sources still running
 * @property {Record<string, any>} errors  source -> error
 * @property {SearchVariant[]} variants
 * @property {string[]} alt               Malayalam spellings also searched (for the hint line)
 * @property {{entry: any, score: number} | null} didYouMean
 * @property {boolean} similarOnly        no strong match: UI says "Showing similar books"
 * @property {boolean} [fromCache]
 */

/** Source adapters. Tests replace these with fakes. */
export const DEFAULT_SOURCES = {
  ia: (o) => searchIA(o),
  ol: (o) => searchOpenLibrary(o),
  google: (o) => searchGoogle(o),
};

/** source -> timestamp until which it is skipped (after HTTP 429). */
const cooldown = new Map();
export function resetCooldowns() { cooldown.clear(); }

/**
 * Decide what to send to each API. One IA request (variants OR-ed), at most two Open Library
 * requests and one Google request per search, whatever the number of variants.
 * @param {SearchQuery} q
 * @param {SearchVariant[]} variants
 */
export function planRemoteQueries(q, variants) {
  const main = q.normalised; // punctuation/case stripped; what we actually send
  const others = variants.filter((v) => v.kind !== 'original' && v.kind !== 'normalised' && v.text !== main);
  const ia = {
    text: main,
    altTexts: others.map((v) => v.text).slice(0, CONFIG.search.maxIaClauses - 1),
    // single Malayalam word: also match inside compound words (ജീവി -> ആടുജീവിതം); slower, so only here
    infix: q.script === 'malayalam' && q.tokens.length === 1 && [...q.compact].length >= 3,
  };
  const known = variants.find((v) => v.kind === 'dictionary' || v.kind === 'correction');
  const knownLatin = variants.find((v) => (v.kind === 'dictionary' || v.kind === 'correction') && v.script === 'latin');
  const knownMl = variants.find((v) => (v.kind === 'dictionary' || v.kind === 'correction') && v.script === 'malayalam');
  // Open Library: what was typed (if Latin) + the library romanisation of the best Malayalam spelling
  // ("randamoozham" -> രണ്ടാമൂഴം -> "rantamulam", which matches its record "Raṇṭāmūḻaṃ").
  const bestMl = hasMalayalam(main) ? main : (knownMl || variants.find((v) => v.script === 'malayalam' && v.kind === 'transliteration' && v.confidence >= 0.9))?.text;
  const ol = [...new Set([
    hasMalayalam(main) ? knownLatin?.text : main,
    bestMl && mlToLibraryRoman(bestMl),
    knownLatin?.text,
  ].filter(Boolean))].slice(0, 2);
  const google = [(known && knownMl?.text) || main];
  return { ia, ol, google };
}

/**
 * @param {Object} o
 * @param {string} o.text
 * @param {'all'|'author'} [o.field]
 * @param {string} [o.category]
 * @param {string} [o.sort]
 * @param {Book[]} [o.featured]
 * @param {AbortSignal} [o.signal]
 * @param {(u: SearchUpdate) => void} o.onUpdate
 * @param {typeof DEFAULT_SOURCES} [o.sources]
 * @param {boolean} [o.useCache]
 */
export async function intelligentSearch({ text, field = 'all', category = 'all', sort = 'relevance', featured = [], signal, onUpdate, sources = DEFAULT_SOURCES, useCache = true }) {
  await loadFuse();
  if (signal?.aborted) return;
  const q = normaliseQuery(text);
  const enabled = { ia: CONFIG.sources.internetArchive, ol: CONFIG.sources.openLibrary, google: CONFIG.sources.googleBooks };

  /** @type {Record<string, Book[]>} */
  const results = {};
  /** @type {Record<string, any>} */
  const errors = {};
  const pending = new Set();

  // ---------- browse (empty query): featured + popular free books, no scoring ----------
  if (q.isEmpty) {
    results.featured = featured;
    const emitBrowse = () => {
      if (signal?.aborted) return;
      let merged = mergeResults([results.featured, results.ia]);
      if (category !== 'all') merged = merged.filter((b) => b.category === category);
      onUpdate({ query: q, books: rankBooks(merged), scores: new Map(), pending: [...pending], errors: { ...errors }, variants: [], alt: [], didYouMean: null, similarOnly: false });
    };
    if (enabled.ia) {
      pending.add('ia');
      sources.ia({ text: '', category, field, sort, signal })
        .then((r) => { results.ia = r; })
        .catch((e) => { if (!isAbort(e)) errors.ia = e; })
        .finally(() => { pending.delete('ia'); emitBrowse(); });
    }
    emitBrowse();
    return;
  }

  // ---------- cached? ----------
  const key = resultKey(q.normalised, field, category, sort);
  const hit = useCache ? resultCache.get(key) : undefined;
  if (hit) { onUpdate({ ...hit, query: q, pending: [], fromCache: true }); return; }

  const variants = generateSearchVariants(q, { field });
  const dym = didYouMean(q, { field });
  const plan = planRemoteQueries(q, variants);
  const alt = variants.filter((v) => v.script === 'malayalam' && v.kind !== 'original' && v.kind !== 'normalised' && v.kind !== 'spelling').map((v) => v.text);
  results.featured = featured;

  const emit = () => {
    if (signal?.aborted) return;
    let merged = mergeResults([results.featured, results.ia, results.ol, results.google]);
    if (category !== 'all') merged = merged.filter((b) => b.category === category);
    const scores = scoreBooks(merged, variants, { field });
    let kept = merged.filter((b) => (scores.get(b.key)?.score ?? 0) >= CONFIG.search.minRelevance);
    // When we have strong matches, drop the long tail of weak ones (e.g. "Benjamin Bailey" for "Benyamin").
    const best = Math.max(0, ...kept.map((b) => scores.get(b.key)?.score ?? 0));
    if (best >= CONFIG.search.strongMatch) kept = kept.filter((b) => (scores.get(b.key)?.score ?? 0) >= best * CONFIG.search.relativeCutoff);
    // Author search: once someone matches the name exactly, near-miss names are other people.
    if (field === 'author' && kept.some((b) => scores.get(b.key)?.matchType === MATCH.EXACT_AUTHOR)) {
      kept = kept.filter((b) => scores.get(b.key)?.matchType === MATCH.EXACT_AUTHOR);
    }
    const books = rankBooks(kept, scores);
    const similarOnly = books.length > 0 && !books.some((b) => {
      const s = scores.get(b.key);
      return s && STRONG_MATCHES.has(/** @type {any} */ (s.matchType)) && s.score >= CONFIG.search.strongMatch;
    });
    /** @type {SearchUpdate} */
    const update = { query: q, books, scores, pending: [...pending], errors: { ...errors }, variants, alt, didYouMean: dym, similarOnly };
    onUpdate(update);
    if (!pending.size) {
      rememberBooks(books);
      // cache only complete, error-free answers (a failed source should be retried next time)
      if (!Object.keys(errors).length) resultCache.set(key, { ...update, pending: [] });
    }
  };

  /** @param {'ia'|'ol'|'google'} name @param {() => Promise<Book[]>} fn */
  const run = (name, fn) => {
    if (!enabled[name]) return;
    if ((cooldown.get(name) || 0) > Date.now()) { errors[name] = { status: 429, cooldown: true }; return; }
    pending.add(name);
    fn()
      .then((r) => { results[name] = r; })
      .catch((e) => {
        if (isAbort(e)) return;
        errors[name] = e;
        if (e?.status === 429) cooldown.set(name, Date.now() + CONFIG.search.rateLimitCooldownMs);
      })
      .finally(() => { pending.delete(name); emit(); });
  };

  /** several queries to one source: merge what succeeds, fail only if all fail */
  const many = async (texts, call) => {
    const settled = await Promise.allSettled(texts.map(call));
    const ok = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => /** @type {any} */ (s).value);
    if (!ok.length) { const bad = settled.find((s) => s.status === 'rejected'); if (bad) throw /** @type {any} */ (bad).reason; }
    return ok;
  };

  run('ia', () => sources.ia({ text: plan.ia.text, altTexts: plan.ia.altTexts, infix: plan.ia.infix, prefix: true, category, field, sort, signal }));
  run('ol', () => many(plan.ol, (t) => sources.ol({ text: t, field, signal })));
  run('google', () => many(plan.google, (t) => sources.google({ text: t, field, signal })));
  emit();
}
