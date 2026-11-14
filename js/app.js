import { CONFIG } from './config.js';
import * as store from './storage.js';
import { icons } from './icons.js';
import { runSearch, sortBooks, SORTS } from './search.js';
import { getBookManifest, getItemMeta } from './sources/ia.js';
import { getOpenLibraryDescription } from './sources/openlibrary.js';
import { openReader, escapeHtml } from './reader.js';
import { pushOverlay } from './overlay.js';
import { loadPageFlip } from './vendor.js';
import { manglishToMalayalam } from './translit.js';
import { HttpError } from './net.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = escapeHtml;

const state = {
  tab: 'library',
  query: '',
  category: 'all',
  featured: [],
  featuredError: null,
  books: [],
  pending: [],
  errors: {},
  alt: [],
  field: 'all',      // 'all' | 'author'
  sort: 'relevance', // see SORTS in search.js
  searchCtrl: null,
};

window.__mlib = state; // handy for debugging in the console

// ---------------- boot ----------------
async function init() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon] || ''; });
  $('#clear-q').innerHTML = icons.close;
  renderChips();
  initToolbar();
  applyTheme();
  bindUi();
  renderLibrary(); // skeletons right away
  await loadFeatured();
  search();
  registerSw();
  // warm the page-flip library while the user browses
  (window.requestIdleCallback || setTimeout)(() => { if (store.getSettings().flip !== false) loadPageFlip().catch(() => {}); });
}

async function loadFeatured() {
  try {
    const res = await fetch(CONFIG.featuredPath, { cache: 'no-cache' });
    if (!res.ok) throw new HttpError(res.status, CONFIG.featuredPath);
    const list = await res.json();
    state.featured = list.filter((f) => f.archiveId && !CONFIG.blockedArchiveIds.includes(f.archiveId)).map(featuredToBook);
    state.featuredError = null;
  } catch (e) {
    state.featured = [];
    state.featuredError = e;
  }
}

function featuredToBook(f) {
  const id = f.archiveId;
  return {
    key: 'ia:' + id,
    source: 'ia',
    archiveId: id,
    title: f.title || id,
    author: f.author || '',
    year: f.year || null,
    category: f.category || 'other',
    coverUrl: f.coverUrl || `https://archive.org/services/img/${encodeURIComponent(id)}`,
    description: f.note || '',
    state: 'READ',
    featured: true,
    link: `https://archive.org/details/${encodeURIComponent(id)}`,
  };
}

function bindUi() {
  const q = $('#q');
  let t;
  q.addEventListener('input', () => {
    $('#clear-q').hidden = !q.value;
    clearTimeout(t);
    t = setTimeout(() => setQuery(q.value), CONFIG.search.debounceMs);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(t); setQuery(q.value); q.blur(); }
  });
  $('#clear-q').addEventListener('click', () => { q.value = ''; $('#clear-q').hidden = true; setQuery(''); q.focus(); });

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.action === 'add-pdf') { $('#pdf-input').click(); return; }
    setTab(b.dataset.tab);
  }));
  $('#pdf-input').addEventListener('change', onPdfPicked);
  $('#theme-btn').addEventListener('click', cycleTheme);

  // card clicks (delegated)
  $('#main').addEventListener('click', (e) => {
    const card = e.target.closest('[data-book]');
    if (card) { openSheet(findBook(card.dataset.book)); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'retry') search();
    if (act.dataset.act === 'clear') { q.value = ''; $('#clear-q').hidden = true; setQuery(''); }
    if (act.dataset.act === 'all') setCategory('all');
    if (act.dataset.act === 'library') setTab('library');
    if (act.dataset.act === 'use-ml') { q.value = act.dataset.text; setQuery(q.value); }
  });
  $('#translit-hint').addEventListener('click', (e) => {
    const b = e.target.closest('[data-text]');
    if (b) { q.value = b.dataset.text; $('#clear-q').hidden = false; setQuery(q.value); }
  });

  // cover images: fade in on load, fall back to a typographic cover on failure
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (!img.classList?.contains('cover-img')) return;
    if (img.naturalWidth < 20) coverFail(img); else img.classList.add('ok');
  }, true);
  document.addEventListener('error', (e) => { if (e.target.classList?.contains('cover-img')) coverFail(e.target); }, true);

  window.addEventListener('online', () => search());
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
}

