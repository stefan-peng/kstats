from collections import defaultdict
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo


def _session_groups(timestamps: list[int], sessions: int) -> list[list[int]]:
    ordered = sorted(timestamps)
    if not ordered:
        return []

    split_count = min(max(sessions - 1, 0), len(ordered) - 1)
    gaps = [
        (ordered[index + 1] - ordered[index], index + 1)
        for index in range(len(ordered) - 1)
    ]
    split_at = {
        index
        for _, index in sorted(gaps, key=lambda item: (-item[0], item[1]))[
            :split_count
        ]
    }

    groups: list[list[int]] = []
    start = 0
    for index in sorted(split_at):
        groups.append(ordered[start:index])
        start = index
    groups.append(ordered[start:])
    return groups


def _add_interval_weights(
    weights: dict[str, float], start: int, end: int, timezone: ZoneInfo
) -> None:
    if end <= start:
        date = datetime.fromtimestamp(start, timezone).date().isoformat()
        weights[date] += 1
        return

    cursor = datetime.fromtimestamp(start, timezone)
    finish = datetime.fromtimestamp(end, timezone)
    while cursor.date() < finish.date():
        next_midnight = datetime.combine(
            cursor.date() + timedelta(days=1), time.min, tzinfo=timezone
        )
        weights[cursor.date().isoformat()] += next_midnight.timestamp() - cursor.timestamp()
        cursor = next_midnight
    weights[cursor.date().isoformat()] += finish.timestamp() - cursor.timestamp()


def _date_weights(
    timestamps: list[int], sessions: int, timezone: ZoneInfo
) -> dict[str, float]:
    weights: dict[str, float] = defaultdict(float)
    for group in _session_groups(timestamps, sessions):
        if len(group) == 1:
            date = datetime.fromtimestamp(group[0], timezone).date().isoformat()
            weights[date] += 1
            continue
        for start, end in zip(group, group[1:]):
            _add_interval_weights(weights, start, end, timezone)
    return dict(weights)


def _allocate_seconds(seconds: int, weights: dict[str, float]) -> dict[str, int]:
    total_weight = sum(weights.values())
    if seconds == 0 or total_weight <= 0:
        return {}

    exact = {
        date: seconds * weight / total_weight for date, weight in weights.items()
    }
    allocated = {date: int(value) for date, value in exact.items()}
    remainder = seconds - sum(allocated.values())
    ranked_dates = sorted(
        exact,
        key=lambda date: (-(exact[date] - allocated[date]), date),
    )
    for date in ranked_dates[:remainder]:
        allocated[date] += 1
    return {date: value for date, value in allocated.items() if value > 0}


def aggregate_reading_duration(
    events: list[dict[str, Any]], timezone: ZoneInfo, *, skipped_rows: int = 0
) -> dict[str, Any]:
    daily: dict[str, int] = defaultdict(int)
    source_seconds = 0
    unallocated_seconds = 0

    for event in events:
        seconds = event["seconds"]
        try:
            weights = _date_weights(
                event["timestamps"], event["sessions"], timezone
            )
        except (OverflowError, OSError, ValueError):
            skipped_rows += 1
            continue
        source_seconds += seconds
        allocation = _allocate_seconds(seconds, weights)
        if not allocation and seconds:
            unallocated_seconds += seconds
            continue
        for date, value in allocation.items():
            daily[date] += value

    series = [
        {"date": date, "seconds": daily[date]}
        for date in sorted(daily)
    ]
    return {
        "estimated": True,
        "coverage_start": series[0]["date"] if series else None,
        "coverage_end": series[-1]["date"] if series else None,
        "source_seconds": source_seconds,
        "allocated_seconds": sum(daily.values()),
        "unallocated_seconds": unallocated_seconds,
        "skipped_rows": skipped_rows,
        "daily": series,
    }
