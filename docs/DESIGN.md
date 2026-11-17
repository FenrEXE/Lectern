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

## Smart search

1. **Work out what was meant.** The messy text ("brandon sandersen mistborn")
   goes to the metadata sources, which return the real author, series and
   titles, plus a "did you mean" list.
2. **Fan out.** Run up to three MAM searches in parallel: author, series and title.
3. **Merge and rank.** Drop duplicates, then rank by closeness to what was typed,
   by format (audio or ebook) and by seeders.
4. **Cache.** A repeated search is instant and costs MAM nothing.

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

Settings holds the admin-only **Tidy up** tool.

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
  They can also be sorted by newest, most popular or A–Z.
- Series order comes from the metadata sources, not from MAM's result order.

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
- Each cover is fetched once at a small size, resized to about 300 px wide,
  saved as WebP and served by Lectern.
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
Scans existing Audiobookshelf libraries and re-checks each book with the same
matching. It shows a preview of the fixes. Once approved, it moves and renames
folders, writes metadata and rescans. It always does a dry run first and keeps
an undo log.

## Ideas to revisit
- After tapping download: close the book page automatically, or stay on it.
- Optional Calibre support for people who already use it.
- An easier e-reader client as an alternative to existing Kindle tools.
- An OPDS feed, so KOReader and other readers can browse the ebook library.
