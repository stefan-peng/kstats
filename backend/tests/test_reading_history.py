import sqlite3
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from backend.app.config import Settings
from backend.app.importer import import_database
from backend.app.repository import Repository
from backend.tests.conftest import create_fixture_database, event_payload


def counter(source, seconds, progress):
    with sqlite3.connect(source) as c:
        c.execute("DELETE FROM Event WHERE ContentID='book-reading' AND EventType=3")
        c.execute("INSERT INTO Event (EventType, ContentID, ExtraData) VALUES (3, 'book-reading', ?)",
                  (event_payload({'ExtraDataReadingSeconds': seconds, 'ExtraDataReadingSessions': 22,
                                  'eventTimestamps': list(range(1700000000, 1700000020))}),))
        c.execute("UPDATE content SET ___PercentRead=? WHERE ContentID='book-reading'", (progress,))


def setup(tmp_path):
    source = tmp_path / 'KoboReader.sqlite'
    create_fixture_database(source)
    return source, Settings(source_db=source, data_dir=tmp_path / 'data')


def age_baseline(settings):
    with sqlite3.connect(settings.snapshot_db) as c:
        c.execute('UPDATE kstats_reading_observations SET observed_at=?',
                  ((datetime.now(UTC) - timedelta(days=1)).isoformat(),))


def book(settings):
    return Repository(settings).book('book-reading', ZoneInfo('UTC'))


def test_corrects_grossly_inflated_total_and_preserves_raw_source(tmp_path):
    source, settings = setup(tmp_path)
    counter(source, 6337, 55)
    with sqlite3.connect(source) as c:
        c.execute("UPDATE content SET TimeSpentReading=460860 WHERE ContentID='book-reading'")
    import_database(settings)
    result = book(settings)
    assert result['reading_seconds'] == 6337
    assert result['reading_time_source'] == 'events'
    with sqlite3.connect(source) as c:
        assert c.execute("SELECT TimeSpentReading FROM content WHERE ContentID='book-reading'").fetchone()[0] == 460860


def test_retention_loss_does_not_replace_plausible_content_total(tmp_path):
    source, settings = setup(tmp_path)
    counter(source, 120, 20)
    import_database(settings)
    assert book(settings)['reading_seconds'] == 3661
    assert book(settings)['reading_time_source'] == 'kobo'


def test_observed_rate_survives_import_and_unchanged_reimports(tmp_path):
    source, settings = setup(tmp_path)
    counter(source, 600, 20)
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'
    age_baseline(settings)
    counter(source, 1200, 25)
    import_database(settings)
    result = book(settings)
    assert result['remaining_estimate_source'] == 'observations'
    assert result['remaining_seconds'] == 9000
    assert result['remaining_estimate_sessions'] == 1
    assert result['remaining_estimate_reading_seconds'] == 600
    assert result['remaining_estimate_progress'] == 5
    import_database(settings)
    assert book(settings)['remaining_seconds'] == 9000
    assert book(settings)['remaining_estimate_sessions'] == 1
    # Loss of retained telemetry does not erase an already observed rate.
    with sqlite3.connect(source) as c:
        c.execute('DELETE FROM Event')
    import_database(settings)
    assert book(settings)['remaining_seconds'] == 9000


def test_subpercent_reading_accumulates_and_reset_discards_rate(tmp_path):
    source, settings = setup(tmp_path)
    counter(source, 600, 20)
    import_database(settings)
    age_baseline(settings)
    counter(source, 900, 20)
    import_database(settings)
    counter(source, 1200, 22)
    import_database(settings)
    assert book(settings)['remaining_seconds'] == 23400
    counter(source, 10, 1)
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'


def test_navigation_and_impossible_counter_growth_are_rejected(tmp_path):
    source, settings = setup(tmp_path)
    counter(source, 600, 20)
    import_database(settings)
    counter(source, 460860, 25)
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'
    age_baseline(settings)
    counter(source, 461460, 80)
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'


def test_session_events_are_retained_without_duplicates(tmp_path):
    import json
    source, settings = setup(tmp_path)
    with sqlite3.connect(source) as c:
        c.execute('CREATE TABLE AnalyticsEvents (Id TEXT, Type TEXT, Timestamp TEXT, Attributes TEXT, Metrics TEXT)')
        for kind, timestamp, progress, metrics in [
            ('OpenContent', '2026-09-01T12:00:00Z', 18, {}),
            ('LeaveContent', '2026-09-01T12:04:00Z', 20, {'SecondsRead': 240, 'PagesTurned': 40}),
        ]:
            c.execute('INSERT INTO AnalyticsEvents VALUES (?,?,?,?,?)',
                      (kind, kind, timestamp, json.dumps({'volumeid': 'book-reading', 'progress': progress}), json.dumps(metrics)))
    import_database(settings)
    import_database(settings)
    assert book(settings)['remaining_estimate_sessions'] == 1
    expected = book(settings)['remaining_seconds']
    with sqlite3.connect(source) as c:
        c.execute('DELETE FROM AnalyticsEvents')
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'sessions'
    assert book(settings)['remaining_seconds'] == expected


