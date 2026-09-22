import os
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.importer import ImportError as KoboImportError
from backend.app.importer import import_database
from backend.app.main import create_app
from backend.app.source_processing import DERIVED_SCHEMA_VERSION
from backend.tests.conftest import create_fixture_database


def insert_book(
    database,
    *,
    content_id,
    book_title,
    title,
    downloaded,
):
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, BookTitle, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, TimesStartedReading,
                IsDownloaded
            ) VALUES (?, 6, 'application/epub+zip', ?, ?, 'Test Author', 0, 0, 0, 0, ?)
            """,
            (content_id, book_title, title, downloaded),
        )


def test_startup_import_and_dashboard_exclude_pocket(client):
    status = client.get("/api/device/status").json()
    assert status["connected"] is True
    assert status["snapshot_available"] is True

    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200
    payload = dashboard.json()
    assert payload["totals"] == {
        "library": 3,
        "finished": 1,
        "reading": 1,
        "reading_seconds": 10861,
    }
    assert payload["status_counts"] == {
        "unread": 1,
        "reading": 1,
        "finished": 1,
    }
    assert payload["continue_reading"][0]["title"] == "Current Book"
    completions = payload["monthly_completions"]
    assert len(completions) == 12
    assert completions[0] == {"month": "2025-06", "count": 0}
    assert completions[-1] == {"month": "2026-05", "count": 1}
    assert sum(month["count"] for month in completions) == 1
    assert payload["reading_duration"] == {
        "estimated": True,
        "coverage_start": "2026-06-16",
        "coverage_end": "2026-06-17",
        "source_seconds": 1800,
        "allocated_seconds": 1800,
        "unallocated_seconds": 0,
        "skipped_rows": 0,
        "daily": [
            {"date": "2026-06-16", "seconds": 900},
            {"date": "2026-06-17", "seconds": 900},
        ],
    }
    assert "recent_books" not in payload


def test_dashboard_uses_requested_timezone(client):
    response = client.get(
        "/api/dashboard", params={"timezone": "America/New_York"}
    )

    assert response.status_code == 200
    assert response.json()["reading_duration"]["daily"] == [
        {"date": "2026-06-16", "seconds": 1800}
    ]


def test_dashboard_rejects_unknown_timezone(client):
    response = client.get("/api/dashboard", params={"timezone": "Mars/Olympus"})

    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown timezone"


def test_dashboard_rejects_path_like_timezone(client):
    response = client.get("/api/dashboard", params={"timezone": "../UTC"})

    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown timezone"


def test_dashboard_handles_snapshot_without_event_table(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.execute("DROP TABLE Event")

    response = client.get("/api/dashboard")

    assert response.status_code == 200
    assert response.json()["reading_duration"]["daily"] == []


def test_dashboard_skips_corrupt_reading_event(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.execute(
            """
            INSERT INTO Event (
                EventType, EventCount, LastOccurrence, ContentID, Checksum, ExtraData
            ) VALUES (3, 1, '2026-06-17T01:00:00Z', 'book-reading', 'corrupt', ?)
            """,
            [b"\x00"],
        )

    response = client.get("/api/dashboard")

    assert response.status_code == 200
    duration = response.json()["reading_duration"]
    assert duration["source_seconds"] == 1800
    assert duration["skipped_rows"] == 1


def test_startup_import_failure_keeps_server_available(tmp_path):
    source = tmp_path / "source.sqlite"
    source.write_bytes(b"not a sqlite database")
    settings = Settings(source_db=source, data_dir=tmp_path / "data")

    with TestClient(create_app(settings)) as client:
        deadline = time.monotonic() + 5
        while True:
            status = client.get("/api/device/status").json()
            if status["import_error"] or time.monotonic() >= deadline:
                break
            time.sleep(0.01)
        assert status["snapshot_available"] is False
        assert "Unable to import Kobo database" in status["import_error"]
        assert client.get("/api/dashboard").status_code == 404


def test_books_support_search_filters_and_sorting(client):
    response = client.get(
        "/api/books",
        params={
            "search": "book",
            "status": "reading",
            "downloaded": "true",
            "sort": "title",
            "direction": "asc",
        },
    )
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["content_id"] == "book-reading"
    assert payload["items"][0]["downloaded"] is True
    assert payload["items"][0]["bookmark_count"] == 1
    assert payload["items"][0]["cover_url"] is None


def test_books_clamps_page_after_results_shrink(client):
    response = client.get("/api/books", params={"page": 3, "page_size": 2})

    assert response.status_code == 200
    payload = response.json()
    assert payload["page"] == 2
    assert payload["pages"] == 2
    assert len(payload["items"]) == 1


def test_books_sort_by_highlight_count(client):
    descending = client.get(
        "/api/books", params={"sort": "highlights", "direction": "desc"}
    )
    ascending = client.get(
        "/api/books", params={"sort": "highlights", "direction": "asc"}
    )

    assert descending.status_code == 200
    assert ascending.status_code == 200
    assert [book["bookmark_count"] for book in descending.json()["items"]] == [
        1,
        0,
        0,
    ]
    assert [book["bookmark_count"] for book in ascending.json()["items"]] == [
        0,
        0,
        1,
    ]


def test_progress_sort_matches_displayed_finished_progress(client):
    response = client.get("/api/books", params={"sort": "progress", "direction": "desc"})
    assert response.status_code == 200
    assert [book["percent_read"] for book in response.json()["items"]] == [100, 42, 0]


def test_books_filter_by_finished_month(client):
    response = client.get("/api/books", params={"finished_month": "2026-05"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert [book["content_id"] for book in payload["items"]] == ["book-finished"]
    assert payload["items"][0]["percent_read"] == 100


def test_books_filter_by_highlights_and_metadata(client):
    response = client.get(
        "/api/books",
        params={
            "has_highlights": "true",
            "series": "Series",
            "publisher": "Press",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["content_id"] == "book-reading"
    assert payload["items"][0]["bookmark_count"] == 1
    assert "Series" in payload["filter_options"]["series"]
    assert "Press" in payload["filter_options"]["publishers"]


def test_books_filter_without_highlights(client):
    response = client.get("/api/books", params={"has_highlights": "false"})

    assert response.status_code == 200
    payload = response.json()
    assert "book-reading" not in {book["content_id"] for book in payload["items"]}


def test_source_filter_hides_removed_and_blank_rows_but_keeps_sideloaded(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', ?, 'Source Author', 0, 0, 0, 1, ?)
            """,
            [
                ("removed-noise", "Removed Noise", "removed"),
                ("blank-noise", "Blank Noise", ""),
                ("sideloaded-book", "Sideloaded Book", "kepub_user"),
            ],
        )

    response = client.get("/api/books", params={"page_size": 100})

    assert response.status_code == 200
    payload = response.json()
    ids = {book["content_id"] for book in payload["items"]}
    assert "sideloaded-book" in ids
    assert "removed-noise" not in ids
    assert "blank-noise" not in ids
    assert payload["source_summary"]["kept_sideloaded"] == 1
    assert payload["source_summary"]["ignored_custom_catalog"] == 2


