// Open Library: catalog metadata. Items with a public (not borrow-only) IA scan become READ.
import { CONFIG } from '../config.js';
import { getJSON } from '../net.js';
import { guessCategory } from '../categories.js';
import { stripHtml } from './ia.js';

const FIELDS = 'key,title,subtitle,author_name,first_publish_year,cover_i,ia,ebook_access,subject,language';

export async function searchOpenLibrary({ text, signal }) {
  const params = new URLSearchParams({ q: text, language: 'mal', limit: String(CONFIG.search.catalogRows), fields: FIELDS });
  const data = await getJSON(`https://openlibrary.org/search.json?${params}`, { ttl: CONFIG.search.cacheTtlMs, signal });
  return (data.docs || []).map(toBook).filter(Boolean);
}

function toBook(d) {
  if (!d.title) return null;
  const iaId = (d.ia || []).find((id) => !CONFIG.blockedArchiveIds.includes(id));
  const author = (d.author_name || []).join(', ');
  const inCopyright = CONFIG.inCopyrightAuthors.some((a) => author.toLowerCase().includes(a));
  const readable = d.ebook_access === 'public' && iaId && !inCopyright;
  return {
    key: readable ? 'ia:' + iaId : 'ol:' + d.key,
    source: 'openlibrary',
    olKey: d.key,
    archiveId: readable ? iaId : undefined,
    title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title,
    author,
    year: d.first_publish_year || null,
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    category: guessCategory((d.subject || []).slice(0, 15).join(' ') + ' ' + d.title),
    state: readable ? 'READ' : 'BUY',
    link: `https://openlibrary.org${d.key}`,
  };
}

/** Work description (fetched lazily when the detail sheet opens). */
export async function getOpenLibraryDescription(olKey, { signal } = {}) {
  const d = await getJSON(`https://openlibrary.org${olKey}.json`, { ttl: CONFIG.search.metaCacheTtlMs, signal });
  const desc = typeof d.description === 'string' ? d.description : d.description?.value;
  return desc ? stripHtml(desc) : '';
}
