from zoneinfo import ZoneInfo

from backend.app.reading_duration import aggregate_reading_duration


def test_allocates_across_local_dates_and_preserves_source_total():
    result = aggregate_reading_duration(
        [
            {
                "seconds": 1800,
                "sessions": 1,
                "timestamps": [1781653500, 1781655300],
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
                "timestamps": [1781653500, 1781655300],
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
    assert result["source_seconds"] == 42
    assert result["unallocated_seconds"] == 42
    assert result["skipped_rows"] == 1


def test_stale_session_count_does_not_spread_seconds_over_a_month():
    # Count Zero's live payload: two interactions in August, then a September
    # interaction without a corresponding update to the one-session counter.
    result = aggregate_reading_duration(
        [{"seconds": 9, "sessions": 1,
          "timestamps": [1787624886, 1787624888, 1790479202]}],
        ZoneInfo("America/New_York"),
    )
    assert result["daily"] == []
    assert result["source_seconds"] == result["unallocated_seconds"] == 9
    assert result["allocated_seconds"] == 0


def test_large_duration_does_not_bridge_idle_days():
    result = aggregate_reading_duration(
        [{"seconds": 300_000, "sessions": 1,
          "timestamps": [0, 600, 259_200, 259_800]}],
        ZoneInfo("UTC"),
    )
    assert result["daily"] == []
    assert result["unallocated_seconds"] == 300_000


def test_duplicate_interactions_do_not_change_daily_weights():
    event = {"seconds": 600, "sessions": 2, "timestamps": [0, 100, 86400]}
    expected = aggregate_reading_duration([event], ZoneInfo("UTC"))
    event["timestamps"] = [0, 100, 86400, 86400]
    assert aggregate_reading_duration([event], ZoneInfo("UTC")) == expected


def test_plausible_midnight_interval_preserves_proportions():
    result = aggregate_reading_duration(
        [{"seconds": 1200, "sessions": 1, "timestamps": [86100, 87300]}],
        ZoneInfo("UTC"),
    )
    assert result["daily"] == [
        {"date": "1970-01-01", "seconds": 300},
        {"date": "1970-01-02", "seconds": 900},
    ]
