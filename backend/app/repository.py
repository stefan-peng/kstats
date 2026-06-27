import math
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .kobo_events import (
    DICTIONARY_EVENT_TYPE,
    EventDecodeError,
    decode_event_payload,
    parse_dictionary_event,
)

BOOK_MIME_TYPES = (
    "application/x-kobo-epub+zip",
    "application/epub+zip",
    "application/pdf",
)

BOOK_SELECT = """
SELECT
    ContentID AS content_id,
    COALESCE(NULLIF(Title, ''), NULLIF(BookTitle, ''), 'Untitled') AS title,
    COALESCE(NULLIF(Attribution, ''), 'Unknown author') AS author,
    COALESCE(ReadStatus, 0) AS read_status,
    MAX(COALESCE(TimeSpentReading, 0), 0) AS reading_seconds,
    MIN(MAX(COALESCE(___PercentRead, 0), 0), 100) AS percent_read,
    DateLastRead AS date_last_read,
    LastTimeFinishedReading AS finished_at,
    CASE
        WHEN COALESCE(ReadStatus, 0) = 1
        THEN MAX(COALESCE(CurrentChapterEstimate, 0), 0)
        ELSE 0
    END AS current_chapter_estimate_seconds,
    CASE
        WHEN COALESCE(ReadStatus, 0) = 1
        THEN MAX(COALESCE(RestOfBookEstimate, 0), 0)
        ELSE 0
    END AS rest_of_book_estimate_seconds,
    CASE
        WHEN COALESCE(ReadStatus, 0) = 1
        THEN MAX(COALESCE(CurrentChapterEstimate, 0), 0)
            + MAX(COALESCE(RestOfBookEstimate, 0), 0)
        ELSE 0
    END AS remaining_seconds,
    CASE WHEN lower(CAST(IsDownloaded AS TEXT)) IN ('1', 'true') THEN 1 ELSE 0 END
        AS downloaded,
    CASE WHEN COALESCE(WordCount, -1) > 0 THEN WordCount ELSE NULL END AS word_count,
    NULLIF(Series, '') AS series,
    NULLIF(SeriesNumber, '') AS series_number,
    NULLIF(Publisher, '') AS publisher,
    NULLIF(Description, '') AS description,
    MimeType AS mime_type
FROM content
"""


def status_name(value: int) -> str:
    return {0: "unread", 1: "reading", 2: "finished"}.get(value, "unread")


def serialize_book(row: sqlite3.Row) -> dict[str, Any]:
    book = dict(row)
    book["status"] = status_name(book.pop("read_status"))
    if book["status"] == "finished":
        book["percent_read"] = 100
    book["downloaded"] = bool(book["downloaded"])
    return book


