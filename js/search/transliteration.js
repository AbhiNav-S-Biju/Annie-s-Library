// @ts-check
// Manglish <-> Malayalam for search. Pure functions, no network, no AI.
//
//  manglishCandidates(text)  several ranked Malayalam guesses for a Manglish phrase
//  manglishToMalayalam(text) the best guess
//  mlToLatin(text)           deterministic romanisation (for matching only, never displayed)
//  skeleton(text)            phonetic key: "aadujeevitham" = "Aatujeevitham" = "ആടുജീവിതം"
//
// How candidates are made: each Latin chunk maps to one or more Malayalam spellings with a cost
// (e.g. "t" -> ട 0.2 | ത 0.5 | റ്റ 1.0). A beam search keeps the cheapest spellings; consonant
// clusters get a virama (conjunct), word-final consonants become chillus/anusvara. Words found in
// the lexicon (lexicon.js) are taken from there with full confidence.
//
// Known limits (documented in the README too):
//  - Manglish drops information Malayalam needs: vowel length (a/aa, e/ee), dental vs retroflex
//    (t/ട/ത, n/ന/ണ, l/ല/ള), ര/റ. Rules alone get common words right; rarer words may need the
//    lexicon or the phonetic fuzzy matcher, which tolerates exactly these confusions.
//  - Samvruthokaram (final ് written as "u") produces both ...ു and ...് variants.
//  - Sanskrit clusters (ജ്ഞ, ക്ഷ, ശ്ര) are covered; rarer ones (ഗ്ദ്ധ etc.) are not.

import { hasMalayalam, normaliseMalayalam } from './normaliseQuery.js';
import { WORDS, DICTIONARY } from './lexicon.js';

export { hasMalayalam };

const VIRAMA = '്';

// ---------------------------------------------------------------- Malayalam -> Latin (matching)
const IND_VOWELS = {
  'അ': 'a', 'ആ': 'aa', 'ഇ': 'i', 'ഈ': 'ii', 'ഉ': 'u', 'ഊ': 'uu', 'ഋ': 'ri', 'എ': 'e', 'ഏ': 'e',
  'ഐ': 'ai', 'ഒ': 'o', 'ഓ': 'o', 'ഔ': 'au',
};
// േ/ോ map to plain e/o: Manglish almost never marks those long vowels, while ീ/ൂ are written ee/oo.
const SIGNS = {
  'ാ': 'aa', 'ി': 'i', 'ീ': 'ii', 'ു': 'u', 'ൂ': 'uu', 'ൃ': 'ri', 'െ': 'e', 'േ': 'e', 'ൈ': 'ai',
  'ൊ': 'o', 'ോ': 'o', 'ൌ': 'au', 'ൗ': 'au',
};
const CONS = {
  'ക': 'k', 'ഖ': 'kh', 'ഗ': 'g', 'ഘ': 'gh', 'ങ': 'ng', 'ച': 'ch', 'ഛ': 'chh', 'ജ': 'j', 'ഝ': 'jh', 'ഞ': 'nj',
  'ട': 't', 'ഠ': 'th', 'ഡ': 'd', 'ഢ': 'dh', 'ണ': 'n', 'ത': 'th', 'ഥ': 'th', 'ദ': 'd', 'ധ': 'dh', 'ന': 'n',
  'പ': 'p', 'ഫ': 'ph', 'ബ': 'b', 'ഭ': 'bh', 'മ': 'm', 'യ': 'y', 'ര': 'r', 'ല': 'l', 'വ': 'v', 'ശ': 'sh',
  'ഷ': 'sh', 'സ': 's', 'ഹ': 'h', 'ള': 'l', 'ഴ': 'zh', 'റ': 'r',
};
const CHILLU = { 'ൺ': 'n', 'ൻ': 'n', 'ർ': 'r', 'ൽ': 'l', 'ൾ': 'l', 'ൿ': 'k' };

export function mlToLatin(s) {
  const str = normaliseMalayalam(String(s)).replace(/റ്റ/g, '').replace(/ന്റ/g, '');
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const base = c === '' ? 'tt' : c === '' ? 'nt' : CONS[c];
    if (base) {
      out += base;
      const n = str[i + 1];
      if (n && SIGNS[n]) { out += SIGNS[n]; i++; }
      else if (n === VIRAMA) i++;
      else out += 'a';
    } else if (IND_VOWELS[c]) out += IND_VOWELS[c];
    else if (CHILLU[c]) out += CHILLU[c];
    else if (c === 'ം') out += 'm';
    else if (c === 'ഃ') out += 'h';
    else if (SIGNS[c] || c === VIRAMA) { /* stray sign */ }
    else out += c;
  }
  return out;
}

