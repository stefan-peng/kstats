# Kobo Stats

A local-first reading dashboard for the native Kobo reader. The app copies the
mounted `KoboReader.sqlite` database into a local snapshot, then serves a
read-only dashboard for books, progress, reading time, completion dates, and
highlights.

## Run

Connect the Kobo at `/Volumes/KOBOeReader`, then run:

```bash
uv sync
npm install --prefix frontend
npm run build --prefix frontend
uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. The last successful snapshot remains available
after the reader is disconnected.

## Validate

```bash
uv run pytest
npm run test --prefix frontend
npm run build --prefix frontend
git diff --check
```

The source Kobo database is opened read-only and is never modified. Pocket
articles and unsupported content types are excluded from book statistics.

