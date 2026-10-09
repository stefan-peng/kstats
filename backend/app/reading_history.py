"""App-owned observations, carried forward with atomic snapshot publication."""
import hashlib
import math
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from .kobo_events import EventDecodeError, decode_event_payload, parse_reading_event

HISTORY_SCHEMAS = {
    'kstats_reading_resets': '(content_id TEXT PRIMARY KEY, reset_at TEXT)',
    'kstats_reading_observations': '(content_id TEXT PRIMARY KEY, seconds INTEGER, progress REAL, observed_at TEXT)',
    'kstats_session_events': '(Id TEXT PRIMARY KEY, Type TEXT, Timestamp TEXT, Attributes TEXT, Metrics TEXT)',
    'kstats_reading_samples': '(id INTEGER PRIMARY KEY, content_id TEXT, seconds INTEGER, progress REAL)',
}


def _create_history(connection: sqlite3.Connection) -> None:
    for table, schema in HISTORY_SCHEMAS.items():
        connection.execute(f'CREATE TABLE IF NOT EXISTS {table} {schema}')


def event_counters(connection: sqlite3.Connection) -> dict[str, dict]:
    counters = {}
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE name='Event' AND type='table'").fetchone():
        return counters
    for content_id, blob in connection.execute(
        'SELECT ContentID, CAST(ExtraData AS BLOB) FROM Event WHERE EventType=3'
    ):
        try:
            event = parse_reading_event(decode_event_payload(blob))
        except EventDecodeError:
            continue
        if event and event['seconds'] <= 2**63 - 1:
            # Duplicate retained rows are cumulative counters, not additive.
            if content_id not in counters or event['seconds'] > counters[content_id]['seconds']:
                counters[content_id] = event
    return counters


def update_reading_history(connection: sqlite3.Connection) -> None:
    _create_history(connection)
    if connection.execute("SELECT 1 FROM sqlite_master WHERE name='AnalyticsEvents' AND type='table'").fetchone():
        for row in connection.execute("SELECT Type, Timestamp, Attributes, Metrics FROM AnalyticsEvents WHERE Type IN ('OpenContent','LeaveContent')").fetchall():
            digest = hashlib.sha256(repr(tuple(row)).encode()).hexdigest()
            connection.execute('INSERT OR IGNORE INTO kstats_session_events VALUES (?,?,?,?,?)', (digest, *row))
        connection.execute("DELETE FROM kstats_session_events WHERE Id NOT IN (SELECT Id FROM kstats_session_events ORDER BY Timestamp DESC, Id DESC LIMIT 20000)")
    now = datetime.now(UTC)
    counters = event_counters(connection)
    for content_id, progress, status, total in connection.execute(
        'SELECT content_id, percent_read, read_status, reading_seconds FROM kstats_books'
    ).fetchall():
        if not isinstance(progress, (int, float)) or not math.isfinite(progress) or not 0 <= progress <= 100:
            continue
        previous = connection.execute(
            'SELECT seconds, progress, observed_at FROM kstats_reading_observations WHERE content_id=?',
            (content_id,),
        ).fetchone()
        if previous and (status == 0 or (isinstance(progress, (int, float)) and progress < previous[1])):
            connection.execute('INSERT OR REPLACE INTO kstats_reading_resets VALUES (?,?)', (content_id, now.isoformat()))
            connection.execute('DELETE FROM kstats_reading_samples WHERE content_id=?', (content_id,))
            connection.execute('DELETE FROM kstats_reading_observations WHERE content_id=?', (content_id,))
            previous = None
        event = counters.get(content_id)
        if event is None:
            # Track resets even on devices that only retain AnalyticsEvents.
            if previous is None or previous[0] is None:
                connection.execute('INSERT OR REPLACE INTO kstats_reading_observations VALUES (?,?,?,?)',
                                   (content_id, None, progress, now.isoformat()))
            continue
        seconds = event['seconds']
        # A large content-counter inflation is independently contradicted by
        # retained session telemetry. Smaller discrepancies may be retention loss.
        if seconds >= 120 and len(set(event['timestamps'])) >= 10 and total > max(86400, seconds * 10):
            connection.execute("UPDATE kstats_books SET reading_seconds=?, reading_time_source='events' WHERE content_id=?",
                               (seconds, content_id))
        if previous and previous[0] is not None:
            delta_seconds, delta_progress = seconds - previous[0], progress - previous[1]
            elapsed = (now - datetime.fromisoformat(previous[2])).total_seconds()
            if delta_seconds < 0 or delta_progress < 0 or status == 0:
                # Reset/reread: rates from the previous reading no longer apply.
                connection.execute('INSERT OR REPLACE INTO kstats_reading_resets VALUES (?,?)', (content_id, now.isoformat()))
                connection.execute('DELETE FROM kstats_reading_samples WHERE content_id=?', (content_id,))
            elif seconds == previous[0] and progress == previous[1]:
                continue
            elif (status in (1, 2) and 120 <= delta_seconds <= elapsed + 10
                  and 1 <= delta_progress <= 25):
                connection.execute('INSERT INTO kstats_reading_samples (content_id, seconds, progress) VALUES (?,?,?)',
                                   (content_id, delta_seconds, delta_progress))
            elif 0 <= delta_progress < 1 and delta_seconds >= 0:
                # Preserve sub-percent reading until enough rounded progress accrues.
                continue
        connection.execute('INSERT OR REPLACE INTO kstats_reading_observations VALUES (?,?,?,?)',
                           (content_id, seconds, progress, now.isoformat()))
        connection.execute('''DELETE FROM kstats_reading_samples WHERE content_id=? AND id NOT IN
            (SELECT id FROM kstats_reading_samples WHERE content_id=? ORDER BY id DESC LIMIT 10)''',
                           (content_id, content_id))
    connection.execute('DELETE FROM kstats_reading_observations WHERE content_id NOT IN (SELECT content_id FROM kstats_books)')
    connection.execute('DELETE FROM kstats_reading_samples WHERE content_id NOT IN (SELECT content_id FROM kstats_books)')


def carry_reading_history(connection: sqlite3.Connection, previous_path: Path, source: str) -> None:
    if not previous_path.is_file():
        return
    with closing(sqlite3.connect(previous_path.resolve().as_uri() + '?mode=ro', uri=True)) as previous:
        tables = {r[0] for r in previous.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'kstats_import' not in tables:
            return
        previous_source = previous.execute('SELECT source FROM kstats_import').fetchone()
        if not previous_source or previous_source[0] != source:
            return
        # A different account at the same mount path must not inherit rates.
        def users(database):
            columns = {r[1] for r in database.execute('PRAGMA table_info(user)')}
            if 'UserID' not in columns:
                return []
            return sorted(str(r[0]) for r in database.execute('SELECT UserID FROM user'))
        if users(connection) != users(previous):
            return
        _create_history(connection)
        for table in HISTORY_SCHEMAS:
            connection.execute(f'DELETE FROM {table}')
            if table in tables:
                rows = previous.execute(f'SELECT * FROM {table}').fetchall()
                if rows:
                    placeholders = ','.join('?' for _ in rows[0])
                    connection.executemany(f'INSERT INTO {table} VALUES ({placeholders})', rows)
        connection.commit()
