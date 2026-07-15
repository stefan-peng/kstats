from pathlib import Path

import pytest

from backend.app import cli
from backend.app.cli import ServerConfig, _load_config


def test_load_config_reads_server_settings(tmp_path: Path):
    path = tmp_path / "kstats.toml"
    path.write_text(
        '[server]\nhost = "0.0.0.0"\nbackend_port = 9000\nfrontend_port = 4173\n'
    )
    assert _load_config(path) == ServerConfig(
        host="0.0.0.0",
        backend_port=9000,
        frontend_port=4173,
    )
    assert _load_config(path).api_url == "http://127.0.0.1:9000"


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("0.0.0.0", "http://127.0.0.1:8000"),
        ("::", "http://[::1]:8000"),
        ("::1", "http://[::1]:8000"),
    ],
)
def test_api_url_is_connectable_from_the_vite_proxy(host: str, expected: str):
    assert ServerConfig(host=host).api_url == expected


@pytest.mark.parametrize(
    "contents, message",
    [
        ('[server]\nhost = ""\n', "server.host must be a valid hostname"),
        (
            '[server]\nhost = "http://localhost"\n',
            "server.host must be a valid hostname",
        ),
        ("[server]\nbackend_port = 0\n", "server.backend_port must be between"),
        (
            "[server]\nbackend_port = 8000\nfrontend_port = 8000\n",
            "backend and frontend ports must differ",
        ),
    ],
)
def test_load_config_rejects_invalid_settings(
    tmp_path: Path, contents: str, message: str
):
    path = tmp_path / "kstats.toml"
    path.write_text(contents)

    with pytest.raises(SystemExit, match=message):
        _load_config(path)


def test_stop_all_signals_every_process_before_waiting(monkeypatch):
    events: list[tuple[str, int]] = []

    class FakeProcess:
        def __init__(self, process_id: int):
            self.process_id = process_id

    monkeypatch.setattr(
        cli,
        "_request_stop",
        lambda process: events.append(("signal", process.process_id)),
    )
    monkeypatch.setattr(
        cli,
        "_finish_stop",
        lambda process: events.append(("wait", process.process_id)),
    )
    cli._stop_all([FakeProcess(1), FakeProcess(2)])

    assert events == [
        ("signal", 1),
        ("signal", 2),
        ("wait", 1),
        ("wait", 2),
    ]
