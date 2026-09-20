import errno
import json
import logging
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from collections.abc import Mapping
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .config import Settings
from .source_processing import derived_tables_current, rebuild_derived_tables


class ImportError(RuntimeError):
    pass


logger = logging.getLogger(__name__)

JPEG_MAGIC = b"\xff\xd8\xff"
COVER_VARIANTS = {
    "grid": "N3_LIBRARY_GRID.parsed",
    "full": "N3_LIBRARY_FULL.parsed",
}

_PROCESS_IMPORT_LOCK = threading.Lock()
BACKUP_TIMEOUT_SECONDS = 60


def _backup(source: sqlite3.Connection, destination: sqlite3.Connection) -> None:
    deadline = time.monotonic() + BACKUP_TIMEOUT_SECONDS

    def progress(_status: int, _remaining: int, _total: int) -> None:
        # sqlite3's connection timeout does not bound backup's SQLITE_BUSY retries.
        if time.monotonic() >= deadline:
            raise ImportError("Timed out copying Kobo database; it may still be in use")

    source.backup(destination, pages=256, progress=progress)


def _is_macos_volume(source: Path) -> bool:
    return sys.platform == "darwin" and source.resolve().is_relative_to(
        Path("/Volumes")
    )


def _copy_source_database(source: Path, destination: Path) -> None:
    resolved_source = source.resolve()
    source_uri = resolved_source.as_uri()

    def backup(uri: str) -> None:
        with (
            closing(sqlite3.connect(uri, uri=True)) as source_connection,
            closing(sqlite3.connect(destination)) as destination_connection,
        ):
            _backup(source_connection, destination_connection)

    if _is_macos_volume(source):
        # A Kobo exposed through macOS's FAT FSKit mount is stable while it is
        # in USB storage mode, but SQLite locking can stall indefinitely.
        backup(f"{source_uri}?mode=ro&immutable=1")
        return

    backup(f"{source_uri}?mode=ro")


@contextmanager
def _snapshot_lock(settings: Settings):
    """Serialize snapshot publication across threads and server processes."""
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    with _PROCESS_IMPORT_LOCK:
        lock_path = settings.data_dir / ".snapshot.lock"
        with lock_path.open("a+b") as handle:
            handle.seek(0)
            if handle.read(1) == b"":
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                while True:
                    try:
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError as error:
                        if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                            raise
                        time.sleep(0.05)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                handle.seek(0)
                if os.name == "nt":
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextmanager
def _temporary_database(settings: Settings):
    descriptor, name = tempfile.mkstemp(
        prefix=".KoboReader-", suffix=".sqlite.tmp", dir=settings.data_dir
    )
    os.close(descriptor)
    temporary = Path(name)
    temporary.unlink()
    try:
        yield temporary
    finally:
        temporary.unlink(missing_ok=True)


def _write_metadata(connection: sqlite3.Connection, source: Path) -> None:
    # Publish the version and the data in the same atomic database replacement.
    connection.execute("DROP TABLE IF EXISTS kstats_import")
    connection.execute(
        "CREATE TABLE kstats_import (imported_at TEXT NOT NULL, source TEXT NOT NULL)"
    )
    connection.execute(
        "INSERT INTO kstats_import VALUES (?, ?)",
        (datetime.now(UTC).isoformat(), str(source)),
    )
    connection.commit()


def _is_jpeg(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(3) == JPEG_MAGIC
    except OSError:
        return False


def _cover_source_root(source: Path) -> Path:
    return source.resolve().parents[1] / ".kobo-images"


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


def _copy_covers(settings: Settings, source: Path, database: Path) -> set[str]:
    source_root = _cover_source_root(source)
    with closing(sqlite3.connect(database)) as connection:
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
    expected_names = {
        f"{image_id} - {COVER_VARIANTS[variant]}"
        for image_id in valid_image_ids
        for variant in COVER_VARIANTS
    }

    covers = _cover_index(source_root, expected_names) if source_root.is_dir() else {}
    staging_dir = Path(tempfile.mkdtemp(prefix=".covers-", dir=settings.data_dir))
    staging_settings = Settings(data_dir=staging_dir)
    copied_names: set[str] = set()
    retained_names = {
        _cover_destination(settings, image_id, variant).name
        for image_id in valid_image_ids
        for variant in COVER_VARIANTS
    }
    try:
        staging_settings.covers_dir.mkdir(parents=True)
        for image_id in valid_image_ids:
            for variant in COVER_VARIANTS:
                try:
                    _copy_cover_variant(
                        covers=covers,
                        settings=staging_settings,
                        image_id=image_id,
                        variant=variant,
                    )
                    destination = _cover_destination(staging_settings, image_id, variant)
                    if destination.is_file():
                        copied_names.add(destination.name)
                except OSError:
                    continue

        if copied_names:
            settings.covers_dir.mkdir(parents=True, exist_ok=True)
            for name in copied_names:
                os.replace(staging_settings.covers_dir / name, settings.covers_dir / name)

    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)
    return retained_names


