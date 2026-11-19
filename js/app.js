import { CONFIG } from './config.js';
import * as store from './storage.js';
import { icons } from './icons.js';
import { intelligentSearch } from './search/intelligentSearch.js';
import { sortBooks, SORTS } from './search/mergeResults.js';
import { getSuggestions } from './search/suggestions.js';
import { normaliseText } from './search/normaliseQuery.js';
import { loadFuse } from './search/fuzzyMatcher.js';
import { getBookManifest, getItemMeta } from './sources/ia.js';
import { getOpenLibraryDescription } from './sources/openlibrary.js';
import { openReader, escapeHtml } from './reader.js';
import { pushOverlay } from './overlay.js';
import { loadPageFlip } from './vendor.js';
import { manglishToMalayalam } from './search/transliteration.js';
import { HttpError } from './net.js';
import { canDownload, downloadBook, removeOffline, offlineInfo, isDownloaded, listOffline, totalOfflineBytes, offlineSource, onOfflineChange, reconcile, fmtBytes, OfflineError } from './offlineBooks.js';
import { primeAudio, downloadComplete, soundsEnabled, setSoundsEnabled } from './sounds.js';
import { syncNewBooks, markSeen, listNotices, unreadCount, markRead, markAllRead, timeAgo } from './notifications.js';
import { listPublicBooks, publishBook, unpublishBook, fetchPublicPdf, getToken, setToken, checkToken, canPublish } from './publicBooks.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = escapeHtml;

const state = {
  tab: 'library',
  query: '',
  category: 'all',
  featured: [],
  shared: [],        // public books published by the owner (see publicBooks.js)
  featuredError: null,
  books: [],
  pending: [],
  errors: {},
  alt: [],
  didYouMean: null,  // {entry} from the dictionary, when the query looks misspelled
  similarOnly: false, // no strong match: show "No exact match found. Showing similar books."
  field: 'all',      // 'all' | 'author'
  sort: 'relevance', // see SORTS in search/mergeResults.js
  searchCtrl: null,
};

window.__mlib = state; // handy for debugging in the console
state.findBook = (key) => findBook(key);
state.checkNewBooks = (refetch = true) => checkNewBooks(refetch);

// ---------------- boot ----------------
async function init() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon] || ''; });
  $('#clear-q').innerHTML = icons.close;
  renderChips();
  initToolbar();
  applyTheme();
  bindUi();
  renderLibrary(); // skeletons right away
  initDock();
  initNotifications();
  await Promise.all([loadFeatured(), loadShared()]);
  search();
  checkNewBooks(false);
  registerSw();
  reconcile().then((gone) => { if (gone.length) renderCurrent(); }).catch(() => {});
  onOfflineChange(() => { if (!document.querySelector('.reader')) renderCurrent(); });
  loadFuse(); // fuzzy matcher for suggestions (built-in fallback is used until/unless it loads)
  // warm the page-flip library while the user browses
  (window.requestIdleCallback || setTimeout)(() => { if (store.getSettings().flip !== false) loadPageFlip().catch(() => {}); });
}

async function loadFeatured() {
  const use = (list) => {
    state.featured = list.filter((f) => f.archiveId && !CONFIG.blockedArchiveIds.includes(f.archiveId)).map(featuredToBook);
    state.featuredError = null;
  };
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      if (i) await new Promise((r) => setTimeout(r, 700 * i));
      const res = await fetch(CONFIG.featuredPath, { cache: 'no-cache' });
      if (!res.ok) throw new HttpError(res.status, CONFIG.featuredPath);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('featured list is not an array');
      use(list);
      store.set('featured-copy', list); // last good copy, for flaky networks
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  // Network failed: fall back to the last list we saw, so the shelf never comes up empty.
  const copy = store.get('featured-copy');
  if (Array.isArray(copy) && copy.length) { use(copy); return; }
  state.featured = [];
  state.featuredError = lastErr;
}

