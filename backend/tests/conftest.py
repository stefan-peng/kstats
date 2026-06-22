import sqlite3
import struct
from pathlib import Path
from typing import Any

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
    Description TEXT,
    CurrentChapterEstimate INTEGER,
    RestOfBookEstimate INTEGER
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
CREATE TABLE Event (
    EventType INTEGER NOT NULL,
    EventCount INTEGER,
    LastOccurrence TEXT,
    ContentID TEXT,
    Checksum TEXT,
    ExtraData BLOB
);
"""


def qstring(value: str) -> bytes:
    encoded = value.encode("utf-16-be")
    return struct.pack(">I", len(encoded)) + encoded


def qvariant(value: Any) -> bytes:
    if value is None:
        return struct.pack(">IBI", 0, 1, 0xFFFFFFFF)
    if isinstance(value, bool):
        return struct.pack(">IBB", 1, 0, int(value))
    if isinstance(value, int):
        return struct.pack(">IBi", 2, 0, value)
    if isinstance(value, str):
        return struct.pack(">IB", 10, 0) + qstring(value)
    if isinstance(value, list):
        return (
            struct.pack(">IBI", 9, 0, len(value))
            + b"".join(qvariant(item) for item in value)
        )
    raise TypeError(f"Unsupported fixture QVariant: {type(value)}")


def event_payload(values: dict[str, Any]) -> bytes:
    return struct.pack(">I", len(values)) + b"".join(
        qstring(key) + qvariant(value) for key, value in values.items()
    )


def create_fixture_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(SCHEMA)
    connection.executemany(
        """
        INSERT INTO content VALUES (
            ?, 6, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
                4060,
                11507,
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
                627,
                6000,
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
                None,
                None,
            ),
        ],
    )
    connection.execute(
        """
        INSERT INTO Bookmark VALUES (
            'highlight-1', 'book-reading', 'Highlighted text', 'A note',
            'highlight', '2026-06-16T11:30:00Z', 0.4, 0, 'false'
        )
        """
    )
    connection.execute(
        """
        INSERT INTO Bookmark VALUES (
            'hidden-highlight', 'book-reading', 'Hidden text', NULL,
            'highlight', '2026-06-17T11:30:00Z', 0.5, 0, 'true'
        )
        """
    )
    connection.executemany(
        """
        INSERT INTO Event (
            EventType, EventCount, LastOccurrence, ContentID, Checksum, ExtraData
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (
                9,
                2,
                "2026-06-16T11:50:00Z",
                "book-reading",
                "dictionary-lookups",
                event_payload(
                    {
                        "DictionaryName": "en",
                        "Word": "perspicacious",
                        "eventTimestamps": [1781610000, 1781610300],
                    }
                ),
            ),
            (
                9,
                1,
                "2026-06-16T11:45:00Z",
                "book-reading",
                "duplicate-dictionary-lookup",
                event_payload(
                    {
                        "DictionaryName": "EN",
                        "Word": " Perspicacious ",
                    }
                ),
            ),
            (
                9,
                1,
                "2026-05-20T12:00:00Z",
                "book-finished",
                "other-book",
                event_payload(
                    {
                        "DictionaryName": "en",
                        "Word": "unrelated",
                        "eventTimestamps": [1779278400],
                    }
                ),
            ),
        ],
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
