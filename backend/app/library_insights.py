"""Library-only summaries; never combine cumulative totals with session telemetry."""
from datetime import datetime
from typing import Any

FORMAT_LABELS = {
    "application/x-kobo-epub+zip": "Kobo EPUB",
    "application/epub+zip": "EPUB",
    "application/pdf": "PDF",
}


def library_insights(books: list[dict[str, Any]]) -> dict[str, Any]:
    quality = {
        "dated_finished": 0,
        "undated_finished": 0,
        "active_without_recorded_time": 0,
        "event_time_books": 0,
        "books_with_word_count": 0,
    }
    groups: dict[str, dict[str, dict[str, Any]]] = {
        key: {} for key in ("author", "source", "format", "language")
    }
    for book in books:
        if book["read_status"] == 2:
            try:
                datetime.fromisoformat(book["finished_at"].replace("Z", "+00:00"))
                quality["dated_finished"] += 1
            except (TypeError, ValueError, AttributeError):
                quality["undated_finished"] += 1
        quality["active_without_recorded_time"] += int(
            book["read_status"] in (1, 2) and book["reading_seconds"] == 0
        )
        quality["event_time_books"] += int(book["reading_time_source"] == "events")
        quality["books_with_word_count"] += int(book["word_count"] is not None)
        labels = {
            "author": book["author"],
            "source": {"kobo_store": "Kobo store", "sideloaded": "Sideloaded"}.get(
                book["source_type"], "Other"
            ),
            "format": FORMAT_LABELS.get(book["mime_type"], "Other"),
            "language": ((book["language"] or "").strip().lower().replace("_", "-").split("-")[0] or "Unknown"),
        }
        status = {0: "unread", 1: "reading", 2: "finished"}.get(book["read_status"], "unread")
        for dimension, label in labels.items():
            row = groups[dimension].setdefault(label, {
                "label": label, "books": 0, "seconds": 0,
                "unread_seconds": 0, "reading_seconds": 0, "finished_seconds": 0,
            })
            row["books"] += 1
            row["seconds"] += book["reading_seconds"]
            row[f"{status}_seconds"] += book["reading_seconds"]
    return {
        "quality": quality,
        "composition": {
            dimension: sorted(rows.values(), key=lambda row: (-row["seconds"], row["label"]))
            for dimension, rows in groups.items()
        },
    }
