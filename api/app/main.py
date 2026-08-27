"""PM-SC dashboard API.

Three tiers, kept apart on purpose: a database that mocks the production store,
this service layer over it, and a separate frontend that talks to it over HTTP.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from sqlalchemy import select

from . import config
from .db import SessionLocal, engine
from .models import Base, Study
from .routers import graph, meta, overview

@asynccontextmanager
async def lifespan(_: FastAPI):
    """Create the schema if missing, and refuse to serve an empty database
    rather than returning zeroes that look like real numbers."""
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        if session.scalar(select(Study).limit(1)) is None:
            raise RuntimeError(
                f"{config.DATABASE_PATH.name} is empty — run: python -m app.seed --force")
    yield


app = FastAPI(
    lifespan=lifespan,
    title="PM-SC dashboard API",
    version="1.0.0",
    description="Sample provenance for Precision Medicine Sample Central. "
                "Synthetic cohort, modelled on the REDCap dictionary.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(meta.router, prefix="/api")
app.include_router(overview.router, prefix="/api")
app.include_router(graph.router, prefix="/api")


class SinglePageApp(StaticFiles):
    """Serve the built front end, and answer an unknown path with index.html.

    The application decides what /graph and /dashboard mean once it is running
    in the browser, so those paths do not exist as files. Without this, opening
    one of them directly — or refreshing the page while on it — would return a
    404 from a server that is holding the very application that knows what to do
    with it.
    """

    async def get_response(self, path: str, scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            return await super().get_response("index.html", scope)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict:
    with SessionLocal() as session:
        study = session.scalar(select(Study).limit(1))
    return {"ok": True, "study": study.name if study else None,
            "as_of": study.as_of.isoformat() if study and study.as_of else None}


# Mounted last and at the root, so that it catches everything the API did not.
# In development this directory does not exist and the block is skipped, leaving
# the service exactly as it was.
if config.WEB_DIR.is_dir():
    app.mount("/", SinglePageApp(directory=config.WEB_DIR, html=True), name="web")
