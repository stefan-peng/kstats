import logging
import threading
import time
from dataclasses import replace
from pathlib import Path

from .config import Settings
from .importer import ImportError, device_status, import_database

logger = logging.getLogger(__name__)
POLL_INTERVAL_SECONDS = 5


def _source_version(source: Path) -> tuple:
    """Include the WAL: committed changes need not touch the main SQLite file."""
    versions = []
    for path in (source, Path(f"{source}-wal")):
        try:
            stat = path.stat()
        except FileNotFoundError:
            versions.append(None)
        else:
            versions.append((stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns))
    return (str(source), *versions)


class DeviceMonitor:
    """Coordinate manual imports and retry hot-plug imports once per poll."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._imported_version: tuple | None = None
        self._connected_source: Path | None = None
        self.import_error: str | None = None

    def status(self) -> dict[str, str | bool | None]:
        return {**device_status(self.settings), "import_error": self.import_error}

    def _import(self, source: Path, version: tuple) -> dict[str, str | bool | None]:
        # Pin the detected path for this attempt; drive discovery can change mid-import.
        started = time.monotonic()
        try:
            result = import_database(replace(self.settings, source_db=source))
        except (ImportError, OSError) as error:
            self.import_error = str(error)
            raise ImportError(str(error)) from error
        self._imported_version = version
        self._connected_source = source
        self.import_error = None
        logger.info(
            "Imported Kobo snapshot from %s in %.2fs",
            source,
            time.monotonic() - started,
        )
        return {**result, "import_error": None}

    def import_now(self) -> dict[str, str | bool | None]:
        with self._lock:
            try:
                source = self.settings.resolve_source_db()
                return self._import(source, _source_version(source))
            except OSError as error:
                self.import_error = str(error)
                raise ImportError(str(error)) from error

    def poll(self) -> None:
        with self._lock:
            previous_error = self.import_error
            try:
                source = self.settings.resolve_source_db()
                if not source.is_file():
                    if self._connected_source is not None:
                        logger.info("Kobo disconnected: %s", self._connected_source)
                    self._connected_source = None
                    self._imported_version = None
                    self.import_error = None
                    return
                if source != self._connected_source:
                    logger.info("Kobo connected: %s", source)
                    self._connected_source = source
                version = _source_version(source)
                if (
                    version != self._imported_version
                    or self.import_error is not None
                    or not self.settings.snapshot_db.is_file()
                ):
                    self._import(source, version)
            except (ImportError, OSError) as error:
                # A volume can appear before its database is ready, or disappear
                # during the copy. Keep serving the snapshot and retry next poll.
                if previous_error != str(error):
                    logger.warning("Automatic Kobo import failed: %s", error)
                self.import_error = str(error)
