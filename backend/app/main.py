from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .importer import ImportError, device_status, import_database
from .kobo_events import EventDecodeError
from .repository import Repository


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if (
            not app_settings.snapshot_db.is_file()
            and app_settings.resolve_source_db().is_file()
        ):
            import_database(app_settings)
        yield

    app = FastAPI(title="Kobo Stats", lifespan=lifespan)
    app.state.settings = app_settings

    def repository(request: Request) -> Repository:
        return Repository(request.app.state.settings.snapshot_db)

    @app.get("/api/device/status")
    def get_device_status(request: Request):
        try:
            return device_status(request.app.state.settings)
        except ImportError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    @app.post("/api/import")
    def refresh_database(request: Request):
        try:
            return import_database(request.app.state.settings)
        except ImportError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.get("/api/dashboard")
    def get_dashboard(repo: Repository = Depends(repository)):
        try:
            return repo.dashboard()
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/api/books")
    def get_books(
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        search: str | None = None,
        status: str | None = None,
        downloaded: bool | None = None,
        finished_month: str | None = Query(
            None,
            pattern=r"^\d{4}-(0[1-9]|1[0-2])$",
        ),
        sort: str = "last_read",
        direction: str = "desc",
        repo: Repository = Depends(repository),
    ):
        try:
            return repo.books(
                page=page,
                page_size=page_size,
                search=search,
                status=status,
                downloaded=downloaded,
                finished_month=finished_month,
                sort=sort,
                direction=direction,
            )
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/api/book")
    def get_book(
        content_id: str = Query(min_length=1),
        repo: Repository = Depends(repository),
    ):
        try:
            book = repo.book(content_id)
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except EventDecodeError as error:
            raise HTTPException(status_code=500, detail=str(error)) from error
        if book is None:
            raise HTTPException(status_code=404, detail="Book not found")
        return book

    frontend_dist = (Path(__file__).parents[2] / "frontend" / "dist").resolve()
    if frontend_dist.is_dir():
        assets = frontend_dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def frontend(path: str):
            candidate = (frontend_dist / path).resolve()
            try:
                candidate.relative_to(frontend_dist)
            except ValueError as error:
                raise HTTPException(status_code=404, detail="File not found") from error
            if path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")

    return app


app = create_app()
