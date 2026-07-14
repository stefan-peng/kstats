import math
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from .config import Settings
from .kobo_events import (
    DICTIONARY_EVENT_TYPE,
    READING_EVENT_TYPE,
    EventDecodeError,
    decode_event_payload,
    parse_dictionary_event,
    parse_reading_event,
)
from .reading_duration import aggregate_reading_duration
from .source_processing import SourceType, ensure_derived_tables

BOOK_SELECT = """
SELECT
    content_id,
    title,
    author,
    read_status,
    reading_seconds,
    percent_read,
    date_last_read,
    finished_at,
    current_chapter_estimate_seconds,
    rest_of_book_estimate_seconds,
    remaining_seconds,
    downloaded,
    word_count,
    series,
    series_number,
    publisher,
    description,
    language,
    isbn,
    image_id,
    mime_type,
    source_type,
    bookmark_count
FROM kstats_books
"""


def status_name(value: int) -> str:
    return {0: "unread", 1: "reading", 2: "finished"}.get(value, "unread")


def serialize_book(row: sqlite3.Row, covers_dir: Path) -> dict[str, Any]:
    book = dict(row)
    book["status"] = status_name(book.pop("read_status"))
    if book["status"] == "finished":
        book["percent_read"] = 100
    book["downloaded"] = bool(book["downloaded"])
    image_id = book.pop("image_id", None)
    cover = covers_dir / f"{image_id}-grid.jpg" if image_id else None
    book["cover_url"] = (
        f"/api/covers/{quote(cover.name)}" if cover and cover.is_file() else None
    )
    return book


