import sqlite3

import pytest

from backend.app.importer import ImportError as KoboImportError
from backend.app.importer import import_database


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
    assert payload["monthly_completions"] == [{"month": "2026-05", "count": 1}]
    assert "recent_books" not in payload


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


def test_books_filter_by_finished_month(client):
    response = client.get("/api/books", params={"finished_month": "2026-05"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert [book["content_id"] for book in payload["items"]] == ["book-finished"]


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
    assert "reading_sessions" not in payload
    assert payload["dictionary_lookups"] == [
        {
            "word": "perspicacious",
            "dictionary": "en",
        },
    ]


def test_finished_book_suppresses_stale_reading_estimates(client):
    response = client.get("/api/book", params={"content_id": "book-finished"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_chapter_estimate_seconds"] == 0
    assert payload["rest_of_book_estimate_seconds"] == 0
    assert payload["remaining_seconds"] == 0


def test_failed_import_keeps_previous_snapshot(settings):
    import_database(settings)
    with sqlite3.connect(settings.snapshot_db) as connection:
        before = connection.execute("SELECT COUNT(*) FROM content").fetchone()[0]

    settings.source_db.write_bytes(b"not a sqlite database")
    try:
        import_database(settings)
    except Exception:
        pass

    with sqlite3.connect(settings.snapshot_db) as connection:
        after = connection.execute("SELECT COUNT(*) FROM content").fetchone()[0]
    assert before == after == 4


def test_failed_integrity_import_removes_temporary_snapshot(settings, monkeypatch):
    class SourceConnection:
        def backup(self, destination):
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
