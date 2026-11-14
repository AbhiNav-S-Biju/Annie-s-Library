import { cacheGet, cachePut } from './storage.js';

const inflight = new Map();

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

/**
 * GET JSON with a TTL cache (memory + localStorage) and in-flight de-duplication.
 * `cacheKey` defaults to the URL; pass one without secrets (API keys) in it.
 */
export async function getJSON(url, { ttl = 0, signal, timeout = 15000, cacheKey = url, map } = {}) {
  if (ttl) {
    const hit = cacheGet(cacheKey);
    if (hit !== undefined) return hit;
  }
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const p = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new HttpError(res.status, url);
      let data = await res.json();
      if (map) data = map(data);
      if (ttl) cachePut(cacheKey, data, ttl);
      return data;
    } finally {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, p);
  return p;
}

export function isAbort(e) { return e?.name === 'AbortError'; }
