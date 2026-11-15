import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { intelligentSearch, resetCooldowns } from '../js/search/intelligentSearch.js';
import { resultCache } from '../js/search/searchCache.js';
import { CORPUS, book } from './fixtures.js';

beforeEach(() => { resultCache.clear(); resetCooldowns(); });

/** Fake sources: each returns the fixture books its name says, after a short delay. */
function fakeSources(over = {}) {
  const calls = { ia: [], ol: [], google: [] };
  const later = (v, ms = 5) => new Promise((r) => setTimeout(() => r(v), ms));
  const s = {
    ia: (o) => { calls.ia.push(o); return later(CORPUS.filter((b) => b.source === 'ia')); },
    ol: (o) => { calls.ol.push(o); return later(CORPUS.filter((b) => b.source === 'openlibrary')); },
    google: (o) => { calls.google.push(o); return later(CORPUS.filter((b) => b.source === 'google')); },
    ...over,
  };
  return { s, calls };
}

/** run a search and resolve with the last update once nothing is pending */
function search(text, opts = {}) {
  return new Promise((resolve, reject) => {
    const updates = [];
    intelligentSearch({
      text,
      featured: [],
      ...opts,
      onUpdate: (u) => { updates.push(u); if (!u.pending.length) resolve({ last: u, updates }); },
    }).catch(reject);
  });
}

test('one failing source does not block the others; error is reported', async () => {
  const { s } = fakeSources({ google: () => Promise.reject(Object.assign(new Error('boom'), { status: 500 })) });
  const { last } = await search('aadujeevitham', { sources: s });
  assert.ok(last.books.length > 0);
  assert.ok(last.errors.google);
  assert.ok(!last.errors.ia && !last.errors.ol);
});

test('all sources failing -> no books, all errors, no crash', async () => {
  const fail = () => Promise.reject(new Error('down'));
  const { last } = await search('chemmeen', { sources: { ia: fail, ol: fail, google: fail } });
  assert.equal(last.books.length, 0);
  assert.deepEqual(Object.keys(last.errors).sort(), ['google', 'ia', 'ol']);
});

test('results arrive progressively (an update per source)', async () => {
  const { s } = fakeSources();
  const { updates } = await search('aadujeevitham', { sources: s });
  assert.ok(updates.length >= 3);
  assert.ok(updates[0].pending.length > 0);
});

test('duplicates across IA, Open Library and Google merge into one card', async () => {
  const { s } = fakeSources();
  const { last } = await search('aadujeevitham', { sources: s });
  const aadu = last.books.filter((b) => /Aadujeevitham|Aatujeevitham|ആടുജീവിതം/.test(b.title));
  assert.equal(aadu.length, 1);
  assert.deepEqual(aadu[0].sources.sort(), ['google', 'ia', 'openlibrary']);
  assert.equal(aadu[0].state, 'PREVIEW');
});

test('few API calls per search, whatever the number of variants', async () => {
  const { s, calls } = fakeSources();
  await search('oru desathinte katha', { sources: s });
  assert.equal(calls.ia.length, 1);
  assert.ok(calls.ol.length <= 2);
  assert.equal(calls.google.length, 1);
  assert.ok(calls.ia[0].altTexts.includes('ഒരു ദേശത്തിന്റെ കഥ'), 'Malayalam spelling sent to IA');
  assert.ok(calls.ia[0].altTexts.length <= 4);
});

test('repeat query is served from cache (no new API calls)', async () => {
  const { s, calls } = fakeSources();
  await search('chemmeen', { sources: s });
  const before = calls.ia.length + calls.ol.length + calls.google.length;
  const { last } = await search('  Chemmeen  ', { sources: s });
  assert.equal(calls.ia.length + calls.ol.length + calls.google.length, before);
  assert.equal(last.fromCache, true);
});

test('HTTP 429 pauses that source for later searches', async () => {
  let googleCalls = 0;
  const { s } = fakeSources({ google: () => { googleCalls++; return Promise.reject(Object.assign(new Error('quota'), { status: 429 })); } });
  await search('chemmeen', { sources: s });
  await search('randamoozham', { sources: s });
  assert.equal(googleCalls, 1);
});

test('aborting stops further updates', async () => {
  const { s } = fakeSources();
  const ctrl = new AbortController();
  let after = 0;
  const p = intelligentSearch({ text: 'aadujeevitham', featured: [], sources: s, signal: ctrl.signal, onUpdate: () => { if (ctrl.signal.aborted) after++; } });
  ctrl.abort();
  await p;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(after, 0);
});

test('empty input = browse mode (featured + popular), no catalogue calls', async () => {
  const { s, calls } = fakeSources();
  const featured = [book({ key: 'f1', title: 'ഇന്ദുലേഖ', featured: true })];
  const { last } = await search('   ', { sources: s, featured });
  assert.equal(last.books[0].key, 'f1');
  assert.equal(calls.ol.length + calls.google.length, 0);
});

test('featured books only appear when they match', async () => {
  const { s } = fakeSources();
  const featured = [book({ key: 'f1', title: 'ഇന്ദുലേഖ (Indulekha)', featured: true })];
  const a = await search('indulekha', { sources: s, featured });
  assert.equal(a.last.books[0].key, 'f1');
  const b = await search('chemmeen', { sources: s, featured });
  assert.ok(!b.last.books.some((x) => x.key === 'f1'));
});

test('"No exact match" flag when only weak matches exist', async () => {
  const { s } = fakeSources();
  const { last } = await search('Essays on life', { sources: s });
  assert.equal(last.similarOnly, true);
  const ok = await search('chemmeen', { sources: s });
  assert.equal(ok.last.similarOnly, false);
});

test('author search: exact author matches exclude similar-looking names', async () => {
  const sources = {
    ia: async () => [book({ key: 'ia:bb', archiveId: 'bb', title: 'Cheru Paithangal', author: 'Benjamin Bailey' })],
    ol: async () => [book({ key: 'ol:b1', source: 'openlibrary', title: 'Aatujeevitham', author: 'Benyāmin', state: 'BUY' })],
    google: async () => [],
  };
  const { last } = await search('Benyamin', { sources, field: 'author' });
  assert.deepEqual(last.books.map((b) => b.key), ['ol:b1']);
});

test('READ / PREVIEW / BUY data survives the pipeline', async () => {
  const { s } = fakeSources();
  const { last } = await search('aadujeevitham', { sources: s });
  const b = last.books.find((x) => x.state === 'PREVIEW');
  assert.ok(b.previewLink, 'preview link kept for the PREVIEW action');
});
