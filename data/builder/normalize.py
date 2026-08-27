"""Stage one of the build: a REDCap export becomes normalized tables.

The export is record-per-specimen, so every one of a patient's records repeats
that patient's enrollment fields. This stage undoes that: it decodes REDCap's
codes back to labels, groups records by study_id, and emits

    patients.csv   one row per patient
    samples.csv    one row per specimen, referencing study_id

Nothing downstream reads the raw export. Swapping synthetic data for a live
REDCap export is a change of input to this file and nothing else.
"""

import csv
import sys
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
import dictionary as D

# Fields belonging to the patient rather than the specimen. Repeated on every
# record of that patient in a record-per-specimen project.
PATIENT_FIELDS = [
    "study_id", "res_sub_consent", "res_sub_date_birth", "res_sub_enroll_date",
    "res_sub_name", "res_sub_email", "res_sub_sex", "res_sub_exactage",
    "other_studies",
]


class ConflictError(Exception):
    pass


def decode_row(dic: D.Dictionary, row: dict) -> dict:
    """REDCap's export codes -> readable values.

    Checkbox columns collapse back into a list of chosen labels; radio and
    dropdown codes become their labels; yesno becomes a bool.
    """
    out = {}
    for f in dic.fields:
        if f.is_descriptive:
            continue
        if f.is_checkbox:
            chosen = [label for code, label in f.choices.items()
                      if row.get(f"{f.name}___{code}") == "1"]
            out[f.name] = chosen
        elif f.type in ("radio", "dropdown"):
            code = (row.get(f.name) or "").strip()
            out[f.name] = f.choices.get(code) if code else None
        elif f.type == "yesno":
            val = (row.get(f.name) or "").strip()
            out[f.name] = None if val == "" else (val == "1")
        else:
            val = (row.get(f.name) or "").strip()
            out[f.name] = val or None

    for form in dic.forms:
        col = f"{form}_complete"
        out[col] = row.get(col, "")
    # Columns present in the export but absent from the dictionary are carried
    # through unchanged; see data/README.md, "Declared deviations".
    known = set(out) | {c for f in dic.fields for c in f.export_columns()} | \
            {f"{form}_complete" for form in dic.forms}
    for col, val in row.items():
        if col not in known:
            out[col] = (val or "").strip() or None
    out["record_id"] = row["record_id"]
    return out


def collapse_patient(rows: list, strict: bool = True) -> dict:
    """One patient's repeated enrollment fields -> a single row.

    Values are expected to agree across a patient's records. If they do not,
    that is a data-quality problem in the source and is reported rather than
    silently resolved.
    """
    patient, conflicts = {}, []
    for f in PATIENT_FIELDS:
        values = {r.get(f) for r in rows}
        values.discard(None)
        if len(values) > 1:
            conflicts.append((f, sorted(str(v) for v in values)))
            patient[f] = sorted(values)[0]
        else:
            patient[f] = values.pop() if values else None
    if conflicts and strict:
        raise ConflictError(
            f"{rows[0].get('study_id')}: {conflicts}")
    patient["_conflicts"] = conflicts
    patient["record_count"] = len(rows)
    return patient


def normalize(export_path: Path, dic: D.Dictionary = None):
    dic = dic or D.load()
    with open(export_path, encoding="utf-8", newline="") as fh:
        raw = list(csv.DictReader(fh))

    decoded = [decode_row(dic, r) for r in raw]

    by_patient = OrderedDict()
    for r in decoded:
        by_patient.setdefault(r["study_id"], []).append(r)

    patients, conflicts = [], []
    for sid, rows in by_patient.items():
        p = collapse_patient(rows, strict=False)
        if p["_conflicts"]:
            conflicts.append((sid, p["_conflicts"]))
        patients.append(p)

    # Specimen rows keep everything that is not a patient field.
    sample_fields = [f.name for f in dic.fields
                     if not f.is_descriptive and f.name not in PATIENT_FIELDS
                     and f.name != "record_id"]
    extra = [c for c in decoded[0] if c not in sample_fields
             and c not in PATIENT_FIELDS
             and c not in ("record_id",)
             and not c.endswith("_complete")]
    samples = []
    for r in decoded:
        s = {"record_id": r["record_id"], "study_id": r["study_id"]}
        for f in sample_fields + extra:
            s[f] = r.get(f)
        for form in dic.forms:
            s[f"{form}_complete"] = r.get(f"{form}_complete")
        samples.append(s)

    return patients, samples, conflicts


def _csv_value(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, list):
        return "|".join(v)
    return str(v)


def write_tables(patients, samples, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    pcols = [c for c in patients[0] if c != "_conflicts"]
    with open(out_dir / "patients.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(pcols)
        for p in patients:
            w.writerow([_csv_value(p[c]) for c in pcols])
    scols = list(samples[0].keys())
    with open(out_dir / "samples.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(scols)
        for s in samples:
            w.writerow([_csv_value(s[c]) for c in scols])
