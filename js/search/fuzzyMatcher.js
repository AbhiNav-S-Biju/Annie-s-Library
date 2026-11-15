// @ts-check
// Fuzzy matching. Uses Fuse.js (pinned 7.1.0; browser: CDN via the import map in index.html,
// Node tests: npm). If Fuse can't load (offline first visit, CDN blocked) a small built-in
// matcher with the same interface takes over, so search never breaks.
import { CONFIG } from '../config.js';

/** @type {any} */
let FuseCtor = null;
/** @type {Promise<boolean> | null} */
let loading = null;

/** Load Fuse.js once. Resolves true when Fuse is available. */
export function loadFuse() {
  if (FuseCtor) return Promise.resolve(true);
  if (!loading) {
    loading = import('fuse.js')
      .then((m) => { FuseCtor = m.default || m.Fuse || null; return !!FuseCtor; })
      .catch(() => false);
  }
  return loading;
}
export const usingFuse = () => !!FuseCtor;

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0 (identical) .. 1 (unrelated); like Fuse scores. Allows the query to match anywhere (partial). */
function fallbackScore(q, text) {
  if (!q || !text) return 1;
  if (text === q) return 0;
  if (text.includes(q)) return 0.05 + 0.1 * (1 - q.length / text.length);
  // best window of similar length
  let best = 1;
  const L = q.length;
  for (let i = 0; i <= Math.max(0, text.length - L); i++) {
    for (const len of [L - 1, L, L + 1]) {
      if (len <= 0 || i + len > text.length) continue;
      const d = levenshtein(q, text.slice(i, i + len)) / L;
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * @template T
 * @typedef {{name: string, weight?: number}} MatchKey
 */

/**
 * Create a matcher over `docs`.
 * @template T
 * @param {T[]} docs
 * @param {Array<{name: string, weight?: number}>} keys   field names (string or string[] values)
 * @param {{threshold?: number}} [opts]
 * @returns {{search: (q: string, limit?: number) => Array<{item: T, score: number}>}}
 */
export function createMatcher(docs, keys, opts = {}) {
  const threshold = opts.threshold ?? CONFIG.search.fuzzy.threshold;
  if (FuseCtor) {
    const fuse = new FuseCtor(docs, {
      keys,
      includeScore: true,
      ignoreLocation: true,     // partial words can match anywhere in a title
      threshold,
      minMatchCharLength: 2,
      shouldSort: true,
    });
    return {
      search(q, limit = 20) {
        if (!q) return [];
        return fuse.search(q, { limit }).map((r) => ({ item: r.item, score: r.score ?? 1 }));
      },
    };
  }
  return {
    search(q, limit = 20) {
      if (!q) return [];
      const out = [];
      for (const item of docs) {
        let best = 1;
        for (const k of keys) {
          const v = /** @type {any} */ (item)[k.name];
          for (const s of [].concat(v || [])) best = Math.min(best, fallbackScore(q, String(s)));
        }
        if (best <= threshold) out.push({ item, score: best });
      }
      return out.sort((a, b) => a.score - b.score).slice(0, limit);
    },
  };
}