/**
 * Phonetic key used for fuzzy comparison across Manglish spellings and scripts.
 * Collapses the confusions Manglish can't express (vowel length, t/d/ട/ത, n/ണ, l/ള, s/ശ/ഷ, doubled letters).
 */
export function skeleton(s) {
  let t = hasMalayalam(s) ? mlToLatin(s) : String(s ?? '');
  t = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t
    .replace(/zh/g, 'l')
    .replace(/ksh/g, 'ks')
    .replace(/x/g, 'ks')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/f/g, 'p')
    .replace(/([kgcjtdpbs])h/g, '$1') // aspirates & th/dh/sh/ch -> base letter
    .replace(/d/g, 't')
    .replace(/ee|ii/g, 'i')
    .replace(/oo|uu/g, 'u')
    .replace(/ou/g, 'au')
    .replace(/aa/g, 'a')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/([b-df-hj-np-tv-z])u\b/g, '$1') // samvruthokaram: "aadu" ~ ആട്, "pattu" ~ പാട്ട്
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/** Phonetic key with spacing ignored: "aadu jeevitham" = "aadujeevitham" = "ആടുജീവിതം". */
export const skeletonCompact = (s) => skeleton(String(s ?? '').replace(/\s+/g, ''));

// ---------------------------------------------------------------- Malayalam -> library romanisation
// Library catalogues (Open Library, LoC) romanise Malayalam as ALA-LC: രണ്ടാമൂഴം -> Raṇṭāmūḻaṃ.
// Open Library ignores diacritics when searching, so the folded form "rantamulam" finds it,
// while Manglish "randamoozham" does not.
const LIB_IND = { 'അ': 'a', 'ആ': 'a', 'ഇ': 'i', 'ഈ': 'i', 'ഉ': 'u', 'ഊ': 'u', 'ഋ': 'r', 'എ': 'e', 'ഏ': 'e', 'ഐ': 'ai', 'ഒ': 'o', 'ഓ': 'o', 'ഔ': 'au' };
const LIB_SIGN = { 'ാ': 'a', 'ി': 'i', 'ീ': 'i', 'ു': 'u', 'ൂ': 'u', 'ൃ': 'r', 'െ': 'e', 'േ': 'e', 'ൈ': 'ai', 'ൊ': 'o', 'ോ': 'o', 'ൌ': 'au', 'ൗ': 'au' };
const LIB_CONS = {
  'ക': 'k', 'ഖ': 'kh', 'ഗ': 'g', 'ഘ': 'gh', 'ങ': 'n', 'ച': 'c', 'ഛ': 'ch', 'ജ': 'j', 'ഝ': 'jh', 'ഞ': 'n',
  'ട': 't', 'ഠ': 'th', 'ഡ': 'd', 'ഢ': 'dh', 'ണ': 'n', 'ത': 't', 'ഥ': 'th', 'ദ': 'd', 'ധ': 'dh', 'ന': 'n',
  'പ': 'p', 'ഫ': 'ph', 'ബ': 'b', 'ഭ': 'bh', 'മ': 'm', 'യ': 'y', 'ര': 'r', 'ല': 'l', 'വ': 'v', 'ശ': 's',
  'ഷ': 's', 'സ': 's', 'ഹ': 'h', 'ള': 'l', 'ഴ': 'l', 'റ': 'r',
};
const LIB_CHILLU = { 'ൺ': 'n', 'ൻ': 'n', 'ർ': 'r', 'ൽ': 'l', 'ൾ': 'l', 'ൿ': 'k' };

/** ALA-LC style romanisation folded to plain ASCII (for querying library catalogues). */
export function mlToLibraryRoman(s) {
  const str = normaliseMalayalam(String(s));
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (LIB_CONS[c]) {
      out += LIB_CONS[c];
      const n = str[i + 1];
      if (n && LIB_SIGN[n]) { out += LIB_SIGN[n]; i++; }
      else if (n === VIRAMA) { i++; if (!/[\u0D15-\u0D39]/.test(str[i + 1] || '')) out += 'u'; } // final ് ~ ŭ
      else out += 'a';
    } else if (LIB_IND[c]) out += LIB_IND[c];
    else if (LIB_CHILLU[c]) out += LIB_CHILLU[c];
    else if (c === 'ം') out += 'm';
    else if (c === 'ഃ') out += 'h';
    else if (LIB_SIGN[c] || c === VIRAMA) { /* stray */ }
    else out += c;
  }
  return out;
}

