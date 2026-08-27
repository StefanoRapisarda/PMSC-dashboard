"""The traversal side: the graph itself, one specimen's history, and ID search."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_session
from ..schemas import GraphPayload
from ..services import graph as graph_service

router = APIRouter(tags=["graph"])


@router.get("/graph", response_model=GraphPayload)
def graph(
    patients: int | None = Query(None, ge=1, le=1000,
                                 description="draw only the first N patients"),
    session: Session = Depends(get_session),
) -> GraphPayload:
    return GraphPayload(**graph_service.build(session, patient_limit=patients))


@router.get("/specimens/{specimen_id}")
def specimen(specimen_id: int, session: Session = Depends(get_session)) -> dict:
    detail = graph_service.specimen_detail(session, specimen_id)
    if detail is None:
        raise HTTPException(404, "unknown specimen")
    return detail


@router.get("/search")
def search(q: str, session: Session = Depends(get_session)) -> dict:
    return {"query": q, "hits": graph_service.search(session, q)}