function coverFail(img) {
  img.remove();
}

/** Images served from cache can finish before our load listener sees them; settle those now. */
function settleCovers(root) {
  root.querySelectorAll('img.cover-img').forEach((img) => {
    if (!img.complete) return;
    if (img.naturalWidth >= 20) img.classList.add('ok'); else if (img.naturalWidth || img.currentSrc) coverFail(img);
  });
}

// ---------------- library / search ----------------
function setQuery(v) {
  const nv = v.trim();
  if (nv === state.query) return;
  state.query = nv;
  if (state.tab !== 'library') setTab('library');
  search();
}

function setCategory(c) {
  state.category = c;
  renderChips();
  if (state.tab === 'library') search(); else renderShelf();
}

function search() {
  state.searchCtrl?.abort();
  const ctrl = new AbortController();
  state.searchCtrl = ctrl;
  state.books = [];
  state.errors = {};
  state.pending = ['init'];
  renderLibrary();
  runSearch({
    text: state.query,
    category: state.category,
    featured: state.featured,
    field: state.field,
    sort: state.sort,
    signal: ctrl.signal,
    onUpdate: ({ books, pending, errors, alt }) => {
      if (ctrl.signal.aborted) return;
      state.books = books;
      state.pending = pending;
      state.errors = errors;
      state.alt = alt;
      renderLibrary();
    },
  });
}

