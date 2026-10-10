from backend.app.library_insights import library_insights


def book(**changes):
    return {
        'author': 'Author', 'source_type': 'kobo_store',
        'mime_type': 'application/epub+zip', 'language': 'en',
        'read_status': 1, 'reading_seconds': 120, 'reading_time_source': 'kobo',
        'word_count': None, 'finished_at': None, **changes,
    }


def test_composition_preserves_totals_and_normalizes_language_variants():
    result = library_insights([
        book(language='en-US'), book(language='en_GB', read_status=2),
        book(language='fr', read_status=0, reading_seconds=0),
        book(language=None, source_type='sideloaded', reading_seconds=60),
    ])
    for rows in result['composition'].values():
        assert sum(row['books'] for row in rows) == 4
        assert sum(row['seconds'] for row in rows) == 300
        assert all(row['seconds'] == sum(row[f'{s}_seconds'] for s in ('unread', 'reading', 'finished')) for row in rows)
    english = next(row for row in result['composition']['language'] if row['label'] == 'en')
    assert english['books'] == 2
    assert english['seconds'] == 240
    assert english['reading_seconds'] == english['finished_seconds'] == 120


def test_quality_distinguishes_missing_dates_and_missing_time_from_unread():
    result = library_insights([
        book(read_status=2, finished_at='2026-10-10T12:00:00Z', word_count=100),
        book(read_status=2, finished_at='2026-02-30', reading_seconds=0),
        book(read_status=2), book(reading_seconds=0, reading_time_source='events'),
        book(read_status=0, reading_seconds=0),
    ])
    assert result['quality'] == {
        'dated_finished': 1, 'undated_finished': 2,
        'active_without_recorded_time': 2, 'event_time_books': 1,
        'books_with_word_count': 1,
    }


def test_empty_library():
    result = library_insights([])
    assert all(value == 0 for value in result['quality'].values())
    assert all(rows == [] for rows in result['composition'].values())
