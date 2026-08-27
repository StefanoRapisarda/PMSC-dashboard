"""Load the synthetic export into the database.

This is the mock of the production ingest. In the real system a weekly pipeline
reads REDCap and writes these same tables; here it reads the built synthetic
export instead. Everything above the database is identical either way, which is
the whole point of putting a database under the app rather than serving JSON.

Run:  python -m app.seed [--force]
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .db import SessionLocal, engine
from .models import (Activity, Aliquot, Base, Deviation, Edge, Facility, Identifier,
                     Patient, PlatformRun, QCResult, Specimen, Staff, StorageLocation, Study)

STAGE_INDEX = {stage: i for i, stage in enumerate(config.STAGES)}


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _split_location(label: str) -> tuple[str | None, str | None, str | None]:
    """'CCK-F2 / CRYO-2025-18 / E6' -> freezer, box, position.

    Pathology racks arrive with two parts only; they get a nominal freezer so the
    freezer -> box -> position hierarchy has a root to hang from.
    """
    parts = [p.strip() for p in label.split("/")]
    if len(parts) >= 3:
        return parts[0], parts[1], parts[2]
    if len(parts) == 2:
        return "Pathology", parts[0], parts[1]
    return None, parts[0], None


def seed(session: Session, *, verbose: bool = True) -> dict[str, int]:
    raw = json.loads(config.GRAPH_JSON.read_text())
    manifest = json.loads(config.MANIFEST_JSON.read_text())
    src = {n["id"]: n for n in raw["nodes"]}

    out_edges: dict[str, list[dict]] = {}
    in_edges: dict[str, list[dict]] = {}
    for edge in raw["edges"]:
        out_edges.setdefault(edge["source"], []).append(edge)
        in_edges.setdefault(edge["target"], []).append(edge)

    records: dict[str, dict] = {}
    with config.REDCAP_CSV.open() as fh:
        for row in csv.DictReader(fh):
            records.setdefault(row["record_id"], row)

    study = Study(name=raw["study"], as_of=_date(raw["as_of"]),
                  description="Multimodal ICI precision medicine in NSCLC (synthetic)")
    session.add(study)
    session.flush()

    # ------------------------------------------------------------- lookups
    staff: dict[str, Staff] = {}
    for node in raw["nodes"]:
        if node["type"] == "Staff":
            row = Staff(hsa_id=node["hsa_id"])
            session.add(row)
            staff[node["id"]] = row

    facilities: dict[str, Facility] = {}
    for node in raw["nodes"]:
        if node["type"] == "Facility":
            row = Facility(name=node["label"], kind=node.get("kind"))
            session.add(row)
            facilities[node["id"]] = row

    locations: dict[str, StorageLocation] = {}
    for node in raw["nodes"]:
        if node["type"] == "StorageLocation":
            freezer, box, position = _split_location(node["label"])
            row = StorageLocation(label=node["label"], freezer=freezer,
                                  box=box, position=position)
            session.add(row)
            locations[node["id"]] = row
    session.flush()

    # ------------------------------------------------------------ patients
    patients: dict[str, Patient] = {}
    for node in sorted((n for n in raw["nodes"] if n["type"] == "Patient"),
                       key=lambda n: n["label"]):
        enroller = next((staff[e["source"]] for e in in_edges.get(node["id"], [])
                         if e["type"] == "ENROLLED" and e["source"] in staff), None)
        row = Patient(study_id=study.id, label=node["label"], sex=node.get("sex"),
                      age=node.get("age"), enrolled_on=_date(node.get("enrolled_on")),
                      consent=bool(node.get("consent")),
                      enrolled_by_id=enroller.id if enroller else None)
        session.add(row)
        patients[node["id"]] = row
    session.flush()

    # ----------------------------------------------------------- specimens
    specimens: dict[str, Specimen] = {}
    for node in sorted((n for n in raw["nodes"] if n["type"] == "Specimen"),
                       key=lambda n: int(n.get("record_id") or 0)):
        patient_edge = next((e for e in in_edges.get(node["id"], [])
                             if e["type"] == "HAS_SPECIMEN"), None)
        storage = next((locations[e["target"]] for e in out_edges.get(node["id"], [])
                        if e["type"] == "STORED_AT" and e["target"] in locations), None)
        row = Specimen(
            patient_id=patients[patient_edge["source"]].id if patient_edge else None,
            record_id=node["record_id"], label=node["label"],
            sample_type=node.get("sample_type"),
            collected_on=_date(node.get("collected_on")),
            stage_reached=node.get("stage_reached") or "enrolled",
            is_repeat=bool(node.get("is_repeat")),
            storage_id=storage.id if storage else None,
            stalled_days=node.get("stalled_days"),
        )
        session.add(row)
        specimens[node["id"]] = row
    session.flush()

    # a retry is filed as its own record; link it back to what it repeats
    for edge in raw["edges"]:
        if edge["type"] == "REPEAT_OF" and edge["source"] in specimens:
            target = specimens.get(edge["target"])
            if target:
                specimens[edge["source"]].repeat_of_id = target.id

    # ---------------------------------------------------------- activities
    activities: dict[str, Activity] = {}
    for node in raw["nodes"]:
        if node["type"] != "Activity":
            continue
        # Which specimen a step belongs to. Following USED alone misses two whole
        # kinds: collection GENERATED the specimen rather than using it, and SP3
        # digestion used an aliquot. The activity's own id carries the record, so
        # fall back to that rather than dropping the step.
        specimen = next((specimens[e["target"]] for e in out_edges.get(node["id"], [])
                         if e["type"] == "USED" and e["target"] in specimens), None)
        if specimen is None:
            specimen = next((specimens[e["source"]] for e in in_edges.get(node["id"], [])
                             if e["source"] in specimens), None)
        if specimen is None:
            parts = node["id"].split(":")
            if len(parts) > 1:
                specimen = specimens.get(f"specimen:{parts[1]}")
        operator = next((staff[e["source"]] for e in in_edges.get(node["id"], [])
                         if e["type"] == "PERFORMED" and e["source"] in staff), None)
        facility = next((facilities[e["target"]] for e in out_edges.get(node["id"], [])
                         if e["type"] == "AT_FACILITY" and e["target"] in facilities), None)
        row = Activity(specimen_id=specimen.id if specimen else None,
                       kind=node.get("activity") or "activity", label=node["label"],
                       performed_on=_date(node.get("date")),
                       performed_at=node.get("time"),
                       staff_id=operator.id if operator else None,
                       facility_id=facility.id if facility else None)
        session.add(row)
        activities[node["id"]] = row
    session.flush()

    # ------------------------------------------------------------ aliquots
    aliquots: dict[str, Aliquot] = {}
    for node in raw["nodes"]:
        if node["type"] != "AnalyticalSample":
            continue
        specimen_id = f"specimen:{node.get('record_id')}"
        storage = next((locations[e["target"]] for e in out_edges.get(node["id"], [])
                        if e["type"] == "STORED_AT" and e["target"] in locations), None)
        row = Aliquot(
            specimen_id=specimens[specimen_id].id if specimen_id in specimens else None,
            label=node["label"], molecule=node.get("molecule") or "?",
            elution_ul=node.get("elution_ul"), buffer=node.get("buffer"),
            concentration=node.get("concentration"), total=node.get("total"),
            qc_outcome=node.get("qc"), storage_id=storage.id if storage else None,
        )
        session.add(row)
        aliquots[node["id"]] = row
    session.flush()

    # The mass-spec QC lives in the REDCap export (ms_qcheck) but never made it
    # into the graph artefact, so the whole proteomics stream arrived with no QC
    # outcome at all. Read it from the source and attach it to the peptide — the
    # peptide is what was injected, so that is what the check applies to.
    ms_outcome = {"1": "Pass", "2": "Fail"}
    for key, aliquot in aliquots.items():
        if aliquot.molecule != "Peptide":
            continue
        specimen = next((s for s in specimens.values() if s.id == aliquot.specimen_id), None)
        record = records.get(specimen.record_id, {}) if specimen else {}
        outcome = ms_outcome.get((record.get("ms_qcheck") or "").strip())
        if outcome:
            aliquot.qc_outcome = outcome
            session.add(QCResult(aliquot_id=aliquot.id, molecule="Peptide", outcome=outcome))

    # peptide hangs off the protein it was digested from
    for edge in raw["edges"]:
        if (edge["type"] == "DERIVED_FROM" and edge["source"] in aliquots
                and edge["target"] in aliquots):
            aliquots[edge["source"]].parent_id = aliquots[edge["target"]].id

    for node in raw["nodes"]:
        if node["type"] != "QCResult":
            continue
        owner = next((aliquots[e["source"]] for e in in_edges.get(node["id"], [])
                      if e["type"] == "HAS_QC" and e["source"] in aliquots), None)
        if owner:
            session.add(QCResult(aliquot_id=owner.id, molecule=node.get("molecule"),
                                 outcome=node.get("outcome") or "?"))

    for node in raw["nodes"]:
        if node["type"] != "Deviation":
            continue
        owner = next((specimens[e["source"]] for e in in_edges.get(node["id"], [])
                      if e["type"] == "HAS_DEVIATION" and e["source"] in specimens), None)
        if owner:
            session.add(Deviation(specimen_id=owner.id,
                                  deviation_type=node.get("deviation_type") or "?",
                                  note=node.get("note")))

    for node in raw["nodes"]:
        if node["type"] != "PlatformRun":
            continue
        aliquot = next((aliquots[e["source"]] for e in in_edges.get(node["id"], [])
                        if e["type"] == "SUBMITTED_TO" and e["source"] in aliquots), None)
        facility = next((facilities[e["target"]] for e in out_edges.get(node["id"], [])
                         if e["type"] == "RUN_AT" and e["target"] in facilities), None)
        if aliquot:
            session.add(PlatformRun(
                aliquot_id=aliquot.id, facility_id=facility.id if facility else None,
                molecule=node.get("molecule"), sent_on=_date(node.get("sent_on")),
                returned_on=_date(node.get("returned_on")),
                volume_ul=node.get("volume_ul"), turnaround_days=node.get("turnaround_days")))

    # --------------------------------------------------------- identifiers
    owner_of: dict[str, tuple[str, int]] = {}
    for key, row in specimens.items():
        owner_of[key] = ("specimen", row.id)
    for key, row in patients.items():
        owner_of[key] = ("patient", row.id)
    for key, row in aliquots.items():
        owner_of[key] = ("aliquot", row.id)

    for edge in raw["edges"]:
        if edge["type"] != "IDENTIFIED_AS":
            continue
        node = src.get(edge["target"], {})
        owner = owner_of.get(edge["source"])
        if owner and node:
            session.add(Identifier(system=node.get("system") or "?", value=node["label"],
                                   owner_type=owner[0], owner_id=owner[1]))

    session.flush()

    # --------------------------------------------------------------- edges
    key_to_row: dict[str, tuple[str, int]] = dict(owner_of)
    for key, row in staff.items():
        key_to_row[key] = ("staff", row.id)
    for key, row in facilities.items():
        key_to_row[key] = ("facility", row.id)
    for key, row in locations.items():
        key_to_row[key] = ("storage", row.id)
    for key, row in activities.items():
        key_to_row[key] = ("activity", row.id)

    kept = 0
    for edge in raw["edges"]:
        source = key_to_row.get(edge["source"])
        target = key_to_row.get(edge["target"])
        if not source or not target:
            continue
        session.add(Edge(src_type=source[0], src_id=source[1],
                         dst_type=target[0], dst_id=target[1], type=edge["type"]))
        kept += 1

    session.commit()

    counts = {
        "patients": len(patients), "specimens": len(specimens), "aliquots": len(aliquots),
        "activities": len(activities), "staff": len(staff), "facilities": len(facilities),
        "locations": len(locations), "edges": kept,
        "source_records": manifest.get("records"),
    }
    if verbose:
        for key, value in counts.items():
            print(f"  {key:>15}: {value}")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Load the synthetic export into the database")
    parser.add_argument("--force", action="store_true", help="drop and rebuild")
    args = parser.parse_args()

    if args.force and config.DATABASE_PATH.exists():
        config.DATABASE_PATH.unlink()

    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        if session.scalar(select(Study).limit(1)) and not args.force:
            print("database already seeded — use --force to rebuild")
            return
        print(f"seeding {config.DATABASE_PATH.name} from {config.GRAPH_JSON.name}")
        seed(session)
    print("done")


if __name__ == "__main__":
    main()
