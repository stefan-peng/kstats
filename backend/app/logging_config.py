from __future__ import annotations

from typing import Any


class SkipSuccessfulStatusPolls:
    """Keep the frontend heartbeat from dominating Uvicorn's access log."""

    def filter(self, record: Any) -> bool:
        arguments = record.args
        if not isinstance(arguments, tuple) or len(arguments) < 5:
            return True
        _, method, path, _, status_code = arguments[:5]
        return not (
            method == "GET"
            and str(path).partition("?")[0] == "/api/device/status"
            and isinstance(status_code, int)
            and status_code < 400
        )


# Uvicorn applies this dictionary before importing the application, so startup,
# access, and application records all share the same terminal presentation.
LOGGING_CONFIG: dict[str, Any] = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "rich": {
            "format": "%(message)s",
            "datefmt": "[%X]",
        },
    },
    "filters": {
        "skip_successful_status_polls": {
            "()": "backend.app.logging_config.SkipSuccessfulStatusPolls",
        },
    },
    "handlers": {
        "rich": {
            "class": "rich.logging.RichHandler",
            "formatter": "rich",
            "level": "INFO",
            "markup": False,
            "omit_repeated_times": False,
            "rich_tracebacks": True,
            "show_path": False,
        },
        "rich_access": {
            "class": "rich.logging.RichHandler",
            "filters": ["skip_successful_status_polls"],
            "formatter": "rich",
            "level": "INFO",
            "markup": False,
            "omit_repeated_times": False,
            "rich_tracebacks": True,
            "show_path": False,
        },
    },
    "loggers": {
        "uvicorn": {
            "handlers": ["rich"],
            "level": "INFO",
            "propagate": False,
        },
        "uvicorn.access": {
            "handlers": ["rich_access"],
            "level": "INFO",
            "propagate": False,
        },
    },
    "root": {
        "handlers": ["rich"],
        "level": "INFO",
    },
}
