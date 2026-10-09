"""Counting questions, answered by the database.

Nothing here reads a precomputed file: the point of putting a store underneath
the app is that the numbers are derived, so they stay right when the data moves.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .. import config
from ..models import (Activity, Aliquot, Deviation, Facility, Patient, PlatformRun,
                      Specimen, Study)

STAGE_INDEX = {stage: i for i, stage in enumerate(config.STAGES)}


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(values)
    middle = len(values) // 2
    if len(values) % 2:
        return round(values[middle], 1)
    return round((values[middle - 1] + values[middle]) / 2, 1)


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    index = min(len(values) - 1, int(round((len(values) - 1) * q)))
    return round(values[index], 1)


def study(session: Session) -> dict:
    row = session.scalar(select(Study).limit(1))
    return {"name": row.name if row else "—",
            "as_of": row.as_of.isoformat() if row and row.as_of else None,
            "description": row.description if row else None}


def kpis(session: Session) -> dict:
    patients = session.scalar(select(func.count()).select_from(Patient)) or 0
    specimens = session.scalar(select(func.count()).select_from(Specimen)) or 0
    aliquots = session.scalar(select(func.count()).select_from(Aliquot)) or 0

    by_molecule = dict(session.execute(
        select(Aliquot.molecule, func.count()).group_by(Aliquot.molecule)).all())

    passed = session.scalar(select(func.count()).select_from(Aliquot)
                            .where(Aliquot.qc_outcome == "Pass")) or 0
    failed = session.scalar(select(func.count()).select_from(Aliquot)
                            .where(Aliquot.qc_outcome == "Fail")) or 0
    resolved = passed + failed

    # a specimen counts as "data back" if any of its aliquots got results
    with_data = session.scalar(
        select(func.count(func.distinct(Aliquot.specimen_id)))
        .join(PlatformRun, PlatformRun.aliquot_id == Aliquot.id)
        .where(PlatformRun.returned_on.is_not(None))) or 0

    stalled = session.scalar(select(func.count()).select_from(Specimen)
                             .where(Specimen.stalled_days.is_not(None))) or 0
    deviations = session.scalar(select(func.count()).select_from(Deviation)) or 0

    return {
        "patients_enrolled": patients,
        "specimens_collected": specimens,
        "aliquots": aliquots,
        "aliquots_by_molecule": by_molecule,
        "qc_pass_rate": round(passed / resolved * 100, 1) if resolved else None,
        "qc_resolved": resolved,
        "reached_data_back_pct": round(with_data / specimens * 100, 1) if specimens else None,
        "specimens_with_data_back": with_data,
        "stalled": stalled,
        "deviations": deviations,
        "stall_threshold_days": config.STALL_THRESHOLD_DAYS,
    }


def stage_distribution(session: Session) -> list[dict]:
    counts = dict(session.execute(
        select(Specimen.stage_reached, func.count()).group_by(Specimen.stage_reached)).all())
    return [{"stage": stage, "count": counts.get(stage, 0)} for stage in config.STAGES]


def flow(session: Session) -> dict:
    """The cohort funnel. Specimens up to AllPrep, aliquots after — the unit
    changes at the split, and the interface has to say so."""
    counts = dict(session.execute(
        select(Specimen.stage_reached, func.count()).group_by(Specimen.stage_reached)).all())

    def at_least(stage: str) -> int:
        floor = STAGE_INDEX[stage]
        return sum(n for s, n in counts.items() if STAGE_INDEX.get(s, -1) >= floor)

    specimen_stages = [
        {"stage": "Collected", "count": at_least("collected")},
        {"stage": "Pathology", "count": at_least("pathology")},
        {"stage": "PM-SC prep", "count": at_least("pmsc_prep")},
        {"stage": "AllPrep", "count": at_least("allprep")},
    ]

    def count_aliquots(molecule: str, outcome: str | None = None) -> int:
        query = select(func.count()).select_from(Aliquot).where(Aliquot.molecule == molecule)
        if outcome:
            query = query.where(Aliquot.qc_outcome == outcome)
        return session.scalar(query) or 0

    def destination(molecule: str) -> str | None:
        """Where this stream is actually sent. The three streams go to three
        different facilities, so one 'SciLifeLab' column would be wrong."""
        return session.scalar(
            select(Facility.name)
            .join(PlatformRun, PlatformRun.facility_id == Facility.id)
            .where(PlatformRun.molecule == molecule).limit(1))

    def count_runs(molecule: str, returned: bool = False) -> int:
        query = select(func.count()).select_from(PlatformRun).where(
            PlatformRun.molecule == molecule)
        if returned:
            query = query.where(PlatformRun.returned_on.is_not(None))
        return session.scalar(query) or 0

    # `submitted` and `returned` are named explicitly rather than left to be
    # picked out of the chain by position: the protein stream has different step
    # names, and a chart that guessed by index compared its post-QC count against
    # the others' submission count.
    streams: dict[str, dict] = {}
    for molecule in ["DNA", "RNA"]:
        streams[molecule] = {
            "qc_fail": count_aliquots(molecule, "Fail"),
            "qc_position": "before_submission",
            "submitted": count_runs(molecule),
            "returned": count_runs(molecule, returned=True),
            "facility": destination(molecule),
            "chain": [
                {"stage": "Extracted", "count": count_aliquots(molecule)},
                {"stage": "QC passed", "count": count_aliquots(molecule, "Pass")},
                {"stage": "Sent", "count": count_runs(molecule)},
                {"stage": "Data back", "count": count_runs(molecule, returned=True)},
            ],
        }

    # The protein stream is different in kind: protein is digested to peptide, the
    # peptide is what goes on the mass spec, and the QC happens AFTER that run
    # rather than before submission. Reading its QC off the protein aliquot would
    # report zero, because the outcome belongs to the child.
    streams["Protein"] = {
        "qc_fail": count_aliquots("Peptide", "Fail"),
        "qc_position": "after_run",
        "submitted": count_runs("Peptide"),
        "returned": count_runs("Peptide", returned=True),
        "facility": destination("Peptide"),
        "chain": [
            {"stage": "Extracted", "count": count_aliquots("Protein")},
            {"stage": "Digested to peptide", "count": count_runs("Peptide")},
            {"stage": "MS QC passed", "count": count_aliquots("Peptide", "Pass")},
            {"stage": "Data back", "count": count_runs("Peptide", returned=True)},
        ],
    }

    # Counting-unit discipline: ribbon width is a count, and the unit changes at
    # the split — specimens before AllPrep, aliquots after. The analysis and
    # tumour-board columns are specimens again, so they must be counted as
    # specimens, not by summing the three aliquot streams.
    analysed_specimens = session.scalar(
        select(func.count(func.distinct(Aliquot.specimen_id)))
        .join(PlatformRun, PlatformRun.aliquot_id == Aliquot.id)
        .where(PlatformRun.returned_on.is_not(None))) or 0

    # A specimen that has not moved on is not the same thing as a stalled one:
    # most of the gap between two stages is work still in the queue. Only the
    # ones past the threshold are flagged, and the chart must not conflate them.
    stalled_total = session.scalar(select(func.count()).select_from(Specimen)
                                   .where(Specimen.stalled_days.is_not(None))) or 0

    return {
        "specimen_stages": specimen_stages,
        "streams": streams,
        "analysis": {"stage": "Data back", "count": analysed_specimens, "unit": "specimens"},
        "stalled": stalled_total,
        "stall_threshold_days": config.STALL_THRESHOLD_DAYS,
        "mtb": {"stage": "MTB Portal", "count": at_least("mtb"), "unit": "specimens"},
        "specimen_unit": "specimens", "aliquot_unit": "aliquots",
        "note": ("Counts are specimens up to AllPrep and aliquots after; one specimen yields "
                 "up to three. The protein stream is QC'd after its mass-spec run, not before."),
    }


def sample_types(session: Session) -> list[dict]:
    """What the cohort is made of, by sample type.

    Specimen counts and aliquot counts are both returned because they answer
    different questions and can disagree sharply: a type can be a large share of
    the cohort while contributing very little downstream material. Showing only
    one of the two hides that.
    """
    specimens = dict(session.execute(
        select(Specimen.sample_type, func.count())
        .group_by(Specimen.sample_type)).all())
    aliquots = dict(session.execute(
        select(Specimen.sample_type, func.count(Aliquot.id))
        .join(Aliquot, Aliquot.specimen_id == Specimen.id)
        .group_by(Specimen.sample_type)).all())

    total_specimens = sum(specimens.values()) or 1
    total_aliquots = sum(aliquots.values()) or 1

    rows = []
    for sample_type, count in sorted(specimens.items(), key=lambda kv: -kv[1]):
        extracted = aliquots.get(sample_type, 0)
        rows.append({
            "type": sample_type or "unknown",
            "specimens": count,
            "specimen_share": round(count / total_specimens * 100, 1),
            "aliquots": extracted,
            "aliquot_share": round(extracted / total_aliquots * 100, 1),
        })
    return rows


def qc_by_sample_type(session: Session) -> dict:
    rows = session.execute(
        select(Specimen.sample_type, Aliquot.molecule, Aliquot.qc_outcome, func.count())
        .join(Aliquot, Aliquot.specimen_id == Specimen.id)
        .where(Aliquot.qc_outcome.is_not(None))
        .group_by(Specimen.sample_type, Aliquot.molecule, Aliquot.qc_outcome)).all()

    out: dict[str, dict[str, dict[str, int]]] = {}
    for sample_type, molecule, outcome, count in rows:
        out.setdefault(sample_type or "unknown", {}).setdefault(
            molecule, {"Pass": 0, "Fail": 0})[outcome] = count
    return out


def _gap(a: date | None, b: date | None) -> float | None:
    if not a or not b:
        return None
    return (b - a).days


def turnaround(session: Session) -> dict:
    """How long a sample takes from surgery to its order in the tumour board portal,
    and where the time goes.

    Turnaround is a headline endpoint for a feasibility study of this kind, so the
    question this answers is "39 days — and which part is ours?".

    Two things the previous shape got wrong and this one is built around:

      * The three analysis labs run in PARALLEL on three fractions of one specimen.
        Listing them as rows invites adding them up, which is simply wrong. They
        are one segment of the path, measured per specimen from the first
        dispatch to the last result — the real critical path, not a max of
        medians.
      * Time is grouped by the three phases laboratory medicine already uses for
        turnaround — pre-analytical, analytical, post-analytical. That is the
        conventional vocabulary, it maps cleanly onto these steps, and it keeps
        the distinction that matters: the analytical phase belongs to the
        analysis labs, the other two are handled in house.
    """
    activity_dates: dict[int, dict[str, date]] = {}
    for specimen_id, kind, when in session.execute(
            select(Activity.specimen_id, Activity.kind, Activity.performed_on)
            .where(Activity.performed_on.is_not(None))).all():
        if specimen_id is None:
            continue
        slot = activity_dates.setdefault(specimen_id, {})
        if kind not in slot or when < slot[kind]:
            slot[kind] = when

    collected = dict(session.execute(select(Specimen.id, Specimen.collected_on)).all())

    first_sent = dict(session.execute(
        select(Aliquot.specimen_id, func.min(PlatformRun.sent_on))
        .join(PlatformRun, PlatformRun.aliquot_id == Aliquot.id)
        .where(PlatformRun.sent_on.is_not(None))
        .group_by(Aliquot.specimen_id)).all())
    last_returned = dict(session.execute(
        select(Aliquot.specimen_id, func.max(PlatformRun.returned_on))
        .join(PlatformRun, PlatformRun.aliquot_id == Aliquot.id)
        .where(PlatformRun.returned_on.is_not(None))
        .group_by(Aliquot.specimen_id)).all())

    def prep_date(slot: dict[str, date]) -> date | None:
        return slot.get("cryoprep") or slot.get("sectioning")

    def measure(pairs: list[tuple[date | None, date | None]]) -> dict:
        gaps = [g for g in (_gap(a, b) for a, b in pairs) if g is not None and g >= 0]
        return {"n": len(gaps), "median_days": _median(gaps),
                "p90_days": _percentile(gaps, 0.9)}

    ids = list(activity_dates)
    slot_of = activity_dates

    segments = [
        {"key": "surgery_pathology", "label": "Surgery → pathology",
         "owner": "in_house", "phase": "pre_analytical",
         "detail": "The specimen reaches pathology the same day it is taken.",
         **measure([(collected.get(i), slot_of[i].get("pathology")) for i in ids])},
        {"key": "at_pathology", "label": "Held at pathology",
         "owner": "in_house", "phase": "pre_analytical",
         "detail": "Cut, racked and frozen, then waiting to be collected for prep.",
         **measure([(slot_of[i].get("pathology"), prep_date(slot_of[i])) for i in ids])},
        {"key": "prep", "label": "Prep → extraction",
         "owner": "in_house", "phase": "pre_analytical",
         "detail": "Cryoprep or sectioning, then the AllPrep co-extraction.",
         **measure([(prep_date(slot_of[i]), slot_of[i].get("allprep")) for i in ids])},
        {"key": "dispatch", "label": "QC → dispatched",
         "owner": "in_house", "phase": "pre_analytical",
         "detail": "Concentration and QC, then the first fraction leaves for an analysis lab.",
         **measure([(slot_of[i].get("allprep"), first_sent.get(i)) for i in ids])},
        {"key": "analysis_labs", "label": "At the analysis labs",
         "owner": "analysis_lab", "phase": "analytical", "parallel": True,
         "detail": "Three fractions analysed at the same time. Measured per specimen "
                   "from the first dispatch to the last result, so this is the real "
                   "critical path rather than the sum of three waits.",
         **measure([(first_sent.get(i), last_returned.get(i)) for i in ids])},
        {"key": "tumour_board", "label": "Results → MTB Portal",
         "owner": "in_house", "phase": "post_analytical",
         "detail": "Data analysed, then the case is ordered in the Molecular Tumor Board Portal.",
         **measure([(last_returned.get(i), slot_of[i].get("mtb")) for i in ids])},
    ]

    # the individual analysis labs, shown inside the parallel segment rather
    # than as peers of the sequential steps
    analysis_labs = []
    for facility_id, name in session.execute(select(Facility.id, Facility.name)).all():
        rows = session.execute(
            select(PlatformRun.turnaround_days, PlatformRun.sent_on, PlatformRun.returned_on)
            .where(PlatformRun.facility_id == facility_id)).all()
        if not rows:
            continue
        gaps = []
        for days, sent_on, returned_on in rows:
            if days is not None:
                gaps.append(days)
            else:
                gap = _gap(sent_on, returned_on)
                if gap is not None and gap >= 0:
                    gaps.append(gap)
        if gaps:
            analysis_labs.append({"name": name, "n": len(gaps), "median_days": _median(gaps),
                              "p90_days": _percentile(gaps, 0.9)})
        else:
            # the mass spec runs in house: a returned date, but nothing was sent,
            # so there is no handover to time. Say so rather than omit the row.
            analysis_labs.append({"name": name, "n": len(rows), "median_days": None,
                              "p90_days": None,
                              "note": "no send date recorded — cannot be measured"})

    end_to_end = measure([(collected.get(i), slot_of[i].get("mtb")) for i in ids])

    def phase_total(name: str) -> float:
        return round(sum(s["median_days"] or 0 for s in segments if s["phase"] == name), 1)

    phases = [
        {"key": "pre_analytical", "label": "Pre-analytical", "where": "in house",
         "days": phase_total("pre_analytical")},
        {"key": "analytical", "label": "Analytical", "where": "at the analysis labs",
         "days": phase_total("analytical")},
        {"key": "post_analytical", "label": "Post-analytical", "where": "in house",
         "days": phase_total("post_analytical")},
    ]

    return {
        "end_to_end": end_to_end,
        "segments": segments,
        "analysis_labs": analysis_labs,
        "phases": phases,
        "in_house_days": round(phase_total("pre_analytical")
                               + phase_total("post_analytical"), 1),
        "analysis_lab_days": phase_total("analytical"),
        "note": ("Medians do not add: the median of the whole path is not the sum of the "
                 "medians of its parts, so the segments will not total the headline figure."),
        # kept so nothing else breaks while it is still referenced
        "collection_to_mtb": end_to_end,
    }


def attention(session: Session, limit: int = 40) -> list[dict]:
    """Every specimen with no next step past the threshold — the daily to-do list."""
    rows = session.execute(
        select(Specimen, Patient.label)
        .join(Patient, Patient.id == Specimen.patient_id)
        .where(Specimen.stalled_days.is_not(None))
        .order_by(Specimen.stalled_days.desc()).limit(limit)).all()

    out = []
    for specimen, patient_label in rows:
        aliquots = session.scalars(
            select(Aliquot).where(Aliquot.specimen_id == specimen.id)).all()
        failed = [a.molecule for a in aliquots if a.qc_outcome == "Fail"]
        waiting_on: list[str] = []
        if not aliquots:
            waiting_on.append("processing")
        else:
            for aliquot in aliquots:
                has_run = session.scalar(select(func.count()).select_from(PlatformRun)
                                         .where(PlatformRun.aliquot_id == aliquot.id)) or 0
                if not has_run and aliquot.qc_outcome != "Fail":
                    waiting_on.append(aliquot.molecule.lower())
        out.append({
            "specimen_id": specimen.id, "record_id": specimen.record_id,
            "study_id": patient_label, "sample_type": specimen.sample_type,
            "stage_reached": specimen.stage_reached,
            "days_since_last_step": specimen.stalled_days,
            "waiting_on": sorted(set(waiting_on)) or ["processing"],
            "failed": failed,
        })
    return out
