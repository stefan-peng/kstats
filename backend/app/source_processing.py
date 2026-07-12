import sqlite3
from typing import Literal

BOOK_MIME_TYPES = (
    "application/x-kobo-epub+zip",
    "application/epub+zip",
    "application/pdf",
)
DERIVED_SCHEMA_VERSION = 2

SourceType = Literal["kobo_store", "sideloaded", "custom_server", "catalog_noise"]


def _title_expression(alias: str) -> str:
    title = f"COALESCE(NULLIF({alias}.Title, ''), NULLIF({alias}.BookTitle, ''), '')"
    return f"LOWER(TRIM({title}))"


def _title_prefix_expression(alias: str) -> str:
    title = f"COALESCE(NULLIF({alias}.Title, ''), NULLIF({alias}.BookTitle, ''), '')"
    return (
        "LOWER(TRIM(CASE "
        f"WHEN instr({title}, ':') > 0 THEN substr({title}, 1, instr({title}, ':') - 1) "
        f"ELSE {title} END))"
    )


def _author_expression(alias: str) -> str:
    return f"LOWER(TRIM(COALESCE(NULLIF({alias}.Attribution, ''), '')))"


SOURCE_TYPE_EXPRESSION = """
CASE
    WHEN content.___UserID = 'removed' THEN 'custom_server'
    WHEN content.___UserID = 'kepub_user' OR content.ContentID LIKE 'file:%' THEN 'sideloaded'
    WHEN content.___UserID IS NULL OR TRIM(content.___UserID) = '' THEN 'catalog_noise'
    ELSE 'kobo_store'
END
"""

CANONICAL_SOURCE_FILTER = """
(
    (content.___UserID IS NULL OR content.___UserID != 'removed')
    AND (
        (
            content.___UserID IS NOT NULL
            AND TRIM(content.___UserID) != ''
        )
        OR content.ContentID LIKE 'file:%'
    )
)
"""

REMOVED_ACTIVITY_FILTER = """
(
    COALESCE(removed.ReadStatus, 0) != 0
    OR COALESCE(removed.TimeSpentReading, 0) > 0
    OR COALESCE(removed.___PercentRead, 0) > 0
)
"""

CONTENT_COUNT_SQL = "SELECT COUNT(*) FROM content"


def content_count(connection: sqlite3.Connection) -> int:
    if not connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content'"
    ).fetchone():
        return 0
    return int(connection.execute(CONTENT_COUNT_SQL).fetchone()[0] or 0)


def derived_tables_current(connection: sqlite3.Connection) -> bool:
    if not connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kstats_meta'"
    ).fetchone():
        return False
    rows = dict(
        connection.execute(
            "SELECT key, value FROM kstats_meta "
            "WHERE key IN ('content_count', 'schema_version')"
        ).fetchall()
    )
    return (
        rows.get("schema_version") == DERIVED_SCHEMA_VERSION
        and rows.get("content_count") == content_count(connection)
    )


def ensure_derived_tables(connection: sqlite3.Connection) -> None:
    if not derived_tables_current(connection):
        rebuild_derived_tables(connection)