function renderChips() {
  $('#chips').innerHTML = CONFIG.categories.map((c) =>
    `<button class="chip" data-cat="${c.id}" aria-pressed="${state.category === c.id}">${esc(c.label)} <small lang="ml">${esc(c.ml)}</small></button>`).join('');
  $('#chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => setCategory(b.dataset.cat)));
}

function initToolbar() {
  const saved = store.getSettings().sort;
  if (SORTS.some((s) => s.id === saved)) state.sort = saved;
  const sel = $('#sort');
  sel.innerHTML = SORTS.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  sel.value = state.sort;
  sel.addEventListener('change', () => setSort(sel.value));
  $('#scope').addEventListener('click', (e) => {
    const b = e.target.closest('[data-field]');
    if (b) setField(b.dataset.field);
  });
  renderScope();
}

function renderScope() {
  $('#scope').querySelectorAll('[data-field]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.field === state.field)));
  $('#q').placeholder = state.field === 'author'
    ? 'Author name… (e.g. Kumaran Asan, കുമാരനാശാൻ)'
    : 'തിരയുക… or type in Manglish (e.g. indulekha)';
}

function setField(f) {
  if (f === state.field) return;
  state.field = f;
  renderScope();
  if (state.query) search();
  $('#q').focus({ preventScroll: true });
}

function setSort(sort) {
  state.sort = sort;
  $('#sort').value = sort;
  store.setSetting('sort', sort);
  if (state.tab === 'library') search(); else renderShelf();
}

/** Search for everything by one author (from the detail sheet). */
function searchAuthor(author) {
  // Featured authors are "ഒ. ചന്തുമേനോൻ (O. Chandu Menon)": the Latin part matches more sources.
  const m = String(author).match(/\(([^)]+)\)/);
  const name = (m ? m[1] : String(author).split(/[,;]/)[0]).trim();
  sheetClose?.();
  state.field = 'author';
  renderScope();
  $('#q').value = name;
  $('#clear-q').hidden = false;
  state.query = '';
  setQuery(name);
}

function renderTranslitHint() {
  const hint = $('#translit-hint');
  const alt = state.query && state.alt?.length ? state.alt[0] : null;
  if (!alt) { hint.hidden = true; return; }
  hint.hidden = false;
  hint.innerHTML = `Also searching <button type="button" data-text="${esc(alt)}" lang="ml">${esc(alt)}</button>`;
}

function renderLibrary() {
  if (state.tab !== 'library') return;
  renderTranslitHint();
  const main = $('#main');
  const loading = state.pending.length > 0;
  const cat = CONFIG.categories.find((c) => c.id === state.category);
  let html = '';

  if (!state.query) {
    if (state.category === 'all') html += continueReadingSection();
    const featured = sortBooks(state.books.filter((b) => b.featured), state.sort);
    const more = sortBooks(state.books.filter((b) => !b.featured), state.sort);
    html += section('Featured', 'തിരഞ്ഞെടുത്തവ', featured, {
      loading: loading && !featured.length && !state.featured.length && !state.featuredError,
      empty: state.featuredError
        ? errorState('Couldn’t load the featured list.', `${CONFIG.featuredPath} — ${state.featuredError.message}`)
        : emptyState(`No featured books in ${cat.label}.`, 'Try another category, or browse everything below.', '<button class="btn small" data-act="all">Show all</button>'),
    });
    html += section(state.category === 'all' ? 'More free books' : `More free ${cat.label.toLowerCase()}`, 'സൗജന്യം · Internet Archive', more, {
      loading: loading && !more.length,
      empty: state.errors.ia ? sourceError('ia', state.errors.ia) : emptyState('Nothing else found here.', 'Internet Archive has no openly readable books in this category right now.'),
    });
  } else {
    const label = state.field === 'author' ? `Books by “${esc(state.query)}”` : `Results for “${esc(state.query)}”`;
    html += section(label, cat.id === 'all' ? '' : cat.label, sortBooks(state.books, state.sort), {
      loading: loading && !state.books.length,
      more: loading && state.books.length,
      empty: Object.keys(state.errors).length >= 3 || !navigator.onLine
        ? errorState(navigator.onLine ? 'Search failed on every source.' : 'You’re offline.', navigator.onLine ? 'Please try again in a moment.' : 'Your shelf and the app still work; search needs a connection.')
        : noResultsState(),
      raw: true,
    });
    html += sourceNotices();
  }
  main.innerHTML = html;
  settleCovers(main);
}

function section(title, sub, books, { loading, empty, more, raw } = {}) {
  let body;
  if (loading) body = skeletonGrid(6);
  else if (!books.length) body = empty;
  else body = `<ul class="grid" role="list">${books.map(cardHtml).join('')}${more ? skeletonCards(2) : ''}</ul>`;
  const count = !loading && books.length ? `<span class="count">${books.length}${sub ? ' · ' + esc(sub) : ''}</span>` : sub ? `<span class="count">${esc(sub)}</span>` : '';
  return `<section class="section"><div class="section-h"><h2>${raw ? title : esc(title)}</h2>${count}</div>${body}</section>`;
}

function continueReadingSection() {
  const shelf = store.getShelf();
  const reading = Object.entries(shelf)
    .filter(([, e]) => e.status === 'reading' && e.book)
    .sort((a, b) => b[1].updated - a[1].updated)
    .slice(0, 6)
    .map(([, e]) => e.book);
  if (!reading.length) return '';
  reading.forEach(rememberBook);
  return `<section class="section"><div class="section-h"><h2>Continue reading</h2><span class="count">തുടർന്ന് വായിക്കാം</span></div>
    <ul class="grid" role="list">${reading.map(cardHtml).join('')}</ul></section>`;
}

const bookIndex = new Map();
function rememberBook(b) { bookIndex.set(b.key, b); }
function findBook(key) {
  return bookIndex.get(key) || state.books.find((b) => b.key === key) || store.shelfEntry(key)?.book;
}

const BADGE = { READ: 'Read', PREVIEW: 'Preview', BUY: 'Buy' };
const COVER_COLORS = [['#7a3b0e', '#3d1d07'], ['#1f5a4a', '#0e2f26'], ['#5b2a6e', '#2c1236'], ['#25466e', '#11233a'], ['#7a2b2b', '#3a1212'], ['#4e5a1f', '#262d0d']];

function coverHtml(b, { badge = true } = {}) {
  const h = [...(b.key || b.title)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [c1, c2] = COVER_COLORS[h % COVER_COLORS.length];
  const prog = store.getProgress(b.key);
  const pct = prog && prog.total ? Math.round(((prog.page + 1) / prog.total) * 100) : 0;
  const badgeText = b.isLocal ? 'My PDF' : BADGE[b.state];
  return `<div class="cover" style="--c1:${c1};--c2:${c2}">
      <div class="fallback" aria-hidden="true"><b>${esc(b.title)}</b><span>${esc(b.author || '')}</span></div>
      ${b.coverUrl ? `<img class="cover-img" src="${esc(b.coverUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
      ${badge ? `<span class="badge ${b.isLocal ? 'MINE' : b.state}">${badgeText}</span>` : ''}
      ${pct > 1 ? `<span class="progress-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}
    </div>`;
}

function cardHtml(b) {
  rememberBook(b);
  const label = `${b.title}${b.author ? ', ' + b.author : ''}. ${b.isLocal ? 'Your PDF' : BADGE[b.state]}`;
  return `<li><button class="card" data-book="${esc(b.key)}" aria-label="${esc(label)}">
      ${coverHtml(b)}
      <span class="card-title">${esc(b.title)}</span>
      ${b.author || b.year ? `<span class="card-author">${b.year ? `<span class="card-year">${esc(b.year)}</span>${b.author ? ' · ' : ''}` : ''}${esc(b.author || '')}</span>` : ''}
    </button></li>`;
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `<li class="skel-card" aria-hidden="true"><div class="cover skel"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></li>`).join('');
}
function skeletonGrid(n) { return `<ul class="grid" aria-busy="true" aria-label="Loading">${skeletonCards(n)}</ul>`; }

function emptyState(title, text, actions = '') {
  return `<div class="state"><div class="state-icon">${icons.book}</div><p><strong>${esc(title)}</strong></p><p>${esc(text)}</p>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;
}
function errorState(title, text) {
  return `<div class="state" role="alert"><div class="state-icon">${icons.retry}</div><p><strong>${esc(title)}</strong></p><p>${esc(text)}</p>
    <div class="row"><button class="btn small" data-act="retry">${icons.retry}<span>Try again</span></button></div></div>`;
}
function sourceError(name, e) {
  return errorState(`${SOURCE_NAMES[name]} isn’t responding.`, e?.status ? `HTTP ${e.status}` : 'Check your connection and try again.');
}
function noResultsState() {
  const q = state.query;
  const ml = /[a-z]/i.test(q) ? manglishToMalayalam(q) : '';
  const storeLinks = CONFIG.stores.map((s) => `<a class="btn small outline" href="${esc(storeUrl(s, q, ''))}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('');
  return `<div class="state"><div class="state-icon">${icons.search}</div>
    <p><strong>No books found for “${esc(q)}”.</strong></p>
    <p>Check the spelling, try the author’s name, or type it in Malayalam${ml ? ` (e.g. <button class="more-link" data-act="use-ml" data-text="${esc(ml)}" lang="ml">${esc(ml)}</button>)` : ''}.</p>
    <p>Looking to buy it? Search the stores:</p><div class="row">${storeLinks}</div>
    ${state.category !== 'all' ? '<div class="row"><button class="btn small ghost" data-act="all">Search all categories</button></div>' : ''}</div>`;
}

const SOURCE_NAMES = { ia: 'Internet Archive', ol: 'Open Library', google: 'Google Books' };
function sourceNotices() {
  const notes = Object.entries(state.errors).map(([k, e]) => {
    if (k === 'google' && e?.status === 429) return 'Google Books: free daily quota used up, so previews may be missing. (Site owner: add a key in js/config.js.)';
    if (k === 'google' && e?.status === 403) return 'Google Books refused the request (check the API key restrictions in js/config.js).';
    return `${SOURCE_NAMES[k] || k} didn’t respond${e?.status ? ` (HTTP ${e.status})` : ''}; results may be incomplete.`;
  });
  return notes.length ? `<p class="notice" role="status">${notes.map(esc).join('<br>')}</p>` : '';
}

// ---------------- detail sheet ----------------
let sheetClose = null;

function openSheet(book) {
  if (!book) return;
  sheetClose?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', book.title);
  sheet.innerHTML = `<div class="sheet-grab" aria-hidden="true"></div>
    <button class="icon-btn sheet-close" aria-label="Close">${icons.close}</button>
    <div class="sheet-body"></div>`;
  document.body.append(backdrop, sheet);
  document.documentElement.classList.add('sheet-open');
  const prevFocus = document.activeElement;
  const ctrl = new AbortController();

  const close = pushOverlay(() => {
    ctrl.abort();
    sheet.classList.remove('on');
    backdrop.classList.remove('on');
    document.documentElement.classList.remove('sheet-open');
    const done = () => { sheet.remove(); backdrop.remove(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 300);
    if (sheetClose === close) sheetClose = null;
    prevFocus?.focus?.({ preventScroll: true });
    if (state.tab === 'shelf') renderShelf(); else renderLibrary(); // statuses/progress may have changed
  });
  sheetClose = close;
  backdrop.addEventListener('click', close);
  sheet.querySelector('.sheet-close').addEventListener('click', close);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  enableDragToClose(sheet, close);

  renderSheet(sheet.querySelector('.sheet-body'), book, ctrl.signal);
  settleCovers(sheet);
  requestAnimationFrame(() => { sheet.classList.add('on'); backdrop.classList.add('on'); });
  setTimeout(() => sheet.querySelector('.detail-actions .btn, .sheet-close')?.focus({ preventScroll: true }), 50);
}

function renderSheet(body, book, signal) {
  const metaBits = [book.year, catLabel(book.category), book.isLocal ? 'On this device' : null].filter(Boolean);
  const entry = store.shelfEntry(book.key);
  const prog = store.getProgress(book.key);
  body.innerHTML = `
    <div class="detail-top">
      ${coverHtml(book, { badge: false })}
      <div>
        <h2 class="detail-title">${esc(book.title)}</h2>
        ${book.author && !book.isLocal ? `<p class="detail-meta"><button class="author-link" data-author="${esc(book.author)}" aria-label="More books by ${esc(book.author)}">${esc(book.author)}</button></p>` : book.author ? `<p class="detail-meta">${esc(book.author)}</p>` : ''}
        <p class="detail-meta">${metaBits.map((m) => `<span>${esc(m)}</span>`).join('')}</p>
        <p class="detail-meta"><span class="badge ${book.isLocal ? 'MINE' : book.state}" style="position:static;display:inline-block;margin-top:6px">${book.isLocal ? 'My PDF' : BADGE[book.state]}</span></p>
      </div>
    </div>
    <div class="detail-actions">${actionsHtml(book, prog)}</div>
    <div class="status-row" role="group" aria-label="My shelf status">
      ${store.STATUSES.map((s) => `<button class="chip" data-status="${s.id}" aria-pressed="${entry?.status === s.id}">${esc(s.label)}<small lang="ml">${esc(s.ml)}</small></button>`).join('')}
    </div>
    ${entry?.bookmarks?.length ? `<p class="detail-meta" style="margin-top:12px">Bookmarks: ${entry.bookmarks.map((p) => `<button class="chip" data-goto="${p}" style="min-height:36px">p. ${p + 1}</button>`).join(' ')}</p>` : ''}
    <div class="detail-desc-wrap">${book.description ? descHtml(book.description) : book.isLocal ? '' : '<div class="skel skel-line"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div>'}</div>
    ${linksHtml(book)}
    <p class="fine">${book.isLocal
      ? 'This PDF stays on your device. Nothing is uploaded.'
      : book.state === 'READ'
        ? 'Free copy from Internet Archive. If this looks like an unauthorised copy of an in-copyright book, please report it.'
        : 'This book appears to be in copyright, so the app only links to legitimate previews and stores.'}</p>`;

  body.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    const cur = store.shelfEntry(book.key)?.status;
    const next = cur === b.dataset.status ? null : b.dataset.status;
    store.setStatus(book, next);
    body.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.status === next)));
    toast(next ? `Added to “${store.STATUSES.find((s) => s.id === next).label}”` : 'Removed from shelf');
  }));
  body.querySelector('[data-read]')?.addEventListener('click', () => openBook(book));
  body.querySelector('[data-author]')?.addEventListener('click', (e) => searchAuthor(e.currentTarget.dataset.author));
  body.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    store.setProgress(book.key, +b.dataset.goto, prog?.total || 0);
    openBook(book);
  }));
  body.querySelector('[data-remove-pdf]')?.addEventListener('click', async () => {
    const { deletePdf } = await import('./pdf.js');
    await deletePdf(book.key);
    store.setStatus(book, null);
    store.remove('progress:' + book.key);
    toast('Removed from this device');
    sheetClose?.();
  });
  body.addEventListener('click', (e) => {
    const m = e.target.closest('.more-link[data-more]');
    if (m) { m.previousElementSibling.classList.remove('clamp'); m.remove(); }
  });

  if (!book.description && !book.isLocal) loadDescription(book, signal).then((d) => {
    if (signal.aborted) return;
    const wrap = body.querySelector('.detail-desc-wrap');
    if (wrap) wrap.innerHTML = d ? descHtml(d) : '<p class="muted detail-desc">No description available.</p>';
  });
}

