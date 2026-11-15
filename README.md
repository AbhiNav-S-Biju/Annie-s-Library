# Annie's Library · ആനിയുടെ ലൈബ്രറി

Live: https://abhinav-s-biju.github.io/Annie-s-Library/

A personal, mobile-first web app for finding and reading Malayalam books. Static files only: no
backend, no build step, no accounts.

- **Read**: public-domain scans from Internet Archive, in a full-screen page-flip reader.
- **Preview**: Google Books limited previews (link out).
- **Buy**: in-copyright books get search links to Amazon.in, Flipkart and DC Books. No scraping, no store APIs.
- **Add book**: add a PDF as **Private** (stays on this device) or **Public** (shown on every device).
- **Search by author** (or title & author), and **sort** by best match, oldest first or newest
  first. Tap an author's name in a book's details to see all their books.
- **My Shelf**: Want to read / Reading / Finished, bookmarks, and last-read page, all stored locally.
- Installable PWA. The app shell, your shelf and saved PDFs work offline.

## Run locally

Any static file server works. ES modules don't load from `file://`.

```bash
python -m http.server 5173
```

Then open http://localhost:5173. To test on a phone on the same Wi-Fi, run
`python -m http.server 5173 --bind 0.0.0.0` and open `http://<your-PC-IP>:5173`. The service worker
and fullscreen only work on `localhost` or HTTPS, so test install/offline after deploying.

`dev/reader-test.html` opens the reader on one hard-coded book (delivery step 1). `dev/sample.pdf`
is a 3-page PDF for trying "Add book".

## Configuration

Everything is in **`js/config.js`**:

| Setting | What it does |
| --- | --- |
| `featuredPath` | Path to the curated list (default `featured.json`). |
| `affiliate.amazon` / `affiliate.flipkart` | Optional affiliate tags. Empty means plain search links. |
| `stores` | Store search-URL templates (`{q}` = "title author"). |
| `googleBooksApiKey` | Optional. Without one, Google's shared anonymous quota is often exhausted (HTTP 429) and the app just skips Google results. Create a browser key in Google Cloud Console, enable the Books API, and restrict the key to your domain. |
| `sources` | Turn Internet Archive / Google Books / Open Library on or off. |
| `blockedArchiveIds` | IA items never offered for reading (e.g. unauthorised uploads). |
| `inCopyrightAuthors` | IA/Open Library items by these authors become **Buy** only, with no link to the upload. |
| `report.githubRepo` / `report.reportEmail` | Where "Report bad scan" goes: a prefilled GitHub issue if a repo is set, otherwise a prefilled email. |
| `reader.*`, `search.*` | Page image size, preload window, debounce, cache lifetimes. |

## Add a book to Featured

1. Find the book on archive.org and open its page: `https://archive.org/details/<identifier>`.
2. Check that it is **openly readable**: it should open in the viewer without "Borrow". It must be
   **public domain** (in India: the author died more than 60 years ago) or openly licensed.
   Don't add uploads of in-copyright books.
3. Copy the identifier from the URL and add an entry to `featured.json`:

```json
{
  "archiveId": "IndulekhafirstNovelOfMalayalam",
  "title": "ഇന്ദുലേഖ (Indulekha)",
  "author": "ഒ. ചന്തുമേനോൻ (O. Chandu Menon)",
  "category": "novels",
  "year": 1889,
  "note": "Shown as the description in the detail sheet (optional).",
  "coverUrl": "https://… (optional; defaults to the Internet Archive thumbnail)"
}
```

`category` is one of `novels`, `poetry`, `short-stories`, `childrens`, `history`, `religion`,
`drama`, `other`. Writing the title as "Malayalam (English)" helps search: both spellings match.

The list is fetched fresh on each visit, so edits show up after a deploy without bumping anything.

## Add your own books (Private or Public)

Tap **Add book**, pick a PDF, fill in the title (author, category and year are optional), and choose:

- **Private:** the PDF is stored in this browser only (IndexedDB). Nothing is uploaded. It appears in
  My Shelf on this device.
- **Public:** the PDF is committed to this site's GitHub repository under `public-books/` and listed
  in `public-books/index.json`. Every device then shows it under **Shared books**, and search finds it.
  Other devices see it after the site rebuilds, which takes about a minute; the device that
  published it can open it straight away.

