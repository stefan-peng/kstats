"""Local, bounded daily usage counts; independent of device snapshots."""
from contextlib import closing, contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
import sqlite3
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

SECTIONS = ('overview', 'status', 'completions', 'duration', 'insights', 'resume',
            'continue', 'library', 'book', 'sessions', 'milestones', 'activity',
            'remaining', 'vocabulary', 'dictionary', 'notes', 'coverage', 'top')
ACTIONS = (
    'book.open.top', 'book.open.finish_soon', 'app.open', 'book.open.library', 'book.open.continue', 'book.open.resume',
    'library.jump', 'library.more_filters', 'library.clear', 'library.search',
    'notes.search', 'notes.color', 'notes.month', 'notes.clear',
    'notes.copy', 'notes.download', 'session.details', 'import.refresh', 'theme.toggle',
    'insights.author', 'insights.source', 'insights.format', 'insights.language',
    'duration.day', 'duration.week', 'duration.month', 'duration.heatmap',
) + tuple('library.' + key for key in (
    'status', 'availability', 'source', 'highlights', 'series', 'publisher',
    'language', 'page', 'sort', 'direction', 'month'))
EVENTS = frozenset(ACTIONS) | {f'seen.{section}' for section in SECTIONS}


class UsageEvent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str
    revision: Literal["baseline-v1"]

    @field_validator('name')
    @classmethod
    def known_event(cls, value: str) -> str:
        if value not in EVENTS:
            raise ValueError('Unknown usage event')
        return value


class UsageStore:
    def __init__(self, data_dir: Path):
        self.path = data_dir / 'usage.sqlite'

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=5)) as db, db:
            # Serialize initialization/migration with writes from other requests.
            db.execute('BEGIN IMMEDIATE')
            columns = {row[1] for row in db.execute('PRAGMA table_info(counts)')}
            legacy = bool(columns) and 'revision' not in columns
            if legacy:
                db.execute('ALTER TABLE counts RENAME TO counts_unversioned')
            db.execute('CREATE TABLE IF NOT EXISTS counts (day TEXT, revision TEXT, name TEXT, count INTEGER NOT NULL, PRIMARY KEY(day,revision,name))')
            if legacy:
                db.execute("INSERT INTO counts SELECT day, 'unversioned', name, count FROM counts_unversioned")
                db.execute('DROP TABLE counts_unversioned')
            cutoff = (datetime.now(UTC).date() - timedelta(days=179)).isoformat()
            db.execute('DELETE FROM counts WHERE day < ?', (cutoff,))
            yield db

    def record(self, name: str, revision: str):
        with self.connect() as db:
            db.execute('INSERT INTO counts VALUES (?,?,?,1) ON CONFLICT(day,revision,name) DO UPDATE SET count=count+1',
                           (datetime.now(UTC).date().isoformat(), revision, name))

    def report(self):
        with self.connect() as db:
            rows = [dict(day=day, revision=revision, name=name, count=count) for day, revision, name, count in
                    db.execute('SELECT day,revision,name,count FROM counts ORDER BY day,revision,name')]
            return {'version': 1, 'retention_days': 180, 'days': rows}