async function loadDescription(book, signal) {
  try {
    if (book.archiveId) {
      const m = await getItemMeta(book.archiveId, { signal });
      return m.description || '';
    }
    if (book.olKey) return await getOpenLibraryDescription(book.olKey, { signal });
  } catch { /* ignore */ }
  return '';
}

function descHtml(d) {
  const long = d.length > 420;
  return `<p class="detail-desc ${long ? 'clamp' : ''}">${esc(d)}</p>${long ? '<button class="more-link" data-more>Read more</button>' : ''}`;
}

function actionsHtml(book, prog) {
  if (book.isLocal || book.state === 'READ') {
    const label = prog && prog.page > 0 ? `Continue reading · page ${prog.page + 1}` : 'Read now';
    return `<button class="btn block" data-read>${icons.book}<span>${label}</span></button>
      ${book.isLocal ? `<button class="btn block ghost" data-remove-pdf>${icons.trash}<span>Remove from this device</span></button>` : ''}`;
  }
  if (book.state === 'PREVIEW') {
    return `<a class="btn block" href="${esc(book.previewLink)}" target="_blank" rel="noopener">${icons.eye}<span>Preview on Google Books</span></a>`;
  }
  return `<p class="detail-meta" style="margin:0">Buy a copy</p>
    <div class="store-row">${CONFIG.stores.map((s) => `<a class="btn outline" href="${esc(storeUrl(s, book.title, book.author))}" target="_blank" rel="noopener sponsored">${icons.cart}<span>${esc(s.label)}</span></a>`).join('')}</div>`;
}

