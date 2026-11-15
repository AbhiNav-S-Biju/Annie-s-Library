import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { scoreBooks, titleParts } from '../js/search/relevanceScorer.js';
import { mergeResults, rankBooks, sameBook } from '../js/search/mergeResults.js';
import { generateSearchVariants } from '../js/search/queryExpansion.js';
import { loadFuse } from '../js/search/fuzzyMatcher.js';
import { MATCH } from '../js/search/searchTypes.js';
import { CONFIG } from '../js/config.js';
import { CORPUS, book } from './fixtures.js';

before(async () => { await loadFuse(); });

/** search the fixture corpus the way intelligentSearch does (minus the network) */
function run(text, field = 'all') {
  const variants = generateSearchVariants(text, { field });
  const merged = mergeResults([CORPUS]);
  const scores = scoreBooks(merged, variants, { field });
  const kept = merged.filter((b) => (scores.get(b.key)?.score ?? 0) >= CONFIG.search.minRelevance);
  return { books: rankBooks(kept, scores), scores, merged };
}
const top = (r) => r.books[0];
const has = (r, re) => r.books.some((b) => re.test(b.title));

test('A. exact Malayalam title ranks the matching book with an exact match', () => {
  const r = run('ആടുജീവിതം');
  const ml = r.books.find((b) => /ആടുജീവിതം|Aadujeevitham|Aatujeevitham/.test(b.title));
  assert.ok(ml);
  assert.equal(r.scores.get(ml.key).matchType, MATCH.EXACT_TITLE);
});

test('B. Manglish finds the Malayalam book (aadujeevitham, randamoozham, chemmeen)', () => {
  assert.ok(has(run('aadujeevitham'), /ആടുജീവിതം|Aadujeevitham/));
  assert.ok(has(run('randamoozham'), /Randamoozham/));
  assert.ok(has(run('chemmeen'), /ചെമ്മീൻ/));
});

test('C. spelling mistakes still find the book (aadjeevitham, randamuzham)', () => {
  assert.ok(has(run('aadjeevitham'), /ആടുജീവിതം|Aadujeevitham/));
  assert.ok(has(run('randamuzham'), /Randamoozham/));
});

test('D. spacing variations give the same top result', () => {
  const a = top(run('aadu jeevitham'));
  const b = top(run('aadujeevitham'));
  assert.equal(a.key, b.key);
});

test('E. author search: Benyamin lists his books, nothing else', () => {
  const r = run('Benyamin', 'author');
  assert.ok(r.books.length >= 2);
  assert.ok(r.books.every((b) => /Benyamin|ബെന്യാമിൻ/.test(b.author)));
});

test('F. partial queries: aadu and ജീവി', () => {
  assert.ok(has(run('aadu'), /ആടുജീവിതം|Aadujeevitham/));
  assert.ok(has(run('aadu'), /പാത്തുമ്മയുടെ ആട്/));
  const j = run('ജീവി');
  assert.ok(has(j, /ആടുജീവിതം/));
  assert.ok(has(j, /വന്യ ജീവി/));
});

test('G. no matching books -> empty, not junk', () => {
  assert.equal(run('zzqxv').books.length, 0);
  assert.equal(run('quantum chromodynamics').books.length, 0);
});

test('G. mixed Malayalam and English query', () => {
  assert.ok(has(run('ആടുജീവിതം Benyamin'), /ആടുജീവിതം|Aadujeevitham/));
});

test('G. special characters are ignored', () => {
  assert.equal(top(run('***ചെമ്മീൻ!!!')).key, 'ia:chemmeen');
});

test('exact title beats approximate matches', () => {
  const books = [
    book({ key: 'x1', title: 'Kayar', state: 'BUY' }),
    book({ key: 'x2', title: 'Kayaru', state: 'BUY' }),
    book({ key: 'x3', title: 'Kaayal', state: 'BUY' }),
  ];
  const scores = scoreBooks(books, generateSearchVariants('Kayar'));
  assert.ok(scores.get('x1').score > (scores.get('x2')?.score ?? 0));
  assert.ok(scores.get('x1').score > (scores.get('x3')?.score ?? 0));
});

test('availability groups: featured > READ > PREVIEW > BUY, relevance within a group', () => {
  const books = [
    book({ key: 'b', title: 'Kayar', state: 'BUY' }),
    book({ key: 'p', title: 'Kayar novel', state: 'PREVIEW' }),
    book({ key: 'r', title: 'Kayar katha', state: 'READ' }),
    book({ key: 'f', title: 'Kayar', state: 'READ', featured: true }),
  ];
  const ranked = rankBooks(books, scoreBooks(books, generateSearchVariants('kayar')));
  assert.deepEqual(ranked.map((b) => b.key), ['f', 'r', 'p', 'b']);
});

test('G. duplicates from several sources merge into one card with combined metadata', () => {
  const merged = mergeResults([[CORPUS[0]], [CORPUS[1]], [CORPUS[2]]]);
  assert.equal(merged.length, 1, 'IA catalogue + Open Library + Google record of the same novel');
  assert.equal(merged[0].state, 'PREVIEW', 'best availability wins');
  assert.deepEqual(merged[0].sources.sort(), ['google', 'ia', 'openlibrary']);
});

test('unrelated books with similar titles are not merged', () => {
  assert.equal(sameBook(book({ title: 'Kayar', author: 'Thakazhi' }), book({ title: 'Kayal', author: 'Someone Else' })), false);
  assert.equal(sameBook(book({ title: 'Ente Katha', author: 'Madhavikutty' }), book({ title: 'Ente Katha', author: 'A. P. Udayabhanu' })), false);
  assert.equal(sameBook(book({ archiveId: 'a', title: 'X' }), book({ archiveId: 'b', title: 'X' })), false, 'different scans are editions');
});

test('titleParts understands catalogue title formats', () => {
  assert.deepEqual(titleParts('ഇന്ദുലേഖ (Indulekha)').slice(0, 2), ['ഇന്ദുലേഖ', 'Indulekha']);
  assert.ok(titleParts('Aadujeevitham By Benyamin').includes('Aadujeevitham'));
  assert.equal(titleParts('1889 - ഇന്ദുലെഖ - ഒന്നാം പതിപ്പ്')[0], 'ഇന്ദുലെഖ');
});
