# Annie's Library · ആനിയുടെ ലൈബ്രറി

Live: https://abhinav-s-biju.github.io/Annie-s-Library/

A personal, mobile-first web app for finding and reading Malayalam books. Static files only: no
backend, no build step, no accounts.

- **Read**: public-domain scans from Internet Archive, in a full-screen page-flip reader.
- **Preview**: Google Books limited previews (link out).
- **Buy**: in-copyright books get search links to Amazon.in, Flipkart and DC Books. No scraping, no store APIs.
- **Add my PDF**: read a PDF you own in the same reader. It stays on your device.
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
is a 3-page PDF for trying "Add my PDF".

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
js/search.js        parallel search, merge/de-dupe, ranking (featured > Read > Preview > Buy)
js/translit.js      Manglish → Malayalam (rules + lexicon), phonetic keys for fuzzy matching
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
  Common literary words and names are in the lexicon in `js/translit.js`; add more there.
- **DC Books** search links use `dcbookstore.com/search?q=`. That page renders client-side, so the
  results couldn't be checked automatically.
- **iPhone:** Safari has no element fullscreen, so the reader uses a fixed 100dvh overlay. "Add to Home Screen" gives the full-screen app.
