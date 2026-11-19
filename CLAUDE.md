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
| Deploy | One Docker image. The server serves the built web app and the API on one port |

## Layout

```
packages/
  shared/   types (Book, Series, SearchResult...) and pure helpers
  server/   Fastify API, config, database, integrations (MAM, qBittorrent, Audiobookshelf)
  web/      Vue app
docs/       DESIGN.md and other notes
Dockerfile, docker-compose.example.yml, .env.example
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
  background jobs. Search asks MAM only after the person picks a book.
- A chosen book fans out to **at most 3** MAM queries (title + surname, then
  series + surname, then author), stopping early on a strong match. Requests go
  through one queue at least 2 seconds apart, and results are cached for 15
  minutes.
- **MAM only allows automating what's on its API page.** Lectern uses exactly
  two of those: *Torrent Search (JSON)* and *Download Torrent*. Anything else
  (and anything that "impacts the site negatively") can cost the account.
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

### Audiobookshelf: no guessing
- Lectern already knows the exact book from its search step. On import it:
  - files the book as `Author/Series/Book N - Title/`;
  - writes a `metadata.json` next to the files;
  - saves the cover;
  - tells Audiobookshelf the exact match (an ASIN for audio, an ISBN for
    ebooks), then triggers a scan.
- Use hardlinks when downloads and libraries share a drive, so seeding keeps
  working and no space is wasted.

### Metadata
- Search suggestions come from Audible's public catalogue (best for audio:
  forgiving of typos, knows series) and Google Books (best for ebooks: ISBNs).
  Open Library is the backup: always asked for ebooks, and for audiobooks while
  Google is resting. Results are merged so each book appears once, and cached
  for 24 hours.
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
3. **Author and series pages (series in reading order)**
4. qBittorrent hand-off and hands-off Audiobookshelf import
5. The new UI and cover caching (small WebP thumbnails)
6. Profiles (separate libraries per person), the ebook side, a watch list, new releases
7. Tidy up: an admin-only tool that fixes existing Audiobookshelf libraries (dry run + undo)
8. Polish, a one-command install and docs, then check with MAM before sharing

## Brand

The working name is Lectern. Colours: forest green `#1F3A2E` and cream
`#F1E6CF`. The icon is a reading stand holding an open book, with text on the
left page and a waveform on the right, and sound rippling off its edge.
