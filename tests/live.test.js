// Live API checks against the real Internet Archive / Open Library / Google Books.
// Skipped unless LIVE=1 (they need network and depend on third-party data):
//   LIVE=1 npm run test:live
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { intelligentSearch, resetCooldowns } from '../js/search/intelligentSearch.js';
import { resultCache } from '../js/search/searchCache.js';

const live = process.env.LIVE === '1';
before(() => { resultCache.clear(); resetCooldowns(); });

function search(text, field = 'all') {
  return new Promise((resolve) => {
    intelligentSearch({ text, field, featured: [], onUpdate: (u) => { if (!u.pending.length) resolve(u); } });
  });
}
const titles = (u) => u.books.map((b) => `${b.title} | ${b.author} [${b.state}; ${b.sources.join('+')}]`);

const AADU = (b) => /aadujeevitham|aatujeevitham|ആടുജീവിതം/i.test(b.title) && /benyamin|ബെന്യാമിൻ/i.test(b.author);
const RANDAM = (b) => /randamoozham|rantamulam|ranṭāmūl|raṇṭāmūḻ|raṇṭāmūl|രണ്ടാമൂഴം/i.test(b.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ṇṭāūḻ]/g, (c) => c)) || (/vasudevan/i.test(b.author) && /r.?a.?n.?t/i.test(b.title.normalize('NFD').replace(/[̀-ͯ]/g, '')));
const CHEMMEEN = (b) => /chemmeen|cemmin|ചെമ്മീൻ/i.test(b.title.normalize('NFD').replace(/[̀-ͯ]/g, '')) && /thakazhi|takal|തകഴി|sivasankara|sivasank|śivaśaṅ/i.test(b.author.normalize('NFD').replace(/[̀-ͯ]/g, ''));

const cases = [
  // [query, field, predicate for the book we expect, max rank it should appear at]
  ['ആടുജീവിതം', 'all', AADU, 3],
  ['aadujeevitham', 'all', AADU, 3],
  ['aadjeevitham', 'all', AADU, 3],
  ['aadu jeevitham', 'all', AADU, 3],
  ['randamoozham', 'all', RANDAM, 5],
  ['randamuzham', 'all', RANDAM, 5],
  ['chemmeen', 'all', CHEMMEEN, 3],
  ['aadu', 'all', AADU, 10],
];
for (const [q, field, pred, maxRank] of cases) {
  test(`live: ${q} (${field})`, { skip: !live && 'set LIVE=1 to run', timeout: 60000 }, async () => {
    const u = await search(q, field);
    console.log(`\n${q}: ${u.books.length} results; errors: ${Object.keys(u.errors).join(',') || 'none'}\n  ` + titles(u).slice(0, 6).join('\n  '));
    const rank = u.books.findIndex(pred);
    assert.ok(rank >= 0, 'expected book not found');
    assert.ok(rank < maxRank, `expected book at rank ${rank + 1}, wanted top ${maxRank}`);
  });
}

test('live: Benyamin (author) lists Benyamin, not Benjamin Bailey', { skip: !live && 'set LIVE=1 to run', timeout: 60000 }, async () => {
  const u = await search('Benyamin', 'author');
  console.log(`\nBenyamin (author): ${u.books.length}\n  ` + titles(u).slice(0, 6).join('\n  '));
  assert.ok(u.books.length > 0);
  const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  assert.ok(u.books.every((b) => /benyamin|ബെന്യാമിൻ/i.test(plain(b.author))), 'only books by Benyamin');
});

test('live: aadu does not match ആട്ടക്കഥ via a conjunct', { skip: !live && 'set LIVE=1 to run', timeout: 60000 }, async () => {
  const u = await search('aadu');
  const first = u.books.slice(0, 3).map((b) => b.title).join(' | ');
  assert.ok(!/ആട്ടക്കഥ/.test(first), first);
});

test('live: ജീവി (partial Malayalam) finds titles containing it', { skip: !live && 'set LIVE=1 to run', timeout: 60000 }, async () => {
  const u = await search('ജീവി');
  console.log(`\nജീവി: ${u.books.length}\n  ` + titles(u).slice(0, 4).join('\n  '));
  assert.ok(u.books.length > 0 && u.books.slice(0, 5).every((b) => /ജീവി/.test(b.title + ' ' + (b.altTitles || []).join(' '))));
});
