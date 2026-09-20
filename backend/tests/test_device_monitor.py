import logging
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend.app import device_monitor, importer
from backend.app.device_monitor import DeviceMonitor
from backend.app.importer import ImportError, import_database
from backend.app.main import create_app


def snapshot_title(settings):
    with closing(sqlite3.connect(settings.snapshot_db)) as connection:
        return connection.execute(
            "SELECT title FROM kstats_books WHERE content_id = 'book-reading'"
        ).fetchone()[0]


def test_startup_refreshes_existing_snapshot(settings):
    import_database(settings)
    with sqlite3.connect(settings.source_db) as connection:
        connection.execute("UPDATE content SET Title = 'New title' WHERE ContentID = 'book-reading'")

    with TestClient(create_app(settings)) as client:
        deadline = time.monotonic() + 5
        while snapshot_title(settings) != "New title" and time.monotonic() < deadline:
            time.sleep(0.01)
        assert snapshot_title(settings) == "New title"
        assert client.get("/api/device/status").json()["import_error"] is None


def test_startup_failure_preserves_existing_snapshot(settings):
    import_database(settings)
    settings.source_db.write_bytes(b"bad database")

    with TestClient(create_app(settings)) as client:
        assert client.get("/api/dashboard").status_code == 200
        assert snapshot_title(settings) == "Current Book"
        deadline = time.monotonic() + 5
        while not client.get("/api/device/status").json()["import_error"] and time.monotonic() < deadline:
            time.sleep(0.01)
        assert client.get("/api/device/status").json()["import_error"]


def test_monitor_imports_once_per_connection_and_after_manual_refresh(settings, monkeypatch):
    spy = Mock(wraps=import_database)
    monkeypatch.setattr(device_monitor, "import_database", spy)
    monitor = DeviceMonitor(settings)
    monitor.poll()
    monitor.poll()
    assert spy.call_count == 1

    unplugged = settings.source_db.with_suffix(".unplugged")
    settings.source_db.rename(unplugged)
    monitor.poll()
    assert not monitor.status()["connected"]
    unplugged.rename(settings.source_db)
    monitor.poll()
    assert spy.call_count == 2

    monitor.import_now()
    monitor.poll()
    assert spy.call_count == 3


def test_monitor_logs_connection_import_and_disconnection(settings, caplog):
    caplog.set_level(logging.INFO, logger=device_monitor.__name__)
    monitor = DeviceMonitor(settings)

    monitor.poll()
    unplugged = settings.source_db.with_suffix(".unplugged")
    settings.source_db.rename(unplugged)
    monitor.poll()

    assert "Kobo connected:" in caplog.text
    assert "Imported Kobo snapshot from" in caplog.text
    assert "Kobo disconnected:" in caplog.text


def test_monitor_retries_transient_failure_without_a_file_change(settings, monkeypatch, caplog):
    spy = Mock(side_effect=[ImportError("not ready"), ImportError("not ready"), {"snapshot_available": True}])
    monkeypatch.setattr(device_monitor, "import_database", spy)
    monitor = DeviceMonitor(settings)
    monitor.poll()
    monitor.poll()
    assert monitor.import_error == "not ready"
    assert caplog.text.count("Automatic Kobo import failed") == 1
    monitor.poll()
    assert spy.call_count == 3
    assert monitor.import_error is None