def test_books_combines_where_and_having_filters_in_placeholder_order(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, IsDownloaded,
                Series, LastTimeFinishedReading, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', ?, 'Filter Author', ?, 0, 0, 1, ?, ?, ?)
            """,
            [
                (
                    "sideloaded-reading",
                    "Sideloaded Reading",
                    1,
                    None,
                    None,
                    "kepub_user",
                ),
                (
                    "finished-series-match",
                    "Finished Series Match",
                    2,
                    "Mixed Filters",
                    "2026-07-02T12:00:00Z",
                    "test-user",
                ),
            ],
        )

    status_source = client.get(
        "/api/books",
        params={"status": "reading", "source": "sideloaded"},
    )
    month_series = client.get(
        "/api/books",
        params={"finished_month": "2026-07", "series": "Mixed Filters"},
    )

    assert status_source.status_code == 200
    assert [book["content_id"] for book in status_source.json()["items"]] == [
        "sideloaded-reading"
    ]
    assert month_series.status_code == 200
    assert [book["content_id"] for book in month_series.json()["items"]] == [
        "finished-series-match"
    ]


def test_removed_history_merges_by_colon_title_prefix_and_author(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, DateLastRead,
                CurrentChapterEstimate, RestOfBookEstimate, IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            [
                (
                    "canonical-prefix",
                    "Siheyuan",
                    "Same Author",
                    0,
                    0,
                    0,
                    None,
                    0,
                    0,
                    "test-user",
                ),
                (
                    "removed-prefix",
                    "Siheyuan: Sign-in Starting from 1951",
                    "Same Author",
                    1,
                    500,
                    25,
                    "2026-06-20T12:00:00Z",
                    100,
                    200,
                    "removed",
                ),
                (
                    "removed-standalone",
                    "Other Removed",
                    "Other Author",
                    1,
                    900,
                    50,
                    "2026-06-21T12:00:00Z",
                    0,
                    0,
                    "removed",
                ),
            ],
        )

    detail = client.get("/api/book", params={"content_id": "canonical-prefix"}).json()
    ids = {
        book["content_id"]
        for book in client.get("/api/books", params={"page_size": 100}).json()["items"]
    }
    dashboard = client.get("/api/dashboard").json()

    assert detail["status"] == "reading"
    assert detail["reading_seconds"] == 500
    assert detail["percent_read"] == 25
    assert detail["remaining_seconds"] == 300
    assert "removed-prefix" not in ids
    assert "removed-standalone" not in ids
    assert dashboard["source_summary"]["removed_with_activity"] == 2
    assert dashboard["source_summary"]["merged_removed_history"] == 1


def test_current_reading_state_wins_over_stale_removed_state(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, DateLastRead,
                LastTimeFinishedReading, CurrentChapterEstimate,
                RestOfBookEstimate, IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            [
                (
                    "current-state",
                    "American Steam Locomotives",
                    "William L. Withuhn",
                    1,
                    6130,
                    90,
                    "2026-07-12T02:07:32Z",
                    None,
                    1302,
                    2313,
                    "test-user",
                ),
                (
                    "removed-state",
                    "American Steam Locomotives: Design and Development, 1880-1960",
                    "William L. Withuhn",
                    2,
                    14,
                    43,
                    "2026-06-24T21:02:51Z",
                    "2026-06-24T21:02:51Z",
                    1584,
                    32304,
                    "removed",
                ),
            ],
        )

    detail = client.get("/api/book", params={"content_id": "current-state"}).json()

    assert detail["status"] == "reading"
    assert detail["percent_read"] == 90
    assert detail["date_last_read"] == "2026-07-12T02:07:32Z"
    assert detail["finished_at"] is None
    assert detail["reading_seconds"] == 6130
    assert detail["current_chapter_estimate_seconds"] == 1302
    assert detail["rest_of_book_estimate_seconds"] == 2313
    assert detail["remaining_seconds"] == 3615


def test_timestamp_only_removed_record_is_not_reading_history(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, DateLastRead,
                LastTimeStartedReading, IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', 'Catalog Timestamp',
                      'Same Author', 0, 0, 0, ?, ?, 1, ?)
            """,
            [
                ("canonical-timestamp", None, None, "test-user"),
                (
                    "removed-timestamp",
                    "2026-06-24T20:36:59Z",
                    "2026-06-24T20:36:59Z",
                    "removed",
                ),
            ],
        )

    detail = client.get(
        "/api/book", params={"content_id": "canonical-timestamp"}
    ).json()
    summary = client.get("/api/dashboard").json()["source_summary"]

    assert detail["status"] == "unread"
    assert detail["date_last_read"] is None
    assert summary["removed_with_activity"] == 0
    assert summary["merged_removed_history"] == 0