class Repository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.database = settings.snapshot_db
        self.covers_dir = settings.covers_dir

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        if not self.database.is_file():
            raise FileNotFoundError("No Kobo snapshot is available")
        connection = sqlite3.connect(self.database, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        try:
            ensure_derived_tables(connection)
            yield connection
        finally:
            connection.close()

    @staticmethod
    def _source_summary(connection: sqlite3.Connection) -> dict[str, int]:
        row = connection.execute("SELECT * FROM kstats_source_summary").fetchone()
        if row is None:
            return {
                "kept_kobo_store": 0,
                "kept_sideloaded": 0,
                "ignored_custom_catalog": 0,
                "removed_with_activity": 0,
                "merged_removed_history": 0,
            }
        return {key: int(row[key] or 0) for key in row.keys()}

    def dashboard(self, timezone: ZoneInfo | None = None) -> dict[str, Any]:
        chart_timezone = timezone or ZoneInfo("UTC")
        with self.connect() as connection:
            totals = connection.execute(
                """
                SELECT
                    COUNT(*) AS library,
                    SUM(CASE WHEN read_status = 2 THEN 1 ELSE 0 END) AS finished,
                    SUM(CASE WHEN read_status = 1 THEN 1 ELSE 0 END) AS reading,
                    SUM(reading_seconds) AS reading_seconds
                FROM kstats_books
                """
            ).fetchone()

            status_rows = connection.execute(
                """
                SELECT read_status AS status, COUNT(*) AS count
                FROM kstats_books
                GROUP BY read_status
                ORDER BY status
                """
            ).fetchall()

            monthly_rows = connection.execute(
                """
                SELECT substr(finished_at, 1, 7) AS month, COUNT(*) AS count
                FROM kstats_books
                WHERE read_status = 2
                    AND finished_at IS NOT NULL
                    AND length(finished_at) >= 7
                GROUP BY month
                ORDER BY month DESC
                LIMIT 12
                """
            ).fetchall()

            continue_rows = connection.execute(
                f"""
                {BOOK_SELECT}
                WHERE read_status = 1
                ORDER BY date_last_read DESC, title
                LIMIT 6
                """
            ).fetchall()

            top_rows = connection.execute(
                f"""
                {BOOK_SELECT}
                WHERE reading_seconds > 0
                ORDER BY reading_seconds DESC
                LIMIT 5
                """
            ).fetchall()

            reading_events: list[dict[str, Any]] = []
            skipped_reading_rows = 0
            has_event_table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Event'"
            ).fetchone()
            event_rows = (
                connection.execute(
                    """
                    SELECT CAST(ExtraData AS BLOB) AS extra_data
                    FROM Event
                    WHERE EventType = ?
                    """,
                    [READING_EVENT_TYPE],
                ).fetchall()
                if has_event_table
                else []
            )
            for event_row in event_rows:
                try:
                    payload = decode_event_payload(event_row["extra_data"])
                except EventDecodeError:
                    skipped_reading_rows += 1
                    continue
                reading_event = parse_reading_event(payload)
                if reading_event is None:
                    skipped_reading_rows += 1
                    continue
                reading_events.append(reading_event)

            source_summary = self._source_summary(connection)

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
            "source_summary": source_summary,
            "status_counts": status_counts,
            "monthly_completions": [
                dict(row) for row in reversed(monthly_rows) if row["month"]
            ],
            "reading_duration": aggregate_reading_duration(
                reading_events,
                chart_timezone,
                skipped_rows=skipped_reading_rows,
            ),
            "continue_reading": [
                serialize_book(row, self.covers_dir) for row in continue_rows
            ],
            "top_books": [serialize_book(row, self.covers_dir) for row in top_rows],
        }

    def books(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None,
        status: str | None,
        source: SourceType | None,
        downloaded: bool | None,
        has_highlights: bool | None,
        finished_month: str | None,
        series: str | None,
        publisher: str | None,
        language: str | None,
        sort: str,
        direction: str,
    ) -> dict[str, Any]:
        filters: list[str] = []
        parameters: list[Any] = []
        if search:
            filters.append("(title LIKE ? OR author LIKE ?)")
            term = f"%{search}%"
            parameters.extend([term, term])
        if status and status != "all":
            value = {"unread": 0, "reading": 1, "finished": 2}.get(status)
            if value is not None:
                filters.append("read_status = ?")
                parameters.append(value)
        if source in ("kobo_store", "sideloaded"):
            filters.append("source_type = ?")
            parameters.append(source)
        if downloaded is not None:
            filters.append("downloaded = ?")
            parameters.append(1 if downloaded else 0)
        if finished_month:
            filters.append("read_status = 2")
            filters.append("substr(finished_at, 1, 7) = ?")
            parameters.append(finished_month)
        if has_highlights is not None:
            filters.append("bookmark_count > 0" if has_highlights else "bookmark_count = 0")
        if series:
            filters.append("series = ?")
            parameters.append(series)
        if publisher:
            filters.append("publisher = ?")
            parameters.append(publisher)
        if language:
            filters.append("language = ?")
            parameters.append(language)

        sort_columns = {
            "title": "title",
            "author": "author",
            "status": "read_status",
            "progress": "percent_read",
            "reading_time": "reading_seconds",
            "remaining_time": "remaining_seconds",
            "last_read": "date_last_read",
            "source": "source_type",
            "highlights": "bookmark_count",
        }
        sort_column = sort_columns.get(sort, "date_last_read")
        sort_direction = "ASC" if direction == "asc" else "DESC"
        where = f"WHERE {' AND '.join(filters)}" if filters else ""

        with self.connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) FROM kstats_books {where}", parameters
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                {BOOK_SELECT}
                {where}
                ORDER BY {sort_column} IS NULL, {sort_column} {sort_direction}, title ASC
                LIMIT ? OFFSET ?
                """,
                [*parameters, page_size, (page - 1) * page_size],
            ).fetchall()
            source_summary = self._source_summary(connection)

        return {
            "items": [serialize_book(row, self.covers_dir) for row in rows],
            "page": page,
            "page_size": page_size,
            "total": total,
            "pages": max(1, math.ceil(total / page_size)),
            "filter_options": self.filter_options(),
            "source_summary": source_summary,
        }

    def filter_options(self) -> dict[str, list[str]]:
        with self.connect() as connection:
            options: dict[str, list[str]] = {}
            for key, column in {
                "series": "series",
                "publishers": "publisher",
                "languages": "language",
            }.items():
                rows = connection.execute(
                    f"""
                    SELECT DISTINCT {column} AS value
                    FROM kstats_books
                    WHERE {column} IS NOT NULL
                    ORDER BY value COLLATE NOCASE
                    LIMIT 200
                    """
                ).fetchall()
                options[key] = [row["value"] for row in rows]
        return options

    def book(self, content_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                f"{BOOK_SELECT} WHERE content_id = ?",
                [content_id],
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
                    payload = decode_event_payload(event_row["ExtraData"])
                    lookup = parse_dictionary_event(payload)
                    if lookup is None:
                        continue
                    key = (
                        lookup["word"].casefold(),
                        (lookup["dictionary"] or "").casefold(),
                    )
                    dictionary_lookups.setdefault(key, lookup)
        book = serialize_book(row, self.covers_dir)
        image_id = row["image_id"]
        full_cover = self.covers_dir / f"{image_id}-full.jpg" if image_id else None
        if full_cover and full_cover.is_file():
            book["cover_url"] = f"/api/covers/{quote(full_cover.name)}"
        book["data_source"] = {
            "snapshot_path": str(self.database),
            "read_only": True,
        }
        book["bookmarks"] = [dict(item) for item in bookmark_rows]
        book["dictionary_lookups"] = sorted(
            dictionary_lookups.values(),
            key=lambda lookup: (
                lookup["word"].casefold(),
                (lookup["dictionary"] or "").casefold(),
            ),
        )
        return book
