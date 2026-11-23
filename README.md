# Lectern

Lectern is a self-hosted web app for audiobooks and ebooks. Heavy vibe coding with claude on this one because i hated the options out there and had to keep fixing issues with them

Search for a book on your phone, tap once, and it lands in Audiobookshelf with
the right series, book number and cover.

> **Status:** early. Smart search works (typo-tolerant, with "did you mean"),
> and "Add to Library" sends a book to qBittorrent and files it into
> Audiobookshelf with the right series and number. Each person has their own
> profile and library, and author and series pages list books in reading order.
> See [docs/DESIGN.md](docs/DESIGN.md) for what's planned.

## Run it

With Docker:

```
cp .env.example .env      # fill in your settings
docker build -t lectern .
docker run -d --name lectern -p 8787:8787 -v ./data:/data --env-file .env lectern
```

Then open `http://<your-server>:8787`. The first visit asks you to create the
admin profile, using the one-time setup code Lectern prints in its log
(`docker logs lectern`). From there, **Settings → Connections** connects MAM, qBittorrent,
Audiobookshelf and Google Books (each with a "Test connection" button), and
**Settings → Profiles** adds everyone else, each with their own library folders.

On a phone, use the browser's "Add to Home Screen" to install it like an app.

For development (Node 22+):

```
npm install
npm run dev               # http://localhost:5173
```

## Settings

Connection settings can be typed into the app as an admin, or set as
environment variables (listed in [.env.example](.env.example)). The environment
values are the defaults; anything saved in the app wins. Secrets saved in the
app stay in Lectern's database in your data folder and are never shown again in
full, only their last four characters.

Sign-in uses a password per profile. The sign-in page shows profile names to
pick from; turn that off in **Settings → Profiles** if Lectern can be reached
from outside your home. Behind a reverse proxy, set `TRUST_PROXY` so sign-in
limits see visitors' real addresses.
