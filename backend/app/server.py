from __future__ import annotations

import argparse
from collections.abc import Sequence

import uvicorn

from .logging_config import LOGGING_CONFIG


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Serve Kobo Stats")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    arguments = _parser().parse_args(argv)
    uvicorn.run(
        "backend.app.main:app",
        host=arguments.host,
        port=arguments.port,
        reload=arguments.reload,
        log_config=LOGGING_CONFIG,
    )


if __name__ == "__main__":
    main()
