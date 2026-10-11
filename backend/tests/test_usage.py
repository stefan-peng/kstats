from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
import sqlite3

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.usage import UsageStore


def test_api_counts_persist_separately_and_reject_arbitrary_data(tmp_path):
    settings = Settings(data_dir=tmp_path)
    client = TestClient(create_app(settings))  # No lifespan/device importer needed.
    payload = {'name': 'book.open.library', 'revision': 'baseline-v1'}
    for _ in range(2):
        assert client.post('/api/usage', json=payload).status_code == 204
    assert client.post('/api/usage', json={**payload, 'title': 'Private title'}).status_code == 422
    assert client.post('/api/usage', json={**payload, 'name': 'Private title'}).status_code == 422
    assert client.post('/api/usage', json={**payload, 'revision': 'unknown'}).status_code == 422
    # Snapshot replacement cannot overwrite this store.
    settings.snapshot_db.write_bytes(b'replacement snapshot')
    report = TestClient(create_app(settings)).get('/api/usage').json()
    assert report['version'] == 1
    assert report['days'] == [{'day': datetime.now(UTC).date().isoformat(),
                              'revision': 'baseline-v1', 'name': 'book.open.library', 'count': 2}]


def test_retention_and_concurrent_increments(tmp_path):
    store = UsageStore(tmp_path)
    store.record('app.open', 'baseline-v1')
    old_day = (datetime.now(UTC).date() - timedelta(days=180)).isoformat()
    with sqlite3.connect(store.path) as db:
        db.execute('INSERT INTO counts VALUES (?, ?, ?, ?)', (old_day, 'baseline-v1', 'app.open', 99))
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(lambda _: store.record('app.open', 'baseline-v1'), range(20)))
    assert len(store.report()['days']) == 1
    assert store.report()['days'][0]['count'] == 21


def test_migrates_initial_unversioned_counts_without_merging_revisions(tmp_path):
    store = UsageStore(tmp_path)
    day = datetime.now(UTC).date().isoformat()
    with sqlite3.connect(store.path) as db:
        db.execute('CREATE TABLE counts (day TEXT, name TEXT, count INTEGER NOT NULL, PRIMARY KEY(day,name))')
        db.execute('INSERT INTO counts VALUES (?, ?, ?)', (day, 'app.open', 5))
    store.record('app.open', 'baseline-v1')
    report = store.report()
    assert report['days'] == [
        {'day': day, 'revision': 'baseline-v1', 'name': 'app.open', 'count': 1},
        {'day': day, 'revision': 'unversioned', 'name': 'app.open', 'count': 5},
    ]
    assert UsageStore(tmp_path).report() == report
