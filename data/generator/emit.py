"""Writes the simulation out as a REDCap CSV export.

REDCap's export format is not a plain table of the dictionary's fields:
  * checkbox fields become one 0/1 column per choice, named field___code;
  * radio, dropdown and yesno fields carry the choice *code*, not its label;
  * descriptive fields store nothing and do not appear at all;
  * each instrument contributes a <form>_complete status column.

Reproducing those quirks here is deliberate. The builder has to unpick them,
which is the same work the production ingester will do against the live export.
"""

import csv

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
import dictionary as D

# Not in the data dictionary. The summary instrument pipes [date_spec] for the
# Spectronaut step but the field is defined nowhere, so a faithful export cannot
# contain it. We generate it and append it as a clearly separate column.
DECLARED_ADDITIONS = ["date_spec"]


def _encode(dic: D.Dictionary, name: str, value) -> dict:
    """One domain value -> the column(s) and code(s) REDCap would export."""
    f = dic.get(name)

    if f.is_checkbox:
        selected = {dic.choice_code(name, label) for label in value}
        return {f"{name}___{code}": ("1" if code in selected else "0")
                for code in f.choices}

    if f.type in ("radio", "dropdown"):
        return {name: dic.choice_code(name, value)}

    if f.type == "yesno":
        return {name: "1" if value else "0"}

    return {name: str(value)}


def record_row(dic: D.Dictionary, specimen) -> dict:
    """Build one export row, including the per-instrument _complete columns."""
    row = {}
    for name, value in specimen.values.items():
        if name in DECLARED_ADDITIONS:
            row[name] = str(value)
            continue
        row.update(_encode(dic, name, value))

    # Checkbox fields that were never touched still export as all-zero columns,
    # which is what REDCap does -- an unchecked box is 0, not blank.
    for f in dic.fields:
        if f.is_checkbox and f.name not in specimen.values:
            for code in f.choices:
                row.setdefault(f"{f.name}___{code}", "0")

    for form in dic.forms:
        row[f"{form}_complete"] = _form_status(dic, form, specimen)
    return row


def _form_status(dic: D.Dictionary, form: str, specimen) -> str:
    """An instrument is Complete once it holds data, Incomplete otherwise.

    The summary instrument stores nothing of its own, so it is marked complete
    once the record has data to display -- which is what a coordinator stepping
    through the form would leave behind.
    """
    if form == "summary":
        return (D.COMPLETE_COMPLETE if specimen.has("allprep")
                else D.COMPLETE_INCOMPLETE)
    names = {f.name for f in dic.fields if f.form == form and not f.is_descriptive}
    has_data = any(n in specimen.values for n in names)
    return D.COMPLETE_COMPLETE if has_data else D.COMPLETE_INCOMPLETE


def write_export(dic: D.Dictionary, specimens, path):
    header = dic.export_header() + DECLARED_ADDITIONS
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=header, restval="", extrasaction="raise")
        w.writeheader()
        for s in sorted(specimens, key=lambda x: x.record_id):
            w.writerow(record_row(dic, s))
    return header
