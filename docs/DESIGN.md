# Lectern design

The product design as agreed so far. CLAUDE.md has the working rules and
roadmap. This file explains what we're building and why.

## The goal

Search on your phone, tap once, and the book shows up correctly in your
library, with the right series, book number and cover. Nothing to fix by hand.
Easy to host, easy to update, and easy for other MAM users to install.

## Principles

- **Hands-off:** decide the exact book up front, so nothing downstream guesses.
- **Forgiving search:** typos, partial names and series names all work.
- **Fast:** covers and results appear instantly, even on mobile data.
- **Separate profiles:** each person has their own libraries, requests and settings.
- **One container:** a single Docker image and one config file.
- **Works in the browser:** a PWA that can be added to the home screen. No app
  store and no native build.

## Search: MAM first

Everything Search lists is something MAM actually has.

1. **One MAM search** when you press Search (never while typing, never when a
   page merely opens). Title, author, series and narrator; up to 100 results.
   Answers are kept for 3 hours and shared by every profile.
2. **Tidy, without asking MAM again:** hide other languages (each profile picks
   one); keep results whose title, author or series match what was typed and
   move narrator-only matches under "more that matched another way"; group
   uploads of the same book (title + author + series number) with the best
   version first; single books before packs unless a series was searched.
3. **Covers and descriptions** come from Audible, Google Books and Open Library,
   only for books on screen, and only when title and author clearly match.
4. **Typos:** if MAM finds nothing, Audible/Google suggest a spelling, shown as
   a button. MAM is searched again only if it's tapped.
5. **Limits:** one request at a time, 2 seconds apart, at most 150 searches a
   day (cached answers don't count).

Opening a book from Search costs MAM nothing: its versions came with the search.

### Author and series pages
- Books come from Audible and Google Books. Opened from a book, an author page
  uses Audible's author ID, so look-alike names (R. Knight, R.J. Knight) don't
  mix. Other languages are hidden.
- **Check what's on MAM** does one MAM search for the whole page and marks each
  book "On MAM" or "Not found on MAM". Only when the button is pressed.

## Audiobooks and ebooks

- A switch at the top picks Audiobooks or Ebooks, and each profile has its own
  default.
- Each type has its own folders and import path. Audio goes to an Audiobookshelf
  audio library. Ebooks are converted to EPUB and go to that person's ebook
  library.
- Ebooks get the same metadata matching and filing as audiobooks.
- The first version only finds and gets books. Delivery to e-readers stays with
  existing tools.

## Layout

There are four tabs along the bottom:

- **Home:** a search bar, "Continue your series", "New from authors you follow"
  and "Recently added".
- **Search:** smart search, with Audiobooks and Ebooks tabs and filters for
  author, series and narrator.
- **Library:** what you own, grouped by series.
- **Downloads:** progress, plus the "needs a look" list.

A small top bar shows the Lectern name and your profile picture, which opens
**Settings**:
- **You:** your default (audiobooks or ebooks) and your password.
- **Connections** (admins): MAM, qBittorrent, Audiobookshelf and book
  information, each with a test button. Values from the environment show as
  defaults; saved values can be reset.
- **Profiles** (admins): add, edit and remove profiles; pick each one's library
  folders (with a folder browser) and Audiobookshelf libraries.
- Later, the admin-only **Tidy up** tool.

### Profiles and sign-in
- First run asks for the admin's name and password, plus a one-time setup code
  from Lectern's log, so a stranger who finds a fresh install can't claim it.
- The sign-in page shows "Who's reading?" with a tile per profile, then a
  password. Admins can hide the names (people then type their name).
- Each profile has its own audiobook and ebook folder and Audiobookshelf
  library. "Add to Library" files the book into the library of whoever tapped it.
- Downloads shows your own books; admins can switch to everyone's.
- Sessions last 30 days and renew while in use. Changing a password signs out
  your other devices.

### Book page
- A big cover, with the page background tinted from the cover's colours.
- Title, author, narrator and length, plus a series line you can tap
  ("Mistborn, Book 2").
- One main button: **Add to Library**, with an Audiobook/Ebook switch when both
  exist. If you already own it, the button reads **Listen in Audiobookshelf**.
- The description, with a Read more link.
- A series strip showing the series in order, with what you own and what's
  available marked.
- More by this author, then similar books.
- MAM details (size, format, seeders) sit behind a Details tap.

### Author and series pages
- Author pages are grouped by series in reading order, with standalones last.
  They can also be sorted by newest or A–Z.
- Series order comes from the metadata sources, not from MAM's result order.
- One book per series number: dramatized or alternate editions are skipped
  when a normal one exists.
- These pages never ask MAM. MAM is only checked when you open a book.

## Discovery without hammering MAM
- Followed authors and new releases are checked in the background once or twice
  a day, spaced out. Opening the app sends no MAM searches.
- New releases are found through the metadata sources first. MAM is searched
  only for those specific titles.
- Similar books and genre browsing come from the metadata sources and are cached.
- An **Available** badge marks books that are on MAM, with an option to show
  only available books.
- **Watch** a missing book, and Lectern tells you when it turns up.

## Covers that load fast
- Each cover is fetched once, resized (120, 300 or 600 px wide), saved as WebP
  in the data folder and served by Lectern. Only known cover hosts (Audible,
  Google Books, Open Library) are fetched.
- The page shows a colour placeholder straight away, then fades in the cover.
- Covers load lazily as you scroll, with long-lived browser caching.

## Hands-off import
When a download finishes, Lectern:
1. files the book as `Author/Series/Book N - Title/`, using hardlinks where it can;
2. writes `metadata.json` with the title, series, number, description and narrator;
3. saves the correct cover;
4. tells Audiobookshelf the exact book and triggers a scan.

Books it can't match confidently go to "needs a look" for a one-tap fix.

## Tidy up (admin only)
Settings → Tidy up checks an existing Audiobookshelf library book by book
against Audible (by ASIN when the book has one, otherwise title and author).

1. **Scan** changes nothing. Results: *can be fixed* (clearly the same book,
   ticked), *need a look* (unticked, with the reason), *already right*, *not found*.
2. Each book shows its changes, e.g. "Series: — → Mistborn #1".
3. **Fix selected** updates only the ticked books, through Audiobookshelf's API.
   Each book's details are saved first.
4. **Undo this run** puts every fixed book back.

First version: details only (title, author, series and number, narrator, ASIN,
a missing year or cover). It never touches files. Moving folders into
`Author/Series/Book N - Title` comes later, once details are proven, because
moves can reset listening progress.

## Ideas to revisit
- After tapping download: close the book page automatically, or stay on it.
- Optional Calibre support for people who already use it.
- An easier e-reader client as an alternative to existing Kindle tools.
- An OPDS feed, so KOReader and other readers can browse the ebook library.