def test_newer_canonical_unread_state_wins_over_removed_history(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, DateLastRead,
                LastTimeFinishedReading, CurrentChapterEstimate,
                RestOfBookEstimate, IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', 'Reset Book',
                      'Same Author', ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            [
                (
                    "canonical-reset",
                    0,
                    0,
                    0,
                    "2026-07-12T12:00:00Z",
                    None,
                    0,
                    0,
                    "test-user",
                ),
                (
                    "removed-reset",
                    2,
                    500,
                    100,
                    "2026-06-20T12:00:00Z",
                    "2026-06-20T12:00:00Z",
                    100,
                    200,
                    "removed",
                ),
            ],
        )

    detail = client.get("/api/book", params={"content_id": "canonical-reset"}).json()

    assert detail["status"] == "unread"
    assert detail["percent_read"] == 0
    assert detail["date_last_read"] is None
    assert detail["finished_at"] is None
    assert detail["remaining_seconds"] == 0
    assert detail["reading_seconds"] == 500


def test_newest_removed_record_supplies_one_coherent_state(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, DateLastRead,
                LastTimeFinishedReading, CurrentChapterEstimate,
                RestOfBookEstimate, IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', 'Repeated Import',
                      'Same Author', ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            [
                (
                    "canonical-repeated",
                    0,
                    0,
                    0,
                    None,
                    None,
                    0,
                    0,
                    "test-user",
                ),
                (
                    "removed-older",
                    2,
                    900,
                    100,
                    "2026-06-20T12:00:00Z",
                    "2026-06-20T12:00:00Z",
                    0,
                    0,
                    "removed",
                ),
                (
                    "removed-newer",
                    1,
                    500,
                    40,
                    "2026-06-21T12:00:00Z",
                    None,
                    100,
                    200,
                    "removed",
                ),
            ],
        )

    detail = client.get(
        "/api/book", params={"content_id": "canonical-repeated"}
    ).json()

    assert detail["status"] == "reading"
    assert detail["percent_read"] == 40
    assert detail["date_last_read"] == "2026-06-21T12:00:00Z"
    assert detail["finished_at"] is None
    assert detail["current_chapter_estimate_seconds"] == 100
    assert detail["rest_of_book_estimate_seconds"] == 200
    assert detail["remaining_seconds"] == 300
    assert detail["reading_seconds"] == 900