async function loadShared() {
  state.shared = await listPublicBooks();
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
    renderSuggestions(q.value); // local only: no network per keystroke
    clearTimeout(t);
    t = setTimeout(() => setQuery(q.value), CONFIG.search.debounceMs);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { moveSuggestion(e.key === 'ArrowDown' ? 1 : -1); e.preventDefault(); return; }
    if (e.key === 'Escape') { hideSuggestions(); return; }
    if (e.key === 'Enter') {
      const active = $('#suggest [aria-selected="true"]');
      clearTimeout(t);
      if (active) { active.click(); e.preventDefault(); return; }
      hideSuggestions();
      setQuery(q.value);
      q.blur();
    }
  });
  q.addEventListener('focus', () => { if (q.value.trim()) renderSuggestions(q.value); });
  q.addEventListener('blur', () => setTimeout(hideSuggestions, 180)); // let a tap on a suggestion land first
  $('#suggest').addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input while tapping
  $('#suggest').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sugg]');
    if (!b) return;
    const s = suggestionsShown[+b.dataset.sugg];
    hideSuggestions();
    if (!s) return;
    if (s.type === 'book' && s.book) { q.blur(); openSheet(s.book); return; }
    if (s.field && s.field !== state.field) { state.field = s.field; renderScope(); }
    q.value = s.value || s.label;
    $('#clear-q').hidden = false;
    clearTimeout(t);
    state.query = '';
    setQuery(q.value);
    q.blur();
  });
  $('#clear-q').addEventListener('click', () => { q.value = ''; $('#clear-q').hidden = true; hideSuggestions(); setQuery(''); q.focus(); });

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
    if (act.dataset.act === 'retry') retryAll();
    if (act.dataset.act === 'clear') { q.value = ''; $('#clear-q').hidden = true; setQuery(''); }
    if (act.dataset.act === 'all') setCategory('all');
    if (act.dataset.act === 'library') setTab('library');
    if (act.dataset.act === 'open-downloads') setTab('downloads');
    if (act.dataset.act === 'dl-clear') clearDownloads();
    if (act.dataset.act === 'use-ml') { q.value = act.dataset.text; $('#clear-q').hidden = false; setQuery(q.value); }
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

  window.addEventListener('online', () => { retryAll(); });
  window.addEventListener('offline', () => renderCurrent());
  window.addEventListener('beforeunload', (e) => { if (jobs.size) { e.preventDefault(); e.returnValue = ''; } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
}

/** "Try again" / back online: reload the featured list too if it failed, then search. */
async function retryAll() {
  if (state.featuredError || !state.featured.length) {
    state.featuredError = null;
    state.pending = ['init'];
    renderLibrary();
    await loadFeatured();
  }
  search();
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
  if (normaliseText(nv) === normaliseText(state.query) && (nv === '') === (state.query === '')) { state.query = nv; return; }
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
  intelligentSearch({
    text: state.query,
    category: state.category,
    featured: [...state.featured, ...state.shared],
    field: state.field,
    sort: state.sort,
    signal: ctrl.signal,
    onUpdate: ({ books, pending, errors, alt, didYouMean, similarOnly }) => {
      if (ctrl.signal.aborted) return;
      state.books = books;
      state.pending = pending;
      state.errors = errors;
      state.alt = alt;
      state.didYouMean = didYouMean;
      state.similarOnly = similarOnly;
      renderLibrary();
      if (document.activeElement === $('#q')) renderSuggestions($('#q').value); // real books can now be suggested
    },
  }).catch(() => { state.pending = []; state.errors = { ia: { message: 'search failed' } }; renderLibrary(); });
}

function renderChips() {
  $('#chips').innerHTML = CONFIG.categories.map((c) =>
    `<button class="chip" data-cat="${c.id}" aria-pressed="${state.category === c.id}">${esc(c.label)} <small lang="ml">${esc(c.ml)}</small></button>`).join('');
  $('#chips').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => setCategory(b.dataset.cat)));
}

// ---------------- suggestions (while typing) ----------------
let suggestionsShown = [];
const SUGG_LABEL = { correction: 'Did you mean', transliteration: 'In Malayalam', title: 'Title', book: 'Book', author: 'Author' };

function renderSuggestions(text) {
  const box = $('#suggest');
  const list = state.tab === 'library'
    ? getSuggestions(text, { field: state.field, featured: [...state.featured, ...state.shared], books: state.books })
    : [];
  suggestionsShown = list;
  if (!list.length) { hideSuggestions(); return; }
  let lastType = '';
  box.innerHTML = list.map((s, i) => {
    const head = s.type !== lastType ? `<li class="sugg-h" role="presentation">${esc(SUGG_LABEL[s.type])}</li>` : '';
    lastType = s.type;
    const icon = s.type === 'book' ? icons.book : s.type === 'author' ? icons.person : icons.search;
    return `${head}<li role="presentation"><button type="button" class="sugg" role="option" id="sugg-${i}" data-sugg="${i}" aria-selected="false">
      <span class="sugg-i">${icon}</span><span class="sugg-t"><span class="sugg-l">${esc(s.label)}</span>${s.sublabel ? `<span class="sugg-s">${esc(s.sublabel)}</span>` : ''}</span></button></li>`;
  }).join('');
  box.hidden = false;
  $('#q').setAttribute('aria-expanded', 'true');
}

function hideSuggestions() {
  const box = $('#suggest');
  box.hidden = true;
  box.innerHTML = '';
  suggestionsShown = [];
  $('#q').setAttribute('aria-expanded', 'false');
  $('#q').removeAttribute('aria-activedescendant');
}

function moveSuggestion(dir) {
  const opts = [...document.querySelectorAll('#suggest .sugg')];
  if (!opts.length) return;
  const cur = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
  const next = (cur + dir + opts.length + (cur < 0 && dir < 0 ? 1 : 0)) % opts.length;
  opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === next)));
  $('#q').setAttribute('aria-activedescendant', opts[next].id);
  opts[next].scrollIntoView({ block: 'nearest' });
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

function renderCurrent() { if (state.tab === 'shelf') renderShelf(); else if (state.tab === 'downloads') renderDownloads(); else renderLibrary(); }

function offlineBanner() {
  if (navigator.onLine || !listOffline().length) return '';
  return `<div class="notice offline-banner" role="status"><span>You’re offline. Your downloaded books are on your shelf.</span>
    <button class="btn small" data-act="open-downloads">Open downloads</button></div>`;
}

