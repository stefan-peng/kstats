import json
import os
import shutil
import sqlite3
from collections.abc import Mapping
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from .config import Settings
from .source_processing import rebuild_derived_tables


class ImportError(RuntimeError):
    pass


JPEG_MAGIC = b"\xff\xd8\xff"
COVER_VARIANTS = {
    "grid": "N3_LIBRARY_GRID.parsed",
    "full": "N3_LIBRARY_FULL.parsed",
}


def _write_metadata(path: Path, imported_at: str, source: Path) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"imported_at": imported_at, "source": str(source)}, indent=2),
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _is_jpeg(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(3) == JPEG_MAGIC
    except OSError:
        return False


def _cover_source_root(source: Path) -> Path:
    return source.parents[1] / ".kobo-images"


def _cover_destination(settings: Settings, image_id: str, variant: str) -> Path:
    return settings.covers_dir / f"{image_id}-{variant}.jpg"


def _cover_index(source_root: Path, expected_names: set[str]) -> dict[str, Path]:
    covers: dict[str, Path] = {}
    if not expected_names:
        return covers
    try:
        for root, _, files in os.walk(source_root):
            for name in files:
                if name in expected_names:
                    covers[name] = Path(root) / name
                    if len(covers) == len(expected_names):
                        return covers
    except OSError:
        return covers
    return covers


def _copy_cover_variant(
    *,
    covers: Mapping[str, Path],
    settings: Settings,
    image_id: str,
    variant: str,
) -> None:
    source = covers.get(f"{image_id} - {COVER_VARIANTS[variant]}")
    if source is None:
        return
    if not source.is_file() or not _is_jpeg(source):
        return
    destination = _cover_destination(settings, image_id, variant)
    temporary = destination.with_suffix(".tmp")
    shutil.copyfile(source, temporary)
    os.replace(temporary, destination)


def _copy_covers(settings: Settings, source: Path) -> None:
    source_root = _cover_source_root(source)
    if not source_root.is_dir() or not settings.snapshot_db.is_file():
        return

    with closing(sqlite3.connect(settings.snapshot_db)) as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT image_id
            FROM kstats_books
            WHERE NULLIF(image_id, '') IS NOT NULL
            """,
        ).fetchall()

    valid_image_ids = [
        image_id
        for (image_id,) in rows
        if isinstance(image_id, str) and "/" not in image_id and "\\" not in image_id
    ]
    if not valid_image_ids:
        return

    expected_names = {
        f"{image_id} - {COVER_VARIANTS[variant]}"
        for image_id in valid_image_ids
        for variant in COVER_VARIANTS
    }

    settings.covers_dir.mkdir(parents=True, exist_ok=True)
    covers = _cover_index(source_root, expected_names)

    for image_id in valid_image_ids:
        for variant in COVER_VARIANTS:
            try:
                _copy_cover_variant(
                    covers=covers,
                    settings=settings,
                    image_id=image_id,
                    variant=variant,
                )
            except OSError:
                continue



def import_database(settings: Settings) -> dict[str, str | bool | None]:
    source = settings.resolve_source_db()
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
            rebuild_derived_tables(destination_connection)
        os.replace(temporary, settings.snapshot_db)
    except ImportError:
        temporary.unlink(missing_ok=True)
        raise
    except (OSError, sqlite3.Error) as error:
        temporary.unlink(missing_ok=True)
        raise ImportError(f"Unable to import Kobo database: {error}") from error

    imported_at = datetime.now(UTC).isoformat()
    _copy_covers(settings, source)
    _write_metadata(settings.import_metadata, imported_at, source)
    return device_status(settings)


def _metadata(settings: Settings) -> dict[str, str | None]:
    if not settings.import_metadata.is_file():
        return {"imported_at": None, "source": None}
    try:
        payload = json.loads(settings.import_metadata.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ImportError(
            f"Unable to read import metadata at {settings.import_metadata}: {error}"
        ) from error
    if not isinstance(payload, dict):
        raise ImportError(
            f"Unable to read import metadata at {settings.import_metadata}: expected object"
        )
    imported_at = payload.get("imported_at")
    source = payload.get("source")
    if imported_at is not None and not isinstance(imported_at, str):
        raise ImportError(
            f"Unable to read import metadata at {settings.import_metadata}: "
            "imported_at must be a string or null"
        )
    if source is not None and not isinstance(source, str):
        raise ImportError(
            f"Unable to read import metadata at {settings.import_metadata}: "
            "source must be a string or null"
        )
    return {
        "imported_at": imported_at,
        "source": source,
    }


def device_status(settings: Settings) -> dict[str, str | bool | None]:
    metadata = _metadata(settings)
    source = settings.resolve_source_db()
    return {
        "connected": source.is_file(),
        "snapshot_available": settings.snapshot_db.is_file(),
        "imported_at": metadata["imported_at"],
        "source": metadata["source"],
    }
