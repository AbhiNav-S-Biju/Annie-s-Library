// Internet Archive: search (advancedsearch), item metadata, and page images.
import { CONFIG } from '../config.js';
import { getJSON } from '../net.js';
import { guessCategory } from '../categories.js';

const BASE = 'https://archive.org';
const LANG = 'language:(mal OR malayalam OR Malayalam OR "Malayalam language")';
// Openly readable only: not lending/borrow restricted, and has page images.
const OPEN = '-access-restricted-item:true AND format:("Single Page Processed JP2 ZIP")';

const CATEGORY_QUERY = {
  novels: 'subject:(novel OR നോവൽ OR നോവല്‍ OR fiction)',
  poetry: 'subject:(poetry OR poem OR poems OR കവിത OR kavitha OR കാവ്യം)',
  'short-stories': 'subject:("short stories" OR stories OR കഥ OR കഥകൾ OR കഥകള്‍)',
  childrens: 'subject:(children OR juvenile OR ബാലസാഹിത്യം OR "children\'s literature")',
  history: 'subject:(history OR ചരിത്രം OR biography OR ജീവചരിത്രം)',
  religion: 'subject:(religion OR hinduism OR christianity OR islam OR ഭക്തി OR ramayana OR bhagavatam OR vedas OR bible OR quran)',
  drama: 'subject:(drama OR play OR plays OR നാടകം OR nadakam OR natakam)',
};

const FIELDS = ['identifier', 'title', 'creator', 'date', 'year', 'subject', 'description', 'downloads', 'licenseurl'];

