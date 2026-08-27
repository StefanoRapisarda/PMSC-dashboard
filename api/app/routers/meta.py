from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import config
from ..db import get_session
from ..models import Aliquot, Patient, Specimen
from ..schemas import Meta
from ..services import analytics

router = APIRouter(tags=["meta"])


@router.get("/meta", response_model=Meta)
def meta(session: Session = Depends(get_session)) -> Meta:
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
