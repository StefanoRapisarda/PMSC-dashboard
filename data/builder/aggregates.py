"""Stage three: the counting layer the dashboard reads.

Counting questions are served from the tables, not from the graph. The unit
being counted changes at AllPrep and is labelled explicitly: specimens before
the split, aliquots after, because one specimen becomes up to four aliquots.
"""

from collections import Counter, defaultdict
from datetime import date
from statistics import median

from graph import STAGES, GraphBuilder

# The stage strip, in order, with the unit each stage counts.
FLOW = [
    ("Collected", "specimens"), ("Pathology", "specimens"),
    ("PM-SC prep", "specimens"), ("AllPrep", "specimens"),
    ("QC pass", "aliquots"), ("Submitted", "aliquots"),
    ("Data back", "aliquots"), ("MTB", "specimens"),
]

# AllPrep yields three fractions. The peptide digest is the protein fraction
# after SP3, not a fourth aliquot, so it is counted inside the protein stream;
# it stays a separate node in the graph for provenance.
MOLECULES = [
    ("DNA", "qc_dna", "send_dna", "datafrom_cg"),
    ("RNA", "qc_rna", "send_rna", "receive_rna"),
    ("Protein", "ms_qcheck", "sp3_digestion", "date_spec"),
]


def _qc_value(s, field):
    v = s.get(field)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def build(patients, samples, as_of: date, stall_threshold: int = 30) -> dict:
    gb = GraphBuilder(as_of, stall_threshold)
    _GB[0] = gb
    by_study = {p["study_id"]: p for p in patients}
    collected = [s for s in samples if s.get("sample_date")]

    for s in samples:
        s["_stage"] = gb.stage_of(s)
        s["_stalled_days"] = gb.stalled_days(s, by_study.get(s["study_id"], {}))

    return {
        "as_of": as_of.isoformat(),
        "stall_threshold_days": stall_threshold,
        "kpis": _kpis(patients, samples, collected),
        "flow": _flow(collected),
        "qc_by_sample_type": _qc_by_type(collected),
        "turnaround": _turnaround(collected),
        "stage_distribution": _stage_distribution(samples),
        "attention": _attention(samples, by_study),
        "operators": _operators(collected),
        "enrollment_by_month": _enrollment(patients),
    }


def _aliquot_rows(collected):
    """One entry per aliquot: (sample_row, molecule, qc, sent, returned)."""
    for s in collected:
        if not s.get("allprep_date_v2"):
            continue
        for mol, qc_f, send_f, back_f in MOLECULES:
            if mol == "RNA" and not s.get("pmscid_rna"):
                continue
            if mol == "Protein" and not s.get("protein_date"):
                continue
            if mol == "DNA" and not s.get("pmscid_dna"):
                continue
            yield s, mol, _qc_value(s, qc_f), s.get(send_f), s.get(back_f)


def _kpis(patients, samples, collected):
    aliquots = list(_aliquot_rows(collected))
    resolved = [a for a in aliquots if a[2] in ("Pass", "Fail")]
    passed = [a for a in resolved if a[2] == "Pass"]

    with_data = {s["record_id"] for s, _, _, _, back in aliquots if back}
    stalled = [s for s in samples if s.get("_stalled_days")]
    # Blood taken for the biobank never enters the omics pipeline, so including
    # it in the denominator understates throughput. Both are reported.
    in_pipeline = [s for s in collected if s.get("pmsc_id")]
    by_mol = Counter(mol for _, mol, _, _, _ in aliquots)

    return {
        "patients_enrolled": len(patients),
        "specimens_collected": len(collected),
        "aliquots": len(aliquots),
        "aliquots_by_molecule": dict(by_mol),
        "qc_pass_rate": round(100 * len(passed) / len(resolved), 1) if resolved else None,
        "qc_resolved": len(resolved),
        "reached_data_back_pct": round(100 * len(with_data) / len(collected), 1)
                                 if collected else None,
        "specimens_with_data_back": len(with_data),
        "reached_data_back_pct_in_pipeline": round(
            100 * len(with_data) / len(in_pipeline), 1) if in_pipeline else None,
        "specimens_in_pipeline": len(in_pipeline),
        "stalled": len(stalled),
    }


def _flow(collected):
    """The Sankey source.

    Specimens flow as specimens up to AllPrep, then split into three aliquot
    streams. Each stream carries its own stage order, because the streams are
    not gated the same way: DNA and RNA are QC'd before submission, while the
    protein fraction is digested and run first and its QC is the mass-spec
    check afterwards. Forcing all three onto one strip would put the protein
    stream's QC in the wrong place.
    """
    idx = {name: i for i, name in enumerate(STAGES)}

    def reached(s, stage):
        return idx[s["_stage"]] >= idx[stage]

    specimen_stages = [
        {"stage": "Collected", "count": len(collected)},
        {"stage": "Pathology",
         "count": sum(1 for s in collected if reached(s, "pathology"))},
        {"stage": "PM-SC prep",
         "count": sum(1 for s in collected if reached(s, "pmsc_prep"))},
        {"stage": "AllPrep",
         "count": sum(1 for s in collected if reached(s, "allprep"))},
    ]

    counts = defaultdict(Counter)
    for s, mol, qc, sent, back in _aliquot_rows(collected):
        counts[mol]["created"] += 1
        if qc == "Pass":
            counts[mol]["qc_pass"] += 1
        elif qc == "Fail":
            counts[mol]["qc_fail"] += 1
        if sent:
            counts[mol]["submitted"] += 1
        if back:
            counts[mol]["data_back"] += 1

    def chain(mol, order):
        c = counts[mol]
        return {
            "qc_position": "before_submission" if order[1] == "qc_pass" else "after_run",
            "qc_fail": c["qc_fail"],
            "chain": [{"stage": label, "count": c[key]} for key, label in order[2]],
        }

    streams = {
        "DNA": chain("DNA", ("", "qc_pass", [
            ("created", "Extracted"), ("qc_pass", "QC passed"),
            ("submitted", "Submitted to Clinical Genomics"),
            ("data_back", "Data returned")])),
        "RNA": chain("RNA", ("", "qc_pass", [
            ("created", "Extracted"), ("qc_pass", "QC passed"),
            ("submitted", "Submitted to Genomics Express"),
            ("data_back", "Data returned")])),
        "Protein": chain("Protein", ("", "submitted", [
            ("created", "Extracted"), ("submitted", "Digested and run"),
            ("qc_pass", "MS QC passed"), ("data_back", "Data returned")])),
    }

    return {
        "specimen_stages": specimen_stages,
        "specimen_unit": "specimens",
        "aliquot_unit": "aliquots",
        "streams": streams,
        "mtb": {"stage": "Tumour board",
                "unit": "specimens",
                "count": sum(1 for s in collected if reached(s, "mtb"))},
        "note": ("Counts are specimens up to AllPrep and aliquots after; one "
                 "specimen yields up to three aliquots. The protein stream is "
                 "QC'd after its mass-spec run, not before submission."),
    }


