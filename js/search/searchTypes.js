// @ts-check
// Shared types for the search engine (JSDoc, so the no-build static site keeps working while
// editors with TypeScript support still type-check these modules).

/**
 * @typedef {'ia'|'openlibrary'|'google'|'featured'|'local'} SearchSource
 */

/**
 * @typedef {'empty'|'latin'|'malayalam'|'mixed'} Script
 */

/**
 * @typedef {Object} SearchQuery
 * @property {string} original     Exactly what the user typed (kept for display).
 * @property {string} display      Trimmed original.
 * @property {string} normalised   Lowercased (Latin), NFC, Malayalam encodings unified, punctuation removed, spaces collapsed.
 * @property {string} compact      `normalised` without spaces.
 * @property {string[]} tokens     Words of `normalised`.
 * @property {Script} script
 * @property {boolean} isEmpty
 */

/**
 * @typedef {'original'|'normalised'|'compact'|'transliteration'|'spelling'|'correction'|'dictionary'} VariantKind
 */

/**
 * @typedef {Object} SearchVariant
 * @property {string} text
 * @property {VariantKind} kind
 * @property {number} confidence   0..1. How likely this is what the user meant.
 * @property {Script} script
 * @property {string} [note]       e.g. the dictionary entry it came from.
 */

/**
 * @typedef {'exact-title'|'normalised-title'|'exact-alt-title'|'transliteration'|'fuzzy-title'|'exact-author'|'partial-title'|'fuzzy-author'|'category'|'description'|'none'} MatchType
 */

/**
 * A book as produced by the source adapters (js/sources/*). Only the fields search uses are listed.
 * @typedef {Object} Book
 * @property {string} key
 * @property {SearchSource} source
 * @property {string} title
 * @property {string} [author]
 * @property {number|null} [year]
 * @property {string} [category]
 * @property {string} [description]
 * @property {'READ'|'PREVIEW'|'BUY'} state
 * @property {boolean} [featured]
 * @property {string[]} [altTitles]
 * @property {string[]} [sources]
 */

/**
 * @typedef {Object} SearchResult
 * @property {Book} book
 * @property {number} score        Relevance (higher is better), see CONFIG.search.weights.
 * @property {MatchType} matchType
 */

/**
 * correction: "Did you mean"; transliteration: Malayalam spelling of Manglish input;
 * title: a known title that the input is part of; book: a real record; author: search by author.
 * @typedef {'correction'|'transliteration'|'title'|'book'|'author'} SuggestionType
 */

/**
 * @typedef {Object} SearchSuggestion
 * @property {SuggestionType} type
 * @property {string} label        Main text (Malayalam or English).
 * @property {string} [sublabel]   Secondary text, e.g. author or English title.
 * @property {string} [value]      Query to run when chosen (correction / transliteration / author).
 * @property {'all'|'author'} [field]
 * @property {Book} [book]         For type 'book': the record to open.
 * @property {number} confidence
 */

export const MATCH = Object.freeze({
  EXACT_TITLE: 'exact-title',
  NORMALISED_TITLE: 'normalised-title',
  EXACT_ALT_TITLE: 'exact-alt-title',
  TRANSLITERATION: 'transliteration',
  FUZZY_TITLE: 'fuzzy-title',
  EXACT_AUTHOR: 'exact-author',
  PARTIAL_TITLE: 'partial-title',
  FUZZY_AUTHOR: 'fuzzy-author',
  CATEGORY: 'category',
  DESCRIPTION: 'description',
  NONE: 'none',
});

/** Match types that count as "we found what you asked for" (vs. "showing similar books"). */
export const STRONG_MATCHES = new Set([
  MATCH.EXACT_TITLE, MATCH.NORMALISED_TITLE, MATCH.EXACT_ALT_TITLE, MATCH.TRANSLITERATION, MATCH.EXACT_AUTHOR, MATCH.PARTIAL_TITLE,
]);
