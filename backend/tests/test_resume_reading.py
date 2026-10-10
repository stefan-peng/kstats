from zoneinfo import ZoneInfo

from backend.app.resume_reading import resume_reading


def book(**changes):
    return {'content_id': 'book', 'title': 'Book', 'read_status': 1,
            'date_last_read': '2026-10-09T23:30:00Z', **changes}


def test_calendar_days_use_snapshot_date_and_requested_timezone():
    snapshot = '2026-10-10T01:00:00Z'
    assert resume_reading([book()], snapshot, ZoneInfo('UTC'))['books'][0]['days_since_read'] == 1
    assert resume_reading([book()], snapshot, ZoneInfo('America/New_York'))['books'][0]['days_since_read'] == 0


def test_invalid_naive_future_and_missing_dates_are_unknown():
    books = [book(content_id=str(i), date_last_read=date) for i, date in enumerate([
        '2026-10-11T00:00:00Z', 'invalid', '2026-10-09T00:00:00', None,
    ])]
    assert all(b['days_since_read'] is None for b in resume_reading(books, '2026-10-10T00:00:00Z', ZoneInfo('UTC'))['books'])
    assert resume_reading([book()], None, ZoneInfo('UTC'))['books'][0]['days_since_read'] is None


def test_only_in_progress_sorted_oldest_first_unknown_last():
    result = resume_reading([
        book(content_id='recent'),
        book(content_id='unknown', date_last_read=None),
        book(content_id='old', date_last_read='2026-08-01T00:00:00Z'),
        book(read_status=2), book(read_status=0),
    ], '2026-10-10T12:00:00Z', ZoneInfo('UTC'))
    assert [b['content_id'] for b in result['books']] == ['old', 'recent', 'unknown']
    assert result['books'][0]['days_since_read'] == 70