There is still no server: GitHub is the storage. So publishing needs a GitHub access token from the
repository owner, entered once per device:

1. Open https://github.com/settings/personal-access-tokens/new (fine-grained token).
2. Repository access → **Only select repositories** → this repository.
3. Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
4. Generate, copy, and paste it into the Add book form the first time you choose Public.

The token is kept in that browser's storage only. Anyone using that browser could publish with it, so
don't set it up on a shared device; "Remove token" in the form forgets it. Visitors without a token
can read public books but can't add or remove them.

Things to know:

- **Public means public.** The site and the repository are open to anyone on the internet, so only
  publish books you wrote or that are free to share (public domain or openly licensed). The form asks
  you to confirm this.
- Public PDFs can be up to 50 MB (`CONFIG.publicBooks.maxMb`). GitHub asks repositories to stay
  under about 1 GB in total, so this suits a small shared collection, not a large one.
- To remove a public book, open it on a device that has the token and choose **Remove for everyone**.
  You can also delete its files and its entry in `public-books/index.json` on GitHub.
- Settings are in `CONFIG.publicBooks` in `js/config.js` (repo, branch, folder, size limit).

## Deploy

**GitHub Pages:** push this folder to a repo, then Settings → Pages → Deploy from branch → `main` /
root. All paths are relative, so a project site (`user.github.io/repo/`) works.

**Vercel / Netlify / Cloudflare Pages:** import the repo with no framework, no build command, and
output directory `.` (the repo root).

After changing any file listed in `SHELL` in `sw.js`, bump `VERSION` there. Our own files are served
network-first, so users get updates on the next load anyway. The version bump refreshes the offline copy.

## How it works

```
index.html, css/app.css
js/app.js           UI: library, search, detail sheet, shelf, theme
js/reader.js        full-screen reader (StPageFlip curl, or instant turns), zoom, gestures, resume
js/search/          the search engine (no UI code):
  intelligentSearch.js  orchestration: sources in parallel, abort, caching, rate-limit cooldown
  normaliseQuery.js     case/space/punctuation + safe Malayalam Unicode normalisation
  transliteration.js    Manglish → Malayalam candidates, phonetic keys, library romanisation
  lexicon.js            word list + dictionary of known titles/authors (suggestions only)
  queryExpansion.js     generateSearchVariants(), "did you mean"
  fuzzyMatcher.js       Fuse.js wrapper (+ built-in fallback)
  relevanceScorer.js    match tiers → relevance score
  mergeResults.js       de-duplication across sources, ranking, year sort
  searchCache.js        result cache + recently seen books
  suggestions.js        suggestions while typing (local, no network)
  searchTypes.js        JSDoc types: SearchQuery, SearchVariant, SearchResult, SearchSuggestion…
js/sources/*.js     Internet Archive, Google Books, Open Library
js/pdf.js           PDF.js rendering + IndexedDB storage for your own PDFs
js/storage.js       localStorage wrappers (all in try/catch), API response cache
sw.js               offline app shell, cached libraries/fonts/covers
```

- **Pages** come from `archive.org/download/{id}/{prefix}/page/n{i}_w{width}.jpg`. The page count
  (and page shape) come from the BookReader manifest, with `_page_numbers.json` and `imagecount` as
  fallbacks. The reader keeps about 6 pages loaded around the current one and releases the rest.
- **Gestures:** swipe or drag a corner to turn, tap the left/right edges, use the arrow keys, or use
  the slider. Pinch, double-tap the centre, or Ctrl+scroll to zoom. While zoomed, dragging pans
  instead of turning. A single tap in the centre shows or hides the bars.
- **Single page** in portrait, **two-page spread** in landscape (width > 1.1 × height and ≥ 560px).
- The page-turn animation follows `prefers-reduced-motion` until you change the switch in the reader menu.

## Search

Type a title, an author, part of a title, a misspelling, or Manglish; any of these works:

