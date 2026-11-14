// Malayalam <-> Latin helpers.
//  - mlToLatin: deterministic romanisation (used for fuzzy matching, not for display).
//  - manglishToMalayalam: best-guess Manglish -> Malayalam script (Mozhi-like), for searching
//    sources whose titles are in Malayalam script. Ambiguous by nature; we query with it *in addition*
//    to the original Latin text, never instead of it.
//  - skeleton: phonetic key so "aadujeevitham", "Aatujeevitham", "ആടുജീവിതം" compare equal.

const VIRAMA = '്';
const IND_VOWELS = {
  'അ': 'a', 'ആ': 'aa', 'ഇ': 'i', 'ഈ': 'ii', 'ഉ': 'u', 'ഊ': 'uu', 'ഋ': 'ru', 'എ': 'e', 'ഏ': 'ee',
  'ഐ': 'ai', 'ഒ': 'o', 'ഓ': 'oo', 'ഔ': 'au',
};
const SIGNS = {
  'ാ': 'aa', 'ി': 'i', 'ീ': 'ii', 'ു': 'u', 'ൂ': 'uu', 'ൃ': 'ru', 'െ': 'e', 'േ': 'ee', 'ൈ': 'ai',
  'ൊ': 'o', 'ോ': 'oo', 'ൌ': 'au', 'ൗ': 'au',
};
const CONS = {
  'ക': 'k', 'ഖ': 'kh', 'ഗ': 'g', 'ഘ': 'gh', 'ങ': 'ng', 'ച': 'ch', 'ഛ': 'chh', 'ജ': 'j', 'ഝ': 'jh', 'ഞ': 'nj',
  'ട': 't', 'ഠ': 'th', 'ഡ': 'd', 'ഢ': 'dh', 'ണ': 'n', 'ത': 'th', 'ഥ': 'th', 'ദ': 'd', 'ധ': 'dh', 'ന': 'n',
  'പ': 'p', 'ഫ': 'ph', 'ബ': 'b', 'ഭ': 'bh', 'മ': 'm', 'യ': 'y', 'ര': 'r', 'ല': 'l', 'വ': 'v', 'ശ': 'sh',
  'ഷ': 'sh', 'സ': 's', 'ഹ': 'h', 'ള': 'l', 'ഴ': 'zh', 'റ': 'r',
};
const CHILLU = { 'ൺ': 'n', 'ൻ': 'n', 'ർ': 'r', 'ൽ': 'l', 'ൾ': 'l', 'ൿ': 'k' };

export const hasMalayalam = (s) => /[ഀ-ൿ]/.test(s);

