# Kobo Stats

A local-first reading dashboard for the native Kobo reader. The app copies the
mounted `KoboReader.sqlite` database into a local snapshot, then serves a
read-only dashboard for books, progress, reading time, completion dates, and
highlights. The overview also charts estimated reading duration by day, week,
or month using Kobo's aggregated session telemetry. The chart preserves Kobo's
reported duration totals, but its historical date allocation is approximate.

## Run

Install the dependencies once:

```bash
uv sync
npm ci --prefix frontend
```

For development, run the reload-enabled backend and Vite frontend:

```bash
uv run dev
```

Open <http://127.0.0.1:5173>.

To build and run the production version:

```bash
uv run prod
```

Open <http://127.0.0.1:8000>. Connect the Kobo before starting either version
to import its database. The last successful snapshot remains available after
the reader is disconnected.

Server settings live in `kstats.toml`:

```toml
[server]
host = "127.0.0.1"
backend_port = 8000
frontend_port = 5173
```

The frontend port is used by `uv run dev`; production serves both the API and
built frontend from the backend port.

The app auto-detects the Kobo database at `/Volumes/KOBOeReader` on macOS and
at the `.kobo` folder on mounted Windows drive letters. If your reader is
mounted elsewhere, set `KSTATS_KOBO_DATABASE` to the full `KoboReader.sqlite`
path before starting the server:

```powershell
$env:KSTATS_KOBO_DATABASE = "E:\.kobo\KoboReader.sqlite"
uv run prod
```

## Validate

```bash
uv run pytest
npm run test --prefix frontend
npm run build --prefix frontend
git diff --check
```

On Windows, if `uv` or pytest reports access denied for its cache or temporary
directory, give both tools fresh directories under the current user's temp
folder. Using unique names avoids reusing a directory with stale permissions:

```powershell
$baseTemp = Join-Path $env:TEMP ("kstats-pytest-" + [guid]::NewGuid().ToString("N"))
$env:UV_CACHE_DIR = Join-Path $env:TEMP ("kstats-uv-" + [guid]::NewGuid().ToString("N"))
uv run pytest --basetemp $baseTemp -p no:cacheprovider
```

The source Kobo database is opened read-only and is never modified. Pocket
articles and unsupported content types are excluded from book statistics.

## Maintenance

Kobo `Event.ExtraData` values use a Qt binary serialization format that may
change with firmware updates. Periodically verify the decoder in
`backend/app/kobo_events.py` against current device data, including new event
fields or event types that could support useful, reliable book details.
