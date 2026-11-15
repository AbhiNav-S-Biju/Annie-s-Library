// @ts-check
// Suggestions while typing. Entirely local (dictionary + books already loaded/seen), so it runs on
// every keystroke without any network request. Low-confidence guesses are not shown.
import { CONFIG } from '../config.js';
import { normaliseQuery, normaliseText } from './normaliseQuery.js';
import { manglishCandidates, looksManglish } from './transliteration.js';
import { findDictionaryMatches, generateSearchVariants } from './queryExpansion.js';
import { scoreBooks } from './relevanceScorer.js';
import { seenBooks } from './searchCache.js';

/** @typedef {import('./searchTypes.js').SearchSuggestion} SearchSuggestion */
/** @typedef {import('./searchTypes.js').Book} Book */

/**
 * @param {string} text
 * @param {{field?: 'all'|'author', featured?: Book[], books?: Book[], limit?: number}} [opts]
 * @returns {SearchSuggestion[]}
 */
export function getSuggestions(text, { field = 'all', featured = [], books = [], limit = 7 } = {}) {
  const q = normaliseQuery(text);
  if (q.isEmpty || q.compact.length < 2) return [];
  /** @type {SearchSuggestion[]} */
  const out = [];
  const seen = new Set();
  /** @param {SearchSuggestion} s */
  const add = (s) => {
    const k = s.type === 'book' ? 'b:' + s.book?.key : normaliseText(s.label) + '|' + (s.field || '');
    if (seen.has(k) || normaliseText(s.label) === q.normalised && s.type !== 'book') return;
    seen.add(k);
    out.push(s);
  };
  const types = field === 'author' ? ['author'] : ['title', 'author'];
  const matches = findDictionaryMatches(q, { types: /** @type {any} */ (types), limit: 4 });

  // 1. Did you mean (close misspelling of a known title/author)
  for (const m of matches.filter((x) => x.kind === 'correction').slice(0, 1)) {
    add({
      type: 'correction', label: m.entry.ml,
      sublabel: m.entry.type === 'author' ? m.entry.en : [m.entry.en, m.entry.authorEn].filter(Boolean).join(' — '),
      value: m.entry.ml, field: m.entry.type === 'author' ? 'author' : field, confidence: 1 - m.score,
    });
  }
  // 2. Malayalam spelling of what was typed in Manglish
  for (const m of matches.filter((x) => x.kind === 'exact').slice(0, 1)) {
    add({
      type: 'transliteration', label: m.entry.ml,
      sublabel: m.entry.type === 'author' ? m.entry.en : [m.entry.en, m.entry.authorEn].filter(Boolean).join(' — '),
      value: m.entry.ml, field: m.entry.type === 'author' ? 'author' : field, confidence: 0.97,
    });
  }
  if (q.script === 'latin' && q.tokens.every(looksManglish) && !matches.some((x) => x.kind === 'exact')) {
    const c = manglishCandidates(q.normalised, { limit: 1 })[0];
    if (c && c.fromLexicon) add({ type: 'transliteration', label: c.text, value: c.text, field, confidence: c.confidence });
  }
  // 3. Known titles / authors that start with or contain what was typed
  for (const m of matches.filter((x) => x.kind === 'completion').slice(0, 2)) {
    add({
      type: m.entry.type === 'author' ? 'author' : 'title', label: m.entry.ml,
      sublabel: m.entry.type === 'author' ? m.entry.en : [m.entry.en, m.entry.authorEn].filter(Boolean).join(' — '),
      value: m.entry.type === 'author' ? m.entry.en : m.entry.ml, field: m.entry.type === 'author' ? 'author' : field,
      confidence: 1 - m.score,
    });
  }
  // 4. Real books already loaded or seen before
  const corpus = new Map();
  for (const b of [...featured, ...books, ...seenBooks()]) if (b?.key && !corpus.has(b.key)) corpus.set(b.key, b);
  const list = [...corpus.values()];
  if (list.length) {
    const scores = scoreBooks(list, generateSearchVariants(q, { field }), { field });
    list
      .map((b) => ({ b, s: scores.get(b.key) }))
      .filter((x) => x.s && x.s.score >= CONFIG.search.strongMatch * 0.9)
      .sort((a, b) => b.s.score - a.s.score)
      .slice(0, 3)
      .forEach(({ b, s }) => add({ type: 'book', label: b.title, sublabel: [b.author, b.year].filter(Boolean).join(' · '), book: b, confidence: s.score / 100 }));
  }
  // 5. Authors from the dictionary that match (only if not shown above)
  for (const m of matches.filter((x) => x.entry.type === 'author' && x.kind !== 'completion').slice(0, 1)) {
    add({ type: 'author', label: m.entry.ml, sublabel: m.entry.en, value: m.entry.en, field: 'author', confidence: 1 - m.score });
  }
  return out.slice(0, limit);
}