// ---------------------------------------------------------------- Manglish -> Malayalam
/** @typedef {{ind: string, sign: string, cost: number}} VowelOut */
const V = (ind, sign, cost = 0) => ({ ind, sign, cost });
/** @type {Array<[string, VowelOut[]]>} longest patterns first */
const VOWELS = [
  ['aa', [V('ആ', 'ാ')]],
  ['ai', [V('ഐ', 'ൈ')]],
  ['au', [V('ഔ', 'ൗ')]],
  ['ou', [V('ഔ', 'ൗ', 0.3)]],
  ['ee', [V('ഈ', 'ീ'), V('ഏ', 'േ', 0.9)]],
  ['ii', [V('ഈ', 'ീ')]],
  ['oo', [V('ഊ', 'ൂ'), V('ഓ', 'ോ', 0.9)]],
  ['uu', [V('ഊ', 'ൂ')]],
  ['ae', [V('ഏ', 'േ', 0.3)]],
  ['a', [V('അ', ''), V('ആ', 'ാ', 1.1)]],
  ['i', [V('ഇ', 'ി'), V('ഈ', 'ീ', 1.2)]],
  ['u', [V('ഉ', 'ു'), V('ഊ', 'ൂ', 1.3)]],
  ['e', [V('എ', 'െ'), V('ഏ', 'േ', 0.6)]],
  ['o', [V('ഒ', 'ൊ'), V('ഓ', 'ോ', 0.6)]],
];

/** @type {Array<[string, Array<[string, number]>]>} longest patterns first */
const CONSONANTS = [
  ['thth', [['ത്ത', 0]]], ['chch', [['ച്ച', 0]]],
  ['ksh', [['ക്ഷ', 0]]], ['nch', [['ഞ്ച', 0]]], ['nth', [['ന്ത', 0], ['ന്ദ', 1]]], ['ndh', [['ന്ധ', 0]]],
  ['chh', [['ഛ', 0], ['ച്ച', 0.5]]], ['cch', [['ച്ച', 0]]], ['tth', [['ത്ത', 0]]], ['ddh', [['ദ്ധ', 0]]],
  ['kk', [['ക്ക', 0]]], ['kh', [['ഖ', 0]]], ['gg', [['ഗ്ഗ', 0]]], ['gh', [['ഘ', 0]]],
  ['ng', [['ങ്ങ', 0], ['ങ', 0.8], ['ന്ഗ', 1.6]]], ['nk', [['ങ്ക', 0], ['ന്ക', 1.5]]],
  ['ch', [['ച', 0], ['ച്ച', 1.0]]], ['jj', [['ജ്ജ', 0]]], ['jh', [['ഝ', 0]]],
  ['nj', [['ഞ', 0], ['ഞ്ഞ', 0.8]]], ['nn', [['ന്ന', 0], ['ണ്ണ', 0.6]]],
  ['tt', [['ട്ട', 0], ['റ്റ', 0.3], ['ത്ത', 0.8]]], ['th', [['ത', 0], ['ത്ത', 0.9], ['ഥ', 1.4]]],
  ['dh', [['ധ', 0], ['ഢ', 1.2]]], ['dd', [['ദ്ദ', 0.3], ['ഡ്ഡ', 0.6], ['ട്ട', 0.9]]],
  ['nd', [['ണ്ട', 0], ['ന്ദ', 0.5], ['ന്റ', 1.0]]], ['nt', [['ന്റ', 0], ['ണ്ട', 0.6], ['ന്ത', 0.8]]],
  ['mb', [['മ്പ', 0], ['മ്ബ', 1.5]]], ['mp', [['മ്പ', 0]]], ['pp', [['പ്പ', 0]]], ['ph', [['ഫ', 0]]],
  ['bh', [['ഭ', 0]]], ['bb', [['ബ്ബ', 0]]], ['mm', [['മ്മ', 0]]], ['yy', [['യ്യ', 0]]],
  ['ll', [['ല്ല', 0], ['ള്ള', 0.4]]], ['zh', [['ഴ', 0]]], ['vv', [['വ്വ', 0]]], ['ww', [['വ്വ', 0]]],
  ['sh', [['ശ', 0], ['ഷ', 0.4]]], ['ss', [['സ്സ', 0], ['ശ്ശ', 0.4]]], ['sr', [['ശ്ര', 0], ['സ്ര', 0.7]]],
  ['gn', [['ഗ്ന', 0.4], ['ജ്ഞ', 0.6]]], ['jn', [['ജ്ഞ', 0.3]]],
  ['k', [['ക', 0]]], ['g', [['ഗ', 0]]], ['c', [['ക', 0.5], ['ച', 0.8]]], ['j', [['ജ', 0]]],
  ['t', [['ട', 0.2], ['ത', 0.5], ['റ്റ', 1.0]]], ['d', [['ദ', 0.2], ['ട', 0.4], ['ഡ', 0.8]]],
  ['n', [['ന', 0], ['ണ', 0.7]]], ['p', [['പ', 0]]], ['f', [['ഫ', 0]]], ['b', [['ബ', 0]]], ['m', [['മ', 0]]],
  ['y', [['യ', 0]]], ['r', [['ര', 0], ['റ', 0.9]]], ['l', [['ല', 0], ['ള', 0.6]]], ['v', [['വ', 0]]], ['w', [['വ', 0]]],
  ['s', [['സ', 0], ['ശ', 0.6]]], ['h', [['ഹ', 0]]], ['x', [['ക്സ', 0]]], ['q', [['ക്ക', 0.5]]], ['z', [['സ', 0.5], ['ഴ', 0.8]]],
];

