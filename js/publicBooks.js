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

/** Turn a GitHub error into something a person can act on; always keeps GitHub's own reason. */
function explain(status, detail = '') {
  const why = detail ? ` (GitHub says: ${String(detail).slice(0, 160)})` : '';
  if (status === 401) return 'GitHub rejected the access token. Check it and paste it again.';
  if (status === 403 && /rate limit|abuse|secondary/i.test(detail)) return 'GitHub is asking us to slow down. Wait a minute and try again.';
  if (status === 403 || status === 404) return `This token can’t write to the library’s repository. It needs “Contents: Read and write” on that repo.${why}`;
  if (status === 413 || status === 502 || status === 504 || /too large|exceeds/i.test(detail)) return `GitHub couldn’t take a file this large. Try a smaller PDF (compressing it usually helps).${why}`;
  if (status === 409 || status === 422) return `GitHub refused the change.${why || ' Please try again.'}`;
  return `GitHub error (HTTP ${status}).${why}`;
}

function parseDetail(text) {
  try { const j = JSON.parse(text); return [j.message, ...(j.errors || []).map((e) => e.message || e.code)].filter(Boolean).join('; '); } catch { return ''; }
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
  if (!res.ok) {
    const err = new PublishError(explain(res.status, parseDetail(await res.text().catch(() => ''))));
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
  return res.status === 204 ? {} : res.json();
}

/**
 * Request body for uploading a file, built in pieces: {"message":…,"branch":…,"content":"<base64>"}.
 * Encoding 3 bytes -> 4 characters chunk by chunk keeps memory near the file's own size; one big
 * base64 string plus JSON.stringify would hold several copies (too much for a 100 MB PDF on a phone).
 */
export async function uploadBody(file, meta, onProgress) {
  const CHUNK = 3 * 256 * 1024; // multiple of 3, so chunks join into valid base64
  const head = JSON.stringify({ ...meta, content: '' }).slice(0, -2); // …,"content":"
  const parts = [head];
  for (let off = 0; off < file.size; off += CHUNK) {
    const bytes = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    parts.push(btoa(bin));
    onProgress?.(Math.min(1, (off + CHUNK) / file.size));
    if (off % (CHUNK * 8) === 0) await new Promise((r) => setTimeout(r)); // let the page breathe
  }
  parts.push('"}');
  return new Blob(parts, { type: 'application/json' });
}

/** Request with upload progress (fetch has none). `body` is an object or a ready-made Blob. */
function sendWithProgress(method, url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(JSON.parse(xhr.responseText || '{}')) : reject(new PublishError(explain(xhr.status, parseDetail(xhr.responseText)))));
    xhr.onerror = () => reject(new PublishError('Upload failed. Check your connection and try again.'));
    xhr.ontimeout = () => reject(new PublishError('The upload took too long. Try again on a faster connection.'));
    xhr.send(body instanceof Blob ? body : JSON.stringify(body));
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

const repoUrl = (path) => `${API}/repos/${P().repo}/${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Upload a file as a git blob (not yet part of any commit). Returns its sha. */
async function uploadBlob(file, onProgress) {
  const body = await uploadBody(file, { encoding: 'base64' }, (f) => onProgress?.(f * 0.1));
  const res = await sendWithProgress('POST', repoUrl('git/blobs'), body, (f) => onProgress?.(0.1 + f * 0.9));
  return res.sha;
}

/**
 * Make ONE commit on the branch that changes several files at once.
 * `build(list, existingNames)` gets the current index.json list and the file names in the folder,
 * and returns { list, files } where files is [{name, sha}] to add or [{name, sha: null}] to delete.
 *
 * Why one commit: separate commits in quick succession (PDF, cover, list) collide on GitHub
 * ("409 conflict"), trigger three site rebuilds, and can leave a file uploaded but never listed.
 * Here either everything lands or nothing does. If someone else pushed meanwhile, the final step
 * fails as "not a fast forward" and we rebuild on top of the new state and try again.
 */
async function commitChange(message, build) {
  const dir = P().dir;
  const branch = encodeURIComponent(P().branch);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(800 * attempt);
    try {
      const ref = await gh(repoUrl(`git/ref/heads/${branch}`));
      if (!ref) throw new PublishError(`The repository has no “${P().branch}” branch.`);
      const base = ref.object.sha;
      const baseCommit = await gh(repoUrl(`git/commits/${base}`));
      const folder = (await gh(contentsUrl(dir) + `?ref=${base}`)) || [];
      const names = Array.isArray(folder) ? folder.map((f) => f.name) : [];
      let list = [];
      const idx = Array.isArray(folder) && folder.find((f) => f.name === 'index.json');
      if (idx) {
        const blob = await gh(repoUrl(`git/blobs/${idx.sha}`));
        try { const parsed = JSON.parse(b64decodeText(blob.content)); if (Array.isArray(parsed)) list = parsed; } catch { /* treat a damaged list as empty */ }
      }
      const change = build(list, names);
      const tree = await gh(repoUrl('git/trees'), {
        method: 'POST',
        body: {
          base_tree: baseCommit.tree.sha,
          tree: [
            { path: `${dir}/index.json`, mode: '100644', type: 'blob', content: JSON.stringify(change.list, null, 2) + '\n' },
            ...change.files.map((f) => ({ path: `${dir}/${f.name}`, mode: '100644', type: 'blob', sha: f.sha })),
          ],
        },
      });
      const commit = await gh(repoUrl('git/commits'), { method: 'POST', body: { message, tree: tree.sha, parents: [base] } });
      await gh(repoUrl(`git/refs/heads/${branch}`), { method: 'PATCH', body: { sha: commit.sha, force: false } });
      return change.list;
    } catch (e) {
      lastErr = e;
      const retry = (e?.status === 422 || e?.status === 409) && /fast.?forward|reference|conflict|expected/i.test(e.message);
      if (!retry) throw e;
    }
  }
  throw lastErr;
}

/**
 * Upload a PDF (and optional cover) to the repo and list it, in a single commit. Resolves with the new book.
 * @param {{file: Blob, title: string, author?: string, category?: string, year?: number|null, note?: string, cover?: Blob|null, onProgress?: (fraction: number, stage: string) => void}} o
 */
export async function publishBook({ file, title, author = '', category = 'other', year = null, note = '', cover = null, onProgress }) {
  if (!getToken()) throw new PublishError('Add your GitHub access token first.');
  const maxBytes = P().maxMb * 1024 * 1024;
  if (file.size > maxBytes) throw new PublishError(`This PDF is ${(file.size / 1048576).toFixed(0)} MB. Public books can be up to ${P().maxMb} MB; keep it private instead, or compress it.`);
  const id = `${Date.now().toString(36)}-${slug(title)}`;

  onProgress?.(0, 'Preparing');
  const pdfSha = await uploadBlob(file, (f) => onProgress?.(f * 0.9, f < 0.1 ? 'Preparing' : 'Uploading'));
  let coverSha = null;
  if (cover) { try { coverSha = await uploadBlob(cover); } catch { /* a missing cover is fine */ } }

  onProgress?.(0.93, 'Saving');
  const entry = { id, title, author, category, year: year || null, note, file: `${id}.pdf`, cover: coverSha ? `${id}.jpg` : null, size: file.size, added: Date.now() };
  await commitChange(`Add public book: ${title}`, (list) => ({
    list: [entry, ...list.filter((e) => e.id !== id)],
    files: [{ name: entry.file, sha: pdfSha }, ...(coverSha ? [{ name: entry.cover, sha: coverSha }] : [])],
  }));

  store.set(PENDING_KEY, [entry, ...(store.get(PENDING_KEY, []) || [])]);
  onProgress?.(1, 'Done');
  return entryToBook(entry, true);
}

/** Remove a public book for everyone (owner only): listing and files go in one commit. */
export async function unpublishBook(book) {
  if (!getToken()) throw new PublishError('Add your GitHub access token first.');
  const id = book.sharedId;
  await commitChange(`Remove public book: ${book.title}`, (list, names) => {
    const entry = list.find((e) => e.id === id);
    const gone = [`${id}.pdf`, entry?.cover || `${id}.jpg`].filter((n) => names.includes(n));
    return { list: list.filter((e) => e.id !== id), files: gone.map((name) => ({ name, sha: null })) };
  });
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