function linksHtml(book) {
  const links = [];
  if (book.link) links.push(`<a class="menu-link" href="${esc(book.link)}" target="_blank" rel="noopener" style="padding:0">${icons.external}<span>View on ${esc(book.archiveId ? 'archive.org' : book.source === 'google' ? 'Google Books' : 'Open Library')}</span></a>`);
  if (book.state === 'READ' && !book.isLocal) links.push(`<a class="menu-link" href="${esc(reportUrl(book))}" target="_blank" rel="noopener" style="padding:0">${icons.flag}<span>Report bad scan or copyright problem</span></a>`);
  const src = (book.sources || [book.source]).map((s) => ({ ia: 'Internet Archive', google: 'Google Books', openlibrary: 'Open Library', local: 'Your device' }[s] || s));
  return `${links.join('')}<p class="sources">Sources: ${esc(src.join(', '))}</p>`;
}

function catLabel(id) { return CONFIG.categories.find((c) => c.id === id)?.label || ''; }

export function storeUrl(s, title, author) {
  const firstAuthor = String(author || '').split(/[,;]/)[0].trim();
  let t = String(title || '');
  // "Aadujeevitham By Benyamin" + "Benyamin" -> don't repeat the author
  if (firstAuthor && t.toLowerCase().includes(firstAuthor.toLowerCase())) t = t.replace(/\s+by\s+.*$/i, '');
  const q = `${t} ${t.toLowerCase().includes(firstAuthor.toLowerCase()) ? '' : firstAuthor}`.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  let url = s.url.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+'));
  const tag = CONFIG.affiliate[s.id];
  if (tag && s.affParam) url += `&${s.affParam}=${encodeURIComponent(tag)}`;
  return url;
}

