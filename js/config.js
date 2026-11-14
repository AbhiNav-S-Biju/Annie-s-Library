// All app configuration lives here. Edit this file, nothing else, to customise a deploy.
export const CONFIG = {
  appName: "Annie's Library",

  // Curated "good books" list (relative to index.html).
  featuredPath: 'featured.json',

  // Optional affiliate tags for store links. Leave empty for plain search links.
  affiliate: {
    amazon: '',   // appended as &tag=...
    flipkart: '', // appended as &affid=...
  },

  // Store search-URL templates. {q} is replaced with the URL-encoded "title author".
  stores: [
    { id: 'amazon', label: 'Amazon.in', url: 'https://www.amazon.in/s?k={q}', affParam: 'tag' },
    { id: 'flipkart', label: 'Flipkart', url: 'https://www.flipkart.com/search?q={q}', affParam: 'affid' },
    { id: 'dcbooks', label: 'DC Books', url: 'https://dcbookstore.com/search?q={q}' },
  ],

  // Google Books works without a key but the shared anonymous quota is often exhausted (HTTP 429).
  // A free browser key from console.cloud.google.com (restrict it to your domain) fixes that.
  googleBooksApiKey: '',

  // Turn individual sources off without touching code.
  sources: { internetArchive: true, googleBooks: true, openLibrary: true },

  // Internet Archive items that must never be offered for reading (e.g. unauthorised uploads of
  // in-copyright books). Add identifiers as you find them; use the in-app "Report" link to collect them.
  blockedArchiveIds: [
    'AadujeevithamByBenyamin',
  ],
  // Lucene clauses AND-ed onto every Internet Archive query to keep non-book material out.
  // Without these, ~96% of IA's "Malayalam texts" are Kerala Gazette issues and Legislative Assembly
  // proceedings (about 213,000 of 221,000), which bury the books, especially when sorting by year.
  iaExclude: [
    '-collection:(gazetteofindia)',
    '-identifier:keralalegislativeassembly*',
    '-title:(bulletin OR "SDOF Sunday")', // weekly church newsletters
  ],

  // IA items whose creator contains one of these (case-insensitive) are treated as catalog-only (BUY),
  // because these authors' works are still in copyright in India (life + 60 years).
  inCopyrightAuthors: [
    // Matched as substrings of the IA "creator" field, so keep entries specific.
    'benyamin', 'basheer', 'vasudevan nair', 'thakazhi', 'o. v. vijayan', 'o.v. vijayan',
    'madhavikutty', 'kamala das', 'kamala surayya', 'vayalar', 'sugathakumari',
    'paul zacharia', 'k. r. meera', 'k.r. meera', 'subhash chandran', 'm. mukundan',
    'pottekkatt', 'uroob', 'kesavadev', 'lalithambika', 'akkitham',
    'onv kurup', 'o. n. v. kurup', 'thikkodiyan', 'perumbadavam', 'kakkanadan',
    'punathil kunjabdulla', 'n. s. madhavan',
  ],

  // Where "Report bad scan" goes. If githubRepo is set ("owner/repo"), a prefilled GitHub issue opens;
  // otherwise a prefilled email to reportEmail (may be empty: the mail app opens with no recipient).
  report: { githubRepo: 'AbhiNav-S-Biju/Annie-s-Library', reportEmail: '' },

  // Reader
  reader: {
    pageWidthPx: 800,   // IA page image width requested (_w{n}); scaled by devicePixelRatio, capped at maxPageWidthPx
    maxPageWidthPx: 1200,
    preloadAhead: 3,    // pages kept loaded after the current one
    keepBehind: 2,      // pages kept loaded before the current one
    autoHideMs: 2800,   // top bar auto-hide delay
  },

  // Search
  search: {
    debounceMs: 350,
    iaRows: 36,
    catalogRows: 20,
    cacheTtlMs: 24 * 60 * 60 * 1000,      // search responses
    metaCacheTtlMs: 7 * 24 * 60 * 60 * 1000, // item metadata
  },

  categories: [
    { id: 'all', label: 'All', ml: 'എല്ലാം' },
    { id: 'novels', label: 'Novels', ml: 'നോവൽ' },
    { id: 'poetry', label: 'Poetry', ml: 'കവിത' },
    { id: 'short-stories', label: 'Short stories', ml: 'കഥകൾ' },
    { id: 'childrens', label: "Children's", ml: 'ബാലസാഹിത്യം' },
    { id: 'history', label: 'History', ml: 'ചരിത്രം' },
    { id: 'religion', label: 'Religion', ml: 'ആത്മീയം' },
    { id: 'drama', label: 'Drama', ml: 'നാടകം' },
    { id: 'other', label: 'Other', ml: 'മറ്റുള്ളവ' },
  ],
};
