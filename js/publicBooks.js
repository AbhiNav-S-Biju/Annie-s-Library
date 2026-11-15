// Public books: PDFs the site owner shares with every device.
//
// There is no server. A public book is a file committed to this site's own GitHub repository
// (CONFIG.publicBooks.dir), listed in <dir>/index.json. GitHub Pages then serves it to everyone.
// Publishing needs a GitHub access token with write access to the repo; it is entered once by the
// owner and kept in this browser's localStorage only (never in the repo, never sent anywhere but
// api.github.com). Visitors without a token can read public books but cannot add or remove them.
import { CONFIG } from './config.js';
import * as store from './storage.js';

const API = 'https://api.github.com';
const P = () => CONFIG.publicBooks;
const TOKEN_KEY = 'gh-token';
const PENDING_KEY = 'public-pending';

export const getToken = () => store.get(TOKEN_KEY, '') || '';
export function setToken(t) { if (t) store.set(TOKEN_KEY, String(t).trim()); else store.remove(TOKEN_KEY); }
export const canPublish = () => !!getToken();

export class PublishError extends Error {}

const b64encodeText = (s) => btoa(unescape(encodeURIComponent(s)));
const b64decodeText = (s) => decodeURIComponent(escape(atob(String(s).replace(/\s/g, ''))));
const contentsUrl = (path) => `${API}/repos/${P().repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

function explain(status, fallback) {
  if (status === 401) return 'GitHub rejected the access token. Check it and paste it again.';
  if (status === 403 || status === 404) return 'This token can’t write to the library’s repository. It needs “Contents: Read and write” on that repo.';
  if (status === 409 || status === 422) return 'GitHub was busy with another change. Please try again.';
  if (status === 413) return 'The file is too large for GitHub.';
  return fallback || `GitHub error (HTTP ${status}).`;
}

async function gh(url, { method = 'GET', body, token = getToken() } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new PublishError('Couldn’t reach GitHub. Check your connection.'); }
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new PublishError(explain(res.status));
  return res.status === 204 ? {} : res.json();
}

/** PUT with upload progress (fetch has none). */
function putWithProgress(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new PublishError(explain(xhr.status))));
    xhr.onerror = () => reject(new PublishError('Upload failed. Check your connection and try again.'));
    xhr.send(JSON.stringify(body));
  });
}

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new PublishError('Couldn’t read the file.'));
    r.readAsDataURL(blob);
  });
}

/** Does the saved token work for this repo? Returns {ok, message}. */
export async function checkToken(token = getToken()) {
  if (!token) return { ok: false, message: 'No access token saved.' };
  try {
    const repo = await gh(`${API}/repos/${P().repo}`, { token });
    if (!repo) return { ok: false, message: 'This token can’t see the library’s repository.' };
    if (repo.permissions && repo.permissions.push === false) return { ok: false, message: 'This token can read the repository but not write to it.' };
    return { ok: true, message: 'Token works.' };
  } catch (e) { return { ok: false, message: e.message }; }
}

// ---------- reading the public list (everyone) ----------
function entryToBook(e, pending = false) {
  const dir = P().dir;
  return {
    key: 'shared:' + e.id,
    source: 'shared',
    shared: true,
    sharedId: e.id,
    title: e.title,
    author: e.author || '',
    year: e.year || null,
    category: e.category || 'other',
    description: e.note || '',
    coverUrl: e.cover ? `${dir}/${e.cover}` : null,
    pdfUrl: `${dir}/${e.file}`,
    // straight from the repo: works within seconds of publishing, before the site rebuild finishes
    pdfFallbackUrl: `https://raw.githubusercontent.com/${P().repo}/${P().branch}/${dir}/${e.file}`,
    size: e.size || 0,
    added: e.added || 0,
    state: 'READ',
    pendingPublish: pending,
  };
}

/** Public books for the library. Never throws: returns [] if the list can't be loaded. */
export async function listPublicBooks() {
  let entries = [];
  try {
    const res = await fetch(`${P().dir}/index.json`, { cache: 'no-cache' });
    if (res.ok) { const j = await res.json(); if (Array.isArray(j)) entries = j; }
  } catch { /* offline or not published yet */ }
  const ids = new Set(entries.map((e) => e.id));
  // Books published from this device that the site hasn't rebuilt with yet (takes about a minute).
  const removed = new Set(store.get('public-removed', []) || []);
  let pending = (store.get(PENDING_KEY, []) || []).filter((e) => e && e.id && !ids.has(e.id));
  pending = pending.filter((e) => Date.now() - (e.added || 0) < 24 * 60 * 60 * 1000);
  store.set(PENDING_KEY, pending);
  store.set('public-removed', [...removed].filter((id) => ids.has(id)));
  return [...pending.map((e) => entryToBook(e, true)), ...entries.filter((e) => !removed.has(e.id)).map((e) => entryToBook(e))]
    .sort((a, b) => (b.added || 0) - (a.added || 0));
}