export function reportUrl(book, page = null) {
  const title = `Bad scan: ${book.title}${page != null ? ` (page ${page + 1})` : ''}`;
  const body = [
    `Book: ${book.title}`,
    `Author: ${book.author || '-'}`,
    `Archive item: ${book.archiveId ? `https://archive.org/details/${book.archiveId}` : '-'}`,
    `Page: ${page != null ? page + 1 : '-'}`,
    '',
    'What is wrong? (missing / blurred / out-of-order pages, wrong book, copyright concern):',
    '',
  ].join('\n');
  const { githubRepo, reportEmail } = CONFIG.report;
  if (githubRepo) return `https://github.com/${githubRepo}/issues/new?${new URLSearchParams({ title, body, labels: 'bad-scan' })}`;
  return `mailto:${encodeURIComponent(reportEmail || '')}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function enableDragToClose(sheet, close) {
  const grab = sheet.querySelector('.sheet-grab');
  let y0 = null, dy = 0;
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
  grab.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) close();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
}

// ---------------- reading ----------------
function openBook(book) {
  if (book.isLocal) { openLocalPdf(book); return; }
  if (!book.archiveId) return;
  const id = book.archiveId;
  const source = getBookManifest(id).then((m) => ({
    count: m.count,
    aspect: m.aspect || 0,
    load: (i, o) => m.pageUrl(i, o.width),
  }));
  openReader({
    book,
    source,
    reportUrl,
    externalUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
  });
}

async function onPdfPicked(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Please choose a PDF file.'); return; }
  const { pdfKey, pdfSource, savePdf } = await import('./pdf.js');
  const book = {
    key: pdfKey(file),
    source: 'local',
    isLocal: true,
    title: file.name.replace(/\.pdf$/i, ''),
    author: 'My PDF',
    category: 'other',
    state: 'READ',
  };
  savePdf(file).then((ok) => { if (!ok) toast('Opened, but this browser can’t keep the file for later.'); });
  if (!store.shelfEntry(book.key)?.status) store.setStatus(book, 'reading');
  openReader({ book, source: pdfSource(file).catch((err) => { throw new Error(`Couldn’t read this PDF (${err.message}).`); }) });
}

async function openLocalPdf(book) {
  const { getPdf, pdfSource } = await import('./pdf.js');
  const blob = await getPdf(book.key);
  if (!blob) {
    toast('This PDF isn’t stored on this device any more. Add it again with “Add my PDF”.');
    return;
  }
  openReader({ book, source: pdfSource(blob) });
}

// ---------------- shelf ----------------
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  $('.search').hidden = tab !== 'library';
  $('#scope').hidden = tab !== 'library';
  $('#translit-hint').hidden = tab !== 'library' || !state.alt?.length || !state.query;
  if (tab === 'shelf') renderShelf(); else renderLibrary();
  window.scrollTo({ top: 0 });
}

function renderShelf() {
  const shelf = store.getShelf();
  const entries = Object.values(shelf).filter((e) => e.book && (state.category === 'all' || e.book.category === state.category));
  const groups = [
    ...['reading', 'want', 'finished'].map((id) => store.STATUSES.find((s) => s.id === id))
      .map((s) => ({ title: s.label, ml: s.ml, items: entries.filter((e) => e.status === s.id) })),
    { title: 'Bookmarked', ml: 'അടയാളപ്പെടുത്തിയവ', items: entries.filter((e) => !e.status && e.bookmarks?.length) },
  ];
  const any = groups.some((g) => g.items.length);
  let html = `<section class="section"><div class="section-h"><h2>My Shelf</h2><span class="count">എന്റെ പുസ്തകങ്ങൾ</span></div>`;
  if (!any) {
    html += emptyState(
      state.category === 'all' ? 'Your shelf is empty.' : `Nothing in ${catLabel(state.category)} on your shelf.`,
      'Open a book and mark it “Want to read”, or start reading: it appears here automatically.',
      '<button class="btn small" data-act="library">Browse the library</button>');
  }
  html += '</section>';
  for (const g of groups) {
    if (!g.items.length) continue;
    g.items.sort((a, b) => b.updated - a.updated);
    if (state.sort !== 'relevance') g.items = sortBooks(g.items.map((e) => ({ ...e.book, _e: e })), state.sort).map((b) => b._e);
    html += `<section class="section shelf-group"><div class="section-h"><h2>${esc(g.title)}</h2><span class="count">${g.items.length} · ${esc(g.ml)}</span></div>
      <ul class="grid" role="list">${g.items.map((e) => cardHtml(e.book)).join('')}</ul></section>`;
  }
  $('#main').innerHTML = html;
  settleCovers($('#main'));
}

// ---------------- theme ----------------
function applyTheme() {
  const t = store.getSettings().theme || 'system';
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  const btn = $('#theme-btn');
  btn.innerHTML = t === 'dark' ? icons.moon : t === 'light' ? icons.sun : icons.auto;
  btn.setAttribute('aria-label', `Theme: ${t === 'system' ? 'follow system' : t}. Tap to change.`);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#15120f' : '#f7f3ec'));
}
function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const cur = store.getSettings().theme || 'system';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  store.setSetting('theme', next);
  applyTheme();
  toast(next === 'system' ? 'Theme follows your device' : next === 'dark' ? 'Dark theme' : 'Light theme');
}

// ---------------- misc ----------------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function registerSw() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}

// Boot last, so every module-level const above is initialised first.
init();
