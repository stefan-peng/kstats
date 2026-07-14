from zoneinfo import ZoneInfo

from backend.app.reading_duration import aggregate_reading_duration


def test_allocates_across_local_dates_and_preserves_source_total():
    result = aggregate_reading_duration(
        [
            {
                "seconds": 1800,
                "sessions": 1,
                "timestamps": [1781652600, 1781656200],
            }
        ],
        ZoneInfo("UTC"),
    )

    assert result["daily"] == [
        {"date": "2026-06-16", "seconds": 900},
        {"date": "2026-06-17", "seconds": 900},
    ]
    assert result["source_seconds"] == 1800
    assert result["allocated_seconds"] == 1800
    assert result["unallocated_seconds"] == 0


def test_uses_requested_timezone_for_calendar_boundaries():
    result = aggregate_reading_duration(
        [
            {
                "seconds": 1800,
                "sessions": 1,
                "timestamps": [1781652600, 1781656200],
            }
        ],
        ZoneInfo("America/New_York"),
    )

    assert result["daily"] == [{"date": "2026-06-16", "seconds": 1800}]


def test_splits_at_largest_session_gap_before_allocating_duration():
    result = aggregate_reading_duration(
        [
            {
                "seconds": 600,
                "sessions": 2,
                "timestamps": [0, 100, 86_400, 86_500],
            }
        ],
        ZoneInfo("UTC"),
    )

    assert result["daily"] == [
        {"date": "1970-01-01", "seconds": 300},
        {"date": "1970-01-02", "seconds": 300},
    ]


def test_reports_duration_that_cannot_be_allocated():
    result = aggregate_reading_duration(
        [{"seconds": 42, "sessions": 1, "timestamps": []}],
        ZoneInfo("UTC"),
        skipped_rows=2,
    )

    assert result["daily"] == []
    assert result["source_seconds"] == 42
    assert result["allocated_seconds"] == 0
    assert result["unallocated_seconds"] == 42
    assert result["skipped_rows"] == 2


def test_skips_timestamp_outside_datetime_range():
    result = aggregate_reading_duration(
        [{"seconds": 42, "sessions": 1, "timestamps": [2**63]}],
        ZoneInfo("UTC"),
    )

    assert result["daily"] == []
    assert result["source_seconds"] == 0
    assert result["skipped_rows"] == 1