def test_progress_reset_without_telemetry_discards_observed_rate(tmp_path):
    source, settings = setup(tmp_path)
    counter(source, 600, 20)
    import_database(settings)
    age_baseline(settings)
    counter(source, 1200, 25)
    import_database(settings)
    with sqlite3.connect(source) as c:
        c.execute('DELETE FROM Event')
        c.execute("UPDATE content SET ___PercentRead=1 WHERE ContentID='book-reading'")
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'


def test_history_is_not_shared_with_another_source(tmp_path):
    source, settings = setup(tmp_path)
    counter(source, 600, 20)
    import_database(settings)
    age_baseline(settings)
    counter(source, 1200, 25)
    import_database(settings)
    other = tmp_path / 'other.sqlite'
    create_fixture_database(other)
    counter(other, 1500, 26)
    changed = Settings(source_db=other, data_dir=settings.data_dir)
    import_database(changed)
    assert book(changed)['remaining_estimate_source'] == 'kobo'


def test_failed_publication_keeps_history_atomic(tmp_path, monkeypatch):
    import pytest
    from backend.app import importer
    source, settings = setup(tmp_path)
    counter(source, 600, 20)
    import_database(settings)
    age_baseline(settings)
    counter(source, 1200, 25)
    original_replace = importer.os.replace

    def fail_snapshot(src, dst):
        if dst == settings.snapshot_db:
            raise OSError('publication failed')
        return original_replace(src, dst)

    monkeypatch.setattr(importer.os, 'replace', fail_snapshot)
    with pytest.raises(importer.ImportError):
        import_database(settings)
    monkeypatch.setattr(importer.os, 'replace', original_replace)
    import_database(settings)
    assert book(settings)['remaining_estimate_reading_seconds'] == 600
    assert book(settings)['remaining_estimate_sessions'] == 1


def test_archive_accepts_json_stored_as_blobs(tmp_path):
    source, settings = setup(tmp_path)
    with sqlite3.connect(source) as c:
        c.execute('CREATE TABLE AnalyticsEvents (Id TEXT, Type TEXT, Timestamp TEXT, Attributes BLOB, Metrics BLOB)')
        c.execute('INSERT INTO AnalyticsEvents VALUES (?,?,?,?,?)',
                  ('open', 'OpenContent', '2026-09-01T12:00:00Z',
                   b'{"volumeid":"book-reading","progress":18}', b'{}'))
        c.execute('INSERT INTO AnalyticsEvents VALUES (?,?,?,?,?)',
                  ('leave', 'LeaveContent', '2026-09-01T12:04:00Z',
                   b'{"volumeid":"book-reading","progress":20}', b'{"SecondsRead":240,"PagesTurned":40}'))
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'sessions'
    assert book(settings)['remaining_estimate_sessions'] == 1


def test_history_is_not_shared_with_another_account_at_same_path(tmp_path):
    source, settings = setup(tmp_path)
    with sqlite3.connect(source) as c:
        c.execute('CREATE TABLE user (UserID TEXT)')
        c.execute("INSERT INTO user VALUES ('first')")
    counter(source, 600, 20)
    import_database(settings)
    age_baseline(settings)
    counter(source, 1200, 25)
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'observations'
    with sqlite3.connect(source) as c:
        c.execute("UPDATE user SET UserID='second'")
    counter(source, 1500, 26)
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'


def test_rereading_does_not_reuse_archived_sessions_without_event_counter(tmp_path):
    import json
    source, settings = setup(tmp_path)
    with sqlite3.connect(source) as c:
        c.execute('DELETE FROM Event')
        c.execute('CREATE TABLE AnalyticsEvents (Id TEXT, Type TEXT, Timestamp TEXT, Attributes TEXT, Metrics TEXT)')
        for kind, timestamp, progress in [
            ('OpenContent', '2026-09-01T12:00:00Z', 18),
            ('LeaveContent', '2026-09-01T12:04:00Z', 20),
        ]:
            c.execute('INSERT INTO AnalyticsEvents VALUES (?,?,?,?,?)',
                      (kind, kind, timestamp, json.dumps({'volumeid': 'book-reading', 'progress': progress}),
                       json.dumps({'SecondsRead': 240, 'PagesTurned': 40})))
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'sessions'
    with sqlite3.connect(source) as c:
        c.execute('DELETE FROM AnalyticsEvents')
        c.execute("UPDATE content SET ___PercentRead=1 WHERE ContentID='book-reading'")
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'
    # A later first event counter establishes a baseline rather than subtracting NULL.
    counter(source, 100, 1)
    import_database(settings)
    assert book(settings)['remaining_estimate_source'] == 'kobo'
