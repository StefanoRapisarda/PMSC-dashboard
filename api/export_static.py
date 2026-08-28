"""Write the API's three responses out as files, for the static build.

WHY THIS EXISTS. The application asks the API three questions and no more:
/api/meta for the banner, /api/overview for the dashboard and the workflow
totals, and /api/graph for the cohort. Every one of them returns the same
answer for the whole life of a release, because the database is built at
release time from a seeded generator and nothing writes to it afterwards.

That makes a server optional for the showcase. Three files on any static host
answer all three questions, which is what lets the app be published on GitHub
Pages for nothing. It does NOT make the server optional for the real system:
there the numbers move, and the argument in README.md for deriving them in SQL
still stands. This is a published build of a showcase, not a change of design.

WHY IT DOES NOT USE HTTP. Calling the routes over the network would need a
running server and an HTTP client that is not in requirements.txt. The routes
are thin — each one assembles a Pydantic model from the service layer — so this
imports the same services and builds the same models. FastAPI serialises through
those models too, so what lands on disk is what the API would have sent.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import func, select

from app import config
from app.db import SessionLocal
from app.models import Aliquot, Patient, Specimen
from app.schemas import GraphPayload, Meta, Overview
from app.services import analytics
from app.services import graph as graph_service

# Where the built front end expects to find them. SvelteKit copies everything
# under web/static verbatim into the build, so a file written here at
# web/static/data/meta.json is served at /data/meta.json.
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "web" / "static" / "data"


def build_meta(session) -> Meta:
    """The same body as routers/meta.py:meta()."""
    sample_types = [row for row in session.scalars(
        select(Specimen.sample_type).distinct().order_by(Specimen.sample_type)).all() if row]
    return Meta(
        study=analytics.study(session),
        counts={
            "patients": session.scalar(select(func.count()).select_from(Patient)) or 0,
            "specimens": session.scalar(select(func.count()).select_from(Specimen)) or 0,
            "aliquots": session.scalar(select(func.count()).select_from(Aliquot)) or 0,
        },
        stages=config.STAGES,
        molecules=config.MOLECULES,
        sample_types=sample_types,
        stall_threshold_days=config.STALL_THRESHOLD_DAYS,
    )


def build_overview(session) -> Overview:
    """The same body as routers/overview.py:overview()."""
    return Overview(
        kpis=analytics.kpis(session),
        flow=analytics.flow(session),
        qc_by_sample_type=analytics.qc_by_sample_type(session),
        sample_types=analytics.sample_types(session),
        turnaround=analytics.turnaround(session),
        stage_distribution=analytics.stage_distribution(session),
        attention=analytics.attention(session),
    )


def build_graph(session) -> GraphPayload:
    """The same body as routers/graph.py:graph(), with no patient limit.

    The application always calls api.graph() with no argument, so the whole
    cohort is the only payload that is ever asked for.
    """
    return GraphPayload(**graph_service.build(session, patient_limit=None))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT,
                    help="directory to write the JSON into")
    args = ap.parse_args()

    if not config.DATABASE_PATH.exists():
        print(f"error: {config.DATABASE_PATH} does not exist — run "
              f"'python -m app.seed --force' first", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as session:
        payloads = {
            "meta.json": build_meta(session),
            "overview.json": build_overview(session),
            "graph.json": build_graph(session),
        }

    for name, model in payloads.items():
        target = args.out / name
        # by_alias and exclude_none off: match what FastAPI sends by default
        target.write_text(model.model_dump_json(), encoding="utf-8")
        print(f"  {name:<14} {target.stat().st_size:>8,} bytes")

    print(f"written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