def test_ambiguous_subtitle_prefix_does_not_merge_history(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution,
                ReadStatus, TimeSpentReading, ___PercentRead, DateLastRead,
                CurrentChapterEstimate, RestOfBookEstimate, IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', ?, 'Same Author', ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            [
                ("canonical-series", "Chronicles", 0, 0, 0, None, 0, 0, "test-user"),
                (
                    "removed-volume-one",
                    "Chronicles: Volume One",
                    1,
                    500,
                    25,
                    "2026-06-20T12:00:00Z",
                    100,
                    200,
                    "removed",
                ),
                (
                    "removed-volume-two",
                    "Chronicles: Volume Two",
                    1,
                    900,
                    50,
                    "2026-06-21T12:00:00Z",
                    300,
                    400,
                    "removed",
                ),
            ],
        )

    detail = client.get("/api/book", params={"content_id": "canonical-series"}).json()

    assert detail["status"] == "unread"
    assert detail["reading_seconds"] == 0
    assert detail["remaining_seconds"] == 0
    assert client.get("/api/dashboard").json()["source_summary"][
        "merged_removed_history"
    ] == 0


def test_removed_history_is_not_assigned_to_multiple_canonical_books(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            """
            INSERT INTO content (
                ContentID, ContentType, MimeType, Title, Attribution, ISBN,
                ReadStatus, TimeSpentReading, ___PercentRead, DateLastRead,
                IsDownloaded, ___UserID
            ) VALUES (?, 6, 'application/epub+zip', 'Duplicate Edition',
                      'Same Author', 'same-isbn', ?, ?, ?, ?, 1, ?)
            """,
            [
                ("canonical-one", 0, 0, 0, None, "test-user"),
                ("canonical-two", 0, 0, 0, None, "test-user"),
                (
                    "removed-duplicate",
                    1,
                    700,
                    30,
                    "2026-06-20T12:00:00Z",
                    "removed",
                ),
            ],
        )

    first = client.get("/api/book", params={"content_id": "canonical-one"}).json()
    second = client.get("/api/book", params={"content_id": "canonical-two"}).json()

    assert first["status"] == second["status"] == "unread"
    assert first["reading_seconds"] == second["reading_seconds"] == 0
    assert client.get("/api/dashboard").json()["source_summary"][
        "merged_removed_history"
    ] == 0


