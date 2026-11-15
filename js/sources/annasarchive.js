// Anna's Archive search via API. Returns downloadable PDF metadata.
import { CONFIG } from '../config.js';
import { getJSON } from '../net.js';
import { guessCategory } from '../categories.js';

const API_BASE = 'https://annas-archive.gl/api/v1';

export async function searchAnnasArchive({ text, field = 'all', signal }) {
  const params = new URLSearchParams({
    q: text,
    limit: String(Math.min(40, CONFIG.search.catalogRows)),
  });
  const cacheKey = 'annas:' + params.toString();
  const data = await getJSON(`${API_BASE}/search?${params}`, {
    ttl: CONFIG.search.cacheTtlMs,
    cacheKey,
    signal,
  });
  return (data.results || []).map(toBook).filter(Boolean);
}

function toBook(item) {
  if (!item.title) return null;
  const title = item.title;
  const author = item.author || '';
  const year = item.year ? +item.year : null;
  const downloads = item.downloads ? +item.downloads : 0;
  const coverUrl = item.cover ? item.cover.replace(/^http:/, 'https:') : null;
  return {
    key: 'annas:' + item.id,
    source: 'annas',
    title,
    author,
    year,
    downloads,
    description: item.description || '',
    coverUrl,
    category: guessCategory(title + ' ' + author),
    state: 'READ',
    link: item.url || '',
  };
}