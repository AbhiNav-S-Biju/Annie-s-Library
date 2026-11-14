// Google Books: catalog metadata + limited previews. Never used as a free-reading source.
import { CONFIG } from '../config.js';
import { getJSON } from '../net.js';
import { guessCategory } from '../categories.js';

export async function searchGoogle({ text, field = 'all', signal }) {
  const params = new URLSearchParams({
    q: field === 'author' ? `inauthor:"${text.replace(/"/g, '')}"` : text,
    langRestrict: 'ml',
    printType: 'books',
    maxResults: String(Math.min(40, CONFIG.search.catalogRows)),
  });
  const cacheKey = 'gb:' + params.toString();
  if (CONFIG.googleBooksApiKey) params.set('key', CONFIG.googleBooksApiKey);
  const data = await getJSON(`https://www.googleapis.com/books/v1/volumes?${params}`, {
    ttl: CONFIG.search.cacheTtlMs,
    cacheKey, // never store the API key in cache keys
    signal,
  });
  return (data.items || []).map(toBook).filter(Boolean);
}

function toBook(item) {
  const v = item.volumeInfo || {};
  const a = item.accessInfo || {};
  if (v.language && v.language !== 'ml') return null;
  if (!v.title) return null;
  const view = a.viewability; // ALL_PAGES | PARTIAL | NO_PAGES
  const hasPreview = (view === 'PARTIAL' || view === 'ALL_PAGES') && a.embeddable !== false;
  const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail;
  const title = v.subtitle ? `${v.title}: ${v.subtitle}` : v.title;
  return {
    key: 'gb:' + item.id,
    source: 'google',
    googleId: item.id,
    title,
    author: (v.authors || []).join(', '),
    year: v.publishedDate ? +String(v.publishedDate).slice(0, 4) || null : null,
    description: v.description || '',
    coverUrl: img ? img.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
    category: guessCategory((v.categories || []).join(' ') + ' ' + title),
    state: hasPreview ? 'PREVIEW' : 'BUY',
    previewLink: hasPreview ? (v.previewLink || `https://books.google.com/books?id=${item.id}`).replace(/^http:/, 'https:') : null,
    link: (v.infoLink || '').replace(/^http:/, 'https:'),
  };
}