def test_monitor_picks_up_wal_only_changes(settings):
    with closing(sqlite3.connect(settings.source_db)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA wal_autocheckpoint=0")
        monitor = DeviceMonitor(settings)
        monitor.poll()
        before = settings.source_db.stat().st_mtime_ns
        connection.execute("UPDATE content SET Title = 'WAL title' WHERE ContentID = 'book-reading'")
        connection.commit()
        assert settings.source_db.stat().st_mtime_ns == before
        monitor.poll()
        assert snapshot_title(settings) == "WAL title"
    with closing(sqlite3.connect(settings.snapshot_db)) as snapshot:
        assert snapshot.execute("PRAGMA journal_mode").fetchone() == ("delete",)


def test_monitor_retries_a_failed_manual_import_of_unchanged_source(settings, monkeypatch):
    monitor = DeviceMonitor(settings)
    monitor.poll()
    spy = Mock(side_effect=[ImportError("temporarily unavailable"), {"snapshot_available": True}])
    monkeypatch.setattr(device_monitor, "import_database", spy)
    with pytest.raises(ImportError, match="temporarily unavailable"):
        monitor.import_now()
    monitor.poll()
    assert spy.call_count == 2
    assert monitor.import_error is None


def test_monitor_serializes_manual_and_automatic_imports(settings, monkeypatch):
    started = threading.Event()
    release = threading.Event()
    calls = []

    def slow_import(settings):
        calls.append(1)
        started.set()
        assert release.wait(5)
        return import_database(settings)

    monkeypatch.setattr(device_monitor, "import_database", slow_import)
    monitor = DeviceMonitor(settings)
    with ThreadPoolExecutor(max_workers=2) as executor:
        manual = executor.submit(monitor.import_now)
        assert started.wait(5)
        automatic = executor.submit(monitor.poll)
        release.set()
        manual.result(timeout=5)
        automatic.result(timeout=5)
    assert len(calls) == 1


def test_hotplug_import_runs_without_browser_requests_and_stops_on_shutdown(settings, monkeypatch):
    monkeypatch.setattr("backend.app.main.POLL_INTERVAL_SECONDS", 0.01)
    imported = threading.Event()
    original = device_monitor.import_database
    spy = Mock(wraps=DeviceMonitor.poll)

    def record_poll(self):
        return spy(self)

    def record_import(settings):
        result = original(settings)
        imported.set()
        return result

    monkeypatch.setattr(DeviceMonitor, "poll", record_poll)
    monkeypatch.setattr(device_monitor, "import_database", record_import)
    unplugged = settings.source_db.with_suffix(".unplugged")
    settings.source_db.rename(unplugged)
    with TestClient(create_app(settings)):
        assert not settings.snapshot_db.exists()
        unplugged.rename(settings.source_db)
        assert imported.wait(5)
        assert snapshot_title(settings) == "Current Book"
    count = spy.call_count
    assert not threading.Event().wait(0.05)
    assert spy.call_count == count


def test_empty_sqlite_source_cannot_replace_good_snapshot(settings):
    import_database(settings)
    original = settings.snapshot_db.read_bytes()
    settings.source_db.write_bytes(b"")
    with pytest.raises(ImportError, match="missing content table"):
        import_database(settings)
    assert settings.snapshot_db.read_bytes() == original


def test_cover_cache_failure_does_not_fail_published_import(settings, monkeypatch):
    def fail_covers(*args):
        raise PermissionError("cover cache is read-only")

    monkeypatch.setattr(importer, "_copy_covers", fail_covers)
    result = import_database(settings)
    assert result["snapshot_available"]
    assert result["imported_at"]
    assert snapshot_title(settings) == "Current Book"


def test_metadata_failure_keeps_previous_snapshot_and_version(settings, monkeypatch):
    before_status = import_database(settings)
    before = settings.snapshot_db.read_bytes()

    def fail_metadata(*args):
        raise sqlite3.OperationalError("disk is full")

    monkeypatch.setattr(importer, "_write_metadata", fail_metadata)
    with pytest.raises(ImportError, match="disk is full"):
        import_database(settings)
    assert settings.snapshot_db.read_bytes() == before
    assert importer.device_status(settings) == before_status


def test_failed_publication_does_not_prune_previous_covers(settings, monkeypatch):
    with sqlite3.connect(settings.source_db) as connection:
        connection.execute("UPDATE content SET ImageId = 'old-cover' WHERE ContentID = 'book-reading'")
    import_database(settings)
    before = settings.snapshot_db.read_bytes()
    settings.covers_dir.mkdir(exist_ok=True)
    cover = settings.covers_dir / "old-cover-grid.jpg"
    cover.write_bytes(b"\xff\xd8\xffcached")
    with sqlite3.connect(settings.source_db) as connection:
        connection.execute("DELETE FROM content WHERE ContentID = 'book-reading'")

    replace = importer.os.replace

    def fail_publication(source, destination):
        if destination == settings.snapshot_db:
            raise PermissionError("snapshot is busy")
        return replace(source, destination)

    monkeypatch.setattr(importer.os, "replace", fail_publication)
    with pytest.raises(ImportError, match="snapshot is busy"):
        import_database(settings)
    assert settings.snapshot_db.read_bytes() == before
    assert cover.read_bytes() == b"\xff\xd8\xffcached"


def test_cover_cleanup_failure_does_not_fail_published_import(settings, monkeypatch):
    def fail_cleanup(*args):
        raise PermissionError("cover is busy")

    monkeypatch.setattr(importer, "_prune_covers", fail_cleanup)
    assert import_database(settings)["snapshot_available"]


def test_offline_migration_publishes_a_single_file_snapshot(settings):
    from backend.app.source_processing import DERIVED_SCHEMA_VERSION

    import_database(settings)
    with closing(sqlite3.connect(settings.snapshot_db)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            "UPDATE kstats_meta SET value = ? WHERE key = 'schema_version'",
            [DERIVED_SCHEMA_VERSION - 1],
        )
        connection.commit()
    settings.source_db.unlink()
    importer.prepare_snapshot(settings)
    with closing(sqlite3.connect(settings.snapshot_db)) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone() == ("delete",)
    assert snapshot_title(settings) == "Current Book"


def test_new_snapshot_metadata_is_not_dependent_on_legacy_json(settings):
    imported = import_database(settings)
    settings.import_metadata.write_text("{not json", encoding="utf-8")
    assert importer.device_status(settings) == imported


def test_relative_source_path_is_supported(settings, monkeypatch):
    from dataclasses import replace

    monkeypatch.chdir(settings.source_db.parent)
    relative = replace(settings, source_db=settings.source_db.relative_to(settings.source_db.parent))
    assert import_database(relative)["snapshot_available"]


def test_busy_backup_has_a_deadline(settings, monkeypatch):
    import_database(settings)
    before = settings.snapshot_db.read_bytes()
    monkeypatch.setattr(importer, "BACKUP_TIMEOUT_SECONDS", 0)
    with closing(sqlite3.connect(settings.source_db)) as connection:
        connection.execute("BEGIN EXCLUSIVE")
        with pytest.raises(ImportError, match="Timed out copying"):
            import_database(settings)
    assert settings.snapshot_db.read_bytes() == before


def test_unknown_api_endpoint_is_not_served_as_html(client):
    response = client.get("/api/not-an-endpoint")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"


def test_startup_serves_saved_snapshot_during_slow_import(settings, monkeypatch):
    import_database(settings)
    with sqlite3.connect(settings.source_db) as connection:
        connection.execute("UPDATE content SET Title = 'Updated book' WHERE ContentID = 'book-reading'")
    entered = threading.Event()
    release = threading.Event()
    original = device_monitor.import_database

    def slow_import(settings):
        entered.set()
        assert release.wait(5)
        return original(settings)

    monkeypatch.setattr(device_monitor, 'import_database', slow_import)
    try:
        with TestClient(create_app(settings)) as client:
            assert entered.wait(2)
            try:
                assert client.get('/api/dashboard').status_code == 200
                assert snapshot_title(settings) == 'Current Book'
                assert client.get('/api/device/status').json()['importing'] is True
            finally:
                release.set()
            deadline = time.monotonic() + 3
            while client.get('/api/device/status').json()['importing'] and time.monotonic() < deadline:
                time.sleep(0.01)
            assert snapshot_title(settings) == 'Updated book'
            assert client.get('/api/device/status').json()['import_error'] is None
    finally:
        release.set()


def test_import_error_clears_on_disconnect_and_success(settings, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger=device_monitor.__name__)
    monitor = DeviceMonitor(settings)
    original = device_monitor.import_database
    monkeypatch.setattr(device_monitor, 'import_database', Mock(side_effect=ImportError('copy failed')))
    with pytest.raises(ImportError):
        monitor.import_now()
    assert 'Manual Kobo import failed: copy failed' in caplog.text
    assert monitor.status()['importing'] is False
    unplugged = settings.source_db.with_suffix('.unplugged')
    settings.source_db.rename(unplugged)
    monitor.poll()
    assert monitor.status()['import_error'] is None
    assert 'Cleared Kobo import error' in caplog.text
    unplugged.rename(settings.source_db)
    monkeypatch.setattr(device_monitor, 'import_database', original)
    monitor.poll()
    assert monitor.status()['import_error'] is None
    assert 'Imported Kobo snapshot' in caplog.text
