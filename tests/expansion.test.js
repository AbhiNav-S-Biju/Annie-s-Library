import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateSearchVariants, didYouMean, findDictionaryMatches } from '../js/search/queryExpansion.js';
import { normaliseQuery } from '../js/search/normaliseQuery.js';
import { loadFuse, usingFuse } from '../js/search/fuzzyMatcher.js';
import { getSuggestions } from '../js/search/suggestions.js';
import { CONFIG } from '../js/config.js';

before(async () => { await loadFuse(); });

const texts = (v) => v.map((x) => x.text);

test('Fuse.js is the fuzzy engine in tests', () => assert.equal(usingFuse(), true));

test('variants: original, normalised, compact, transliteration', () => {
  const v = generateSearchVariants('Aadu  Jeevitham');
  assert.equal(v[0].kind, 'original');
  assert.equal(v[0].text, 'Aadu Jeevitham', 'original kept as typed (its normalised form is the same variant)');
  assert.ok(texts(v).includes('aadujeevitham'));
  assert.ok(texts(v).includes('ആടുജീവിതം'));
  assert.ok(v.length <= CONFIG.search.maxVariants);
  assert.equal(new Set(texts(v).map((t) => t.toLowerCase())).size, v.length, 'deduplicated');
});

test('Manglish queries expand to the Malayalam spelling', () => {
  for (const [q, ml] of [['aadujeevitham', 'ആടുജീവിതം'], ['randamoozham', 'രണ്ടാമൂഴം'], ['chemmeen', 'ചെമ്മീൻ'], ['oru desathinte katha', 'ഒരു ദേശത്തിന്റെ കഥ']]) {
    assert.ok(texts(generateSearchVariants(q)).includes(ml), `${q} -> ${ml}`);
  }
});

test('spelling mistakes: aadjeevitham and randamuzham', () => {
  assert.equal(didYouMean('aadjeevitham')?.entry.ml, 'ആടുജീവിതം');
  assert.ok(texts(generateSearchVariants('aadjeevitham')).includes('ആടുജീവിതം'));
  // randamuzham is phonetically identical to randamoozham, so it is an exact (not a "did you mean") match
  assert.ok(texts(generateSearchVariants('randamuzham')).includes('രണ്ടാമൂഴം'));
});

test('no "did you mean" when the query is already correct or unrelated', () => {
  assert.equal(didYouMean('ആടുജീവിതം'), null);
  assert.equal(didYouMean('aadujeevitham'), null);
  assert.equal(didYouMean('oru desathinte katha'), null, 'exact match must suppress a near-miss correction');
  assert.equal(didYouMean('zzqx'), null);
  assert.equal(didYouMean('quantum physics'), null);
});

test('author: Benyamin resolves to the Malayalam name', () => {
  const v = generateSearchVariants('Benyamin', { field: 'author' });
  assert.ok(texts(v).includes('ബെന്യാമിൻ'));
  const m = findDictionaryMatches(normaliseQuery('benyamin'), { types: ['author'] });
  assert.equal(m[0]?.entry.en, 'Benyamin');
});

test('Malayalam query adds the older chillu encoding used by some catalogues', () => {
  const v = generateSearchVariants('ചെമ്മീൻ');
  assert.ok(texts(v).includes('ചെമ്മീന്‍'));
});

test('empty, spaces, special characters only', () => {
  for (const s of ['', '   ', '?!.,']) assert.deepEqual(generateSearchVariants(s), []);
});

test('suggestions: aadjeevitham -> Did you mean ആടുജീവിതം (Aadujeevitham — Benyamin)', () => {
  const s = getSuggestions('aadjeevitham');
  assert.equal(s[0].type, 'correction');
  assert.equal(s[0].label, 'ആടുജീവിതം');
  assert.match(s[0].sublabel, /Aadujeevitham — Benyamin/);
});

test('suggestions: partial input completes to known titles; nothing misleading for gibberish', () => {
  assert.ok(getSuggestions('aadu').some((x) => x.label === 'ആടുജീവിതം'));
  assert.ok(getSuggestions('ജീവി').some((x) => x.label === 'ആടുജീവിതം'));
  assert.deepEqual(getSuggestions('zzqxv'), []);
  assert.deepEqual(getSuggestions('a'), [], 'too short to suggest');
});