function renderLibrary() {
  if (state.tab !== 'library') return;
  renderTranslitHint();
  const main = $('#main');
  const loading = state.pending.length > 0;
  const cat = CONFIG.categories.find((c) => c.id === state.category);
  let html = offlineBanner();

  if (!state.query) {
    if (state.category === 'all') html += continueReadingSection();
    const featured = sortBooks(state.books.filter((b) => b.featured), state.sort);
    const shared = sortBooks(state.books.filter((b) => b.shared && !b.featured), state.sort);
    const more = sortBooks(state.books.filter((b) => !b.featured && !b.shared), state.sort);
    html += section('Featured', 'തിരഞ്ഞെടുത്തവ', featured, {
      loading: loading && !featured.length && !state.featured.length && !state.featuredError,
      empty: state.featuredError
        ? errorState('Couldn’t load the featured books.', navigator.onLine
          ? `Check your connection and tap Try again. (${state.featuredError.status ? `HTTP ${state.featuredError.status}` : 'network error'})`
          : 'You’re offline. They’ll appear when you’re back online.')
        : emptyState(`No featured books in ${cat.label}.`, 'Try another category, or browse everything below.', '<button class="btn small" data-act="all">Show all</button>'),
    });
    if (shared.length) html += section('Shared books', 'ഈ ലൈബ്രറിയിൽ നിന്ന്', shared, {});
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
    html = searchNotices() + html + sourceNotices();
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
  const badgeText = b.isLocal ? 'My PDF' : b.shared ? 'Shared' : BADGE[b.state];
  return `<div class="cover" style="--c1:${c1};--c2:${c2}">
      <div class="fallback" aria-hidden="true"><b>${esc(b.title)}</b><span>${esc(b.author || '')}</span></div>
      ${b.coverUrl ? `<img class="cover-img" src="${esc(b.coverUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
      ${badge ? `<span class="badge ${b.isLocal ? 'MINE' : b.shared ? 'SHARED' : b.state}">${badgeText}</span>` : ''}
      ${badge && isDownloaded(b.key) ? `<span class="offline-mark" title="Saved for offline reading" aria-hidden="true">${icons.offline}</span>` : ''}
      ${pct > 1 ? `<span class="progress-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}
    </div>`;
}

function cardHtml(b) {
  rememberBook(b);
  const label = `${b.title}${b.author ? ', ' + b.author : ''}. ${b.isLocal ? 'Your PDF' : b.shared ? 'Shared book' : BADGE[b.state]}${isDownloaded(b.key) ? '. Saved offline' : ''}`;
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

function searchNotices() {
  if (state.pending.length && !state.books.length) return '';
  const parts = [];
  const dym = state.didYouMean?.entry;
  if (dym && normaliseText(dym.ml) !== normaliseText(state.query)) {
    parts.push(`<p class="notice dym">Did you mean <button class="more-link" data-act="use-ml" data-text="${esc(dym.ml)}" lang="ml">${esc(dym.ml)}</button>${dym.en ? ` <span class="muted">(${esc(dym.en)})</span>` : ''}?</p>`);
  }
  if (state.similarOnly && state.books.length && !state.pending.length) {
    parts.push('<p class="notice" role="status">No exact match found. Showing similar books.</p>');
  }
  return parts.join('');
}

const SOURCE_NAMES = { ia: 'Internet Archive', ol: 'Open Library', google: 'Google Books' };
function sourceNotices() {
  const notes = Object.entries(state.errors).map(([k, e]) => {
    if (k === 'google' && e?.status === 429) return `Google Books: free daily quota used up${e.cooldown ? ' (pausing it for a few minutes)' : ''}, so previews may be missing. (Site owner: add a key in js/config.js.)`;
    if (e?.status === 429) return `${SOURCE_NAMES[k] || k} is rate-limiting us; skipping it for a few minutes.`;
    if (k === 'google' && e?.status === 403) return 'Google Books refused the request (check the API key restrictions in js/config.js).';
    return `${SOURCE_NAMES[k] || k} didn’t respond${e?.status ? ` (HTTP ${e.status})` : ''}; results may be incomplete.`;
  });
  return notes.length ? `<p class="notice" role="status">${notes.map(esc).join('<br>')}</p>` : '';
}

// ---------------- detail sheet ----------------
let sheetClose = null;

/** Bottom sheet (phone) / side panel (tablet+). Returns its parts; `close()` goes through history. */
function createSheet(label) {
  sheetClose?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', label);
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
    renderCurrent(); // statuses/progress/downloads may have changed
  });
  sheetClose = close;
  backdrop.addEventListener('click', close);
  sheet.querySelector('.sheet-close').addEventListener('click', close);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  enableDragToClose(sheet, close);
  requestAnimationFrame(() => { sheet.classList.add('on'); backdrop.classList.add('on'); });
  return { sheet, body: sheet.querySelector('.sheet-body'), close, signal: ctrl.signal };
}

function openSheet(book) {
  if (!book) return;
  const { sheet, body, signal } = createSheet(book.title);
  renderSheet(body, book, signal);
  settleCovers(sheet);
  setTimeout(() => sheet.querySelector('.detail-actions .btn, .sheet-close')?.focus({ preventScroll: true }), 50);
}

function renderSheet(body, book, signal) {
  const metaBits = [book.year, catLabel(book.category), book.isLocal ? 'On this device' : null, book.shared && book.size ? `${(book.size / 1048576).toFixed(1)} MB` : null].filter(Boolean);
  const entry = store.shelfEntry(book.key);
  const prog = store.getProgress(book.key);
  body.innerHTML = `
    <div class="detail-top">
      ${coverHtml(book, { badge: false })}
      <div>
        <h2 class="detail-title">${esc(book.title)}</h2>
        ${book.author && !book.isLocal ? `<p class="detail-meta"><button class="author-link" data-author="${esc(book.author)}" aria-label="More books by ${esc(book.author)}">${esc(book.author)}</button></p>` : book.author ? `<p class="detail-meta">${esc(book.author)}</p>` : ''}
        <p class="detail-meta">${metaBits.map((m) => `<span>${esc(m)}</span>`).join('')}</p>
        <p class="detail-meta"><span class="badge ${book.isLocal ? 'MINE' : book.shared ? 'SHARED' : book.state}" style="position:static;display:inline-block;margin-top:6px">${book.isLocal ? 'My PDF' : book.shared ? 'Shared' : BADGE[book.state]}</span></p>
      </div>
    </div>
    <div class="detail-actions">${actionsHtml(book, prog)}</div>
    <div class="status-row" role="group" aria-label="My shelf status">
      ${store.STATUSES.map((s) => `<button class="chip" data-status="${s.id}" aria-pressed="${entry?.status === s.id}">${esc(s.label)}<small lang="ml">${esc(s.ml)}</small></button>`).join('')}
    </div>
    ${entry?.bookmarks?.length ? `<p class="detail-meta" style="margin-top:12px">Bookmarks: ${entry.bookmarks.map((p) => `<button class="chip" data-goto="${p}" style="min-height:36px">p. ${p + 1}</button>`).join(' ')}</p>` : ''}
    <div class="detail-desc-wrap">${book.description ? descHtml(book.description) : book.isLocal || book.shared ? '' : '<div class="skel skel-line"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div>'}</div>
    ${linksHtml(book)}
    <p class="fine">${book.isLocal
      ? 'This PDF stays on your device. Nothing is uploaded.'
      : book.shared
        ? `Shared by this library’s owner, so it appears on every device.${book.pendingPublish ? ' Just published: other devices will see it in about a minute.' : ''} If it shouldn’t be here, please report it.`
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
  const dlSlot = body.querySelector('.dl-slot');
  if (dlSlot) setupDownloadSlot(dlSlot, book, signal);
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

  body.querySelector('[data-unpublish]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.querySelector('span').textContent = 'Tap again to remove it for everyone'; return; }
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Removing…';
    try {
      await unpublishBook(book);
      const { deletePdf } = await import('./pdf.js');
      await deletePdf(book.key);
      state.shared = state.shared.filter((b) => b.key !== book.key);
      state.books = state.books.filter((b) => b.key !== book.key);
      store.setStatus(book, null);
      toast('Removed. It disappears from other devices in about a minute.');
      sheetClose?.();
    } catch (err) {
      btn.disabled = false;
      btn.dataset.sure = '';
      btn.querySelector('span').textContent = 'Remove for everyone';
      toast(err.message);
    }
  });

  if (!book.description && !book.isLocal && !book.shared) loadDescription(book, signal).then((d) => {
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
      ${canDownload(book) ? '<div class="dl-slot"></div>' : ''}
      ${book.isLocal ? `<button class="btn block ghost" data-remove-pdf>${icons.trash}<span>Remove from this device</span></button>` : ''}
      ${book.shared && canPublish() ? `<button class="btn block ghost" data-unpublish>${icons.trash}<span>Remove for everyone</span></button>` : ''}`;
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
  const src = (book.sources || [book.source]).map((s) => ({ ia: 'Internet Archive', google: 'Google Books', openlibrary: 'Open Library', local: 'Your device', shared: 'Shared by this library' }[s] || s));
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

// ---------------- offline downloads ----------------
const jobs = new Map();          // book key -> {done, total, bytes, failed, kind, ctrl}
const lastError = new Map();     // book key -> message from the last failed attempt
const jobListeners = new Map();  // book key -> Set<fn>
let wakeLock = null;

function emitJob(key) { jobListeners.get(key)?.forEach((fn) => fn()); }

async function holdScreen(on) {
  try {
    if (on && !wakeLock) { wakeLock = await navigator.wakeLock?.request('screen'); wakeLock?.addEventListener('release', () => { wakeLock = null; }); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* optional */ }
}

async function startDownload(book) {
  if (jobs.has(book.key)) return;
  primeAudio(); // unlock audio during this tap so the finish sound can play later
  const ctrl = new AbortController();
  const job = { done: 0, total: book.shared ? book.size || 0 : 0, bytes: 0, failed: 0, kind: book.shared ? 'pdf' : 'pages', ctrl };
  jobs.set(book.key, job);
  lastError.delete(book.key);
  holdScreen(true);
  emitJob(book.key);
  try {
    await downloadBook(book, { signal: ctrl.signal, onProgress: (p) => { Object.assign(job, p); emitJob(book.key); } });
    downloadComplete();
    toast(`“${book.title}” is saved for offline reading.`);
  } catch (e) {
    if (e?.name === 'AbortError') toast('Download stopped. What was saved is kept, so you can resume later.');
    else {
      const msg = e instanceof OfflineError ? e.message : 'The download failed. Check your connection and try again.';
      lastError.set(book.key, msg);
      toast(msg.length > 90 ? 'The download didn’t finish. Open the book to resume.' : msg);
    }
  } finally {
    jobs.delete(book.key);
    if (!jobs.size) holdScreen(false);
    emitJob(book.key);
  }
}

/*
 * Download control: a pill-shaped progress button. Press it and a round stop button buds off its
 * right side like a droplet while the fill runs (tap it to change your mind); when the download
 * finishes the droplet melts back in and the label reads "Saved offline". The droplet effect is an
 * SVG "goo" filter (#goo in index.html) over the two shapes. Interaction design after Aviral's
 * "Progress button" (x.com/aviralj02, via bencho.dev/finds); this is an independent implementation.
 */
function downloadButtonHtml() {
  return `<div class="pbtn" data-mode="idle">
      <span class="pbtn-goo" aria-hidden="true"><i class="pbtn-pill"></i><i class="pbtn-drop"></i></span>
      <button class="pbtn-main" data-dl type="button"><span class="pbtn-fill"></span><span class="pbtn-label"><span class="pbtn-icon"></span><span class="pbtn-text">Download for offline</span></span></button>
      <button class="pbtn-stop" data-dl-cancel type="button" aria-label="Stop download" tabindex="-1">${icons.stop}</button>
    </div>
    <div class="pbtn-extra"></div>`;
}

function renderDownloadSlot(slot, book, hint = '') {
  if (!slot.querySelector('.pbtn')) slot.innerHTML = downloadButtonHtml();
  const btn = slot.querySelector('.pbtn');
  const main = btn.querySelector('.pbtn-main');
  const stop = btn.querySelector('.pbtn-stop');
  const text = btn.querySelector('.pbtn-text');
  const icon = btn.querySelector('.pbtn-icon');
  const extra = slot.querySelector('.pbtn-extra');
  const job = jobs.get(book.key);
  const rec = offlineInfo(book.key);
  const err = lastError.get(book.key);
  let mode, label, ico = icons.download, pct = 0, extraHtml = '';

  if (job) {
    mode = 'active';
    pct = job.kind === 'pdf' ? 0 : (job.total ? Math.min(1, job.done / job.total) : 0);
    label = job.kind === 'pdf' ? 'Downloading…' : `Downloading ${Math.round(pct * 100)}%`;
    ico = '';
    extraHtml = `<p class="fine">${job.kind === 'pdf' ? 'Saving the PDF on this device.' : `${job.done} of ${job.total || '…'} pages · ${esc(fmtBytes(job.bytes))}.`} You can close this and keep browsing.</p>`;
  } else if (rec?.complete) {
    mode = 'done';
    pct = 1;
    label = `Saved offline · ${fmtBytes(rec.bytes)}`;
    ico = icons.check;
    extraHtml = '<button class="more-link" data-dl-remove>Remove download</button>';
  } else if (rec && rec.kind === 'pages' && rec.have > 0) {
    mode = 'idle';
    pct = rec.count ? rec.have / rec.count : 0;
    label = `Resume download · ${rec.have} of ${rec.count}`;
    extraHtml = `${err ? `<p class="form-error" role="alert">${esc(err)}</p>` : ''}<button class="more-link" data-dl-remove>Discard the ${esc(fmtBytes(rec.bytes))} downloaded so far</button>`;
  } else {
    mode = 'idle';
    label = 'Download for offline';
    extraHtml = err ? `<p class="form-error" role="alert">${esc(err)}</p>` : `<p class="fine">${esc(hint || 'Saves the pages on this device so you can read without internet.')}</p>`;
  }
  btn.dataset.mode = mode;
  btn.style.setProperty('--p', String(pct));
  if (text.textContent !== label) text.textContent = label;
  if (icon.innerHTML !== ico) icon.innerHTML = ico;
  main.disabled = mode !== 'idle';
  main.setAttribute('aria-label', mode === 'active' ? `${label}. Use the stop button to cancel.` : label);
  stop.tabIndex = mode === 'active' ? 0 : -1;
  stop.setAttribute('aria-hidden', String(mode !== 'active'));
  if (extra.dataset.html !== extraHtml) { extra.innerHTML = extraHtml; extra.dataset.html = extraHtml; }
}

function setupDownloadSlot(slot, book, signal) {
  let hint = book.shared && book.size ? `Saves this book on this device (${fmtBytes(book.size)}) so you can read without internet.` : '';
  const draw = () => renderDownloadSlot(slot, book, hint);
  draw();
  const set = jobListeners.get(book.key) || new Set();
  set.add(draw);
  jobListeners.set(book.key, set);
  signal.addEventListener('abort', () => set.delete(draw), { once: true });
  if (!book.shared && book.archiveId && !isDownloaded(book.key) && navigator.onLine) {
    getBookManifest(book.archiveId, { signal }).then((m) => {
      hint = `${m.count} pages · about ${fmtBytes(m.count * 190 * 1024)} on this device. Takes a few minutes; you can keep browsing.`;
      if (!jobs.has(book.key)) draw();
    }).catch(() => {});
  }
  slot.addEventListener('click', async (e) => {
    if (e.target.closest('[data-dl]')) startDownload(book);
    else if (e.target.closest('[data-dl-cancel]')) jobs.get(book.key)?.ctrl.abort();
    else if (e.target.closest('[data-dl-remove]')) {
      await removeOffline(book);
      lastError.delete(book.key);
      toast('Download removed from this device.');
      draw();
    }
  });
}

async function clearDownloads() {
  const n = listOffline().length;
  if (!n || !confirm(`Remove all ${n} downloaded book${n > 1 ? 's' : ''} from this device? You can download them again later.`)) return;
  for (const r of listOffline()) await removeOffline(r.key);
  toast('Downloads removed.');
  renderCurrent();
}

// ---------------- reading ----------------
function openBook(book) {
  if (book.isLocal) { openLocalPdf(book); return; }
  if (book.shared) { openSharedPdf(book); return; }
  if (!book.archiveId) return;
  const id = book.archiveId;
  const saved = offlineInfo(book.key);
  if (saved && saved.kind === 'pages' && (saved.complete || saved.have > 0)) {
    // Downloaded: read from this device. A partly downloaded book fills any gaps from the network when online.
    const source = saved.complete
      ? offlineSource(saved)
      : getBookManifest(id).then((m) => (m.count === saved.count ? m.pageUrl : null)).catch(() => null)
        .then((pageUrl) => offlineSource(saved, pageUrl ? (i, w) => pageUrl(i, w) : null));
    openReader({ book, source, reportUrl, externalUrl: `https://archive.org/details/${encodeURIComponent(id)}` });
    return;
  }
  if (!navigator.onLine) { toast('You’re offline. Books you’ve downloaded are under Downloads.'); return; }
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

function onPdfPicked(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Please choose a PDF file.'); return; }
  openAddBookForm(file);
}

/** "Add a book": details + Private (this device) or Public (every device). */
function openAddBookForm(file) {
  const { sheet, body, close } = createSheet('Add a book');
  const mb = (file.size / 1048576).toFixed(1);
  const tooBig = file.size > CONFIG.publicBooks.maxMb * 1048576;
  const guessTitle = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  body.innerHTML = `
    <form class="add-form" novalidate>
      <h2 class="detail-title">Add a book</h2>
      <p class="detail-meta">${esc(file.name)} · ${mb} MB</p>
      <label class="field"><span>Title</span><input name="title" required maxlength="200" value="${esc(guessTitle)}" autocomplete="off"></label>
      <label class="field"><span>Author <small>(optional)</small></span><input name="author" maxlength="200" autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Category</span><select name="category">${CONFIG.categories.filter((c) => c.id !== 'all').map((c) => `<option value="${c.id}"${c.id === 'other' ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Year <small>(optional)</small></span><input name="year" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"></label>
      </div>
      <fieldset class="vis">
        <legend>Who can see it?</legend>
        <label class="vis-opt"><input type="radio" name="vis" value="private" checked>
          <span><b>Private</b><small>Only on this device. Nothing is uploaded.</small></span></label>
        <label class="vis-opt"><input type="radio" name="vis" value="public"${tooBig ? ' disabled' : ''}>
          <span><b>Public</b><small>${tooBig ? `Not available: public books can be up to ${CONFIG.publicBooks.maxMb} MB.` : 'Everyone who opens this library, on any device.'}</small></span></label>
      </fieldset>
      <div class="public-extra" hidden>
        <div class="token-setup"${getToken() ? ' hidden' : ''}>
          <label class="field"><span>GitHub access token</span><input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
          <p class="fine">One-time setup on this device. Public books are saved into this site’s GitHub repository, so publishing needs a token from the repository’s owner:
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">create a fine-grained token</a> →
            Repository access: only <b>${esc(CONFIG.publicBooks.repo.split('/')[1])}</b> → Permissions: <b>Contents: Read and write</b>.
            It is stored only in this browser.</p>
        </div>
        <p class="fine token-ok"${getToken() ? '' : ' hidden'}>Publishing is set up on this device. <button type="button" class="more-link" data-forget-token>Remove token</button></p>
        <label class="check"><input type="checkbox" name="rights">
          <span>I wrote this book, or it is free to share (public domain or openly licensed). I understand it will be visible to anyone.</span></label>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <div class="upload-progress" hidden><div class="bar"><i></i></div><span class="muted"></span></div>
      <button class="btn block" type="submit">${icons.upload}<span>Add book</span></button>
    </form>`;
  const form = body.querySelector('form');
  const extra = form.querySelector('.public-extra');
  const err = form.querySelector('.form-error');
  const prog = form.querySelector('.upload-progress');
  const submit = form.querySelector('[type="submit"]');
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };

  form.addEventListener('change', (e) => {
    if (e.target.name === 'vis') {
      extra.hidden = form.vis.value !== 'public';
      submit.querySelector('span').textContent = form.vis.value === 'public' ? 'Publish for everyone' : 'Add book';
      showErr('');
    }
  });
  form.querySelector('[data-forget-token]').addEventListener('click', () => {
    setToken('');
    form.querySelector('.token-setup').hidden = false;
    form.querySelector('.token-ok').hidden = true;
  });

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const title = form.title.value.trim();
    const author = form.author.value.trim();
    const year = /^\d{4}$/.test(form.year.value.trim()) ? +form.year.value.trim() : null;
    const category = form.category.value;
    const isPublic = form.vis.value === 'public';
    if (!title) { showErr('Please give the book a title.'); form.title.focus(); return; }
    if (form.year.value.trim() && !year) { showErr('Year should be four digits, like 1925.'); form.year.focus(); return; }
    if (isPublic) {
      const typed = form.token.value.trim();
      if (!getToken() && !typed) { showErr('Paste your GitHub access token to publish.'); form.token.focus(); return; }
      if (!form.rights.checked) { showErr('Please confirm you’re allowed to share this book publicly.'); form.rights.focus(); return; }
    }
    busy = true;
    submit.disabled = true;
    showErr('');
    const pdf = await import('./pdf.js');
    try {
      // The cover is a nicety: never let it hold up adding the book (rendering can stall in a
      // background tab or on a damaged first page).
      const cover = await Promise.race([
        pdf.pdfCover(file, isPublic ? 360 : 220),
        new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      if (!isPublic) {
        const book = { key: pdf.pdfKey(file), source: 'local', isLocal: true, title, author: author || 'My PDF', category, year, state: 'READ', coverUrl: cover ? await pdf.blobToDataUrl(cover) : null };
        const kept = await pdf.savePdf(file);
        store.setStatus(book, store.shelfEntry(book.key)?.status || 'reading');
        // Closing the form goes through history (popstate). Open the reader only after that has
        // happened, otherwise the pending "back" would close the reader instead of the form.
        window.addEventListener('popstate', () => {
          toast(kept ? 'Added to My Shelf (this device only).' : 'Opened, but this browser can’t keep the file for later.');
          openReader({ book, source: pdf.pdfSource(file).catch((er) => { throw new Error(`Couldn’t read this PDF (${er.message}).`); }) });
        }, { once: true });
        close();
        return;
      }
      const typed = form.token.value.trim();
      if (typed) {
        const check = await checkToken(typed);
        if (!check.ok) throw new Error(check.message);
        setToken(typed);
      }
      prog.hidden = false;
      const book = await publishBook({
        file, title, author, category, year, cover,
        onProgress: (f, stage) => {
          prog.querySelector('i').style.width = `${Math.round(f * 100)}%`;
          prog.querySelector('span').textContent = `${stage}… ${Math.round(f * 100)}%`;
        },
      });
      await pdf.savePdf(file, book.key); // so it opens instantly here, before the site rebuilds
      if (cover) book.coverUrl = await pdf.blobToDataUrl(cover);
      state.shared = [book, ...state.shared];
      markSeen([book.key]);
      close();
      toast('Published. Other devices will see it in about a minute.');
      search();
    } catch (er) {
      showErr(er.message || 'Something went wrong. Please try again.');
      prog.hidden = true;
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
  setTimeout(() => form.title.focus({ preventScroll: true }), 60);
  void sheet;
}

async function openSharedPdf(book) {
  const source = (async () => {
    const { getPdf, pdfSource } = await import('./pdf.js');
    const blob = (await getPdf(book.key)) || (await fetchPublicPdf(book));
    return pdfSource(blob);
  })();
  openReader({ book, source, reportUrl });
}

async function openLocalPdf(book) {
  const { getPdf, pdfSource } = await import('./pdf.js');
  const blob = await getPdf(book.key);
  if (!blob) {
    toast('This PDF isn’t stored on this device any more. Add it again with “Add book”.');
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
  renderCurrent();
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

function renderDownloads() {
  const downloaded = listOffline().filter((r) => r.book && (state.category === 'all' || r.book.category === state.category));
  const total = downloaded.reduce((n, r) => n + (r.bytes || 0), 0);
  const partial = downloaded.filter((r) => !r.complete).length;
  let html = `<section class="section"><div class="section-h"><h2>Downloads</h2>
    <span class="count">${downloaded.length ? `${downloaded.length} · ${esc(fmtBytes(total))}${partial ? ` · ${partial} unfinished` : ''}` : 'ഡൗൺലോഡുകൾ'}</span></div>`;
  if (!downloaded.length) {
    html += emptyState(
      state.category === 'all' ? 'No downloads yet.' : `No downloaded ${catLabel(state.category).toLowerCase()} books.`,
      'Open a free book and tap “Download for offline” to read it without internet.',
      '<button class="btn small" data-act="library">Browse the library</button>');
  } else {
    html += `<ul class="grid" role="list">${downloaded.map((r) => cardHtml({ ...r.book, state: 'READ' })).join('')}</ul>
      <p class="fine"><button class="more-link" data-act="dl-clear">Remove all downloads</button> to free up space on this device.</p>`;
  }
  html += '</section>';
  $('#main').innerHTML = html;
  settleCovers($('#main'));
}

// ---------------- dock (bottom navigation on phone/tablet) ----------------
// A magnifying dock: icons swell toward your finger (or mouse), the nearest growing most. On touch,
// press and slide along the dock; lifting your finger opens the item under it. Laptop widths show
// the tabs in the header instead (CSS), so the effect is off there.
function initDock() {
  const dock = $('.dock');
  const items = [...dock.querySelectorAll('.tab')];
  const wide = matchMedia('(min-width: 1024px)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const MAX = 0.55, RANGE = 96;
  let pressing = null; // pointerId while a finger/mouse button is down on the dock

  const magnify = (x) => {
    if (wide.matches || still.matches) return;
    dock.classList.add('magnifying');
    for (const b of items) {
      const r = b.getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.width / 2));
      const k = Math.max(0, 1 - d / RANGE);
      b.style.setProperty('--s', (1 + MAX * k * k).toFixed(3));
      b.classList.toggle('near', k > 0.6);
    }
  };
  const reset = () => {
    dock.classList.remove('magnifying');
    items.forEach((b) => { b.style.removeProperty('--s'); b.classList.remove('near'); });
  };
  const itemAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.dock .tab');

  dock.addEventListener('pointerdown', (e) => { pressing = e.pointerId; dock.dataset.downOn = itemAt(e.clientX, e.clientY)?.dataset.tab || itemAt(e.clientX, e.clientY)?.dataset.action || ''; magnify(e.clientX); });
  dock.addEventListener('pointermove', (e) => { if (pressing === e.pointerId || e.pointerType === 'mouse') magnify(e.clientX); });
  window.addEventListener('pointerup', (e) => {
    if (pressing !== e.pointerId) return;
    pressing = null;
    const target = itemAt(e.clientX, e.clientY);
    const id = target?.dataset.tab || target?.dataset.action || '';
    // slid onto a different item than the one pressed: open that one (a plain tap is handled by click)
    if (target && id !== dock.dataset.downOn) target.click();
    if (e.pointerType !== 'mouse') reset();
  });
  window.addEventListener('pointercancel', () => { pressing = null; reset(); });
  dock.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && pressing === null) reset(); });
}

// ---------------- notifications ----------------
let lastCheck = 0;

function initNotifications() {
  const btn = $('#notif-btn');
  btn.addEventListener('click', () => (document.querySelector('.notif-panel') ? closeNotifPanel() : openNotifPanel()));
  renderNotifBadge();
  setInterval(() => { if (document.visibilityState === 'visible') checkNewBooks(true); }, CONFIG.notifications.checkEveryMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 2 * 60 * 1000) checkNewBooks(true);
  });
}

/** Look for books this device hasn't seen. `refetch` reloads the featured/shared lists first. */
async function checkNewBooks(refetch) {
  lastCheck = Date.now();
  if (refetch) {
    if (!navigator.onLine) return;
    const before = state.shared.map((b) => b.key).join('|') + '#' + state.featured.map((b) => b.key).join('|');
    await Promise.all([loadFeatured(), loadShared()]);
    const after = state.shared.map((b) => b.key).join('|') + '#' + state.featured.map((b) => b.key).join('|');
    if (before !== after && state.tab === 'library' && !state.query && !document.querySelector('.reader')) search();
  }
  const fresh = syncNewBooks([...state.featured, ...state.shared]);
  renderNotifBadge();
  if (document.querySelector('.notif-panel')) renderNotifPanel();
  if (fresh.length) toast(fresh.length === 1 ? `New book: ${fresh[0].title}` : `${fresh.length} new books added`);
}

function renderNotifBadge() {
  const n = unreadCount();
  const badge = $('#notif-btn .notif-count');
  badge.hidden = !n;
  badge.textContent = n > 9 ? '9+' : String(n);
  $('#notif-btn').setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
}

let notifClose = null;
function openNotifPanel() {
  const panel = document.createElement('div');
  panel.className = 'notif-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');
  document.body.appendChild(panel);
  $('#notif-btn').setAttribute('aria-expanded', 'true');
  renderNotifPanel();
  requestAnimationFrame(() => panel.classList.add('on'));
  const onDoc = (e) => { if (!panel.contains(e.target) && !e.target.closest('#notif-btn')) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = pushOverlay(() => {
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey);
    $('#notif-btn').setAttribute('aria-expanded', 'false');
    panel.classList.remove('on');
    setTimeout(() => panel.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    notifClose = null;
  });
  notifClose = close;
  document.addEventListener('pointerdown', onDoc, true);
  document.addEventListener('keydown', onKey);
  setTimeout(() => panel.querySelector('button')?.focus({ preventScroll: true }), 60);
}
function closeNotifPanel() { notifClose?.(); }

function renderNotifPanel() {
  const panel = document.querySelector('.notif-panel');
  if (!panel) return;
  const items = listNotices();
  const unread = items.filter((n) => !n.read).length;
  panel.innerHTML = `
    <div class="notif-head"><h2>Notifications</h2>${unread ? '<button class="more-link" data-n-all>Mark all as read</button>' : ''}</div>
    ${items.length ? `<ul class="notif-list" role="list">${items.map((n, i) => `<li><button class="notif-item${n.read ? '' : ' unread'}" data-n="${i}">
        <span class="notif-cover">${n.coverUrl ? `<img src="${esc(n.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>
        <span class="notif-text"><span class="notif-kind">New book added</span><span class="notif-title">${esc(n.title)}</span>
          <span class="notif-meta">${esc([n.author, timeAgo(n.at)].filter(Boolean).join(' · '))}</span></span>
        ${n.read ? '' : '<span class="notif-dot" aria-label="Unread"></span>'}</button></li>`).join('')}</ul>`
      : `<div class="notif-empty">${icons.bell}<p><strong>No new books yet.</strong></p><p>When a book is added to the library, it shows up here. Tap it to open the book.</p></div>`}
    <label class="switch-row notif-sound"><span>Sound when a download finishes</span><input type="checkbox" data-n-sound ${soundsEnabled() ? 'checked' : ''}></label>`;
  panel.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => {
    const n = items[+b.dataset.n];
    markRead(n.key);
    renderNotifBadge();
    const book = [...state.shared, ...state.featured].find((x) => x.key === n.key) || (navigator.onLine ? null : n.book);
    closeNotifPanel();
    if (!book) { toast('This book isn’t in the library any more.'); return; }
    if (state.tab !== 'library') setTab('library');
    setTimeout(() => openSheet(book), 60); // after the panel's history entry has closed
  }));
  panel.querySelector('[data-n-all]')?.addEventListener('click', () => { markAllRead(); renderNotifBadge(); renderNotifPanel(); });
  panel.querySelector('[data-n-sound]').addEventListener('change', (e) => {
    setSoundsEnabled(e.target.checked);
    if (e.target.checked) { primeAudio(); downloadComplete(); } // let them hear it
  });
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
