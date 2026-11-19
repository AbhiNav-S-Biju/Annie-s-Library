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

## Read offline (Download)

Open any free-to-read book and tap **Download for offline**. The pages are saved on that device, and
the book then opens in the same page-flip reader with no internet. Downloaded books show a small
arrow mark on their cover and are listed under **Downloads** in the bottom bar, where you can also see how much
space they use and remove them. The download button shows its progress as it fills; tap the round
stop button beside it to cancel, and a short sound plays when the download finishes (switch it off in
the notifications panel).

- **Internet Archive books:** each page is saved as an image (about 0.2 MB per page, so a 200-page
  book is around 40 MB). A download takes a few minutes. It can run in the background while you browse
  (keep the app open), you can cancel at any time, and if it is interrupted it resumes where it
  stopped. A book you started reading while only partly downloaded fills the missing pages from the
  internet.
- **Shared (public) books:** the PDF is saved on the device.
- The app itself (the library, your shelf, the featured list) also works offline once it has been opened
  once, so a downloaded book can be opened with no connection at all.

How it works, and why: the reader's normal page images and Internet Archive's PDF files cannot be read
by a website (the Archive doesn't allow it), so they can't be saved. Its IIIF image service
(`iiif.archive.org`) does allow it, so downloads use that. It is slower and less reliable than the
reader's own endpoint: some pages time out at one size and work at another, so every page is tried at
several widths (1000, 800, 900, 700 px), and a second width is started alongside if the first is slow.
Settings are in `OFFLINE` at the top of `js/offlineBooks.js`.

Limits:
- Offline pages are saved at about 1000 px wide, so zooming in offline shows that resolution (online,
  the reader fetches sharper pages when you zoom).
- Browsers may delete saved data if the device runs very low on storage; the app asks the browser to
  keep it, and reopens a book as "Resume download" if pages went missing.
- If Internet Archive is slow or busy, a few pages may fail; the book then shows **Resume download**.
- Opening a downloaded book resumes at your last page, the same as online.

## New-book notifications

The bell at the top right shows when a book has been added to the library since you last looked (a new
entry in `featured.json` or a new shared book). Tap a notification to open that book. There's no server,
so this works by checking those lists when the app opens, when you come back to it, and every 10 minutes
while it's open (`CONFIG.notifications.checkEveryMs`). It can't alert a closed app; real push alerts
would need a server. The first time the app runs on a device, everything already there counts as seen.

## Sounds

The download-complete cue is synthesised in the browser (`js/sounds.js`), an original sound inspired
by "Landed" on bencho.dev. Bencho's own sound files can only be downloaded with a Bencho Pro account;
if you have one, put the WAV in the site and set `CONFIG.sounds.downloadComplete` to its path (for
example `'sounds/landed.wav'`) to use it instead.

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
- Public PDFs can be up to **40 MB** when added from the app (`CONFIG.publicBooks.maxMb`). That is
  GitHub's real limit for uploads through its API: in testing, 40 MB was accepted and 45 MB and up
  was refused as "too large to process". Compressing a scanned PDF usually gets it under.
- Bigger files (up to GitHub's 100 MB git limit) can be added from a computer with git: put the PDF
  in `public-books/`, add an entry like
  `{ "id": "my-book", "title": "…", "author": "…", "category": "novels", "year": 1930, "file": "my-book.pdf", "cover": null, "size": 0, "added": 0 }`
  to `public-books/index.json`, commit and push.
- Publishing is one commit (PDF, cover and list together), so a failed upload leaves nothing behind.
  GitHub asks repositories to stay under about 1 GB in total, so this suits a small shared
  collection, not a large one.
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
js/offlineBooks.js  offline downloads: IIIF page download, resume, storage, offline reader source
js/notifications.js new-book notifications (seen list, read state)
js/sounds.js        synthesised download-complete sound
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
