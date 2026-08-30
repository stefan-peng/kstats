import errno
import json
import os
import shutil
import sqlite3
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


JPEG_MAGIC = b"\xff\xd8\xff"
COVER_VARIANTS = {
    "grid": "N3_LIBRARY_GRID.parsed",
    "full": "N3_LIBRARY_FULL.parsed",
}

_PROCESS_IMPORT_LOCK = threading.Lock()


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
    if not settings.snapshot_db.is_file():
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
    expected_names = {
        f"{image_id} - {COVER_VARIANTS[variant]}"
        for image_id in valid_image_ids
        for variant in COVER_VARIANTS
    }

    covers = _cover_index(source_root, expected_names) if source_root.is_dir() else {}
    staging_dir = Path(tempfile.mkdtemp(prefix=".covers-", dir=settings.data_dir))
    staging_settings = Settings(data_dir=staging_dir)
    staging_settings.covers_dir.mkdir(parents=True)
    copied_names: set[str] = set()
    try:
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

        if settings.covers_dir.is_dir():
            for existing in settings.covers_dir.iterdir():
                if (
                    existing.is_file()
                    and existing.name.endswith(("-grid.jpg", "-full.jpg"))
                    and existing.name not in copied_names
                ):
                    existing.unlink(missing_ok=True)
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)



def import_database(settings: Settings) -> dict[str, str | bool | None]:
    with _snapshot_lock(settings):
        return _import_database_locked(settings)


def _import_database_locked(settings: Settings) -> dict[str, str | bool | None]:
    source = settings.resolve_source_db()
    if not source.is_file():
        raise ImportError(f"Kobo database not found at {source}")

    with _temporary_database(settings) as temporary:
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
            raise
        except (OSError, sqlite3.Error) as error:
            raise ImportError(f"Unable to import Kobo database: {error}") from error

    imported_at = datetime.now(UTC).isoformat()
    _copy_covers(settings, source)
    _write_metadata(settings.import_metadata, imported_at, source)
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
                        source_connection.backup(destination_connection)
                        rebuild_derived_tables(destination_connection)
                os.replace(temporary, settings.snapshot_db)
        except (OSError, sqlite3.Error) as error:
            raise ImportError(f"Unable to prepare Kobo snapshot: {error}") from error


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
