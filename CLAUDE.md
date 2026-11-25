# Lectern

Lectern is a self-hosted web app for finding and getting audiobooks and ebooks
from MyAnonamouse (MAM). It sends downloads to qBittorrent and files finished
books into Audiobookshelf with the right title, series and book number. The
goal: **search on your phone, tap once, and the book shows up correctly in
your library.**

Read `docs/DESIGN.md` for the full product design. This file is the short
version plus the rules for working in this repo.

## Ground rules

- **Original code only.** Lectern is a fresh project. Don't copy code from
  Shelfarr, pagearr or any other request app. Reading public API docs is fine.
- **This repo is public.** Never commit secrets, cookies, IP addresses,
  hostnames, real library paths or people's names. All configuration comes from
  environment variables. `.env` files are git-ignored, and `.env.example` shows
  the keys with blank values.
- **Keep it maintainable by a non-expert.** The owner is learning as he goes.
  Prefer plain, well-named code over clever code. Add a short comment wherever
  the *why* isn't obvious. Add a dependency only when it clearly earns its place.
- **Small steps.** Build one roadmap item at a time, keep the app runnable after
  each change, and update this file when a decision changes.

## Stack

| Part | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Server | Node 22, Fastify, SQLite via better-sqlite3 |
| Web | Vue 3 + Vite + vue-router, installable as a PWA (later) |
| Shared | `packages/shared`: types and helpers used by both server and web |
| Deploy | One Docker image (`ghcr.io/<owner>/lectern`, built by `.github/workflows/image.yml` for amd64 and arm64). The server serves the built web app and the API on one port. Runs as `PUID`/`PGID` (`docker/entrypoint.sh`) |
| Licence | GPL-3.0-or-later |

## Layout

```
packages/
  shared/   types (Book, Series, SearchResult...) and pure helpers
  server/   Fastify API, config, database, integrations (MAM, qBittorrent, Audiobookshelf)
  web/      Vue app
docs/       DESIGN.md, screenshots (made-up names only)
docker/     entrypoint.sh (PUID/PGID)
.github/    the image workflow
Dockerfile, docker-compose.example.yml (plain), docker-compose.vpn.example.yml, .env.example
```

## Commands

```
npm install          # install everything (npm workspaces)
npm run dev          # server on :8787 and Vite on :5173, with the API proxied
npm run typecheck    # all packages
npm test             # unit tests (vitest)
npm run build        # build shared, server and web
npm start            # run the built server (serves the web app too)
docker build -t lectern .
```

## How Lectern talks to other services

### MAM: be a polite client
- All MAM traffic goes through `packages/server/src/mam/client.ts`. Nothing else
  may call MAM.
