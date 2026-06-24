# Kobo Stats

A local-first reading dashboard for the native Kobo reader. The app copies the
mounted `KoboReader.sqlite` database into a local snapshot, then serves a
read-only dashboard for books, progress, reading time, completion dates, and
highlights.

## Run

Connect the Kobo, then run:

```bash
uv sync
npm ci --prefix frontend
npm run build --prefix frontend
uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. The last successful snapshot remains available
after the reader is disconnected.

The app auto-detects the Kobo database at `/Volumes/KOBOeReader` on macOS and
at the `.kobo` folder on mounted Windows drive letters. If your reader is
mounted elsewhere, set `KSTATS_KOBO_DATABASE` to the full `KoboReader.sqlite`
path before starting the server:

```powershell
$env:KSTATS_KOBO_DATABASE = "E:\.kobo\KoboReader.sqlite"
uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

## Validate

```bash
uv run pytest
npm run test --prefix frontend
npm run build --prefix frontend
git diff --check
```

The source Kobo database is opened read-only and is never modified. Pocket
articles and unsupported content types are excluded from book statistics.

## Maintenance

Kobo `Event.ExtraData` values use a Qt binary serialization format that may
change with firmware updates. Periodically verify the decoder in
`backend/app/kobo_events.py` against current device data, including new event
fields or event types that could support useful, reliable book details.
