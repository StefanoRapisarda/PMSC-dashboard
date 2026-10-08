"""Traversal questions, answered by the database.

The shape returned here is the one the frontend's 3-D view already speaks
(the vocabulary from mockups/index-v3.html): typed nodes with numeric indices
and typed edges between them. Keeping that contract is deliberate — the
renderer, its physics and its interactions are settled work, and this layer
exists to feed them from a real store rather than from a generator in the page.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (Activity, Aliquot, Deviation, Facility, Identifier, Patient,
                      PlatformRun, QCResult, Specimen, Staff, StorageLocation)

PLATFORM_KEY = {
    "Clinical Genomics, SciLifeLab": "CG",
    "Genomics Express": "GX",
    "Clinical Proteomics, SciLifeLab": "MS",
}

MOLECULE_ORDER = {"DNA": 0, "RNA": 1, "Protein": 2, "Peptide": 3}

# v3's stage ladder: 4 = through PM-SC prep, 6 = submitted, 7 = analysed, 8 = MTB
STAGE_NUMBER = {"enrolled": 1, "collected": 2, "pathology": 3, "pmsc_prep": 4,
                "allprep": 5, "qc": 5, "submitted": 6, "data_back": 7, "mtb": 8}


class _Builder:
    def __init__(self) -> None:
        self.nodes: list[dict] = []
        self.edges: list[dict] = []

    def add(self, type_: str, label: str, **extra) -> int:
        self.nodes.append({"id": len(self.nodes), "type": type_, "label": label, **extra})
        return len(self.nodes) - 1

    def link(self, a: int, b: int, type_: str) -> None:
        self.edges.append({"a": a, "b": b, "type": type_})


def build(session: Session, *, patient_limit: int | None = None) -> dict[str, Any]:
    """Whole cohort, or the first `patient_limit` patients by label.

    The limit exists because the force simulation is O(n^2): past roughly five
    hundred visible nodes it stops holding a frame rate, and v3 falls back to a
    flat layout. Drawing fewer patients keeps the physics — which is the point
    of that view — rather than silently degrading it.
    """
    g = _Builder()

    # ------------------------------------------------------------- storage
    freezers: dict[str, int] = {}
    boxes: dict[str, int] = {}
    location_box: dict[int, int] = {}
    for row in session.scalars(select(StorageLocation).order_by(StorageLocation.id)).all():
        freezer_name = row.freezer or "Unknown"
        box_name = row.box or row.label
        if freezer_name not in freezers:
            freezers[freezer_name] = g.add("storage", freezer_name, kind="freezer")
        if box_name not in boxes:
            boxes[box_name] = g.add("storage", box_name, kind="box")
            g.link(freezers[freezer_name], boxes[box_name], "contains")
        location_box[row.id] = boxes[box_name]

    # -------------------------------------------------------------- agents
    platforms: dict[str, int] = {}
    mtb_index: int | None = None
    for row in session.scalars(select(Facility).order_by(Facility.id)).all():
        key = PLATFORM_KEY.get(row.name)
        if key:
            platforms[key] = g.add("platform", row.name, facility_id=row.id)
        elif "Tumor Board" in row.name:
            mtb_index = g.add("mtb", "MTB board")
    if mtb_index is None:
        mtb_index = g.add("mtb", "MTB board")

    operators: dict[int, int] = {}
    for row in session.scalars(select(Staff).order_by(Staff.id)).all():
        operators[row.id] = g.add("operator", row.hsa_id, staff_id=row.id)

    # ------------------------------------------------------------ patients
    patient_query = select(Patient).order_by(Patient.label)
    if patient_limit:
        patient_query = patient_query.limit(patient_limit)
    patients = session.scalars(patient_query).all()

    identifiers: dict[tuple[str, int], list[Identifier]] = {}
    for row in session.scalars(select(Identifier)).all():
        identifiers.setdefault((row.owner_type, row.owner_id), []).append(row)

    def attach_identifiers(owner_type: str, owner_id: int, node_index: int) -> None:
        """Every object carries the names it is known by.

        The chain starts at the patient's study ID and ends at the per-aliquot
        IDs; emitting only the specimen's names broke it at both ends, which is
        precisely the join WP2 exists to reconstruct.
        """
        for identifier in identifiers.get((owner_type, owner_id), []):
            index = g.add("identifier", identifier.system, scheme=identifier.system,
                          system=identifier.system, value=identifier.value)
            g.link(node_index, index, "identified_as")

    patient_index: dict[int, int] = {}
    for row in patients:
        index = g.add(
            "patient", row.label, sex="F" if row.sex == "Female" else "M",
            age=round(row.age or 0), consent=bool(row.consent), patient_id=row.id)
        patient_index[row.id] = index
        attach_identifiers("patient", row.id, index)
        # the enrolling oncologist; without this link they reach the graph unattached
        if row.enrolled_by_id in operators:
            g.link(operators[row.enrolled_by_id], index, "enrolled")

    specimens = session.scalars(
        select(Specimen).where(Specimen.patient_id.in_(patient_index))
        .order_by(Specimen.id)).all()
    specimen_ids = [s.id for s in specimens]

    deviations: dict[int, list[Deviation]] = {}
    for row in session.scalars(
            select(Deviation).where(Deviation.specimen_id.in_(specimen_ids))).all():
        deviations.setdefault(row.specimen_id, []).append(row)

    activities: dict[int, list[Activity]] = {}
    for row in session.scalars(
            select(Activity).where(Activity.specimen_id.in_(specimen_ids))).all():
        activities.setdefault(row.specimen_id, []).append(row)

    aliquots: dict[int, list[Aliquot]] = {}
    for row in session.scalars(
            select(Aliquot).where(Aliquot.specimen_id.in_(specimen_ids))).all():
        aliquots.setdefault(row.specimen_id, []).append(row)

    runs: dict[int, list[PlatformRun]] = {}
    aliquot_ids = [a.id for group in aliquots.values() for a in group]
    for row in session.scalars(
            select(PlatformRun).where(PlatformRun.aliquot_id.in_(aliquot_ids))).all():
        runs.setdefault(row.aliquot_id, []).append(row)

    facility_key = {row.id: PLATFORM_KEY.get(row.name)
                    for row in session.scalars(select(Facility)).all()}

    specimen_index: dict[int, int] = {}
    aliquot_index: dict[int, int] = {}

    for spec in specimens:
        box_label = None
        if spec.storage_id and spec.storage_id in location_box:
            box_label = g.nodes[location_box[spec.storage_id]]["label"]

        spec_deviations = deviations.get(spec.id, [])
        s_index = g.add(
            "sample", spec.label.replace("Specimen ", "S-"),
            stype=spec.sample_type, reached=STAGE_NUMBER.get(spec.stage_reached, 1),
            box=box_label,
            # deviations are a property of the specimen to filter on, not objects
            # to draw: there is nothing downstream of a deviation to traverse to
            deviations=[d.deviation_type for d in spec_deviations],
            deviation_notes=[d.note for d in spec_deviations if d.note],
            devType=spec_deviations[0].deviation_type if spec_deviations else None,
            record_id=spec.record_id, collected=spec.collected_on.isoformat() if spec.collected_on else None,
            stalled=spec.stalled_days is not None, stalled_days=spec.stalled_days,
            specimen_id=spec.id)
        specimen_index[spec.id] = s_index

        if spec.patient_id in patient_index:
            p_index = patient_index[spec.patient_id]
            g.link(p_index, s_index, "has_sample")
            g.nodes[s_index]["_psex"] = g.nodes[p_index]["sex"]
            g.nodes[s_index]["_page"] = g.nodes[p_index]["age"]

        attach_identifiers("specimen", spec.id, s_index)

        # Each processing step is a node, so you can see what was actually run on
        # a specimen and by whom. The tumour board keeps its own node, so its
        # activity is skipped rather than drawn twice.
        activity_index: dict[int, int] = {}
        for activity in activities.get(spec.id, []):
            if activity.kind == "mtb":
                continue
            a_index = g.add(
                "activity", activity.label, kind=activity.kind,
                date=activity.performed_on.isoformat() if activity.performed_on else None,
                time=activity.performed_at)
            activity_index[activity.id] = a_index
            g.link(a_index, s_index, "used")
            if activity.staff_id in operators:
                g.link(operators[activity.staff_id], a_index, "performed")

        # which step produced which fraction
        by_kind = {a.kind: activity_index[a.id] for a in activities.get(spec.id, [])
                   if a.id in activity_index}
        made_by = {"DNA": "allprep", "RNA": "allprep",
                   "Protein": "protein_extraction", "Peptide": "sp3"}
        aliquot_list = sorted(aliquots.get(spec.id, []),
                              key=lambda a: MOLECULE_ORDER.get(a.molecule, 9))
        alis: list[int] = []
        for aliquot in aliquot_list:
            outcome = aliquot.qc_outcome
            qc_state = "pass" if outcome == "Pass" else ("fail" if outcome == "Fail" else "pending")
            a_index = g.add("aliquot", aliquot.label, mol=aliquot.molecule,
                            molLabel=aliquot.molecule, qc=qc_state, total=aliquot.total,
                            conc=aliquot.concentration, elution=aliquot.elution_ul,
                            buffer=aliquot.buffer, aliquot_id=aliquot.id)
            alis.append(a_index)
            aliquot_index[aliquot.id] = a_index
            attach_identifiers("aliquot", aliquot.id, a_index)
            maker = by_kind.get(made_by.get(aliquot.molecule, ""))
            if maker is not None:
                g.link(maker, a_index, "generated")
            # Peptide is made from protein by digestion, so its parent is another
            # aliquot, not the specimen. Linking it to the specimen would draw it
            # as a sibling of protein — a different claim about the chemistry.
            parent = aliquot_index.get(aliquot.parent_id) if aliquot.parent_id else None
            g.link(a_index, parent if parent is not None else s_index, "derived_from")

            if aliquot.storage_id and aliquot.storage_id in location_box:
                g.link(a_index, location_box[aliquot.storage_id], "stored_at")

            for run in runs.get(aliquot.id, []):
                key = facility_key.get(run.facility_id)
                if key and key in platforms:
                    g.link(a_index, platforms[key], "submitted_to")
                g.nodes[a_index]["sent_on"] = run.sent_on.isoformat() if run.sent_on else None
                g.nodes[a_index]["returned_on"] = run.returned_on.isoformat() if run.returned_on else None

        g.nodes[s_index]["_alisIdx"] = alis
        g.nodes[s_index]["_actIdx"] = next(iter(activity_index.values()), None)

        if STAGE_NUMBER.get(spec.stage_reached, 1) >= 8:
            g.link(s_index, mtb_index, "has_mtb")

    # a retry is its own record, so the repeat relation is specimen to specimen
    for spec in specimens:
        if spec.repeat_of_id and spec.repeat_of_id in specimen_index:
            g.link(specimen_index[spec.id], specimen_index[spec.repeat_of_id], "repeat_of")

    sample_types = sorted({s.sample_type for s in specimens if s.sample_type})

    activity_kinds = sorted({n["kind"] for n in g.nodes
                             if n["type"] == "activity" and n.get("kind")})

    return {
        "nodes": g.nodes, "edges": g.edges,
        "activity_kinds": activity_kinds,
        "platforms": platforms, "mtb": mtb_index,
        "sample_types": sample_types,
        "counts": {"patients": len(patients), "specimens": len(specimens),
                   "nodes": len(g.nodes), "edges": len(g.edges)},
        "patient_limit": patient_limit,
        "patients_total": session.scalar(select(func.count()).select_from(Patient)) or 0,
    }


def specimen_detail(session: Session, specimen_id: int) -> dict | None:
    """Everything about one specimen: the chain, the steps, the fractions."""
    spec = session.get(Specimen, specimen_id)
    if spec is None:
        return None
    patient = session.get(Patient, spec.patient_id)

    chain: list[dict] = []
    if patient:
        for identifier in session.scalars(select(Identifier).where(
                Identifier.owner_type == "patient", Identifier.owner_id == patient.id)).all():
            chain.append({"role": "Patient", "system": identifier.system,
                          "value": identifier.value})
    for identifier in session.scalars(select(Identifier).where(
            Identifier.owner_type == "specimen", Identifier.owner_id == spec.id)).all():
        chain.append({"role": "Specimen", "system": identifier.system, "value": identifier.value})

    aliquot_rows = session.scalars(
        select(Aliquot).where(Aliquot.specimen_id == spec.id)).all()
    for aliquot in sorted(aliquot_rows, key=lambda a: MOLECULE_ORDER.get(a.molecule, 9)):
        found = session.scalars(select(Identifier).where(
            Identifier.owner_type == "aliquot", Identifier.owner_id == aliquot.id)).all()
        for identifier in found:
            chain.append({"role": f"Aliquot · {aliquot.molecule}",
                          "system": identifier.system, "value": identifier.value})
        if not found:
            chain.append({"role": f"Aliquot · {aliquot.molecule}",
                          "system": "not captured", "value": None})

    steps = []
    for activity in sorted(session.scalars(
            select(Activity).where(Activity.specimen_id == spec.id)).all(),
            key=lambda a: (a.performed_on or spec.collected_on or "")):
        operator = session.get(Staff, activity.staff_id) if activity.staff_id else None
        facility = session.get(Facility, activity.facility_id) if activity.facility_id else None
        steps.append({"kind": activity.kind, "label": activity.label,
                      "date": activity.performed_on.isoformat() if activity.performed_on else None,
                      "time": activity.performed_at,
                      "operator": operator.hsa_id if operator else None,
                      "facility": facility.name if facility else None})

    fractions = []
    for aliquot in sorted(aliquot_rows, key=lambda a: MOLECULE_ORDER.get(a.molecule, 9)):
        run = session.scalars(select(PlatformRun)
                              .where(PlatformRun.aliquot_id == aliquot.id)).first()
        facility = session.get(Facility, run.facility_id) if run and run.facility_id else None
        fractions.append({
            "label": aliquot.label, "molecule": aliquot.molecule, "qc": aliquot.qc_outcome,
            "total": aliquot.total, "concentration": aliquot.concentration,
            "elution_ul": aliquot.elution_ul, "buffer": aliquot.buffer,
            "platform": facility.name if facility else None,
            "sent_on": run.sent_on.isoformat() if run and run.sent_on else None,
            "returned_on": run.returned_on.isoformat() if run and run.returned_on else None,
        })

    storage = session.get(StorageLocation, spec.storage_id) if spec.storage_id else None
    return {
        "id": spec.id, "label": spec.label, "record_id": spec.record_id,
        "sample_type": spec.sample_type,
        "collected_on": spec.collected_on.isoformat() if spec.collected_on else None,
        "stage_reached": spec.stage_reached, "stalled_days": spec.stalled_days,
        "is_repeat": spec.is_repeat,
        "patient": {"label": patient.label, "sex": patient.sex,
                    "age": round(patient.age or 0)} if patient else None,
        "storage": storage.label if storage else None,
        "id_chain": chain, "steps": steps, "fractions": fractions,
        "deviations": [{"type": d.deviation_type, "note": d.note} for d in
                       session.scalars(select(Deviation)
                                       .where(Deviation.specimen_id == spec.id)).all()],
    }


def search(session: Session, query: str, limit: int = 15) -> list[dict]:
    """Paste any captured identifier and land on the specimen that carries it."""
    like = f"%{query.strip()}%"
    hits: list[dict] = []
    for identifier in session.scalars(
            select(Identifier).where(Identifier.value.ilike(like)).limit(limit)).all():
        specimen_id = None
        if identifier.owner_type == "specimen":
            specimen_id = identifier.owner_id
        elif identifier.owner_type == "aliquot":
            aliquot = session.get(Aliquot, identifier.owner_id)
            specimen_id = aliquot.specimen_id if aliquot else None
        elif identifier.owner_type == "patient":
            first = session.scalars(select(Specimen)
                                    .where(Specimen.patient_id == identifier.owner_id)).first()
            specimen_id = first.id if first else None
        hits.append({"value": identifier.value, "system": identifier.system,
                     "owner_type": identifier.owner_type, "specimen_id": specimen_id})
    return hits