- **Never from the home IP.** The MAM session is locked to the VPN's network. In
  production Lectern runs inside qBittorrent's network (`network_mode:
  service:qbittorrent`) with `MAM_REQUIRE_INTERFACE=wg0`, so the client refuses
  to send anything while the tunnel is down.
- Never call MAM when a page loads. Use only user actions and spaced-out
  background jobs. Opening the Search page with a query in its address only
  reads the cache (`cached=1`); MAM is asked when Search is pressed.
- **Search is MAM first** (`search/mamSearch.ts`): one MAM request per search,
  100 results, cached 3 hours and shared by all profiles. Results are filtered
  (language, title/author/series match), grouped into books and ordered without
  asking MAM again. Opening a found book costs nothing.
- **At most 150 MAM searches a day** (`DAILY_SEARCH_LIMIT`; cache hits don't
  count). One queue, at least 2 seconds between requests.
- Author/series pages never contact MAM on their own. "Check what's on MAM"
  (`search/onMam.ts`) is one search for the whole page. A book opened from those
  pages without a check still uses the old fan-out (`search/availability.ts`):
  at most 3 queries, stopping early on a strong match.
- **MAM only allows automating what's on its API page.** Lectern uses exactly
  three of those: *Torrent Search (JSON)*, *Download Torrent* and the user
  summary `GET /jsonLoad.php?snatch_summary` (ratio and unsatisfied count).
  Anything else (and anything that "impacts the site negatively") can cost the
  account.
- Account stats (`mam/stats.ts`): asked hourly in the background, and by a
  Refresh button at most every 5 minutes for the whole server. Pages only read
  the saved copy, never MAM. Ratio is worked out from the byte counts.
- Search: `POST /tor/js/loadSearchJSONbasic.php` with a JSON `tor` body
  (confirmed against MAM's API docs). `main_cat`: 13 = AudioBooks,
  14 = E-Books. `srchIn` accepts title, author, narrator, series (and others).
  Answers come as strings: numbers ("40"), size in bytes ("6324306932"),
  several file types in one string ("m4a mp3"), authors/series as JSON strings,
  series numbers that can be packs ("01-16, 13.5"), and sometimes `name`
  instead of `title`. "No results" arrives as an `error` message. `free` or
  `personal_freeleech` means free to download; `fl_vip` alone doesn't.
- Never send `dlLink`: it returns personal download keys Lectern doesn't need.
- Download: `GET /tor/download.php?tid=<id>` with the session cookie.
  **Never add `&fl`**: it spends a freeleech wedge, and there are no refunds.
  Only ever do that if the person explicitly chooses it for that torrent.
- MAM may send back a refreshed `mam_id` cookie. **Always store the newest one**,
  so the session keeps renewing itself. If the session fails, show a clear
  "MAM session expired" message with a place to paste a new cookie.
- Check MAM's rules on automated tools before publishing. Treat them as
  binding.

### qBittorrent: work with any version
- Decide whether a login worked from the result (an `SID` cookie, then a test call
  such as `/api/v2/app/version`), never from the response text. Versions differ
  ("Ok." vs an empty body).
- Give separate errors for "wrong password", "can't reach qBittorrent" and
  "qBittorrent is up but the VPN isn't".
- qBittorrent 5.2+ can use an API key (`QB_API_KEY`, sent as
  `Authorization: Bearer`). When set, it replaces the username and password, so
  a Web UI password change doesn't break Lectern. Older versions keep the login.

### Add to Library (packages/server/src/requests/service.ts)
- A request goes sending → downloading → importing → done (or failed, with a
  message and a retry). It's all in the `requests` table, so restarts resume.
- The .torrent's info hash (computed by Lectern, `torrent/torrentFile.ts`) is
  how Lectern follows it in qBittorrent. Adding is confirmed by looking the
  torrent up, never by qBittorrent's reply text.
- A watcher checks qBittorrent every 10 seconds. It only talks to qBittorrent,
  never MAM.
- qBittorrent tags: `audiobook`/`ebook`, `MAM`, `mamid=<torrent id>`, `lectern`
  (matching the other MAM tools on the box).
- qBittorrent category per profile: the profile's name for audiobooks
  (`Sam`), `Sam-Ebook` for ebooks. `QB_CATEGORY` is only the fallback for
  requests without a profile.
- Importing never overwrites: if the book's folder already has files, it's
  marked done with "Already in your library".

### Audiobookshelf: no guessing
- Lectern already knows the exact book from its search step. On import it:
  - files the book as `Author/Series/Book N - Title/`;
  - writes a `metadata.json` next to the files;
  - saves the cover;
  - tells Audiobookshelf the exact match (an ASIN for audio, an ISBN for
    ebooks), then triggers a scan.
- Use hardlinks when downloads and libraries share a drive, so seeding keeps
  working and no space is wasted.
- **Tidy up** (`tidy/`, Settings → Tidy up, admin only) fixes books already in
  a library: scan (changes nothing) → the admin picks → apply → undo. Details
  only, through Audiobookshelf's API (title, authors, series and number,
  narrators, ASIN, a missing year, a missing cover). It never moves or renames
  files, never blanks a field, never replaces an existing cover or year, and
  saves each book's "before" so a run can be undone. Anything less than a clear
  match is "needs a look" and not ticked. Audible is asked one book at a time,
  answers cached 30 days. Moving folders is a later step.
  Series are never renamed for spelling ("Paradox" = "Paradox Series":
  `seriesKey`), only added when missing or their number corrected; a match
  from a different series is never used; narrators are only filled when
  missing. Titles that are just "Series, Book 3" are looked up by series and
  number (`seriesFromTitle`, `chooseBySeries`). A title is never shortened by
  dropping real words ("X: Skulls and Stones" → "X" is refused: `losesWords`);
  only edition notes and series filler may go. "Series: Book Name" titles are
  also searched by the part after the colon (`titleVariants`), and a known book
  number (from Audiobookshelf, the title or the folder: `numberFromPath`)
  rules out other books in the series, so the result is the book's own title
  with the series set ("Skulls and Stones", Monster Girl Defense Force #2).

### Profiles, sign-in and settings
- Every `/api` route needs a signed-in profile except health, sign-in and
  first-run setup (`auth/guard.ts`). `/api/admin/*` needs an admin. The guard
  decides by the **matched route pattern** (`req.routeOptions.url`), never the
  raw address, because `/%61pi/...` also reaches `/api/...`. State-changing
  requests must come from Lectern's own page (Origin check).
- First-run setup needs a one-time code that Lectern prints in its log.
- Passwords are hashed with scrypt; session tokens are stored only as SHA-256
  hashes. Sign-in tries count as they start (so parallel guesses are limited
  too): 5 per address and 20 per name per 15 minutes.
- Connection settings live in the database (`settings.ts`) on top of the
  environment: the environment gives defaults, saved values win, and changes
  apply without a restart. Read config through `readConfig()` / the getter, never
  copy it once at startup. Secrets are never sent back to the browser, only
  whether they're set and their last 4 characters. Changing qBittorrent's or
  Audiobookshelf's address needs its password or key typed again, so a saved
  secret can't be sent somewhere new. `MAM_REQUIRE_INTERFACE` is
  environment-only.
- Each profile has its own library folders and Audiobookshelf libraries.
  `LIBRARY_*` and `ABS_*_LIBRARY_ID` only seed the first admin. A request files
  into the library of the profile that made it.
- Covers are only fetched through `coverFetch.ts`: https, a short list of known
  cover hosts, and every redirect re-checked. The web app shows them through
  `/api/cover`, which caches small WebP copies.

### Metadata
- Book info (covers, descriptions, ASINs, series lists, "did you mean") comes
  from Audible's public catalogue (best for audio), Google Books (best for
  ebooks: ISBNs) and Open Library (backup). Never from MAM. Covers for search
  results are fetched only for books on screen (`search/details.ts`), cached 30
  days, and used only when title and author clearly match.
- Each profile has a book language (`users.language`, default English, or
  "any"). Search, author and series pages hide other languages; books whose
  language isn't known are kept. Author pages match Audible's author ID when
  known, otherwise the exact name (initials written any way: `sameAuthor`).
- Google Books without a key shares a quota with everyone else's keyless
  requests, which runs out. Set `GOOGLE_BOOKS_API_KEY`. After any "quota
  exceeded" (429, or a 403 that mentions quota), a source rests for an hour
  instead of being retried on every search.
- Fallback order when importing: Audible data (via Audnexus) for audio, then
  Google Books, Open Library, Hardcover, the MAM listing, and finally the file's
  embedded tags.
- Score every match. When the sources disagree, put the book in a "needs a look"
  list rather than guessing.

## Roadmap (current position in bold)

1. Skeleton: server, web, shared types, config, database, Docker image ✅
2. Smart search: the metadata lookup (Audible, Google Books, Open Library),
   "did you mean", then a MAM fan-out for the chosen book, merge and rank ✅
   (tested against live MAM through the VPN)
3. Author and series pages (series in reading order) ✅
4. **qBittorrent hand-off and hands-off Audiobookshelf import.** Built; still
   to test with a real download.
5. The new UI and cover caching (small WebP thumbnails), installable on a
   phone ✅ (offline support later)
6. Profiles with sign-in and separate libraries per person, and an admin
   Settings panel for all connections ✅. Still to do: the ebook side, a watch
   list, new releases
7. Tidy up: an admin-only tool that fixes existing Audiobookshelf libraries
   (dry run + undo). Details ✅ (built, to test on a real library); folders later
8. Polish, a one-command install and docs, then check with MAM before sharing.
   README, published image, PUID/PGID and the hardlink check ✅

## Brand

The working name is Lectern. Colours: forest green `#1F3A2E` and cream
`#F1E6CF`. The icon is a reading stand holding an open book, with text on the
left page and a waveform on the right, and sound rippling off its edge.