def _prune_covers(settings: Settings, retained_names: set[str]) -> None:
    if settings.covers_dir.is_dir():
        for existing in settings.covers_dir.iterdir():
            if (
                existing.is_file()
                and existing.name.endswith(("-grid.jpg", "-full.jpg"))
                and existing.name not in retained_names
            ):
                existing.unlink(missing_ok=True)


def import_database(settings: Settings) -> dict[str, str | bool | None]:
    with _snapshot_lock(settings):
        return _import_database_locked(settings)


def _import_database_locked(settings: Settings) -> dict[str, str | bool | None]:
    source = settings.resolve_source_db()
    if not source.is_file():
        raise ImportError(f"Kobo database not found at {source}")

    with _temporary_database(settings) as temporary:
        try:
            _copy_source_database(source, temporary)
            with closing(sqlite3.connect(temporary)) as destination_connection:
                integrity = destination_connection.execute(
                    "PRAGMA integrity_check"
                ).fetchone()
                if not integrity or integrity[0] != "ok":
                    raise ImportError("Imported database failed its integrity check")
                # A copied WAL-mode database must become a self-contained file
                # before publication; sidecars cannot follow an atomic replace.
                destination_connection.execute("PRAGMA journal_mode=DELETE")
                if not destination_connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content'"
                ).fetchone():
                    raise ImportError("Kobo database is not ready: missing content table")
                rebuild_derived_tables(destination_connection)
                _write_metadata(destination_connection, source)
            retained_names = None
            try:
                retained_names = _copy_covers(settings, source, temporary)
            except OSError:
                logger.warning(
                    "Cover caching failed; importing without new covers", exc_info=True
                )
            os.replace(temporary, settings.snapshot_db)
        except ImportError:
            raise
        except (OSError, sqlite3.Error) as error:
            raise ImportError(f"Unable to import Kobo database: {error}") from error

    # Never remove assets from the previous snapshot until publication succeeds.
    if retained_names is not None:
        try:
            _prune_covers(settings, retained_names)
        except OSError:
            logger.warning("Snapshot imported, but stale cover cleanup failed", exc_info=True)
    return device_status(settings)


def prepare_snapshot(settings: Settings) -> None:
    """Atomically migrate an existing snapshot before requests can read it."""
    with _snapshot_lock(settings):
        if not settings.snapshot_db.is_file():
            return
        source_uri = f"{settings.snapshot_db.resolve().as_uri()}?mode=ro"
        try:
            with _temporary_database(settings) as temporary:
                with closing(sqlite3.connect(source_uri, uri=True)) as source_connection:
                    if derived_tables_current(source_connection):
                        return
                    with closing(sqlite3.connect(temporary)) as destination_connection:
                        _backup(source_connection, destination_connection)
                        destination_connection.execute("PRAGMA journal_mode=DELETE")
                        rebuild_derived_tables(destination_connection)
                os.replace(temporary, settings.snapshot_db)
        except (OSError, sqlite3.Error) as error:
            raise ImportError(f"Unable to prepare Kobo snapshot: {error}") from error


def _metadata(settings: Settings) -> dict[str, str | None]:
    if settings.snapshot_db.is_file():
        uri = f"{settings.snapshot_db.resolve().as_uri()}?mode=ro"
        try:
            with closing(sqlite3.connect(uri, uri=True)) as connection:
                if connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kstats_import'"
                ).fetchone():
                    row = connection.execute(
                        "SELECT imported_at, source FROM kstats_import"
                    ).fetchone()
                    if row:
                        return {"imported_at": row[0], "source": row[1]}
        except sqlite3.Error as error:
            raise ImportError(f"Unable to read snapshot metadata: {error}") from error

    # Snapshots from older releases kept metadata in a separate JSON file.
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
