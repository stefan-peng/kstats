import sqlite3

from backend.app.book_insights import progress_milestones, recorded_timestamps, saved_words
from backend.tests.conftest import event_payload


def test_timestamp_validation_and_deduplication():
    assert recorded_timestamps({'eventTimestamps': [0, 0, 1, True, -1, '2', 10**30]}) == [
        '1970-01-01T00:00:00+00:00', '1970-01-01T00:00:01+00:00',
    ]
    assert recorded_timestamps({'eventTimestamps': 'not-a-list'}) == []


def test_milestones_preserve_repeated_crossings_but_not_duplicate_rows():
    with sqlite3.connect(':memory:') as connection:
        connection.execute('CREATE TABLE Event (EventType INTEGER, ContentID TEXT, ExtraData BLOB)')
        connection.executemany('INSERT INTO Event VALUES (?,?,?)', [
            (1013, 'book', event_payload({'eventTimestamps': [2]})),
            (1012, 'book', event_payload({'eventTimestamps': [1, 3, 3, True, -1]})),
            (1012, 'book', event_payload({'eventTimestamps': [1]})),
            (1014, 'other', event_payload({'eventTimestamps': [4]})),
            (1020, 'book', event_payload({'eventTimestamps': [4]})),
            (1014, 'book', b'bad'),
        ])
        assert progress_milestones(connection, 'book') == [
            {'percent': 25, 'recorded_at': '1970-01-01T00:00:01+00:00'},
            {'percent': 50, 'recorded_at': '1970-01-01T00:00:02+00:00'},
            {'percent': 25, 'recorded_at': '1970-01-01T00:00:03+00:00'},
        ]


def test_saved_words_are_book_scoped_and_missing_dates_remain_unknown():
    with sqlite3.connect(':memory:') as connection:
        connection.execute('CREATE TABLE WordList (Text TEXT, DictSuffix TEXT, DateCreated TEXT, VolumeId TEXT)')
        connection.executemany('INSERT INTO WordList VALUES (?,?,?,?)', [
            (' Word ', '-en', '2026-10-01T12:00:00Z', 'book'),
            ('Other', None, 'not-a-date', 'book'),
            ('   ', '-en', None, 'book'),
            ('Outside', '-en', '2026-10-01T12:00:00Z', 'other'),
        ])
        assert saved_words(connection, 'book') == [
            {'word': 'Other', 'dictionary': None, 'saved_at': None},
            {'word': 'Word', 'dictionary': '-en', 'saved_at': '2026-10-01T12:00:00+00:00'},
        ]


def test_optional_source_tables_are_empty_when_absent():
    with sqlite3.connect(':memory:') as connection:
        assert progress_milestones(connection, 'book') == []
        assert saved_words(connection, 'book') == []
