import json
import sqlite3
from datetime import UTC, datetime, timedelta

from backend.app.remaining_estimate import estimate_remaining


def database():
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    connection.executescript('''
        CREATE TABLE kstats_books (content_id TEXT, title TEXT, author TEXT, read_status INTEGER, percent_read INTEGER);
        INSERT INTO kstats_books VALUES ('book', 'Title', 'Author', 1, 20);
        CREATE TABLE AnalyticsEvents (Id INTEGER PRIMARY KEY, Type TEXT, Timestamp TEXT, Attributes TEXT, Metrics TEXT);
    ''')
    return connection


def session(connection, start, end, seconds=240, identity=None):
    timestamp = datetime(2026, 9, 1, tzinfo=UTC) + timedelta(hours=connection.execute('SELECT count(*) FROM AnalyticsEvents').fetchone()[0])
    for kind, progress, time, metrics in [
        ('OpenContent', start, timestamp, {}),
        ('LeaveContent', end, timestamp + timedelta(seconds=seconds), {'SecondsRead': seconds, 'PagesTurned': 40}),
    ]:
        connection.execute('INSERT INTO AnalyticsEvents (Type,Timestamp,Attributes,Metrics) VALUES (?,?,?,?)',
                           (kind, time.isoformat(), json.dumps(dict(identity or {'title': 'Title', 'author': 'Author'}, progress=str(progress))), json.dumps(metrics)))


def test_estimate_filters_jumps_and_speed_outliers_without_mutating_kobo():
    connection = database()
    for start in [0, 2, 4]:
        session(connection, start, start + 2)
    session(connection, 6, 11, 120)  # Implausibly fast relative to the other sessions.
    session(connection, 0, 17, 293)  # Progress reset/navigation jump.
    result = estimate_remaining(connection)['book']
    assert result == {'seconds': 9600, 'sample_sessions': 3, 'sample_seconds': 720,
                      'sample_progress': 6, 'rejected_sessions': 2}
    assert connection.execute('SELECT percent_read FROM kstats_books').fetchone()[0] == 20


def test_single_session_with_one_percent_progress_produces_estimate():
    connection = database()
    session(connection, 19, 20)
    result = estimate_remaining(connection)['book']
    assert result['seconds'] == 19200
    assert result['sample_sessions'] == 1
    assert result['sample_progress'] == 1


def test_two_sessions_with_small_progress_produce_estimate():
    connection = database()
    session(connection, 0, 2)
    session(connection, 2, 4)
    result = estimate_remaining(connection)['book']
    assert result['seconds'] == 9600
    assert result['sample_sessions'] == 2
    assert result['sample_progress'] == 4


def test_single_navigation_jump_does_not_produce_estimate():
    connection = database()
    session(connection, 0, 17, 293)
    result = estimate_remaining(connection)['book']
    assert result['seconds'] is None
    assert result['rejected_sessions'] == 1


def test_single_session_with_inconsistent_duration_does_not_produce_estimate():
    connection = database()
    session(connection, 19, 20)
    connection.execute("UPDATE AnalyticsEvents SET Metrics = ? WHERE Type = 'LeaveContent'",
                       (json.dumps({'SecondsRead': 2400, 'PagesTurned': 40}),))
    result = estimate_remaining(connection)['book']
    assert result['seconds'] is None
    assert result['rejected_sessions'] == 1


def test_ambiguous_names_are_rejected_but_explicit_ids_are_accepted():
    connection = database()
    connection.execute("INSERT INTO kstats_books VALUES ('duplicate', 'Title', 'Author', 1, 20)")
    session(connection, 4, 6)
    assert estimate_remaining(connection)['book']['sample_sessions'] == 0
    session(connection, 18, 20, identity={'volumeid': 'book'})
    assert estimate_remaining(connection)['book']['seconds'] == 9600


def test_missing_analytics_and_malformed_events_are_unavailable():
    connection = database()
    connection.execute("INSERT INTO AnalyticsEvents VALUES (1, 'OpenContent', 'invalid', '[]', '{}')")
    assert estimate_remaining(connection)['book']['seconds'] is None
    connection.execute('DROP TABLE AnalyticsEvents')
    assert estimate_remaining(connection)['book']['seconds'] is None


def test_conflicting_rates_do_not_prefer_the_slower_sample():
    connection = database()
    session(connection, 0, 2, 240)
    session(connection, 2, 4, 2400)
    result = estimate_remaining(connection)['book']
    assert result['seconds'] is None
    assert result['sample_sessions'] == 0
    assert result['rejected_sessions'] == 2


def test_estimation_supports_default_sqlite_row_factory():
    connection = database()
    session(connection, 19, 20)
    connection.row_factory = None
    assert estimate_remaining(connection)['book']['seconds'] == 19200


def test_nonfinite_progress_and_unrepresentable_rate_are_rejected():
    for end in ['nan', 'inf', '1e-320', True]:
        connection = database()
        session(connection, 0, end)
        if end is True:
            connection.execute("UPDATE AnalyticsEvents SET Attributes = ? WHERE Type = 'LeaveContent'",
                               (json.dumps({'volumeid': 'book', 'progress': True}),))
        assert estimate_remaining(connection)['book']['seconds'] is None


def test_oversized_reported_seconds_do_not_break_snapshot_processing():
    connection = database()
    session(connection, 19, 20)
    connection.execute("UPDATE AnalyticsEvents SET Metrics = ? WHERE Type = 'LeaveContent'",
                       (json.dumps({'SecondsRead': 1 << 4096, 'PagesTurned': 40}),))
    assert estimate_remaining(connection)['book']['seconds'] is None
