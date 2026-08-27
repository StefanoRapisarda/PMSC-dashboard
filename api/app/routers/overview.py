"""The counting side of the app: KPIs, funnel, QC, turnaround, attention list."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_session
from ..schemas import Overview
from ..services import analytics

router = APIRouter(tags=["overview"])


@router.get("/overview", response_model=Overview)
def overview(session: Session = Depends(get_session)) -> Overview:
    return Overview(
        kpis=analytics.kpis(session),
        flow=analytics.flow(session),
        qc_by_sample_type=analytics.qc_by_sample_type(session),
        sample_types=analytics.sample_types(session),
        turnaround=analytics.turnaround(session),
        stage_distribution=analytics.stage_distribution(session),
        attention=analytics.attention(session),
    )


@router.get("/attention")
def attention(limit: int = 40, session: Session = Depends(get_session)) -> dict:
    return {"rows": analytics.attention(session, limit=limit)}