def rebuild_derived_tables(connection: sqlite3.Connection) -> None:
    placeholders = ",".join("?" for _ in BOOK_MIME_TYPES)
    canonical_state_is_authoritative = """
    (
        COALESCE(content.ReadStatus, 0) != 0
        OR COALESCE(content.TimeSpentReading, 0) > 0
        OR COALESCE(content.___PercentRead, 0) > 0
        OR (
            content.DateLastRead IS NOT NULL
            AND content.DateLastRead >= COALESCE(removed.DateLastRead, '')
        )
    )
    """
    connection.executescript(
        """
        DROP TABLE IF EXISTS kstats_books;
        DROP TABLE IF EXISTS kstats_source_summary;
        DROP TABLE IF EXISTS kstats_meta;
        """
    )
    if not connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content'"
    ).fetchone():
        connection.executescript(
            f"""
            CREATE TABLE kstats_books (
                content_id TEXT PRIMARY KEY,
                title TEXT,
                author TEXT,
                read_status INTEGER,
                reading_seconds INTEGER,
                percent_read INTEGER,
                date_last_read TEXT,
                finished_at TEXT,
                current_chapter_estimate_seconds INTEGER,
                rest_of_book_estimate_seconds INTEGER,
                remaining_seconds INTEGER,
                downloaded INTEGER,
                word_count INTEGER,
                series TEXT,
                series_number TEXT,
                publisher TEXT,
                description TEXT,
                language TEXT,
                isbn TEXT,
                image_id TEXT,
                mime_type TEXT,
                source_type TEXT,
                merged_removed_count INTEGER,
                bookmark_count INTEGER
            );
            CREATE TABLE kstats_source_summary (
                kept_kobo_store INTEGER NOT NULL,
                kept_sideloaded INTEGER NOT NULL,
                ignored_custom_catalog INTEGER NOT NULL,
                removed_with_activity INTEGER NOT NULL,
                merged_removed_history INTEGER NOT NULL
            );
            INSERT INTO kstats_source_summary VALUES (0, 0, 0, 0, 0);
            CREATE TABLE kstats_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
            INSERT INTO kstats_meta VALUES ('content_count', 0);
            INSERT INTO kstats_meta VALUES ('schema_version', {DERIVED_SCHEMA_VERSION});
            """
        )
        connection.commit()
        return
    connection.executescript(
        """
        DROP TABLE IF EXISTS temp.kstats_removed_matches;
        DROP TABLE IF EXISTS temp.kstats_removed_candidates;
        DROP TABLE IF EXISTS temp.kstats_removed_owned_candidates;
        DROP TABLE IF EXISTS temp.kstats_removed_aggregates;
        DROP TABLE IF EXISTS temp.kstats_removed_state;
        DROP TABLE IF EXISTS temp.kstats_effective_state;
        DROP TABLE IF EXISTS temp.kstats_canonical_books;
        DROP TABLE IF EXISTS temp.kstats_removed_activity;
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE kstats_removed_activity AS
        SELECT ContentID, ISBN, ReadStatus, TimeSpentReading, ___PercentRead,
               DateLastRead, LastTimeFinishedReading, CurrentChapterEstimate,
               RestOfBookEstimate,
               {_title_expression('content')} AS normalized_title,
               {_title_prefix_expression('content')} AS normalized_title_prefix,
               {_author_expression('content')} AS normalized_author
        FROM content AS content
        WHERE content.ContentType = 6
          AND content.MimeType IN ({placeholders})
          AND content.___UserID = 'removed'
          AND {REMOVED_ACTIVITY_FILTER.replace('removed.', 'content.')}
        """,
        list(BOOK_MIME_TYPES),
    )
    connection.executescript(
        """
        CREATE UNIQUE INDEX temp.kstats_removed_content_id_idx
            ON kstats_removed_activity(ContentID);
        CREATE INDEX temp.kstats_removed_isbn_idx ON kstats_removed_activity(ISBN);
        CREATE INDEX temp.kstats_removed_title_author_idx
            ON kstats_removed_activity(normalized_title, normalized_author);
        CREATE INDEX temp.kstats_removed_prefix_author_idx
            ON kstats_removed_activity(normalized_title_prefix, normalized_author);
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE kstats_canonical_books AS
        SELECT ContentID, NULLIF(TRIM(ISBN), '') AS ISBN,
               {_title_expression('content')} AS normalized_title,
               {_title_prefix_expression('content')} AS normalized_title_prefix,
               {_author_expression('content')} AS normalized_author
        FROM content AS content
        WHERE content.ContentType = 6
          AND content.MimeType IN ({placeholders})
          AND {CANONICAL_SOURCE_FILTER}
        """,
        list(BOOK_MIME_TYPES),
    )
    connection.executescript(
        """
        CREATE INDEX temp.kstats_canonical_isbn_idx ON kstats_canonical_books(ISBN);
        CREATE INDEX temp.kstats_canonical_title_author_idx
            ON kstats_canonical_books(normalized_title, normalized_author);
        CREATE INDEX temp.kstats_canonical_prefix_author_idx
            ON kstats_canonical_books(normalized_title_prefix, normalized_author);
        CREATE TEMP TABLE kstats_removed_candidates AS
        SELECT content_id, removed_content_id, MAX(match_quality) AS match_quality
        FROM (
        SELECT canonical.ContentID AS content_id, removed.ContentID AS removed_content_id,
               3 AS match_quality
        FROM kstats_canonical_books AS canonical
        JOIN kstats_removed_activity AS removed
          ON NULLIF(TRIM(removed.ISBN), '') = canonical.ISBN
        WHERE canonical.ISBN IS NOT NULL
        UNION ALL
        SELECT canonical.ContentID, removed.ContentID, 2
        FROM kstats_canonical_books AS canonical
        JOIN kstats_removed_activity AS removed
          ON removed.normalized_title = canonical.normalized_title
         AND removed.normalized_author = canonical.normalized_author
        WHERE canonical.normalized_title != '' AND canonical.normalized_author != ''
        UNION ALL
        SELECT canonical.ContentID, removed.ContentID, 1
        FROM kstats_canonical_books AS canonical
        JOIN kstats_removed_activity AS removed
          ON removed.normalized_author = canonical.normalized_author
         AND (
              (canonical.normalized_title = canonical.normalized_title_prefix
               AND removed.normalized_title != removed.normalized_title_prefix
               AND canonical.normalized_title = removed.normalized_title_prefix)
              OR
              (removed.normalized_title = removed.normalized_title_prefix
               AND canonical.normalized_title != canonical.normalized_title_prefix
               AND removed.normalized_title = canonical.normalized_title_prefix)
         )
        WHERE canonical.normalized_title != '' AND canonical.normalized_author != ''
        )
        GROUP BY content_id, removed_content_id;
        CREATE TEMP TABLE kstats_removed_owned_candidates AS
        SELECT candidate.content_id, candidate.removed_content_id,
               candidate.match_quality
        FROM kstats_removed_candidates AS candidate
        WHERE candidate.match_quality = (
                SELECT MAX(peer.match_quality)
                FROM kstats_removed_candidates AS peer
                WHERE peer.removed_content_id = candidate.removed_content_id
              )
          AND 1 = (
                SELECT COUNT(*)
                FROM kstats_removed_candidates AS peer
                WHERE peer.removed_content_id = candidate.removed_content_id
                  AND peer.match_quality = candidate.match_quality
              );
        CREATE TEMP TABLE kstats_removed_matches AS
        SELECT candidate.content_id, candidate.removed_content_id
        FROM kstats_removed_owned_candidates AS candidate
        WHERE (
                candidate.match_quality > 1
                OR (
                    1 = (
                        SELECT COUNT(*)
                        FROM kstats_removed_owned_candidates AS peer
                        WHERE peer.content_id = candidate.content_id
                          AND peer.match_quality = 1
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM kstats_removed_owned_candidates AS peer
                        WHERE peer.content_id = candidate.content_id
                          AND peer.match_quality > 1
                    )
                )
              );
        CREATE INDEX temp.kstats_removed_matches_content_idx
            ON kstats_removed_matches(content_id);
        CREATE TEMP TABLE kstats_removed_aggregates AS
        SELECT matches.content_id,
               COUNT(*) AS removed_count,
               MAX(MAX(COALESCE(removed.TimeSpentReading, 0), 0)) AS reading_seconds
        FROM kstats_removed_matches AS matches
        JOIN kstats_removed_activity AS removed
          ON removed.ContentID = matches.removed_content_id
        GROUP BY matches.content_id;
        CREATE TEMP TABLE kstats_removed_state AS
        SELECT * FROM (
            SELECT matches.content_id,
                   removed.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY matches.content_id
                       ORDER BY
                           CASE WHEN COALESCE(removed.ReadStatus, 0) != 0
                                  OR COALESCE(removed.TimeSpentReading, 0) > 0
                                  OR COALESCE(removed.___PercentRead, 0) > 0
                                THEN 1 ELSE 0 END DESC,
                           COALESCE(removed.DateLastRead, '') DESC,
                           COALESCE(removed.LastTimeFinishedReading, '') DESC,
                           removed.ContentID DESC
                   ) AS state_rank
            FROM kstats_removed_matches AS matches
            JOIN kstats_removed_activity AS removed
              ON removed.ContentID = matches.removed_content_id
        )
        WHERE state_rank = 1;
        """
    )
    connection.execute(
        f"""
        CREATE TEMP TABLE kstats_effective_state AS
        WITH chosen AS (
            SELECT content.ContentID AS content_id,
                   CASE WHEN {canonical_state_is_authoritative}
                        THEN COALESCE(content.ReadStatus, 0)
                        ELSE COALESCE(removed.ReadStatus, content.ReadStatus, 0) END AS read_status,
                   CASE WHEN {canonical_state_is_authoritative}
                        THEN COALESCE(content.___PercentRead, 0)
                        ELSE COALESCE(removed.___PercentRead, content.___PercentRead, 0) END AS percent_read,
                   CASE WHEN {canonical_state_is_authoritative}
                        THEN content.DateLastRead
                        ELSE COALESCE(removed.DateLastRead, content.DateLastRead) END AS date_last_read,
                   CASE WHEN {canonical_state_is_authoritative}
                        THEN content.LastTimeFinishedReading
                        ELSE COALESCE(removed.LastTimeFinishedReading, content.LastTimeFinishedReading) END AS finished_at,
                   CASE WHEN {canonical_state_is_authoritative}
                        THEN COALESCE(content.CurrentChapterEstimate, 0)
                        ELSE COALESCE(removed.CurrentChapterEstimate, content.CurrentChapterEstimate, 0) END AS current_estimate,
                   CASE WHEN {canonical_state_is_authoritative}
                        THEN COALESCE(content.RestOfBookEstimate, 0)
                        ELSE COALESCE(removed.RestOfBookEstimate, content.RestOfBookEstimate, 0) END AS rest_estimate
            FROM content AS content
            LEFT JOIN kstats_removed_state AS removed
              ON removed.content_id = content.ContentID
            WHERE content.ContentType = 6
              AND content.MimeType IN ({placeholders})
              AND {CANONICAL_SOURCE_FILTER}
        )
        SELECT content_id,
               read_status,
               MIN(MAX(COALESCE(percent_read, 0), 0), 100) AS percent_read,
               date_last_read,
               finished_at,
               CASE WHEN read_status = 1 THEN MAX(COALESCE(current_estimate, 0), 0) ELSE 0 END
                   AS current_chapter_estimate_seconds,
               CASE WHEN read_status = 1 THEN MAX(COALESCE(rest_estimate, 0), 0) ELSE 0 END
                   AS rest_of_book_estimate_seconds
        FROM chosen
        """,
        list(BOOK_MIME_TYPES),
    )
    connection.execute(
        f"""
        CREATE TABLE kstats_books AS
        SELECT
            content.ContentID AS content_id,
            COALESCE(NULLIF(content.Title, ''), NULLIF(content.BookTitle, ''), 'Untitled') AS title,
            COALESCE(NULLIF(content.Attribution, ''), 'Unknown author') AS author,
            state.read_status,
            MAX(MAX(COALESCE(content.TimeSpentReading, 0), 0), COALESCE(history.reading_seconds, 0)) AS reading_seconds,
            state.percent_read,
            NULLIF(state.date_last_read, '') AS date_last_read,
            NULLIF(state.finished_at, '') AS finished_at,
            state.current_chapter_estimate_seconds,
            state.rest_of_book_estimate_seconds,
            state.current_chapter_estimate_seconds + state.rest_of_book_estimate_seconds
                AS remaining_seconds,
            CASE WHEN lower(CAST(content.IsDownloaded AS TEXT)) IN ('1', 'true') THEN 1 ELSE 0 END AS downloaded,
            CASE WHEN COALESCE(content.WordCount, -1) > 0 THEN content.WordCount ELSE NULL END AS word_count,
            NULLIF(content.Series, '') AS series,
            NULLIF(content.SeriesNumber, '') AS series_number,
            NULLIF(content.Publisher, '') AS publisher,
            NULLIF(content.Description, '') AS description,
            NULLIF(content.Language, '') AS language,
            NULLIF(content.ISBN, '') AS isbn,
            NULLIF(content.ImageId, '') AS image_id,
            content.MimeType AS mime_type,
            {SOURCE_TYPE_EXPRESSION} AS source_type,
            COALESCE(history.removed_count, 0) AS merged_removed_count,
            (
                SELECT COUNT(*)
                FROM Bookmark
                WHERE VolumeID = content.ContentID
                  AND LOWER(TRIM(CAST(COALESCE(Hidden, 0) AS TEXT))) IN ('0', 'false')
            ) AS bookmark_count
        FROM content AS content
        JOIN kstats_effective_state AS state ON state.content_id = content.ContentID
        LEFT JOIN kstats_removed_aggregates AS history
          ON history.content_id = content.ContentID
        WHERE content.ContentType = 6
          AND content.MimeType IN ({placeholders})
          AND {CANONICAL_SOURCE_FILTER}
        """,
        list(BOOK_MIME_TYPES),
    )
    connection.executescript(
        """
        CREATE UNIQUE INDEX kstats_books_content_id_idx ON kstats_books(content_id);
        CREATE INDEX kstats_books_status_idx ON kstats_books(read_status);
        CREATE INDEX kstats_books_source_idx ON kstats_books(source_type);
        CREATE INDEX kstats_books_finished_idx ON kstats_books(finished_at);
        CREATE INDEX kstats_books_last_read_idx ON kstats_books(date_last_read);
        CREATE INDEX kstats_books_series_idx ON kstats_books(series);
        CREATE INDEX kstats_books_publisher_idx ON kstats_books(publisher);
        CREATE INDEX kstats_books_language_idx ON kstats_books(language);
        """
    )
    summary = connection.execute(
        f"""
        SELECT
            (
                SELECT COUNT(*) FROM kstats_books WHERE source_type = 'kobo_store'
            ) AS kept_kobo_store,
            (
                SELECT COUNT(*) FROM kstats_books WHERE source_type = 'sideloaded'
            ) AS kept_sideloaded,
            (
                SELECT COUNT(*)
                FROM content AS content
                WHERE content.ContentType = 6
                  AND content.MimeType IN ({placeholders})
                  AND NOT {CANONICAL_SOURCE_FILTER}
            ) AS ignored_custom_catalog,
            (
                SELECT COUNT(*)
                FROM content AS removed
                WHERE removed.ContentType = 6
                  AND removed.MimeType IN ({placeholders})
                  AND removed.___UserID = 'removed'
                  AND {REMOVED_ACTIVITY_FILTER}
            ) AS removed_with_activity,
            COALESCE((SELECT SUM(merged_removed_count) FROM kstats_books), 0)
                AS merged_removed_history
        """,
        [*BOOK_MIME_TYPES, *BOOK_MIME_TYPES],
    ).fetchone()
    connection.execute(
        """
        CREATE TABLE kstats_source_summary (
            kept_kobo_store INTEGER NOT NULL,
            kept_sideloaded INTEGER NOT NULL,
            ignored_custom_catalog INTEGER NOT NULL,
            removed_with_activity INTEGER NOT NULL,
            merged_removed_history INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        "INSERT INTO kstats_source_summary VALUES (?, ?, ?, ?, ?)",
        tuple(int(value or 0) for value in summary),
    )
    connection.execute(
        "CREATE TABLE kstats_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)"
    )
    connection.execute(
        "INSERT INTO kstats_meta VALUES ('content_count', ?)",
        (content_count(connection),),
    )
    connection.execute(
        "INSERT INTO kstats_meta VALUES ('schema_version', ?)",
        (DERIVED_SCHEMA_VERSION,),
    )
    connection.executescript(
        """
        DROP TABLE temp.kstats_removed_matches;
        DROP TABLE temp.kstats_removed_candidates;
        DROP TABLE temp.kstats_removed_owned_candidates;
        DROP TABLE temp.kstats_removed_aggregates;
        DROP TABLE temp.kstats_removed_state;
        DROP TABLE temp.kstats_effective_state;
        DROP TABLE temp.kstats_canonical_books;
        DROP TABLE temp.kstats_removed_activity;
        """
    )
    connection.commit()
