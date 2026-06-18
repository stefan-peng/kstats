import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


SCHEMA = """
CREATE TABLE content (
    ContentID TEXT PRIMARY KEY,
    ContentType INTEGER,
    MimeType TEXT,
    BookTitle TEXT,
    Title TEXT,
    Attribution TEXT,
    ReadStatus INTEGER,
    TimeSpentReading INTEGER,
    ___PercentRead INTEGER,
    TimesStartedReading INTEGER,
    DateLastRead TEXT,
    LastTimeStartedReading TEXT,
    LastTimeFinishedReading TEXT,
    IsDownloaded,
    WordCount INTEGER,
    Series TEXT,
    SeriesNumber TEXT,
    Publisher TEXT,
    Description TEXT
);
CREATE TABLE Bookmark (
    BookmarkID TEXT PRIMARY KEY,
    VolumeID TEXT,
    Text TEXT,
    Annotation TEXT,
    Type TEXT,
    DateCreated TEXT,
    ChapterProgress REAL,
    Color INTEGER,
    Hidden INTEGER
);
"""


def create_fixture_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(SCHEMA)
    connection.executemany(
        """
        INSERT INTO content VALUES (
            ?, 6, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """,
        [
            (
                "book-reading",
                "application/x-kobo-epub+zip",
                "Current Book",
                "Ada Reader",
                1,
                3661,
                42,
                3,
                "2026-06-16T12:00:00Z",
                "2026-06-16T11:00:00Z",
                None,
                "true",
                80000,
                "Series",
                "1",
                "Press",
                "Description",
            ),
            (
                "book-finished",
                "application/epub+zip",
                "Finished Book",
                "B. Author",
                2,
                7200,
                100,
                5,
                "2026-05-20T12:00:00Z",
                None,
                "2026-05-20T12:00:00Z",
                0,
                -1,
                None,
                None,
                None,
                None,
            ),
            (
                "book-cloud",
                "application/pdf",
                "Cloud Book",
                "C. Author",
                0,
                None,
                None,
                None,
                None,
                None,
                None,
                "false",
                None,
                None,
                None,
                None,
                None,
            ),
            (
                "pocket",
                "application/x-kobo-html+instapaper",
                "Pocket Article",
                "News",
                2,
                9999,
                100,
                1,
                "2026-06-01T12:00:00Z",
                None,
                "2026-06-01T12:00:00Z",
                1,
                1000,
                None,
                None,
                None,
                None,
            ),
        ],
    )
    connection.execute(
        """
        INSERT INTO Bookmark VALUES (
            'highlight-1', 'book-reading', 'Highlighted text', 'A note',
            'highlight', '2026-06-16T11:30:00Z', 0.4, 0, 0
        )
        """
    )
    connection.commit()
    connection.close()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    source = tmp_path / "source.sqlite"
    create_fixture_database(source)
    return Settings(source_db=source, data_dir=tmp_path / "data")


@pytest.fixture
def client(settings: Settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client