class Repository:
    def __init__(self, database: Path):
        self.database = database

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        if not self.database.is_file():
            raise FileNotFoundError("No Kobo snapshot is available")
        connection = sqlite3.connect(
            f"file:{self.database}?mode=ro", uri=True, check_same_thread=False
        )
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def _book_filter(alias: str = "") -> tuple[str, list[str]]:
        prefix = f"{alias}." if alias else ""
        placeholders = ",".join("?" for _ in BOOK_MIME_TYPES)
        return (
            f"{prefix}ContentType = 6 AND {prefix}MimeType IN ({placeholders})",
            list(BOOK_MIME_TYPES),
        )

    def dashboard(self) -> dict[str, Any]:
        where, parameters = self._book_filter()
        with self.connect() as connection:
            totals = connection.execute(
                f"""
                SELECT
                    COUNT(*) AS library,
                    SUM(CASE WHEN ReadStatus = 2 THEN 1 ELSE 0 END) AS finished,
                    SUM(CASE WHEN ReadStatus = 1 THEN 1 ELSE 0 END) AS reading,
                    SUM(MAX(COALESCE(TimeSpentReading, 0), 0)) AS reading_seconds
                FROM content WHERE {where}
                """,
                parameters,
            ).fetchone()

            status_rows = connection.execute(
                f"""
                SELECT COALESCE(ReadStatus, 0) AS status, COUNT(*) AS count
                FROM content WHERE {where}
                GROUP BY COALESCE(ReadStatus, 0)
                ORDER BY status
                """,
                parameters,
            ).fetchall()

            monthly_rows = connection.execute(
                f"""
                SELECT substr(LastTimeFinishedReading, 1, 7) AS month, COUNT(*) AS count
                FROM content
                WHERE {where}
                    AND ReadStatus = 2
                    AND LastTimeFinishedReading IS NOT NULL
                    AND length(LastTimeFinishedReading) >= 7
                GROUP BY month
                ORDER BY month DESC
                LIMIT 12
                """,
                parameters,
            ).fetchall()

            continue_rows = connection.execute(
                f"""
                {BOOK_SELECT}
                WHERE {where} AND ReadStatus = 1
                ORDER BY DateLastRead DESC, title
                LIMIT 6
                """,
                parameters,
            ).fetchall()

            top_rows = connection.execute(
                f"""
                {BOOK_SELECT}
                WHERE {where} AND COALESCE(TimeSpentReading, 0) > 0
                ORDER BY reading_seconds DESC
                LIMIT 5
                """,
                parameters,
            ).fetchall()

        status_counts = {"unread": 0, "reading": 0, "finished": 0}
        for row in status_rows:
            status_counts[status_name(row["status"])] = row["count"]

        return {
            "totals": {
                "library": totals["library"] or 0,
                "finished": totals["finished"] or 0,
                "reading": totals["reading"] or 0,
                "reading_seconds": totals["reading_seconds"] or 0,
            },
            "status_counts": status_counts,
            "monthly_completions": [
                dict(row) for row in reversed(monthly_rows) if row["month"]
            ],
            "continue_reading": [serialize_book(row) for row in continue_rows],
            "top_books": [serialize_book(row) for row in top_rows],
        }

    def books(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None,
        status: str | None,
        downloaded: bool | None,
        finished_month: str | None,
        sort: str,
        direction: str,
    ) -> dict[str, Any]:
        base_filter, parameters = self._book_filter()
        filters = [base_filter]
        if search:
            filters.append(
                "("
                "COALESCE(NULLIF(Title, ''), NULLIF(BookTitle, ''), '') LIKE ? "
                "OR COALESCE(Attribution, '') LIKE ?"
                ")"
            )
            term = f"%{search}%"
            parameters.extend([term, term])
        if status and status != "all":
            value = {"unread": 0, "reading": 1, "finished": 2}.get(status)
            if value is not None:
                filters.append("COALESCE(ReadStatus, 0) = ?")
                parameters.append(value)
        if downloaded is not None:
            downloaded_expression = (
                "lower(COALESCE(CAST(IsDownloaded AS TEXT), '')) IN ('1', 'true')"
            )
            filters.append(
                downloaded_expression if downloaded else f"NOT ({downloaded_expression})"
            )
        if finished_month:
            filters.append(
                "COALESCE(ReadStatus, 0) = 2 "
                "AND substr(LastTimeFinishedReading, 1, 7) = ?"
            )
            parameters.append(finished_month)

        sort_columns = {
            "title": "title",
            "author": "author",
            "status": "read_status",
            "progress": "percent_read",
            "reading_time": "reading_seconds",
            "remaining_time": "remaining_seconds",
            "last_read": "date_last_read",
        }
        sort_column = sort_columns.get(sort, "date_last_read")
        sort_direction = "ASC" if direction == "asc" else "DESC"
        where = " AND ".join(filters)

        with self.connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) FROM content WHERE {where}", parameters
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                {BOOK_SELECT}
                WHERE {where}
                ORDER BY {sort_column} IS NULL, {sort_column} {sort_direction}, title ASC
                LIMIT ? OFFSET ?
                """,
                [*parameters, page_size, (page - 1) * page_size],
            ).fetchall()

        return {
            "items": [serialize_book(row) for row in rows],
            "page": page,
            "page_size": page_size,
            "total": total,
            "pages": max(1, math.ceil(total / page_size)),
        }

    def book(self, content_id: str) -> dict[str, Any] | None:
        where, parameters = self._book_filter()
        with self.connect() as connection:
            row = connection.execute(
                f"{BOOK_SELECT} WHERE {where} AND ContentID = ?",
                [*parameters, content_id],
            ).fetchone()
            if row is None:
                return None
            bookmark_rows = connection.execute(
                """
                SELECT BookmarkID AS id, Text AS text, Annotation AS annotation,
                       Type AS type, DateCreated AS created_at,
                       ChapterProgress AS chapter_progress, Color AS color
                FROM Bookmark
                WHERE VolumeID = ?
                  AND LOWER(TRIM(CAST(COALESCE(Hidden, 0) AS TEXT)))
                      IN ('0', 'false')
                ORDER BY DateCreated DESC
                """,
                [content_id],
            ).fetchall()
            dictionary_lookups: dict[tuple[str, str], dict[str, Any]] = {}
            if connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Event'"
            ).fetchone():
                event_rows = connection.execute(
                    """
                    SELECT EventType, EventCount, LastOccurrence,
                           CAST(ExtraData AS BLOB) AS ExtraData
                    FROM Event
                    WHERE ContentID = ? AND EventType = ?
                    ORDER BY LastOccurrence DESC
                    """,
                    [content_id, DICTIONARY_EVENT_TYPE],
                ).fetchall()
                for event_row in event_rows:
                    try:
                        payload = decode_event_payload(event_row["ExtraData"])
                    except (EventDecodeError, TypeError):
                        continue
                    lookup = parse_dictionary_event(payload)
                    if lookup is None:
                        continue
                    key = (
                        lookup["word"].casefold(),
                        (lookup["dictionary"] or "").casefold(),
                    )
                    dictionary_lookups.setdefault(key, lookup)
        book = serialize_book(row)
        book["bookmarks"] = [dict(item) for item in bookmark_rows]
        book["dictionary_lookups"] = sorted(
            dictionary_lookups.values(),
            key=lambda lookup: (
                lookup["word"].casefold(),
                (lookup["dictionary"] or "").casefold(),
            ),
        )
        return book
