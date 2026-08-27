"""Response shapes. Thin on purpose — the services already return the payloads
the frontend consumes; these exist so /docs describes them."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class Meta(BaseModel):
    study: dict[str, Any]
    counts: dict[str, int]
    stages: list[str]
    molecules: list[str]
    sample_types: list[str]
    stall_threshold_days: int


class Overview(BaseModel):
    kpis: dict[str, Any]
    flow: dict[str, Any]
    qc_by_sample_type: dict[str, Any]
    sample_types: list[dict[str, Any]]
    turnaround: dict[str, Any]
    stage_distribution: list[dict[str, Any]]
    attention: list[dict[str, Any]]


class GraphPayload(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    platforms: dict[str, int]
    mtb: int
    sample_types: list[str]
    activity_kinds: list[str]
    counts: dict[str, int]
    patient_limit: int | None
    patients_total: int
