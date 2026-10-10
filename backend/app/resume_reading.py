"""Calendar-day inactivity relative to the snapshot, not the wall clock."""
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo


def aware_timestamp(value: str | None) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except (AttributeError, TypeError, ValueError):
        return None


def resume_reading(books: list[dict[str, Any]], imported_at: str | None, timezone: ZoneInfo) -> dict[str, Any]:
    snapshot = aware_timestamp(imported_at)
    result = []
    for book in books:
        if book["read_status"] != 1:
            continue
        last_read = aware_timestamp(book["date_last_read"])
        days = None
        if snapshot and last_read and last_read <= snapshot:
            days = (snapshot.astimezone(timezone).date() - last_read.astimezone(timezone).date()).days
        result.append({**book, "days_since_read": days})
    result.sort(key=lambda book: (
        book["days_since_read"] is None, -(book["days_since_read"] or 0), book["title"]
    ))
    return {"as_of": snapshot.isoformat() if snapshot else None, "books": result}
