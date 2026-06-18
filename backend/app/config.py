from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    source_db: Path = Path("/Volumes/KOBOeReader/.kobo/KoboReader.sqlite")
    data_dir: Path = Path(".data")

    @property
    def snapshot_db(self) -> Path:
        return self.data_dir / "KoboReader.sqlite"

    @property
    def import_metadata(self) -> Path:
        return self.data_dir / "import.json"

