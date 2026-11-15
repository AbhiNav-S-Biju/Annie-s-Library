import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseQuery, normaliseText, normaliseMalayalam } from '../js/search/normaliseQuery.js';

test('empty and whitespace-only input', () => {
  for (const s of ['', '   ', '\t\n', '!!!', null, undefined]) {
    const q = normaliseQuery(s);
    assert.equal(q.isEmpty, true, JSON.stringify(s));
    assert.equal(q.script, 'empty');
    assert.deepEqual(q.tokens, []);
  }
});

test('trims, lowercases Latin, collapses spaces, keeps the original for display', () => {
  const q = normaliseQuery('  Aadu   Jeevitham!! ');
  assert.equal(q.original, '  Aadu   Jeevitham!! ');
  assert.equal(q.display, 'Aadu Jeevitham!!');
  assert.equal(q.normalised, 'aadu jeevitham');
  assert.equal(q.compact, 'aadujeevitham');
  assert.deepEqual(q.tokens, ['aadu', 'jeevitham']);
  assert.equal(q.script, 'latin');
});

test('special characters become spaces; apostrophes join', () => {
  assert.equal(normaliseText("Annie's  Library: (Vol. 1) — ‘test’"), 'annies library vol 1 test');
  assert.equal(normaliseText('ഒരു-ദേശത്തിന്റെ_കഥ?'), 'ഒരു ദേശത്തിന്റെ കഥ');
});

test('Latin diacritics from library romanisation are stripped', () => {
  assert.equal(normaliseText('Pr̲ēmalēkhanaṃ'), 'premalekhanam');
});

test('Malayalam: NFC composes split vowel signs', () => {
  const decomposed = 'കൊ'.normalize('NFD'); // ക + െ + ാ
  assert.notEqual(decomposed, 'കൊ');
  assert.equal(normaliseMalayalam(decomposed), 'കൊ');
});

test('Malayalam: old ZWJ chillus and ൻറ unify with modern encoding, conjuncts untouched', () => {
  assert.equal(normaliseMalayalam('ചെമ്മീന്‍'), 'ചെമ്മീൻ');
  assert.equal(normaliseMalayalam('അവന്‍റെ'), 'അവന്റെ');
  assert.equal(normaliseMalayalam('കര്‍മ്മം'), 'കർമ്മം');
  // conjuncts (consonant + virama + consonant) must survive
  for (const w of ['ക്ഷേത്രം', 'ജ്ഞാനം', 'ശ്രീ', 'പ്പ', 'ന്റെ']) assert.equal(normaliseMalayalam(w), w);
});

test('Malayalam and mixed script detection', () => {
  assert.equal(normaliseQuery('ആടുജീവിതം').script, 'malayalam');
  assert.equal(normaliseQuery('ആടുജീവിതം Benyamin').script, 'mixed');
  assert.equal(normaliseQuery('ആടുജീവിതം').normalised, 'ആടുജീവിതം');
});
