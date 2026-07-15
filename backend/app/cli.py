from __future__ import annotations

import os
import signal
import shutil
import subprocess
import sys
import time
import tomllib
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).parents[2]
CONFIG_PATH = PROJECT_ROOT / "kstats.toml"


def _raise_keyboard_interrupt(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def _configure_break_signal() -> None:
    if sys.platform == "win32":
        signal.signal(signal.SIGBREAK, _raise_keyboard_interrupt)


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    backend_port: int = 8000
    frontend_port: int = 5173

    @property
    def api_url(self) -> str:
        proxy_host = {"0.0.0.0": "127.0.0.1", "::": "::1"}.get(
            self.host, self.host
        )
        if ":" in proxy_host:
            proxy_host = f"[{proxy_host}]"
        return f"http://{proxy_host}:{self.backend_port}"


def _load_config(path: Path = CONFIG_PATH) -> ServerConfig:
    try:
        with path.open("rb") as config_file:
            server = tomllib.load(config_file).get("server", {})
        config = ServerConfig(**server)
    except (OSError, tomllib.TOMLDecodeError, TypeError) as error:
        raise SystemExit(f"Could not read {path.name}: {error}") from error

    if (
        not isinstance(config.host, str)
        or not config.host
        or config.host != config.host.strip()
        or any(character.isspace() for character in config.host)
        or any(character in config.host for character in "/\\")
    ):
        raise SystemExit(
            f"{path.name}: server.host must be a valid hostname or IP address"
        )
    for name, port in (
        ("backend_port", config.backend_port),
        ("frontend_port", config.frontend_port),
    ):
        if (
            not isinstance(port, int)
            or isinstance(port, bool)
            or not 1 <= port <= 65535
        ):
            raise SystemExit(f"{path.name}: server.{name} must be between 1 and 65535")
    if config.backend_port == config.frontend_port:
        raise SystemExit(f"{path.name}: backend and frontend ports must differ")
    return config


def _npm() -> str:
    executable = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if executable is None:
        raise SystemExit("npm was not found. Install Node.js and try again.")
    return executable


def _request_stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        try:
            if sys.platform == "win32":
                result = subprocess.run(
                    [
                        "taskkill",
                        "/PID",
                        str(process.pid),
                        "/T",
                        "/F",
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
                if result.returncode and process.poll() is None:
                    process.terminate()
            else:
                os.killpg(process.pid, signal.SIGTERM)
        except OSError:
            process.terminate()


def _finish_stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if sys.platform == "win32":
                process.kill()
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def _stop(process: subprocess.Popen[bytes]) -> None:
    _request_stop(process)
    _finish_stop(process)


def _stop_all(processes: list[subprocess.Popen[bytes]]) -> None:
    for process in processes:
        _request_stop(process)
    for process in processes:
        _finish_stop(process)


def _start(
    command: list[str], environment: dict[str, str] | None = None
) -> subprocess.Popen[bytes]:
    options: dict[str, object] = {}
    if sys.platform != "win32":
        options["start_new_session"] = True
    return subprocess.Popen(
        command,
        cwd=PROJECT_ROOT,
        env=environment,
        **options,
    )


def dev() -> None:
    """Run the reload-enabled API and Vite development server."""
    _configure_break_signal()
    config = _load_config()
    commands = [
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.app.main:app",
            "--reload",
            "--host",
            config.host,
            "--port",
            str(config.backend_port),
        ],
        [
            _npm(),
            "run",
            "dev",
            "--prefix",
            "frontend",
            "--",
            "--host",
            config.host,
            "--port",
            str(config.frontend_port),
        ],
    ]
    environment = {
        **os.environ,
        "KSTATS_DEV_API_URL": config.api_url,
    }
    processes: list[subprocess.Popen[bytes]] = []
    try:
        for command in commands:
            processes.append(_start(command, environment))
        while all(process.poll() is None for process in processes):
            time.sleep(0.2)
    except OSError as error:
        raise SystemExit(f"Could not start development servers: {error}") from error
    except KeyboardInterrupt:
        pass
    finally:
        _stop_all(processes)

    failed = next(
        (
            process.returncode
            for process in processes
            if process.returncode not in (0, None)
        ),
        0,
    )
    if failed:
        raise SystemExit(failed)


def prod() -> None:
    """Build the frontend and serve the production application."""
    _configure_break_signal()
    config = _load_config()
    build = subprocess.run(
        [_npm(), "run", "build", "--prefix", "frontend"],
        cwd=PROJECT_ROOT,
        check=False,
    )
    if build.returncode:
        raise SystemExit(build.returncode)

    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.app.main:app",
        "--host",
        config.host,
        "--port",
        str(config.backend_port),
    ]
    try:
        server = _start(command)
    except OSError as error:
        raise SystemExit(f"Could not start production server: {error}") from error
    try:
        returncode = server.wait()
    except KeyboardInterrupt:
        _stop(server)
        return
    if returncode:
        raise SystemExit(returncode)
