# Lectern

Lectern is a self-hosted web app for audiobooks and ebooks. Heavy vibe coding with claude on this one because i hated the options out there and had to keep fixing issues with them

Search for a book on your phone, tap once, and it lands in Audiobookshelf with
the right series, book number and cover.

> **Status:** early. The app skeleton runs; smart search is next.
> See [docs/DESIGN.md](docs/DESIGN.md) for what's planned.

## Run it

With Docker:

```
cp .env.example .env      # fill in your settings
docker build -t lectern .
docker run -d --name lectern -p 8787:8787 -v ./data:/data --env-file .env lectern
```

Then open `http://<your-server>:8787`.

For development (Node 22+):

```
npm install
npm run dev               # http://localhost:5173
```

## Settings

All settings are environment variables, listed in [.env.example](.env.example).
Lectern never stores them in the repo.
