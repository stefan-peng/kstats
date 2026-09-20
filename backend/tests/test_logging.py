import logging
import subprocess
import sys

from backend.app.logging_config import LOGGING_CONFIG, SkipSuccessfulStatusPolls
from backend.app import server


def test_logging_config_installs_rich_handlers():
    script = """
import logging
import logging.config
from rich.logging import RichHandler
from backend.app.logging_config import LOGGING_CONFIG

logging.config.dictConfig(LOGGING_CONFIG)
assert isinstance(logging.getLogger().handlers[0], RichHandler)
assert isinstance(logging.getLogger("uvicorn.access").handlers[0], RichHandler)
"""

    subprocess.run([sys.executable, "-c", script], check=True)


def test_access_filter_skips_only_successful_status_poll():
    access_filter = SkipSuccessfulStatusPolls()

    def record(method: str, path: str, status_code: int) -> logging.LogRecord:
        return logging.LogRecord(
            "uvicorn.access",
            logging.INFO,
            "",
            0,
            "%s - %s %s HTTP/%s %d",
            ("127.0.0.1:1234", method, path, "1.1", status_code),
            None,
        )

    assert not access_filter.filter(record("GET", "/api/device/status", 200))
    assert access_filter.filter(record("GET", "/api/device/status", 500))
    assert access_filter.filter(record("POST", "/api/import", 200))


def test_server_passes_rich_logging_config_to_uvicorn(monkeypatch):
    calls = []
    monkeypatch.setattr(
        server.uvicorn,
        "run",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    server.main(["--host", "0.0.0.0", "--port", "9000", "--reload"])

    assert calls == [
        (
            ("backend.app.main:app",),
            {
                "host": "0.0.0.0",
                "port": 9000,
                "reload": True,
                "log_config": LOGGING_CONFIG,
            },
        )
    ]
