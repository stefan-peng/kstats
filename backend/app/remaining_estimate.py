"""Estimate book time remaining from retained, paired reading sessions."""
import json
import math
import sqlite3
from datetime import datetime
from statistics import median
from typing import TypedDict


class RemainingEstimate(TypedDict):
    seconds: int | None
    sample_sessions: int
    sample_seconds: int
    sample_progress: float
    rejected_sessions: int


def _rows(connection: sqlite3.Connection, query: str) -> list[dict]:
    cursor = connection.execute(query)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor]


def estimate_remaining(connection: sqlite3.Connection) -> dict[str, RemainingEstimate]:
    books = _rows(connection, """
        SELECT content_id, title, author, read_status, percent_read
        FROM kstats_books
    """)
    by_id = {book['content_id']: book for book in books}
    by_name: dict[tuple[str, str], list[str]] = {}
    for book in books:
        by_name.setdefault((book['title'], book['author']), []).append(book['content_id'])
    result: dict[str, RemainingEstimate] = {
        book['content_id']: {
            'seconds': None, 'sample_sessions': 0, 'sample_seconds': 0,
            'sample_progress': 0, 'rejected_sessions': 0,
        } for book in books
    }
    if not connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'AnalyticsEvents'"
    ).fetchone():
        return result
    samples: dict[str, list[tuple[int, float]]] = {book['content_id']: [] for book in books}
    pending = None
    for row in _rows(connection, """
        SELECT Type, Timestamp, Attributes, Metrics FROM AnalyticsEvents
        WHERE Type IN ('OpenContent', 'LeaveContent') ORDER BY Timestamp, Id
    """):
        try:
            attributes = json.loads(row['Attributes'])
            metrics = json.loads(row['Metrics'])
            if not isinstance(attributes, dict) or not isinstance(metrics, dict):
                raise ValueError()
            content_id = attributes.get('volumeid')
            if content_id is None:
                matches = by_name.get((attributes.get('title'), attributes.get('author')), [])
                content_id = matches[0] if len(matches) == 1 else None
            if content_id not in by_id:
                raise ValueError()
            if isinstance(attributes['progress'], bool):
                raise ValueError()
            progress = float(attributes['progress'])
            timestamp = datetime.fromisoformat(row['Timestamp'].replace('Z', '+00:00'))
            if not math.isfinite(progress) or not 0 <= progress <= 100 or timestamp.tzinfo is None:
                raise ValueError()
        except (TypeError, ValueError, KeyError, AttributeError, OverflowError):
            pending = None
            continue
        if row['Type'] == 'OpenContent':
            pending = (content_id, progress, timestamp)
            continue
        opening, pending = pending, None
        if opening is None or opening[0] != content_id:
            continue
        delta = progress - opening[1]
        elapsed = (timestamp - opening[2]).total_seconds()
        seconds, pages = metrics.get('SecondsRead'), metrics.get('PagesTurned')
        # Rounded progress and brief navigation are poor speed measurements.
        if (type(seconds) is not int or not 120 <= seconds <= 2**63 - 1 or elapsed <= 0
                or abs(seconds - elapsed) > max(10, elapsed * .1)
                or not 0 < delta <= 10 or type(pages) is not int or pages < 10):
            result[content_id]['rejected_sessions'] += 1
            continue
        rate = seconds / delta
        if not math.isfinite(rate) or rate * 100 > 2**63 - 1:
            result[content_id]['rejected_sessions'] += 1
            continue
        samples[content_id].append((seconds, delta))
    for book in books:
        content_id = book['content_id']
        candidates = samples[content_id][-10:]
        if not candidates:
            continue
        # Center multiplicative rates in log space. Two conflicting samples
        # should not preferentially select the slower one as the ordinary median does.
        center = math.exp(median(math.log(seconds / delta) for seconds, delta in candidates))
        accepted = [(seconds, delta) for seconds, delta in candidates
                    if center / 3 <= seconds / delta <= center * 3]
        output = result[content_id]
        output['rejected_sessions'] += len(candidates) - len(accepted)
        output['sample_sessions'] = len(accepted)
        output['sample_seconds'] = sum(seconds for seconds, _ in accepted)
        output['sample_progress'] = sum(delta for _, delta in accepted)
        if book['read_status'] == 1 and 0 < book['percent_read'] < 100 and accepted:
            output['seconds'] = round(output['sample_seconds'] / output['sample_progress']
                                      * (100 - book['percent_read']))
    return result


def apply_remaining_estimates(connection: sqlite3.Connection) -> None:
    """Materialize the selected estimate for consistent API values and sorting."""
    estimates = estimate_remaining(connection)
    for book in _rows(connection, 'SELECT content_id, read_status, remaining_seconds FROM kstats_books'):
        estimate = estimates[book['content_id']]
        seconds = estimate['seconds']
        source = 'sessions' if seconds is not None else None
        if seconds is None:
            seconds = book['remaining_seconds']
            if book['read_status'] == 1 and seconds > 0:
                source = 'kobo'
        connection.execute("""
            UPDATE kstats_books SET remaining_seconds = ?, remaining_estimate_source = ?,
                remaining_estimate_sessions = ?, remaining_estimate_reading_seconds = ?,
                remaining_estimate_progress = ? WHERE content_id = ?
        """, (
            seconds, source,
            estimate['sample_sessions'] if source == 'sessions' else 0,
            estimate['sample_seconds'] if source == 'sessions' else 0,
            estimate['sample_progress'] if source == 'sessions' else 0,
            book['content_id'],
        ))