def test_outdated_derived_schema_is_rebuilt(client, settings, monkeypatch):
    assert client.get("/api/book", params={"content_id": "book-reading"}).json()[
        "remaining_seconds"
    ] == 15567

    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.execute(
            "UPDATE content SET CurrentChapterEstimate = 60, RestOfBookEstimate = 120 "
            "WHERE ContentID = 'book-reading'"
        )
        connection.execute(
            "UPDATE kstats_meta SET value = 1 WHERE key = 'schema_version'"
        )

    original_connect = sqlite3.connect
    original_replace = os.replace
    source_connections = []

    class TrackedConnection:
        def __init__(self, connection):
            self.connection = connection
            self.closed = False

        def __getattr__(self, name):
            return getattr(self.connection, name)

        @property
        def row_factory(self):
            return self.connection.row_factory

        @row_factory.setter
        def row_factory(self, value):
            self.connection.row_factory = value

        def close(self):
            self.closed = True
            self.connection.close()

    def tracked_connect(database, *args, **kwargs):
        connection = original_connect(database, *args, **kwargs)
        if isinstance(database, str) and database.startswith("file:"):
            tracked = TrackedConnection(connection)
            source_connections.append(tracked)
            return tracked
        return connection

    def windows_compatible_replace(source, destination):
        assert source_connections
        assert all(connection.closed for connection in source_connections)
        original_replace(source, destination)

    monkeypatch.setattr("backend.app.importer.sqlite3.connect", tracked_connect)
    monkeypatch.setattr("backend.app.importer.os.replace", windows_compatible_replace)

    detail = client.get("/api/book", params={"content_id": "book-reading"}).json()

    assert detail["remaining_seconds"] == 180
    with sqlite3.connect(settings.snapshot_db) as connection:
        version = connection.execute(
            "SELECT value FROM kstats_meta WHERE key = 'schema_version'"
        ).fetchone()[0]
    assert version == DERIVED_SCHEMA_VERSION


