"""Reads the REDCap data dictionary and derives the shape of an export.

The dictionary is the contract. The column list, the checkbox expansion and the
set of fields that carry no data are all derived from it rather than hard-coded,
so a newer dictionary changes the export without changing this code.
"""

import csv
from dataclasses import dataclass, field
from pathlib import Path

DICTIONARY_PATH = (
    Path(__file__).resolve().parents[1]
    / "reference"
    / "TESTPMSampleCentral_DataDictionary_2026-07-09.csv"
)

COMPLETE_INCOMPLETE, COMPLETE_UNVERIFIED, COMPLETE_COMPLETE = "0", "1", "2"


@dataclass
class Field:
    name: str
    form: str
    type: str
    label: str
    choices: dict
    validation: str
    branching: str
    annotation: str

    @property
    def is_checkbox(self) -> bool:
        return self.type == "checkbox"

    @property
    def is_descriptive(self) -> bool:
        """Descriptive fields display text; REDCap stores nothing for them."""
        return self.type == "descriptive"

    def export_columns(self) -> list:
        """The column name(s) this field occupies in a REDCap CSV export."""
        if self.is_descriptive:
            return []
        if self.is_checkbox:
            return [f"{self.name}___{code}" for code in self.choices]
        return [self.name]


@dataclass
class Dictionary:
    fields: list = field(default_factory=list)

    def __post_init__(self):
        self.by_name = {f.name: f for f in self.fields}
        self.forms = []
        for f in self.fields:
            if f.form not in self.forms:
                self.forms.append(f.form)

    def get(self, name: str) -> Field:
        return self.by_name[name]

    def choice_code(self, name: str, label: str) -> str:
        """Look a choice code up by its label, so the simulation can speak in
        words ('Fresh-Frozen') while the export carries REDCap's codes."""
        f = self.get(name)
        for code, text in f.choices.items():
            if text == label:
                return code
        raise KeyError(f"{name} has no choice labelled {label!r}")

    def export_header(self) -> list:
        """Full column list of a REDCap CSV export, in dictionary order, with
        each instrument's _complete field appended after its last field."""
        cols, seen_forms = [], []
        for f in self.fields:
            if f.form not in seen_forms:
                if seen_forms:
                    cols.append(f"{seen_forms[-1]}_complete")
                seen_forms.append(f.form)
            cols.extend(f.export_columns())
        if seen_forms:
            cols.append(f"{seen_forms[-1]}_complete")
        return cols


def _parse_choices(raw: str) -> dict:
    """'1, Female | 2, Male' -> {'1': 'Female', '2': 'Male'}"""
    out = {}
    if not raw.strip():
        return out
    for part in raw.split("|"):
        part = part.strip()
        if not part or "," not in part:
            continue
        code, label = part.split(",", 1)
        out[code.strip()] = label.strip()
    return out


def load(path: Path = DICTIONARY_PATH) -> Dictionary:
    fields = []
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            ftype = row["Field Type"].strip()
            raw_choices = row["Choices, Calculations, OR Slider Labels"]
            fields.append(
                Field(
                    name=row["Variable / Field Name"].strip(),
                    form=row["Form Name"].strip(),
                    type=ftype,
                    label=row["Field Label"].strip(),
                    choices=_parse_choices(raw_choices) if ftype in
                            ("radio", "checkbox", "dropdown") else {},
                    validation=row["Text Validation Type OR Show Slider Number"].strip(),
                    branching=row["Branching Logic (Show field only if...)"].strip(),
                    annotation=row["Field Annotation"].strip(),
                )
            )
    return Dictionary(fields)


if __name__ == "__main__":
    d = load()
    header = d.export_header()
    print(f"{len(d.fields)} fields across {len(d.forms)} instruments")
    print(f"{len(header)} export columns")
    print("checkbox:", [f.name for f in d.fields if f.is_checkbox])
    print("descriptive (not exported):", [f.name for f in d.fields if f.is_descriptive])