def _qc_by_type(collected):
    out = defaultdict(lambda: defaultdict(Counter))
    for s, mol, qc, _, _ in _aliquot_rows(collected):
        types = s.get("sample_type") or []
        kind = ("Blood" if "Blood" in types else "FFPE" if "FFPE" in types
                else "Biopsy" if "Biopsy" in types else "Tissue")
        if qc in ("Pass", "Fail"):
            out[kind][mol][qc] += 1
    return {k: {m: dict(c) for m, c in v.items()} for k, v in out.items()}


def _turnaround(collected):
    """Hands-on time and platform waiting reported separately: a single long bar
    would read as inefficiency when most of it is a platform queue."""
    hands_on, waiting = defaultdict(list), defaultdict(list)

    def days(a, b):
        if a and b:
            return (date.fromisoformat(b) - date.fromisoformat(a)).days

    for s in collected:
        for label, a, b in [
            ("Collection to pathology", s.get("sample_date"), s.get("pat_sample_date")),
            ("Pathology to PM-SC prep", s.get("pat_sample_date"),
             s.get("prep_sectioning_date") or s.get("pmsc_cryoprep_date")),
            ("PM-SC prep to AllPrep",
             s.get("prep_sectioning_date") or s.get("pmsc_cryoprep_date"),
             s.get("allprep_date_v2")),
            ("AllPrep to submission", s.get("allprep_date_v2"),
             s.get("send_dna") or s.get("send_rna")),
        ]:
            d = days(a, b)
            if d is not None and d >= 0:
                hands_on[label].append(d)

        for label, a, b in [
            ("DNA at Clinical Genomics", s.get("send_dna"), s.get("datafrom_cg")),
            ("RNA at Genomics Express", s.get("send_rna"), s.get("receive_rna")),
            ("Peptide at Clinical Proteomics", s.get("sp3_digestion"), s.get("date_spec")),
            ("Data back to tumour board", _latest_back(s), s.get("order_date")),
        ]:
            d = days(a, b)
            if d is not None and d >= 0:
                waiting[label].append(d)

    def stats(d):
        return [{"step": k, "n": len(v), "median_days": median(v),
                 "p90_days": sorted(v)[max(0, int(len(v) * 0.9) - 1)]}
                for k, v in d.items() if v]

    total = [d for s in collected
             if (d := _days(s.get("sample_date"), s.get("order_date"))) is not None]
    return {
        "hands_on": stats(hands_on),
        "waiting": stats(waiting),
        "collection_to_mtb": {"n": len(total),
                              "median_days": median(total) if total else None,
                              "p90_days": sorted(total)[max(0, int(len(total)*0.9)-1)]
                                          if total else None},
    }


def _latest_back(s):
    backs = [s.get(f) for f in ("datafrom_cg", "receive_rna", "date_spec") if s.get(f)]
    return max(backs) if backs else None


def _days(a, b):
    if a and b:
        return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _stage_distribution(samples):
    """Includes consented patients with no specimen yet, which is why this runs
    over every record rather than only the collected ones."""
    c = Counter(s["_stage"] for s in samples)
    return [{"stage": st, "count": c.get(st, 0)} for st in STAGES]


_GB = [None]   # the GraphBuilder for this build, so nothing reads the clock


def _attention(samples, by_study):
    """The daily action list: everything still expected to move that has not."""
    items = []
    for s in samples:
        d = s.get("_stalled_days")
        if not d:
            continue
        items.append({
            "record_id": s["record_id"],
            "study_id": s["study_id"],
            "pmsc_id": s.get("pmsc_id"),
            "pad_number": s.get("pat_sample_id_1"),
            "sample_type": (s.get("sample_type") or [None])[0],
            "stage_reached": s["_stage"],
            "days_since_last_step": d,
            "waiting_on": _GB[0].open_streams(s),
        })
    return sorted(items, key=lambda x: -x["days_since_last_step"])


def _operators(collected):
    fields = ["prep_sectioning_sign", "prep_cryoprep_sign", "allprep_operator",
              "prot_extr_operator", "prot_extr_operator_2", "prot_extr_operator_3"]
    c = Counter()
    for s in collected:
        for f in fields:
            if s.get(f):
                c[s[f]] += 1
    return [{"hsa_id": k, "steps": v} for k, v in c.most_common()]


def _enrollment(patients):
    c = Counter(p["res_sub_enroll_date"][:7] for p in patients
                if p.get("res_sub_enroll_date"))
    return [{"month": m, "patients": n} for m, n in sorted(c.items())]
