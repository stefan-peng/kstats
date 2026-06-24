import json
import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from .config import Settings


class ImportError(RuntimeError):
    pass


def _write_metadata(path: Path, imported_at: str, source: Path) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"imported_at": imported_at, "source": str(source)}, indent=2),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def import_database(settings: Settings) -> dict[str, str | bool | None]:
    source = settings.source_db
    if not source.is_file():
        raise ImportError(f"Kobo database not found at {source}")

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    temporary = settings.snapshot_db.with_suffix(".sqlite.tmp")
    temporary.unlink(missing_ok=True)

    try:
        source_uri = f"{source.resolve().as_uri()}?mode=ro"
        with (
            closing(sqlite3.connect(source_uri, uri=True)) as source_connection,
            closing(sqlite3.connect(temporary)) as destination_connection,
        ):
            source_connection.backup(destination_connection)
            integrity = destination_connection.execute(
                "PRAGMA integrity_check"
            ).fetchone()
            if not integrity or integrity[0] != "ok":
                raise ImportError("Imported database failed its integrity check")
        os.replace(temporary, settings.snapshot_db)
    except (OSError, sqlite3.Error) as error:
        temporary.unlink(missing_ok=True)
        raise ImportError(f"Unable to import Kobo database: {error}") from error

    imported_at = datetime.now(UTC).isoformat()
    _write_metadata(settings.import_metadata, imported_at, source)
    return device_status(settings)


def _metadata(settings: Settings) -> dict[str, str | None]:
    if not settings.import_metadata.is_file():
        return {"imported_at": None, "source": None}
    try:
        payload = json.loads(settings.import_metadata.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"imported_at": None, "source": None}
    return {
        "imported_at": payload.get("imported_at"),
        "source": payload.get("source"),
    }


def device_status(settings: Settings) -> dict[str, str | bool | None]:
    metadata = _metadata(settings)
    return {
        "connected": settings.source_db.is_file(),
        "snapshot_available": settings.snapshot_db.is_file(),
        "imported_at": metadata["imported_at"],
        "source": metadata["source"],
    }