function escapeTerm(s) {
  return s.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Build a Lucene query: every word must hit title/creator/subject; long words get ~1 fuzziness. */
function termClause(text, field = 'all') {
  const words = escapeTerm(text).split(' ').filter(Boolean).slice(0, 6);
  if (!words.length) return '';
  const fuzzy = (w) => (/^[a-z]+$/i.test(w) && w.length >= 5 ? `(${w} OR ${w}~1)` : w);
  const all = words.map(fuzzy).join(' AND ');
  if (field === 'author') {
    // Ignore initials ("O. Chandu Menon" -> chandu menon) and also try the run-together spelling
    // IA uploaders often use ("Chandumenon", "Kumaranasan").
    const names = words.filter((w) => w.replace(/\./g, '').length > 1).map((w) => w.replace(/\./g, ''));
    if (!names.length) return `creator:(${all})`;
    const parts = [`creator:(${names.map(fuzzy).join(' AND ')})`];
    if (names.length > 1) parts.push(`creator:(${names.join('')})`);
    return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
  }
  return `(title:(${all}) OR creator:(${all}) OR subject:(${all}))`;
}

/**
 * @param {{text?: string, altTexts?: string[], category?: string, rows?: number, signal?: AbortSignal}} opts
 * altTexts: extra spellings (e.g. Manglish transliterated to Malayalam) OR-ed with the text.
 */
export async function searchIA({ text = '', altTexts = [], category = 'all', field = 'all', sort = 'relevance', rows = CONFIG.search.iaRows, signal } = {}) {
  const clauses = [text, ...altTexts].map((t) => termClause(t, field)).filter(Boolean);
  const parts = [LANG, 'mediatype:texts', OPEN, ...(CONFIG.iaExclude || [])];
  if (clauses.length) parts.unshift(clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0]);
  if (category && CATEGORY_QUERY[category]) parts.push(CATEGORY_QUERY[category]);
  const q = parts.join(' AND ');

  const params = new URLSearchParams({ q, rows: String(rows), page: '1', output: 'json' });
  FIELDS.forEach((f) => params.append('fl[]', f));
  // Year sorts are done server-side so you get e.g. the oldest matches overall, not just the
  // oldest of the 36 most-downloaded. IA puts undated items last.
  if (sort === 'year-asc' || sort === 'year-desc') {
    // Some uploaders enter Kollam-era (ME) or Hijri years (e.g. 1103, 1417), which would swamp
    // "oldest first". Keep plausible Gregorian years plus undated items.
    params.set('q', `${q} AND (year:[1700 TO 2100] OR (*:* -year:[* TO *]))`);
    params.append('sort[]', `year ${sort === 'year-asc' ? 'asc' : 'desc'}`);
  } else {
    params.append('sort[]', 'downloads desc');
  }
  const url = `${BASE}/advancedsearch.php?${params}`;

  const data = await getJSON(url, { ttl: CONFIG.search.cacheTtlMs, signal });
  const docs = data?.response?.docs || [];
  return docs.map(docToBook).filter(Boolean);
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const joinAll = (v) => (Array.isArray(v) ? v.join(', ') : v || '');

function isInCopyright(creator) {
  const c = (creator || '').toLowerCase();
  return CONFIG.inCopyrightAuthors.some((a) => c.includes(a));
}

export function docToBook(d) {
  const id = d.identifier;
  if (!id || CONFIG.blockedArchiveIds.includes(id)) return null;
  const author = cleanAuthor(joinAll(d.creator));
  const subjects = [].concat(d.subject || []);
  const readable = !isInCopyright(author);
  return {
    key: 'ia:' + id,
    source: 'ia',
    archiveId: id,
    title: cleanTitle(first(d.title) || id),
    author,
    year: yearOf(d.year || d.date),
    description: stripHtml(first(d.description) || ''),
    coverUrl: `${BASE}/services/img/${encodeURIComponent(id)}`,
    category: guessCategory(subjects.join(' ') + ' ' + (first(d.title) || '')),
    state: readable ? 'READ' : 'BUY',
    downloads: d.downloads || 0,
    // In-copyright author: show as catalog-only and never link to the upload itself.
    link: readable ? `${BASE}/details/${encodeURIComponent(id)}` : null,
    ...(readable ? {} : { archiveId: undefined, coverUrl: null, key: 'iacat:' + id }),
  };
}

function cleanTitle(t) { return String(t).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }
function cleanAuthor(a) { return String(a).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(); }
// Years before 1700 are almost always Kollam-era or Hijri dates typed as Gregorian; treat as unknown.
function yearOf(v) { const m = String(first(v) || '').match(/\d{4}/); const y = m ? +m[0] : null; return y && y >= 1700 && y <= 2100 ? y : null; }
export function stripHtml(s) {
  try {
    const d = new DOMParser().parseFromString(String(s), 'text/html');
    return (d.body.textContent || '').replace(/\s+\n/g, '\n').trim();
  } catch { return String(s); }
}

/**
 * Everything the reader needs for an item: page count, page-image URL builder, basic metadata.
 * Throws if the item has no openly readable page images.
 */
/** Slimmed item metadata (title, description, page-image info). Cached for a week. */
export function getItemMeta(id, { signal } = {}) {
  return getJSON(`${BASE}/metadata/${encodeURIComponent(id)}`, {
    ttl: CONFIG.search.metaCacheTtlMs,
    signal,
    map: slimMetadata,
  });
}

export async function getBookManifest(id, { signal } = {}) {
  if (CONFIG.blockedArchiveIds.includes(id)) throw new Error('This item is not available in the app.');
  const meta = await getItemMeta(id, { signal });
  if (!meta || !meta.exists) throw new Error('Item not found on Internet Archive.');
  if (meta.restricted) throw new Error('This item is lending-only on Internet Archive, so it cannot be read here.');
  if (!meta.sub) throw new Error('No page images for this item (it may be a PDF-only upload).');

  let count = 0, aspect = 0;
  // 1) BookReader manifest: page count + page dimensions in one call.
  if (meta.server && meta.dir) {
    try {
      const qs = new URLSearchParams({ id, itemPath: meta.dir, server: meta.server, format: 'json', subPrefix: meta.sub });
      const br = await getJSON(`https://${meta.server}/BookReader/BookReaderJSIA.php?${qs}`, {
        ttl: CONFIG.search.metaCacheTtlMs,
        cacheKey: 'brjsia:' + id,
        signal,
        map: (d) => {
          const pages = (d?.data?.brOptions?.data || []).flat();
          const mid = pages[Math.min(pages.length - 1, 3)];
          return { n: pages.length, aspect: mid && mid.width && mid.height ? mid.width / mid.height : 0 };
        },
      });
      count = br.n;
      if (br.aspect > 0.35 && br.aspect < 1.6) aspect = br.aspect;
    } catch { /* fall back below */ }
  }
  // 2) _page_numbers.json  3) imagecount
  if (!count && meta.pageNumbersFile) {
    try {
      const pn = await getJSON(`${BASE}/download/${encodeURIComponent(id)}/${encodePath(meta.pageNumbersFile)}`, {
        ttl: CONFIG.search.metaCacheTtlMs,
        signal,
        map: (d) => ({ n: (d.pages || []).length }),
      });
      count = pn.n;
    } catch { /* fall back below */ }
  }
  if (!count) count = meta.imagecount || 0;
  if (!count) throw new Error('Could not work out how many pages this book has.');

  const sub = meta.sub;
  return {
    ...meta,
    id,
    count,
    aspect,
    pageUrl(i, w = CONFIG.reader.pageWidthPx) {
      return `${BASE}/download/${encodeURIComponent(id)}/${encodePath(sub)}/page/n${i}_w${Math.round(w)}.jpg`;
    },
  };
}

function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

function slimMetadata(d) {
  if (!d || !d.metadata) return { exists: false };
  const m = d.metadata;
  const files = d.files || [];
  const jp2 = files.find((f) => /_jp2\.(zip|tar)$/.test(f.name));
  const sub = jp2 ? jp2.name.replace(/_jp2\.(zip|tar)$/, '') : null;
  const pnf = sub && files.find((f) => f.name === `${sub}_page_numbers.json`);
  return {
    exists: true,
    title: cleanTitle(first(m.title) || ''),
    author: cleanAuthor(joinAll(m.creator)),
    year: yearOf(m.year || m.date),
    description: stripHtml(joinAll(m.description)).slice(0, 4000),
    subjects: [].concat(m.subject || []).slice(0, 20),
    licenseurl: m.licenseurl || '',
    restricted: String(m['access-restricted-item']) === 'true',
    imagecount: +m.imagecount || 0,
    sub,
    pageNumbersFile: pnf ? pnf.name : null,
    server: d.server || null,
    dir: d.dir || null,
  };
}