export function mlToLatin(s) {
  const str = String(s).replace(/[‌‍]/g, '').replace(/റ്റ/g, '').replace(/ന്റ/g, '');
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '') { out += 'tt'; continue; }
    if (c === '') { out += 'nt'; continue; }
    if (CONS[c]) {
      out += CONS[c];
      const n = str[i + 1];
      if (n && SIGNS[n]) { out += SIGNS[n]; i++; }
      else if (n === VIRAMA) { i++; }
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

/** Phonetic key for fuzzy comparison across Manglish spellings and scripts. */
export function skeleton(s) {
  let t = hasMalayalam(s) ? mlToLatin(s) : String(s);
  t = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t
    .replace(/zh/g, 'l')
    .replace(/ksh/g, 'ks')
    .replace(/x/g, 'ks')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/f/g, 'p')
    .replace(/([kgcjtdpbs])h/g, '$1') // aspirates & th/dh/sh/ch -> base
    .replace(/d/g, 't')
    .replace(/ee|ii/g, 'i')
    .replace(/oo|uu/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

// ---------- Manglish -> Malayalam ----------
// Ordered longest-first. Uppercase letters keep their Mozhi meaning (T=ട, L=ള, N=ണ, R=റ, S=ഷ).
const M_CONS = [
  ['nchh', 'ഞ്ഛ'], ['ksh', 'ക്ഷ'], ['nth', 'ന്ത'], ['nch', 'ഞ്ച'], ['chh', 'ഛ'], ['ng', 'ങ്ങ'], ['nk', 'ങ്ക'], ['nj', 'ഞ'],
  ['nt', 'ന്റ'], ['tt', 'റ്റ'], ['TT', 'ട്ട'], ['kh', 'ഖ'], ['gh', 'ഘ'], ['ch', 'ച'], ['jh', 'ഝ'], ['th', 'ത'],
  ['Th', 'ഠ'], ['dh', 'ധ'], ['Dh', 'ഢ'], ['ph', 'ഫ'], ['bh', 'ഭ'], ['sh', 'ശ'], ['zh', 'ഴ'],
  ['k', 'ക'], ['g', 'ഗ'], ['c', 'ക'], ['j', 'ജ'], ['T', 'ട'], ['t', 'ട'], ['D', 'ഡ'], ['d', 'ദ'], ['N', 'ണ'],
  ['n', 'ന'], ['p', 'പ'], ['f', 'ഫ'], ['b', 'ബ'], ['m', 'മ'], ['y', 'യ'], ['R', 'റ'], ['r', 'ര'], ['L', 'ള'],
  ['l', 'ല'], ['v', 'വ'], ['w', 'വ'], ['S', 'ഷ'], ['s', 'സ'], ['h', 'ഹ'], ['x', 'ക്സ'], ['q', 'ക്യ'], ['z', 'സ'],
];
const M_VOWELS = [ // [latin, independent, sign]
  ['aa', 'ആ', 'ാ'], ['A', 'ആ', 'ാ'], ['ai', 'ഐ', 'ൈ'], ['au', 'ഔ', 'ൌ'], ['ee', 'ഈ', 'ീ'], ['ii', 'ഈ', 'ീ'],
  ['I', 'ഈ', 'ീ'], ['oo', 'ഊ', 'ൂ'], ['uu', 'ഊ', 'ൂ'], ['U', 'ഊ', 'ൂ'], ['E', 'ഏ', 'േ'], ['O', 'ഓ', 'ോ'],
  ['a', 'അ', ''], ['i', 'ഇ', 'ി'], ['u', 'ഉ', 'ു'], ['e', 'എ', 'െ'], ['o', 'ഒ', 'ൊ'],
];
const FINAL = { 'ന': 'ൻ', 'ണ': 'ൺ', 'ര': 'ർ', 'റ': 'ർ', 'ല': 'ൽ', 'ള': 'ൾ', 'മ': 'ം' };

function matchAt(table, s, i) {
  for (const row of table) if (s.startsWith(row[0], i)) return row;
  return null;
}

function wordToMl(w) {
  // keep case only for single letters that carry meaning in Mozhi; lowercase the rest
  let s = w.length > 1 && w === w.toUpperCase() ? w.toLowerCase() : w;
  s = s.replace(/^[A-Z]/, (c) => c.toLowerCase());
  let out = '';
  let i = 0;
  let lastWasCons = false;
  let lastCons = '';
  while (i < s.length) {
    const c = matchAt(M_CONS, s, i);
    if (c) {
      if (lastWasCons) out += '്'; // conjunct
      out += c[1];
      i += c[0].length;
      lastWasCons = true;
      lastCons = c[1];
      continue;
    }
    const v = matchAt(M_VOWELS, s, i);
    if (v) {
      out += lastWasCons ? v[2] : v[1];
      i += v[0].length;
      lastWasCons = false;
      continue;
    }
    out += s[i];
    i++;
    lastWasCons = false;
  }
  if (lastWasCons) {
    // word-final consonant: chillu / anusvara where natural, else explicit virama
    const ch = FINAL[lastCons];
    out = ch ? out.slice(0, -lastCons.length) + ch : out + '്';
  }
  return out;
}

// Casual Manglish drops vowel length and retroflex marks ("malayalam" for മലയാളം), which no rule
// set can recover. A small lexicon of common literary words and names fixes the most-searched ones.
// Keys are matched by phonetic skeleton, so "aadujeevitham", "adujeevitham", "aatujivitham" all hit.
const LEXICON = {
  malayalam: 'മലയാളം', kerala: 'കേരള', keralam: 'കേരളം', sree: 'ശ്രീ', sri: 'ശ്രീ',
  ramayanam: 'രാമായണം', ramayana: 'രാമായണ', mahabharatham: 'മഹാഭാരതം', bhagavatham: 'ഭാഗവതം', bhagavad: 'ഭഗവദ്', geetha: 'ഗീത', gita: 'ഗീത',
  katha: 'കഥ', kathakal: 'കഥകൾ', kavitha: 'കവിത', kavithakal: 'കവിതകൾ', novel: 'നോവൽ', nadakam: 'നാടകം', natakam: 'നാടകം',
  charitham: 'ചരിതം', charithram: 'ചരിത്രം', sahithyam: 'സാഹിത്യം', sahitya: 'സാഹിത്യ', kilippattu: 'കിളിപ്പാട്ട്', pattu: 'പാട്ട്',
  sandesam: 'സന്ദേശം', mayurasandesam: 'മയൂരസന്ദേശം', kathakali: 'കഥകളി', aithihyamala: 'ഐതിഹ്യമാല', aitihyamala: 'ഐതിഹ്യമാല',
  indulekha: 'ഇന്ദുലേഖ', chandumenon: 'ചന്തുമേനോൻ', chandu: 'ചന്തു', menon: 'മേനോൻ', nair: 'നായർ', pillai: 'പിള്ള',
  kumaran: 'കുമാരൻ', asan: 'ആശാൻ', kumaranasan: 'കുമാരനാശാൻ', ezhuthachan: 'എഴുത്തച്ഛൻ', vallathol: 'വള്ളത്തോൾ', ulloor: 'ഉള്ളൂർ',
  kunchan: 'കുഞ്ചൻ', nambiar: 'നമ്പ്യാർ', panchatantram: 'പഞ്ചതന്ത്രം', thampuran: 'തമ്പുരാൻ', varma: 'വർമ്മ',
  buddha: 'ബുദ്ധ', budha: 'ബുദ്ധ', sreebudhacharitham: 'ശ്രീബുദ്ധചരിതം', veenapoovu: 'വീണപൂവ്', veena: 'വീണ', poovu: 'പൂവ്',
  basheer: 'ബഷീർ', vaikom: 'വൈക്കം', muhammad: 'മുഹമ്മദ്', balyakalasakhi: 'ബാല്യകാലസഖി', pathummayude: 'പാത്തുമ്മയുടെ', aadu: 'ആട്',
  aadujeevitham: 'ആടുജീവിതം', randamoozham: 'രണ്ടാമൂഴം', chemmeen: 'ചെമ്മീൻ', khasakkinte: 'ഖസാക്കിന്റെ', itihasam: 'ഇതിഹാസം',
  thakazhi: 'തകഴി', pranayam: 'പ്രണയം', mathrubhumi: 'മാതൃഭൂമി', kuttikal: 'കുട്ടികൾ', balasahithyam: 'ബാലസാഹിത്യം',
};
let lexIndex = null;
function lexLookup(word) {
  if (!lexIndex) {
    lexIndex = new Map();
    for (const [k, v] of Object.entries(LEXICON)) lexIndex.set(skeleton(k), v);
  }
  return lexIndex.get(skeleton(word));
}

export function manglishToMalayalam(text) {
  return String(text).replace(/[A-Za-z]+/g, (w) => lexLookup(w) || wordToMl(w.replace(/^sr(?=[aeiou])/i, 'shr')));
}

/** Old-style chillu (consonant + virama + ZWJ) variant, common in older IA metadata. */
export function toOldChillu(s) {
  const map = { 'ൻ': 'ന്‍', 'ൺ': 'ണ്‍', 'ർ': 'ര്‍', 'ൽ': 'ല്‍', 'ൾ': 'ള്‍', 'ൿ': 'ക്‍' };
  return String(s).replace(/[ൻൺർൽൾൿ]/g, (c) => map[c]);
}

/** Looks like romanised Malayalam (vs. an English word)? Cheap heuristic for showing the hint. */
export function looksManglish(s) {
  const t = String(s).trim();
  return /^[a-z\s.'-]{3,}$/i.test(t) && !hasMalayalam(t);
}