// ---------- publishing (owner only) ----------
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'book';

async function readIndex() {
  const f = await gh(contentsUrl(`${P().dir}/index.json`) + `?ref=${encodeURIComponent(P().branch)}`);
  if (!f) return { sha: undefined, list: [] };
  let list = [];
  try { list = JSON.parse(b64decodeText(f.content)); } catch { list = []; }
  return { sha: f.sha, list: Array.isArray(list) ? list : [] };
}

async function writeIndex(mutate, message) {
  for (let attempt = 0; ; attempt++) {
    const { sha, list } = await readIndex();
    const next = mutate(list);
    try {
      await gh(contentsUrl(`${P().dir}/index.json`), {
        method: 'PUT',
        body: { message, branch: P().branch, content: b64encodeText(JSON.stringify(next, null, 2) + '\n'), ...(sha ? { sha } : {}) },
      });
      return next;
    } catch (e) {
      if (attempt >= 2 || !/busy/.test(e.message)) throw e; // someone else changed it: re-read and retry
    }
  }
}

/**
 * Upload a PDF (and optional cover) to the repo and list it. Resolves with the new book.
 * @param {{file: Blob, title: string, author?: string, category?: string, year?: number|null, note?: string, cover?: Blob|null, onProgress?: (fraction: number, stage: string) => void}} o
 */
export async function publishBook({ file, title, author = '', category = 'other', year = null, note = '', cover = null, onProgress }) {
  if (!getToken()) throw new PublishError('Add your GitHub access token first.');
  const maxBytes = P().maxMb * 1024 * 1024;
  if (file.size > maxBytes) throw new PublishError(`This PDF is ${(file.size / 1048576).toFixed(0)} MB. Public books can be up to ${P().maxMb} MB; keep it private instead, or compress it.`);
  const id = `${Date.now().toString(36)}-${slug(title)}`;
  const dir = P().dir;

  onProgress?.(0, 'Preparing');
  const pdf64 = await fileToBase64(file);
  await putWithProgress(contentsUrl(`${dir}/${id}.pdf`), { message: `Add public book: ${title}`, branch: P().branch, content: pdf64 }, (f) => onProgress?.(f * 0.9, 'Uploading'));

  let coverName = null;
  if (cover) {
    try {
      await gh(contentsUrl(`${dir}/${id}.jpg`), { method: 'PUT', body: { message: `Add cover: ${title}`, branch: P().branch, content: await fileToBase64(cover) } });
      coverName = `${id}.jpg`;
    } catch { /* a missing cover is fine */ }
  }
  onProgress?.(0.95, 'Listing');
  const entry = { id, title, author, category, year: year || null, note, file: `${id}.pdf`, cover: coverName, size: file.size, added: Date.now() };
  await writeIndex((list) => [entry, ...list.filter((e) => e.id !== id)], `List public book: ${title}`);

  store.set(PENDING_KEY, [entry, ...(store.get(PENDING_KEY, []) || [])]);
  onProgress?.(1, 'Done');
  return entryToBook(entry, true);
}

/** Remove a public book for everyone (owner only). */
export async function unpublishBook(book) {
  if (!getToken()) throw new PublishError('Add your GitHub access token first.');
  const id = book.sharedId;
  let entry = null;
  await writeIndex((list) => { entry = list.find((e) => e.id === id) || entry; return list.filter((e) => e.id !== id); }, `Remove public book: ${book.title}`);
  for (const name of [`${id}.pdf`, entry?.cover || `${id}.jpg`]) {
    try {
      const f = await gh(contentsUrl(`${P().dir}/${name}`) + `?ref=${encodeURIComponent(P().branch)}`);
      if (f?.sha) await gh(contentsUrl(`${P().dir}/${name}`), { method: 'DELETE', body: { message: `Remove ${name}`, branch: P().branch, sha: f.sha } });
    } catch { /* the listing is gone; a leftover file is harmless */ }
  }
  store.set(PENDING_KEY, (store.get(PENDING_KEY, []) || []).filter((e) => e.id !== id));
  store.set('public-removed', [...new Set([...(store.get('public-removed', []) || []), id])]);
}

/** Fetch a public book's PDF (site copy first, then straight from the repo). */
export async function fetchPublicPdf(book, { signal } = {}) {
  for (const url of [book.pdfUrl, book.pdfFallbackUrl]) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok) return await res.blob();
    } catch (e) { if (e?.name === 'AbortError') throw e; }
  }
  throw new Error('This book isn’t available yet. If it was just added, try again in a minute.');
}