def test_books_sort_by_in_progress_remaining_time(client):
    response = client.get(
        "/api/books",
        params={"sort": "remaining_time", "direction": "desc"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["content_id"] == "book-reading"
    assert payload["items"][0]["remaining_seconds"] == 15567
    assert payload["items"][-1]["remaining_seconds"] == 0


def test_books_searches_visible_fallback_title(client, settings):
    insert_book(
        settings.snapshot_db,
        content_id="fallback-title",
        book_title="Visible Fallback Title",
        title="",
        downloaded=1,
    )

    response = client.get("/api/books", params={"search": "Fallback Title"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["title"] == "Visible Fallback Title"


def test_cloud_filter_matches_all_values_serialized_as_not_downloaded(client, settings):
    insert_book(
        settings.snapshot_db,
        content_id="cloud-null",
        book_title=None,
        title="Null Download State",
        downloaded=None,
    )
    insert_book(
        settings.snapshot_db,
        content_id="cloud-empty",
        book_title=None,
        title="Empty Download State",
        downloaded="",
    )

    response = client.get("/api/books", params={"downloaded": "false"})

    assert response.status_code == 200
    payload = response.json()
    ids = {book["content_id"] for book in payload["items"]}
    assert {"book-cloud", "cloud-null", "cloud-empty"} <= ids
    assert all(book["downloaded"] is False for book in payload["items"])


def test_frontend_route_rejects_encoded_path_traversal(client):
    response = client.get("/%2e%2e/package.json")

    assert response.status_code == 404
    assert '"name": "kobo-stats-frontend"' not in response.text


def test_book_detail_includes_visible_highlights(client):
    response = client.get("/api/book", params={"content_id": "book-reading"})
    payload = response.json()
    assert payload["word_count"] == 80000
    assert payload["bookmark_count"] == 1
    assert payload["cover_url"] is None
    assert payload["data_source"] == {
        "snapshot_path": str(client.app.state.settings.snapshot_db),
        "read_only": True,
    }
    assert payload["current_chapter_estimate_seconds"] == 4060
    assert payload["rest_of_book_estimate_seconds"] == 11507
    assert payload["remaining_seconds"] == 15567
    assert payload["bookmarks"] == [
        {
            "id": "highlight-1",
            "text": "Highlighted text",
            "annotation": "A note",
            "type": "highlight",
            "created_at": "2026-06-16T11:30:00Z",
            "chapter_progress": 0.4,
            "color": 0,
        }
    ]
    assert payload["reading_duration"] == {
        "estimated": True,
        "coverage_start": "2026-06-16",
        "coverage_end": "2026-06-17",
        "source_seconds": 1800,
        "allocated_seconds": 1800,
        "unallocated_seconds": 0,
        "skipped_rows": 0,
        "daily": [
            {"date": "2026-06-16", "seconds": 900},
            {"date": "2026-06-17", "seconds": 900},
        ],
    }
    assert payload["dictionary_lookups"] == [
        {
            "word": "perspicacious",
            "dictionary": "en",
        },
    ]


def test_book_detail_skips_corrupt_dictionary_event(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.execute(
            """
            INSERT INTO Event (
                EventType, EventCount, LastOccurrence, ContentID, Checksum, ExtraData
            ) VALUES (9, 1, '2026-06-18T12:00:00Z', ?, 'corrupt', ?)
            """,
            ("book-reading", b"\x00"),
        )

    response = client.get("/api/book", params={"content_id": "book-reading"})

    assert response.status_code == 200
    assert response.json()["title"] == "Current Book"
    assert response.json()["dictionary_lookups"] == [
        {"word": "perspicacious", "dictionary": "en"}
    ]


def test_device_status_reports_corrupt_import_metadata(client, settings):
    # Legacy snapshots still read import.json.
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.execute("DROP TABLE kstats_import")
    settings.import_metadata.write_text("{not json", encoding="utf-8")

    response = client.get("/api/device/status")

    assert response.status_code == 500
    assert "Unable to read import metadata" in response.json()["detail"]


def test_finished_book_suppresses_stale_reading_estimates(client):
    response = client.get("/api/book", params={"content_id": "book-finished"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["percent_read"] == 100
    assert payload["current_chapter_estimate_seconds"] == 0
    assert payload["rest_of_book_estimate_seconds"] == 0
    assert payload["remaining_seconds"] == 0


def test_failed_import_keeps_previous_snapshot(settings):
    import_database(settings)
    with sqlite3.connect(settings.snapshot_db) as connection:
        before = connection.execute("SELECT COUNT(*) FROM content").fetchone()[0]

    settings.source_db.write_bytes(b"not a sqlite database")
    with pytest.raises(KoboImportError, match="Unable to import Kobo database"):
        import_database(settings)

    with sqlite3.connect(settings.snapshot_db) as connection:
        after = connection.execute("SELECT COUNT(*) FROM content").fetchone()[0]
    assert before == after == 4


@pytest.mark.parametrize("macos_volume", [False, True])
def test_import_preserves_committed_wal_changes(settings, monkeypatch, macos_volume):
    monkeypatch.setattr("backend.app.importer._is_macos_volume", lambda source: macos_volume)
    connection = sqlite3.connect(settings.source_db)
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.execute("UPDATE content SET Title = 'WAL title' WHERE ContentID = 'book-reading'")
        connection.commit()
        before = settings.source_db.read_bytes()
        wal = settings.source_db.with_name(settings.source_db.name + "-wal")
        before_wal = wal.read_bytes()
        assert import_database(settings)["snapshot_available"] is True
        with sqlite3.connect(settings.snapshot_db) as snapshot:
            assert snapshot.execute("SELECT title FROM kstats_books WHERE content_id = 'book-reading'").fetchone() == ("WAL title",)
            assert snapshot.execute("PRAGMA journal_mode").fetchone() == ("delete",)
        assert settings.source_db.read_bytes() == before
        assert wal.read_bytes() == before_wal
        assert not list(settings.data_dir.glob(".kobo-source-*"))
    finally:
        connection.close()


def test_macos_copy_rejects_changing_source(settings, monkeypatch):
    from backend.app import importer

    import_database(settings)
    before = settings.snapshot_db.read_bytes()
    copyfile = importer.shutil.copyfile

    def changing_copy(source, destination):
        result = copyfile(source, destination)
        if source == settings.source_db.resolve():
            with sqlite3.connect(source) as connection:
                connection.execute("UPDATE content SET Title = 'Changed' WHERE ContentID = 'book-reading'")
        return result

    monkeypatch.setattr(importer, "_is_macos_volume", lambda source: True)
    monkeypatch.setattr(importer.shutil, "copyfile", changing_copy)
    with pytest.raises(KoboImportError, match="changed while copying"):
        import_database(settings)
    assert settings.snapshot_db.read_bytes() == before
    assert not list(settings.data_dir.glob(".kobo-source-*"))


def test_concurrent_imports_are_serialized_and_publish_complete_snapshots(
    settings, monkeypatch
):
    from backend.app import importer

    first_rebuild_started = threading.Event()
    release_first_rebuild = threading.Event()
    rebuild_count = 0
    count_lock = threading.Lock()
    original_rebuild = importer.rebuild_derived_tables

    def controlled_rebuild(connection):
        nonlocal rebuild_count
        with count_lock:
            rebuild_count += 1
            current = rebuild_count
        if current == 1:
            first_rebuild_started.set()
            assert release_first_rebuild.wait(timeout=5)
        original_rebuild(connection)

    monkeypatch.setattr(importer, "rebuild_derived_tables", controlled_rebuild)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(import_database, settings)
        assert first_rebuild_started.wait(timeout=5)
        second = executor.submit(import_database, settings)
        time.sleep(0.05)
        assert not second.done()
        release_first_rebuild.set()
        assert first.result(timeout=5)["snapshot_available"] is True
        assert second.result(timeout=5)["snapshot_available"] is True

    with sqlite3.connect(settings.snapshot_db) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("SELECT COUNT(*) FROM kstats_books").fetchone() == (3,)
    assert list(settings.data_dir.glob(".KoboReader-*.sqlite.tmp")) == []


def test_failed_integrity_import_removes_temporary_snapshot(settings, monkeypatch):
    class SourceConnection:
        def backup(self, destination, **kwargs):
            pass

        def close(self):
            pass

    class DestinationConnection:
        def __init__(self, path):
            self.path = path
            path.write_text("partial import", encoding="utf-8")

        def execute(self, statement):
            assert statement == "PRAGMA integrity_check"
            return self

        def fetchone(self):
            return ("database disk image is malformed",)

        def close(self):
            pass

    def connect(database, *args, **kwargs):
        if isinstance(database, str):
            return SourceConnection()
        return DestinationConnection(database)

    monkeypatch.setattr("backend.app.importer.sqlite3.connect", connect)

    with pytest.raises(KoboImportError, match="integrity check"):
        import_database(settings)

    assert not settings.snapshot_db.with_suffix(".sqlite.tmp").exists()


def test_status_and_import_rescan_device_candidates_after_startup(tmp_path):
    drive_c = tmp_path / "C"
    drive_d = tmp_path / "D"
    source = drive_d / ".kobo" / "KoboReader.sqlite"
    settings = Settings(
        data_dir=tmp_path / "data",
        system="Windows",
        windows_drive_roots=lambda: [drive_c, drive_d],
    )

    with TestClient(create_app(settings)) as client:
        assert client.get("/api/device/status").json()["connected"] is False

        source.parent.mkdir(parents=True)
        create_fixture_database(source)

        status = client.get("/api/device/status").json()
        assert status["connected"] is True
        assert status["snapshot_available"] is False

        imported = client.post("/api/import")
        assert imported.status_code == 200
        payload = imported.json()
        assert payload["connected"] is True
        assert payload["snapshot_available"] is True
        assert payload["source"] == str(source)


def test_cover_route_serves_only_cached_cover_files(client, settings):
    settings.covers_dir.mkdir(parents=True)
    cover = settings.covers_dir / "cover-id-grid.jpg"
    cover.write_bytes(b"\xff\xd8\xffjpeg")

    response = client.get("/api/covers/cover-id-grid.jpg")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content.startswith(b"\xff\xd8\xff")
    assert client.get("/api/covers/%2e%2e%2fimport.json").status_code == 404
    assert client.get("/api/covers/missing-grid.jpg").status_code == 404


def test_import_copies_available_cover_assets_best_effort(tmp_path):
    source = tmp_path / "KOBOeReader" / ".kobo" / "KoboReader.sqlite"
    source.parent.mkdir(parents=True)
    create_fixture_database(source)
    image_id = "cover-[image]"
    with sqlite3.connect(source) as connection:
        connection.execute(
            "UPDATE content SET ImageId = ? WHERE ContentID = 'book-reading'",
            (image_id,),
        )
    covers = tmp_path / "KOBOeReader" / ".kobo-images" / "1" / "2"
    covers.mkdir(parents=True)
    (covers / f"{image_id} - N3_LIBRARY_GRID.parsed").write_bytes(b"\xff\xd8\xffgrid")
    (covers / f"{image_id} - N3_LIBRARY_FULL.parsed").write_bytes(b"not jpeg")
    settings = Settings(source_db=source, data_dir=tmp_path / "data")

    status = import_database(settings)

    assert status["snapshot_available"] is True
    assert (settings.covers_dir / f"{image_id}-grid.jpg").is_file()
    assert not (settings.covers_dir / f"{image_id}-full.jpg").exists()


def test_import_keeps_cached_cover_when_device_copy_is_unavailable(tmp_path):
    source = tmp_path / "KOBOeReader" / ".kobo" / "KoboReader.sqlite"
    source.parent.mkdir(parents=True)
    create_fixture_database(source)
    image_id = "temporary-cover"
    with sqlite3.connect(source) as connection:
        connection.execute(
            "UPDATE content SET ImageId = ? WHERE ContentID = 'book-reading'",
            (image_id,),
        )
    source_cover = (
        tmp_path
        / "KOBOeReader"
        / ".kobo-images"
        / f"{image_id} - N3_LIBRARY_GRID.parsed"
    )
    source_cover.parent.mkdir(parents=True)
    source_cover.write_bytes(b"\xff\xd8\xffgrid")
    settings = Settings(source_db=source, data_dir=tmp_path / "data")

    import_database(settings)
    cached_cover = settings.covers_dir / f"{image_id}-grid.jpg"
    assert cached_cover.is_file()

    source_cover.unlink()
    import_database(settings)

    assert cached_cover.is_file()

    with sqlite3.connect(source) as connection:
        connection.execute("DELETE FROM content WHERE ContentID = 'book-reading'")
    import_database(settings)
    assert not cached_cover.exists()


def test_import_succeeds_without_cover_directory(tmp_path):
    source = tmp_path / "KOBOeReader" / ".kobo" / "KoboReader.sqlite"
    source.parent.mkdir(parents=True)
    create_fixture_database(source)
    settings = Settings(source_db=source, data_dir=tmp_path / "data")

    status = import_database(settings)

    assert status["snapshot_available"] is True
    assert not settings.covers_dir.exists()


def test_completion_calendar_fills_gaps_across_years_and_ignores_bad_dates(client, settings):
    with sqlite3.connect(settings.snapshot_db) as connection:
        connection.executemany(
            "UPDATE kstats_books SET read_status = 2, finished_at = ? WHERE content_id = ?",
            [
                ("2026-01-10", "book-finished"),
                ("2025-11-10", "book-reading"),
                ("not-a-date", "book-cloud"),
            ],
        )
    months = client.get("/api/dashboard").json()["monthly_completions"]
    assert len(months) == 12
    assert months[0] == {"month": "2025-02", "count": 0}
    assert months[-3:] == [
        {"month": "2025-11", "count": 1},
        {"month": "2025-12", "count": 0},
        {"month": "2026-01", "count": 1},
    ]


def test_macos_copy_recovers_hot_rollback_journal_locally(tmp_path, monkeypatch):
    import subprocess
    import sys
    from backend.app import importer

    source = tmp_path / 'source.sqlite'
    destination = tmp_path / 'snapshot.sqlite'
    with sqlite3.connect(source) as connection:
        connection.execute('CREATE TABLE example (value TEXT)')
        connection.execute("INSERT INTO example VALUES ('committed')")
    subprocess.run([
        sys.executable, '-c',
        "import sqlite3, os, sys; c=sqlite3.connect(sys.argv[1]); "
        "c.execute('PRAGMA cache_size=1'); c.execute('BEGIN IMMEDIATE'); "
        "c.execute(\"UPDATE example SET value = hex(zeroblob(100000))\"); os._exit(0)",
        str(source),
    ], check=True, timeout=10)
    journal = source.with_name(source.name + '-journal')
    assert journal.is_file()
    before = source.read_bytes(), journal.read_bytes()
    monkeypatch.setattr(importer, '_is_macos_volume', lambda source: True)
    importer._copy_source_database(source, destination)
    with sqlite3.connect(destination) as connection:
        assert connection.execute('SELECT value FROM example').fetchone() == ('committed',)
    assert (source.read_bytes(), journal.read_bytes()) == before