/** Word-final consonant -> chillu / anusvara / explicit virama. */
const FINAL = {
  'ന': [['ൻ', 0], ['ന്', 1.0]], 'ണ': [['ൺ', 0], ['ണ്', 0.8]], 'ര': [['ർ', 0]], 'റ': [['ർ', 0.3], ['റ്', 1.0]],
  'ല': [['ൽ', 0]], 'ള': [['ൾ', 0]], 'മ': [['ം', 0], ['മ്', 1.0]], 'ക': [['ക്', 0], ['ൿ', 1.0]],
};

const BEAM = 64;
const JOIN_COST = 0.15;      // conjunct made by our join (explicit double rules are preferred)
const MID_VOWEL_COST = 1.8;  // independent vowel letter in the middle of a word is unusual

/**
 * @param {string} word  one Latin word
 * @param {number} limit
 * @returns {{text: string, cost: number}[]}
 */
export function wordCandidates(word, limit = 6) {
  const w = String(word).toLowerCase();
  if (!w) return [];
  /** @type {{i: number, out: string, cost: number, pend: string}[]} */
  let frontier = [{ i: 0, out: '', cost: 0, pend: '' }];
  /** @type {Map<string, number>} */
  const done = new Map();
  const finish = (st) => {
    let opts = [[st.out, 0]];
    if (st.pend) {
      const f = st.pend.length === 1 && FINAL[st.pend];
      opts = f ? f.map(([ml, c]) => [st.out + ml, c]) : [[st.out + st.pend + VIRAMA, 0]];
    }
    for (const [text, c] of opts) {
      const cost = st.cost + /** @type {number} */ (c);
      if (!done.has(text) || done.get(text) > cost) done.set(text, cost);
    }
  };

  while (frontier.length) {
    /** @type {Map<string, {i: number, out: string, cost: number, pend: string}>} */
    const next = new Map();
    const push = (st) => {
      const k = `${st.i}|${st.out}|${st.pend}`;
      const prev = next.get(k);
      if (!prev || prev.cost > st.cost) next.set(k, st);
    };
    for (const st of frontier) {
      if (st.i >= w.length) { finish(st); continue; }
      let matched = false;
      for (const [pat, outs] of VOWELS) {
        if (!w.startsWith(pat, st.i)) continue;
        matched = true;
        const end = st.i + pat.length;
        for (const v of outs) {
          if (st.pend) {
            push({ i: end, out: st.out + st.pend + v.sign, cost: st.cost + v.cost, pend: '' });
            // samvruthokaram: final "u" is often a written ് (aadu -> ആട്)
            if (pat === 'u' && end === w.length) push({ i: end, out: st.out + st.pend + VIRAMA, cost: st.cost + 0.5, pend: '' });
          } else {
            push({ i: end, out: st.out + v.ind, cost: st.cost + v.cost + (st.i > 0 ? MID_VOWEL_COST : 0), pend: '' });
          }
        }
      }
      for (const [pat, outs] of CONSONANTS) {
        if (!w.startsWith(pat, st.i)) continue;
        matched = true;
        const end = st.i + pat.length;
        for (const [ml, c] of outs) {
          if (st.pend) {
            const hPenalty = ml === 'ഹ' ? 1.2 : 0;
            push({ i: end, out: st.out + st.pend + VIRAMA, cost: st.cost + c + JOIN_COST + hPenalty, pend: ml });
            if (st.pend === 'മ') push({ i: end, out: st.out + 'ം', cost: st.cost + c + 0.4, pend: ml }); // anusvara before consonant
          } else {
            push({ i: end, out: st.out, cost: st.cost + c, pend: ml });
          }
        }
      }
      if (!matched) {
        // digits, stray symbols: close any pending consonant and keep the character
        const base = st.pend ? (st.pend.length === 1 && FINAL[st.pend] ? FINAL[st.pend][0][0] : st.pend + VIRAMA) : '';
        push({ i: st.i + 1, out: st.out + base + w[st.i], cost: st.cost + 0.5, pend: '' });
      }
    }
    frontier = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, BEAM);
  }
  return [...done.entries()]
    .map(([text, cost]) => ({ text: text.normalize('NFC'), cost }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, limit);
}

