"""Explicit milestone timestamps and saved vocabulary, without inferred history."""
import sqlite3
from datetime import UTC, datetime
from typing import Any

from .kobo_events import EventDecodeError, decode_event_payload

MILESTONE_PROGRESS = {1012: 25, 1013: 50, 1014: 75}


def recorded_timestamps(payload: dict[str, Any]) -> list[str]:
    values = payload.get('eventTimestamps')
    if not isinstance(values, list):
        return []
    result = set()
    for value in values:
        if type(value) is not int or value < 0:
            continue
        try:
            result.add(datetime.fromtimestamp(value, UTC).isoformat())
        except (ValueError, OSError, OverflowError):
            continue
    return sorted(result)


def progress_milestones(connection: sqlite3.Connection, content_id: str) -> list[dict[str, Any]]:
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Event'").fetchone():
        return []
    milestones = set()
    for event_type, blob in connection.execute(
        'SELECT EventType, CAST(ExtraData AS BLOB) FROM Event WHERE ContentID=? AND EventType IN (1012,1013,1014)',
        (content_id,),
    ):
        try:
            payload = decode_event_payload(blob)
        except EventDecodeError:
            continue
        for timestamp in recorded_timestamps(payload):
            milestones.add((timestamp, MILESTONE_PROGRESS[event_type]))
    return [{'recorded_at': timestamp, 'percent': progress} for timestamp, progress in sorted(milestones)]


def saved_words(connection: sqlite3.Connection, content_id: str) -> list[dict[str, Any]]:
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='WordList'").fetchone():
        return []
    words = []
    for text, dictionary, created_at in connection.execute(
        'SELECT Text, DictSuffix, DateCreated FROM WordList WHERE VolumeId=? ORDER BY TRIM(Text) COLLATE NOCASE',
        (content_id,),
    ):
        if not isinstance(text, str) or not text.strip():
            continue
        try:
            timestamp = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            saved_at = timestamp.isoformat() if timestamp.tzinfo is not None else None
        except (TypeError, ValueError, AttributeError):
            saved_at = None
        words.append({
            'word': text.strip(),
            'dictionary': dictionary.strip() if isinstance(dictionary, str) and dictionary.strip() else None,
            'saved_at': saved_at,
        })
    return words
