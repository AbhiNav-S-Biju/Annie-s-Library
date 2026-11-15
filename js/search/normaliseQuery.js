// @ts-check
// Query/text normalisation that is safe for Malayalam.
//
// Malayalam has several encodings for the same visible text, and old/new spellings coexist in
// library metadata. We unify only encodings that are visually identical, never letters:
//   - Unicode NFC (e.g. ൊ written as െ + ാ  ->  ൊ)
//   - old "ZWJ chillu" (ന് + ZWJ) -> atomic chillu (ൻ), likewise ണ ര ല ള ക
//   - old ൻറ / ൻ്റ  -> modern ന്റ (same rendering as "nta")
//   - ൌ (two-part AU sign) -> ൗ (AU length mark), dot reph ൎ -> ർ
//   - stray ZWJ/ZWNJ removed after the above (they only affect glyph choice)
// Conjuncts (consonant + ് + consonant) are left untouched.

/** @typedef {import('./searchTypes.js').SearchQuery} SearchQuery */

const ML = /[ഀ-ൿ]/;
const LATIN = /[A-Za-zÀ-ɏ]/;

const OLD_CHILLU = [
  [/ന്‍/g, 'ൻ'], [/ണ്‍/g, 'ൺ'], [/ര്‍/g, 'ർ'], [/റ്‍/g, 'ർ'],
  [/ല്‍/g, 'ൽ'], [/ള്‍/g, 'ൾ'], [/ക്‍/g, 'ൿ'],
];

export const hasMalayalam = (s) => ML.test(String(s));
export const hasLatin = (s) => LATIN.test(String(s));

/** Unify Malayalam encodings (see header). Does not lowercase or touch punctuation. */
export function normaliseMalayalam(s) {
  let t = String(s ?? '').normalize('NFC');
  if (!hasMalayalam(t)) return t;
  for (const [re, rep] of OLD_CHILLU) t = t.replace(re, rep);
  t = t
    .replace(/ൻ്?റ/g, 'ന്റ') // ൻറ, ൻ്റ  ->  ന്റ
    .replace(/ൌ/g, 'ൗ')  // ൌ -> ൗ
    .replace(/ൎ/g, 'ർ')       // dot reph
    .replace(/[‌‍]/g, '');
  return t.normalize('NFC');
}

/**
 * Text normalisation used for matching (book titles and queries alike):
 * lowercase Latin, strip Latin diacritics (Pr̲ēmalēkhanaṃ -> premalekhanam), unify Malayalam,
 * turn punctuation into spaces, collapse whitespace.
 */
export function normaliseText(s) {
  let t = normaliseMalayalam(String(s ?? ''));
  t = t.toLowerCase();
  // NFD + remove combining marks only in the Latin range; Malayalam signs are recomposed by NFC.
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  t = t
    .replace(/['’`ʼ]/g, '')              // apostrophes join: annie's -> annies
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ') // other punctuation/symbols -> space (keeps ് and vowel signs)
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/** @returns {import('./searchTypes.js').Script} */
export function detectScript(s) {
  const m = hasMalayalam(s), l = hasLatin(s);
  if (m && l) return 'mixed';
  if (m) return 'malayalam';
  if (l) return 'latin';
  return String(s).trim() ? 'latin' : 'empty'; // digits only count as latin-ish
}

/**
 * @param {string} raw
 * @returns {SearchQuery}
 */
export function normaliseQuery(raw) {
  const original = String(raw ?? '');
  const display = original.trim().replace(/\s+/g, ' ');
  const normalised = normaliseText(original);
  const tokens = normalised ? normalised.split(' ') : [];
  return {
    original,
    display,
    normalised,
    compact: normalised.replace(/\s+/g, ''),
    tokens,
    script: normalised ? detectScript(normalised) : 'empty',
    isEmpty: !normalised,
  };
}
