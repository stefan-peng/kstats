import os
import platform
import string
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path


KOBO_DATABASE = Path(".kobo") / "KoboReader.sqlite"
SOURCE_DB_ENV = "KSTATS_KOBO_DATABASE"


def _windows_drive_roots() -> list[Path]:
    return [Path(f"{letter}:\\") for letter in string.ascii_uppercase]


def kobo_database_candidates(
    system: str | None = None,
    *,
    windows_drive_roots: Iterable[Path] | None = None,
) -> list[Path]:
    current_system = system or platform.system()
    if current_system == "Windows":
        roots = (
            list(windows_drive_roots)
            if windows_drive_roots is not None
            else _windows_drive_roots()
        )
        return [root / KOBO_DATABASE for root in roots]

    if current_system == "Darwin":
        return [Path("/Volumes/KOBOeReader") / KOBO_DATABASE]

    user = os.environ.get("USER")
    linux_candidates = []
    if user:
        linux_candidates.extend(
            [
                Path("/run/media") / user / "KOBOeReader" / KOBO_DATABASE,
                Path("/media") / user / "KOBOeReader" / KOBO_DATABASE,
            ]
        )
    linux_candidates.append(Path("/mnt/KOBOeReader") / KOBO_DATABASE)
    return linux_candidates


def default_source_db(
    environ: Mapping[str, str] | None = None,
    *,
    system: str | None = None,
    windows_drive_roots: Iterable[Path] | None = None,
) -> Path:
    environment = environ if environ is not None else os.environ
    configured = environment.get(SOURCE_DB_ENV)
    if configured:
        return Path(configured).expanduser()

    candidates = kobo_database_candidates(
        system,
        windows_drive_roots=windows_drive_roots,
    )
    if not candidates:
        raise RuntimeError("No Kobo database candidates are configured")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


@dataclass(frozen=True)
class Settings:
    source_db: Path = field(default_factory=default_source_db)
    data_dir: Path = Path(".data")

    @property
    def snapshot_db(self) -> Path:
        return self.data_dir / "KoboReader.sqlite"

    @property
    def import_metadata(self) -> Path:
        return self.data_dir / "import.json"
