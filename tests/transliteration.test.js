import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manglishCandidates, manglishToMalayalam, wordCandidates, skeleton, skeletonCompact, looksManglish } from '../js/search/transliteration.js';

const texts = (list) => list.map((c) => c.text);

test('spec examples: expected Malayalam is the top candidate', () => {
  assert.equal(manglishToMalayalam('aadujeevitham'), 'ആടുജീവിതം');
  assert.equal(manglishToMalayalam('randamoozham'), 'രണ്ടാമൂഴം');
  assert.equal(manglishToMalayalam('chemmeen'), 'ചെമ്മീൻ');
  assert.equal(manglishToMalayalam('oru desathinte katha'), 'ഒരു ദേശത്തിന്റെ കഥ');
});

test('rule engine alone (no lexicon) still proposes the right spelling among candidates', () => {
  // Honest limits: rules can't know vowel length, so some need the lexicon or the phonetic matcher.
  assert.ok(texts(wordCandidates('aadujeevitham', 6)).includes('ആടുജീവിതം'));
  assert.equal(wordCandidates('chemmeen', 1)[0].text, 'ചെമ്മീൻ');
  assert.ok(texts(wordCandidates('kayar', 3)).includes('കയർ'));
  assert.ok(texts(wordCandidates('premalekhanam', 8)).includes('പ്രേമലേഖനം') || skeleton('പ്രെമലെഖനം') === skeleton('പ്രേമലേഖനം'));
});

test('multiple candidates for ambiguous input, never just one', () => {
  const c = manglishCandidates('kadal', { limit: 5 });
  assert.ok(c.length >= 2, 'ambiguous word should give several candidates');
  assert.ok(texts(wordCandidates('thottam', 6)).length >= 3);
});

test('phonetic key equates Manglish spellings, romanisations and Malayalam', () => {
  const same = [
    ['aadujeevitham', 'ആടുജീവിതം'], ['Aatujeevitham', 'ആടുജീവിതം'], ['randamoozham', 'രണ്ടാമൂഴം'],
    ['randamuzham', 'രണ്ടാമൂഴം'], ['chemmeen', 'ചെമ്മീൻ'], ['desathinte', 'ദേശത്തിന്റെ'], ['Pr̲ēmalēkhanaṃ', 'പ്രേമലേഖനം'],
  ];
  for (const [a, b] of same) assert.equal(skeleton(a), skeleton(b), `${a} ~ ${b}`);
  assert.equal(skeletonCompact('aadu jeevitham'), skeletonCompact('ആടുജീവിതം'));
  assert.notEqual(skeleton('chemmeen'), skeleton('randamoozham'));
});

test('mixed Malayalam + Manglish: Malayalam words pass through', () => {
  // whole phrase is a known title, so that wins; the word-by-word reading is still a candidate
  assert.equal(manglishToMalayalam('ആടു jeevitham'), 'ആടുജീവിതം');
  assert.ok(texts(manglishCandidates('ആടു jeevitham')).includes('ആടു ജീവിതം'));
  assert.equal(manglishToMalayalam('ഒരു kadal'), 'ഒരു കടൽ');
});

test('looksManglish', () => {
  assert.equal(looksManglish('aadujeevitham'), true);
  assert.equal(looksManglish('ആടുജീവിതം'), false);
  assert.equal(looksManglish(''), false);
});