| You type | You get |
| --- | --- |
| `ആടുജീവിതം` | exact title match |
| `aadujeevitham`, `aadu jeevitham` | Manglish → ആടുജീവിതം |
| `aadjeevitham` | "Did you mean ആടുജീവിതം (Aadujeevitham — Benyamin)?" |
| `randamoozham`, `randamuzham` | രണ്ടാമൂഴം; Open Library is also asked for "rantamulam", which is how it catalogues *Raṇṭāmūḻaṃ* |
| `aadu`, `ജീവി` | partial matches (prefix search on IA; mid-word for single Malayalam words) |
| `Benyamin` (Author) | his books only, not Benjamin Bailey |

How it works:
1. **Normalise:** lowercase, collapse spaces, drop punctuation. Malayalam text is put into NFC and old encodings are unified (ന്‍ → ൻ, ൻറ → ന്റ, ൌ → ൗ), without touching conjuncts.
2. **Expand** (`generateSearchVariants`): the original, normalised and space-less forms, Manglish transliteration candidates, dictionary matches, and the older chillu encoding some catalogues use. At most 8 variants, deduplicated.
3. **Query sources concurrently:** one Internet Archive request (variants OR-ed), up to two Open Library requests, one Google Books request, whatever the number of variants. The search is debounced 350 ms, outdated requests are aborted, and after HTTP 429 a source is skipped for 10 minutes. API responses are cached for 24 h and ranked results for 10 minutes.
4. **Score:** exact title > normalised title > alternate title > transliteration > fuzzy title (Fuse.js) > exact author > partial title > fuzzy author > category > description. Weights and thresholds are in `CONFIG.search`.
5. **Merge and rank:** the same book from different sources becomes one card only if titles *and* authors agree. Then featured > Read > Preview > Buy, by relevance within each group.

Suggestions while typing are computed locally (no API calls): "Did you mean", the Malayalam spelling, known titles that start with what you typed, real books already loaded, and authors. Guesses with low confidence are not shown.

To improve Manglish for more books, add entries to `js/search/lexicon.js` (correct Malayalam + one English spelling).

### Tests

```bash
npm install
```

```bash
npm test
```

Offline unit tests cover normalisation, transliteration, expansion, ranking, de-duplication, failure handling, caching and abort. `LIVE=1 npm run test:live` runs the spec queries against the real APIs.

Fuse.js 7.1.0 comes from jsDelivr through the import map in `index.html` (and from npm in tests). `package.json` exists only for the tests; the site still has no build step.

## Limits and known issues

- **Google Books:** the keyless quota was exhausted (HTTP 429, limit 0) every time this was tested.
  Without a key there are effectively no Preview results.
- **Internet Archive:** page images have no CORS headers, so the service worker doesn't cache them
  (opaque responses waste storage quota). Reading needs a connection; the browser's HTTP cache keeps
  recently viewed pages for about an hour. The first page of a book can take a few seconds while IA
  prepares the image.
- **Copyright filtering is best-effort.** IA licences are self-declared by uploaders. The app trusts
  IA's "not lending-restricted" flag, then applies `blockedArchiveIds` and `inCopyrightAuthors`. Use
  "Report bad scan or copyright problem" to collect more IDs.
- **Manglish → Malayalam** is a best guess (vowel length and ṭ/t, ḷ/l are ambiguous in Manglish). The
  app always searches the original text as well, and fuzzy matching handles spelling variants.
  Common literary words and names are in the lexicon in `js/search/lexicon.js`; add more there.
  On its own, the rule engine gets common words right (ചെമ്മീൻ first; ആടുജീവിതം second) but can't recover
  vowel length the user didn't type (randamoozham → രണ്ടമൂഴം); the dictionary and the phonetic fuzzy
  matcher cover those. Samvruthokaram (final ്) yields both …ു and …് candidates.
- **Open Library** romanises Malayalam (ALA-LC), so Manglish spellings only match there via the
  generated romanisation, which is approximate (it found *Raṇṭāmūḻaṃ* and *Cemmīn*, but not every title).
- Mid-word Malayalam search on Internet Archive uses a leading wildcard, which takes 2–3 s, so it is
  only used for single-word Malayalam queries.
- **DC Books** search links use `dcbookstore.com/search?q=`. That page renders client-side, so the
  results couldn't be checked automatically.
- **iPhone:** Safari has no element fullscreen, so the reader uses a fixed 100dvh overlay. "Add to Home Screen" gives the full-screen app.