// ---------------------------------------------------------------- lexicon
/** @type {Map<string, string> | null} */
let lexIndex = null;
export function lookupWord(word) {
  if (!lexIndex) {
    lexIndex = new Map();
    for (const [k, v] of Object.entries(WORDS)) lexIndex.set(skeleton(k), v);
  }
  return lexIndex.get(skeleton(word)) || null;
}

/** @type {Map<string, string> | null} */
let phraseIndex = null;
/** Whole-phrase lookup in the title/author dictionary ("randamoozham" -> രണ്ടാമൂഴം). */
export function lookupPhrase(text) {
  if (!phraseIndex) {
    phraseIndex = new Map();
    for (const e of DICTIONARY) for (const s of [e.en, ...e.aliases]) phraseIndex.set(skeletonCompact(s), e.ml);
  }
  return phraseIndex.get(skeletonCompact(text)) || null;
}

/**
 * Ranked Malayalam candidates for a Manglish phrase.
 * @param {string} text
 * @param {{limit?: number, perWord?: number}} [opts]
 * @returns {{text: string, cost: number, confidence: number, fromLexicon: boolean}[]}
 */
export function manglishCandidates(text, { limit = 5, perWord = 4 } = {}) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const phrase = /[a-z]/i.test(text) ? lookupPhrase(text) : null;
  /** @type {{text: string, cost: number, lex: boolean}[]} */
  let combos = [{ text: '', cost: 0, lex: true }];
  for (const w of words) {
    if (!/[a-z]/i.test(w)) { // already Malayalam / digits: keep as is
      combos = combos.map((c) => ({ ...c, text: c.text ? `${c.text} ${w}` : w }));
      continue;
    }
    const lex = lookupWord(w);
    /** @type {{text: string, cost: number, lex: boolean}[]} */
    const opts = [];
    if (lex) opts.push({ text: lex, cost: 0, lex: true });
    for (const c of wordCandidates(w, perWord)) {
      if (c.text !== lex) opts.push({ text: c.text, cost: c.cost + (lex ? 0.6 : 0), lex: false });
    }
    const next = [];
    for (const c of combos) for (const o of opts) next.push({ text: c.text ? `${c.text} ${o.text}` : o.text, cost: c.cost + o.cost, lex: c.lex && o.lex });
    combos = next.sort((a, b) => a.cost - b.cost).slice(0, Math.max(limit * 3, 12));
  }
  if (phrase) combos.unshift({ text: phrase, cost: -1, lex: true });
  const seen = new Set();
  return combos
    .filter((c) => (seen.has(c.text) ? false : (seen.add(c.text), true)))
    .slice(0, limit)
    .map((c) => ({
      text: c.text,
      cost: c.cost,
      fromLexicon: c.lex,
      confidence: c.lex ? 0.95 : Math.max(0.15, Math.min(0.7, Math.exp(-c.cost / Math.max(1, words.length)) * 0.7)),
    }));
}

export function manglishToMalayalam(text) {
  return manglishCandidates(text, { limit: 1 })[0]?.text || '';
}

/** Old-style chillu (consonant + virama + ZWJ), common in older Internet Archive metadata. */
export function toOldChillu(s) {
  const map = { 'ൻ': 'ന്‍', 'ൺ': 'ണ്‍', 'ർ': 'ര്‍', 'ൽ': 'ല്‍', 'ൾ': 'ള്‍', 'ൿ': 'ക്‍' };
  return String(s).replace(/[ൻൺർൽൾൿ]/g, (c) => map[c]);
}

/** Romanised Malayalam (vs. Malayalam script)? Cheap check used to decide whether to transliterate. */
export function looksManglish(s) {
  const t = String(s ?? '').trim();
  return /[a-z]/i.test(t) && /^[a-z\s.'\-0-9]{2,}$/i.test(t) && !hasMalayalam(t);
}
