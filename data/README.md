# Synthetic data generation — PM-SC Dashboard

Everything the showcase displays is generated here, from the REDCap data
dictionary (`TESTPMSampleCentral_DataDictionary_2026-07-09.csv`, 124 fields
across 8 instruments).

**No real patient or sample data is used anywhere in this pipeline.** Names,
identifiers, dates, measurements and free text are all generated.

---

## Contents

- [Quick start](#quick-start) · [Layout](#layout) · [The pipeline](#the-pipeline)
- [How generation works](#how-generation-works) — the simulation, step by step
- [What the export looks like](#what-the-export-looks-like) — REDCap's quirks
- [The builder](#the-builder) — normalize, graph, aggregates
- [Output schemas](#output-schemas)
- [Tuning the dataset](#tuning-the-dataset)
- [Working with a real export](#working-with-a-real-export)
- [Extending it](#extending-it)
- [Design decisions](#design-decisions) · [Cohort as generated](#cohort-as-generated)
- [Declared deviations](#declared-deviations) · [Verification](#verification)

---

## Quick start

```bash
python3 generator/generate.py     # -> out/redcap_export.csv, out/manifest.json
python3 builder/build.py          # -> out/*.csv, out/*.json, ../web/static/data/*.json
```

No dependencies beyond the Python standard library. The seed is fixed in
`generator/config.py`, so the same config always produces byte-identical output —
verify with `md5 out/redcap_export.csv` across two runs.

Useful flags:

```bash
python3 generator/generate.py --out /tmp/scratch
python3 builder/build.py --export path/to/other_export.csv --as-of 2026-11-01
python3 builder/build.py --stall-threshold 45
python3 common/dictionary.py      # print the dictionary's shape and export columns
```

## Layout

```
common/dictionary.py     reads the REDCap dictionary; used by both stages
reference/               vendored copy of the dictionary the dataset was built from
generator/
  config.py              every tunable number, and the seed
  model.py               the simulation: patients, specimens, timelines, QC
  emit.py                turns the simulation into a REDCap-shaped CSV
  generate.py            CLI; writes the export and manifest.json
builder/
  normalize.py           export -> patients.csv + samples.csv
  graph.py               normalized tables -> graph.json
  aggregates.py          normalized tables -> aggregates.json
  build.py               CLI; runs all three stages
out/                     export, intermediates, readable copies      (gitignored)
../web/static/data/      graph.json, aggregates.json                 (committed)
```

The frontend artifacts are committed so a fresh clone runs the demo without a
Python toolchain. They are written compact for the browser; readable copies with
the same content live in `out/`.

## The pipeline

```
generator  ->  redcap_export.csv  ->  normalize  ->  patients.csv
                                                     samples.csv
                                                        |
                                                        +-> graph.json
                                                        +-> aggregates.json
```

The generator emits a genuine REDCap export rather than the finished artifacts.
That costs an extra stage and buys the thing the architecture depends on: the
builder that turns an export into the dashboard's data exists and is exercised
every run. Pointing it at a live REDCap export is a change of input to
`builder/build.py`, not a redesign.

---

## How generation works

`generator/model.py` runs six phases, in this order. The order matters: each
phase depends on the one before it.

### 1. Patients

100 patients, enrolled evenly across the window with a few days of jitter, so
the cohort ends up spread across pipeline stages rather than bunched. Age is
drawn from a normal distribution centred on 68 and clipped to 45–88; sex is 55%
male. Both are appropriate for NSCLC. Date of birth is derived backwards from
age and enrollment date, so `res_sub_exactage` reproduces the dictionary's own
calculation.

### 2. Specimens

The most recently enrolled patients have consented but not yet been operated on;
they get a record with only the enrollment instrument filled. Everyone else gets
a tissue specimen, and most also give blood at the same surgery.

Composition is assigned **by quota, not by a coin flip per specimen**. With 95
draws, a 40% probability lands anywhere from 32 to 46 FFPE specimens, and the
cohort mix is a stated property of this dataset — it should match `config.py`
exactly rather than approximately. So the generator builds a list of the right
length, shuffles it, and deals it out.

### 3. The ideal timeline

Each specimen is given a **complete** timeline first, as though nothing ever went
wrong and the snapshot date did not exist: collection, pathology receipt, PM-SC
preparation, AllPrep, QC, submission to each analysis lab, data return, tumour board.
Each step is offset from the one before it by a range taken from the PreDDLung
journey in `docs/domain-brief.md` §5.

QC outcomes are decided in this phase too, because the rest of the timeline
depends on them — a failed aliquot is never submitted, so it has no send or
return date. **Outcome and concentration are decided together**, so the two
agree: an aliquot that failed QC has a low yield, and the numbers would survive
someone plotting them.

### 4. Truncation

This is where the dataset gets its shape. Two independent mechanisms cut the
ideal timeline back:

**By the snapshot date.** Any milestone that falls after `AS_OF` has not
happened yet and is dropped. This is what spreads the cohort across stages: a
patient enrolled 18 months ago is finished, one enrolled last month is still
waiting on an analysis lab, one enrolled last week has nothing but a record.

**By a forced stall.** Twelve specimens are picked to stop at a chosen stage and
stay there. Candidates are filtered so the last recorded step lands between
`STALL_MIN_DAYS` and `STALL_MAX_DAYS` before the snapshot — old enough to count
as stalled, recent enough to be a live problem rather than an abandoned one. The
twelve are spread across five stages so the attention list is not all one kind
of problem.

One constraint is worth knowing about: a **blood specimen is never stalled before
PM-SC registration**, because such a stall would be undetectable downstream.
Nothing in the export records that a blood tube was earmarked for extraction
rather than the biobank, so a blood specimen stuck at pathology is
indistinguishable from one correctly biobanked. See
`../decisions_on_dataset_variables.md` §8 — this is a real gap in the eCRF.

### 5. Repeat records

An aliquot that failed QC with the action *Repeat analysis* is re-run on
leftover material, which is registered at PM-SC as a **new record** with its own
`pmsc_id`, sharing the original's `study_id` and PAD number. The failing record's
`dna_repeat` / `rna_repeat` points at it.

This is the schema's own `REPEAT_OF` edge — the dictionary literally stores *"the
Study ID or PMSC ID used for the repeat analysis"* — and it is why
`leftover_material` and `cryopowder_remain_am` exist as fields.

Repeats usually succeed. The ~15% that fail again are never repeated a second
time, and their fail-action is forced to *Exclude* or *Investigate*, so no record
ever points at a repeat that does not exist.

### 6. Field values

Only now are REDCap field values written, and only for steps that actually
happened. An aliquot extracted but not yet measured has its identifier, elution
volume, buffer and storage location filled, and its concentration, total and QC
outcome empty — because the Qubit measurement is a later step than the
extraction. Getting this wrong makes the `allprep` stage unreachable and the
stalled-at-AllPrep case impossible.

### Identifiers

The cross-system ID chain is deliberately **dissimilar at every handoff**,
because reconciling it is the WP2 deliverable and a chain of lookalike IDs would
demonstrate nothing:

| Identifier | System | Format | Example |
|---|---|---|---|
| `study_id` | eCRF | `PDL-nnnn` | `PDL-0042` |
| `pat_sample_id_1` | Pathology (Sympathy) | PAD number | `K2347-25 3C` |
| `tube_label` | KI Biobank / SMB | flat 10-digit barcode | `4820193756` |
| `pmsc_id` | PM Sample Central | `PMSC-yyyy-nnnn` | `PMSC-2025-0042` |
| `pmscid_dna` / `pmscid_rna` | PM-SC aliquot | `<pmsc_id>-DNA` | `PMSC-2025-0042-DNA` |

Operators are Swedish HSA-IDs (`SE2321000016-nnnn`) drawn from a pool of 10, with
4 enrolling oncologists, so grouping by person is meaningful. Email addresses use
the reserved `.invalid` TLD and can never resolve.

---

## What the export looks like

141 columns, 181 records. It reproduces REDCap's export format rather than a tidy
table, because the builder has to unpick it and the production ingester will face
exactly the same thing:

- **checkbox fields explode** into one `0`/`1` column per choice
  (`sample_type___1` … `sample_type___5`); an unchecked box is `0`, not blank
- **radio, dropdown and yesno fields carry the code**, not the label —
  `res_sub_sex` is `1` or `2`, not `Female` or `Male`
- **descriptive fields store nothing** and do not appear at all; the whole
  `summary` instrument contributes only `summary_complete`
- **each instrument adds a `<form>_complete`** status column (`0` incomplete,
  `2` complete)
- **branching logic leaves whole blocks empty** — the FFPE and fresh-frozen prep
  branches are mutually exclusive, and blood-only fields are absent on tissue
  records

The column list, the checkbox expansion and the set of non-storing fields are all
**derived from the dictionary** by `common/dictionary.py`, not hard-coded. Drop a
newer dictionary into `reference/` and the export shape follows.

---

## The builder

### Stage 1 — `normalize.py`

Decodes REDCap's codes back to labels, groups records by `study_id`, and splits
the record-per-specimen export into two tables:

- `patients.csv` — one row per patient
- `samples.csv` — one row per specimen, referencing `study_id`

Because a patient's enrollment fields are repeated on every one of their records,
this stage collapses those copies. `collapse_patient` compares them and reports
any disagreement rather than silently picking one. The generator plants no
conflicts, but the check is real and runs on every build — point it at a live
export and it will tell you.

**Nothing downstream reads the raw export.** Both later stages consume these
tables, which is what makes the synthetic-to-live switch a change of input.

### Stage 2 — `graph.py`

Builds the labelled, directed provenance graph: 12 node types and 16 edge types,
per `docs/design-decisions.md` §3. The promotion rule is that a field becomes a
node when it is shared, carries its own attributes, or is traversed through;
everything else stays a property.

Two derived properties are computed here and carried on the Specimen nodes so the
graph can be faceted without recomputation:

- `stage_reached` — the furthest stage with data, from `mtb` back to `enrolled`
- `stalled_days` — days since the last recorded step, but **only when something
  is still expected**. An aliquot that failed QC and was repeated, excluded or
  sent for investigation is *resolved*, not stuck; blood taken for the biobank is
  finished at pathology. Without that rule the stalled count is dominated by
  samples behaving exactly as intended.

### Stage 3 — `aggregates.py`

The counting layer. Counting questions are served from the tables, not by
traversing the graph.

The unit being counted **changes at AllPrep** and is labelled explicitly:
specimens before the split, aliquots after, because one specimen becomes up to
three aliquots. Patients and specimens never share a stream.

---

## Output schemas

### `graph.json`

```jsonc
{
  "as_of": "2026-08-19",
  "study": "PreDDLung",
  "node_types": ["Study", "Patient", "Specimen", ...],   // 12
  "nodes": [ { "id": "...", "type": "...", "label": "...", ...props } ],
  "edges": [ { "source": "...", "target": "...", "type": "...", ...props } ]
}
```

Node ids are prefixed by kind, so they are readable and collision-free:
`patient:PDL-0042`, `specimen:57`, `aliquot:PMSC-2025-0042-DNA`,
`qc:PMSC-2025-0042-DNA`, `run:ms:57`, `act:57:allprep`, `staff:SE2321000016-1497`,
`id:PAD (pathology):K2347-25 3C`, `loc:CCK-F2 / DNA-2025-07 / B7`.

| Node type | Key properties |
|---|---|
| `Patient` | `sex`, `age`, `enrolled_on`, `consent`, `other_studies` |
| `Specimen` | `sample_type`, `collected_on`, `stage_reached`, `stalled_days`, `is_repeat` |
| `AnalyticalSample` | `molecule`, `elution_ul`, `buffer`, `concentration`, `total`, `qc` |
| `QCResult` | `outcome`, `molecule`, `fail_action`, `note` |
| `PlatformRun` | `molecule`, `instrument`, `sent_on`, `returned_on`, `turnaround_days` |
| `Deviation` | `deviation_type`, `note` |
| `Activity` | `activity`, `date` |
| `Identifier` | `scheme`, the kind of identifier, such as a PAD number |
| `Facility` | `kind`. Each facility is a lab, meaning a place where work is done on the material. |
| `InformationSystem` | `kind`. Each one is software where something is registered, such as REDCap or Labware. |
| `StorageLocation` | `freezer`, `box`, `position` |

Edge types: `HAS_PATIENT`, `HAS_SPECIMEN`, `IDENTIFIED_AS`, `DERIVED_FROM`,
`HAS_QC`, `SUBMITTED_TO`, `RETURNED_DATA`, `RUN_AT`, `AT_FACILITY`, `USED`,
`GENERATED`, `PERFORMED`, `ENROLLED`, `STORED_AT`, `HAS_DEVIATION`, `REPEAT_OF`,
`ISSUED_BY`, `RECORDED_IN`.

`ISSUED_BY` joins an identifier to the system that issues it, and `RECORDED_IN`
joins an identifier or an activity to a system that records it. Both are drawn
only where a source names the system, so the PMSC sample and aliquot IDs carry
neither.

### `aggregates.json`

| Key | What it holds |
|---|---|
| `kpis` | the headline tiles, all computed — see the two notes below |
| `flow` | `specimen_stages` up to AllPrep, then a per-molecule `streams` chain, then `mtb` |
| `qc_by_sample_type` | pass/fail counts nested sample type → molecule |
| `turnaround` | `hands_on` and `waiting` separately, plus `collection_to_mtb`; each with n, median and p90 |
| `stage_distribution` | records per stage reached, including those awaiting collection |
| `attention` | the action list — one entry per stalled object, sorted oldest first, with `waiting_on` |
| `operators` | steps performed per HSA-ID |
| `enrollment_by_month` | the accrual curve |

Two things in there need a decision before the views are built:

- **`reached_data_back_pct` is reported twice.** The design doc's denominator is
  all collected specimens, giving 60.2%. Blood taken for the biobank can never
  reach an omics result, so that understates throughput; over specimens that
  entered PM-SC it is 88.3% (`reached_data_back_pct_in_pipeline`). Pick one for
  the tile.
- **The three streams are not gated alike.** DNA and RNA are QC'd *before*
  submission; the protein fraction is digested and run first and its QC is the
  mass-spec check *afterwards*. `flow.streams` therefore carries a per-stream
  stage order and a `qc_position` flag (`before_submission` / `after_run`), rather
  than one flat strip that would put the protein stream's QC in the wrong place.

---

## Tuning the dataset

Every number lives in `generator/config.py`. Change it and re-run both stages.

| Parameter | Effect |
|---|---|
| `SEED` | Change to get a different but equally valid dataset. Keep fixed for a reproducible demo. |
| `AS_OF` | The snapshot date, stamped into the output. Nothing reads the system clock. |
| `ENROLL_START` / `ENROLL_END` | The window length controls how the cohort spreads across stages — this is what makes the Sankey and stage strip have shape. Shorten it and everyone bunches at the same stage. |
| `N_PATIENTS` | Cohort size. Roughly 1.8 records and 3.2 aliquots per patient. |
| `N_ENROLLED_ONLY` | Patients consented with nothing collected yet. |
| `P_TISSUE_FFPE`, `P_BLOOD_WITH_TISSUE`, `P_BIOPSY_SOURCE` | Cohort mix. Applied as exact quotas. |
| `N_BLOOD_TO_PMSC` | Blood specimens continued to DNA extraction rather than biobanked. |
| `P_DNA_FAIL`, `P_RNA_FAIL_FF`, `P_RNA_FAIL_FFPE`, `P_MS_FAIL` | QC failure rates. FFPE RNA is deliberately worse — degraded material. |
| `FAIL_ACTION_WEIGHTS` | Repeat / exclude / investigate split. More repeats means more records. |
| `N_STALLED`, `STALL_MIN_DAYS`, `STALL_MAX_DAYS` | How many stuck samples, and how old their last step is. |
| `STALL_THRESHOLD_DAYS` | The definition of stalled. Flows through to the builder via `manifest.json`. |
| `P_DEVIATION`, `DEVIATION_MIX` | Deviation rate and the timing/temperature/handling/labelling split. |
| `T_*` | Per-step day ranges. These set the turnaround chart. |
| `*_CONC_*`, `*_ELUTION_*`, `INJECTION_NG` | Assay value ranges. Failure ranges are separate, which is what keeps QC outcome and yield consistent. |

Two caveats:

- **Failures are not noise, they are the content.** The dashboard has a QC
  pass-rate tile, a QC-by-type chart, a stalled count and a `REPEAT_OF` edge type.
  Set the failure rates to zero and four features render empty.
- **`AS_OF` and the enrollment window interact.** If `ENROLL_END` is close to
  `AS_OF`, the last patients have no specimen; if it is far, everyone is finished
  and nothing is in flight.

---

## Working with a real export

The builder does not depend on the generator. Point it at a real REDCap export:

```bash
python3 builder/build.py --export ~/exports/PMSampleCentral_DATA_2026-11-01.csv \
                        --as-of 2026-11-01 --stall-threshold 30
```

`--as-of` is required when there is no `manifest.json` to read it from — the
build refuses to guess, and refuses to read the clock.

Expect the first real run to surface things the synthetic data does not have:

- **Patient-field conflicts.** `normalize.py` prints every `study_id` whose
  records disagree about DOB, sex, enrollment date or oncologist. The synthetic
  data has none by design; a live export very well may.
- **A different record grain.** This pipeline assumes one record per specimen. If
  the live project turns out to use repeating instruments instead, the export will
  carry `redcap_repeat_instrument` and `redcap_repeat_instance` columns and
  `normalize.py` will need a grouping pass before it collapses patients. That is
  the one open question about PID 3225 worth confirming.
- **Unmapped values.** `decode_row` looks choices up by code; a code the
  dictionary does not define decodes to `None` rather than crashing, so check for
  unexpectedly empty columns after the first run.

---

## Extending it

**A field was added to the dictionary.** Drop the new dictionary into
`reference/`, update the path in `common/dictionary.py`, and re-run. The export
gains its column automatically, but nothing *populates* it until you add it to
the relevant `_fill_*` method in `model.py`.

**A field should become a graph node.** Apply the promotion rule from
`docs/design-decisions.md` §3 — shared, own attributes, or traversed through — and
add it in `graph.py`. Node ids are `kind:value`; use `self.node()` and
`self.edge()` so deduplication is handled for you.

**A new KPI or chart.** Add it to `aggregates.py`. It reads the normalized tables,
not the graph. If it counts objects across the AllPrep split, state the unit
explicitly the way `flow` does.

**A new edge case to demonstrate.** Prefer adding it to the simulation over
hand-editing the output. The output is regenerated on every run and hand edits
are lost; more importantly, an edge case the generator cannot express is usually
one the dashboard cannot detect either — which is itself worth knowing.

---

## Design decisions

**Record grain — one record per specimen.** `record_id` identifies a specimen,
not a patient; `study_id` repeats across a patient's records. This is a normal
REDCap configuration for sample tracking, and it is the simplest one that
produces the dictionary as it stands: the `summary` instrument is a *per-sample*
timeline that also pipes the enrollment date, which only works if enrollment and
sample data share a record. A patient who gave tissue and blood at one surgery
has two records. A consented patient with nothing collected yet has one record
with only the enrollment instrument filled.

**Patient fields are denormalized and internally consistent.** Every record of a
patient repeats that patient's enrollment fields, and the copies agree. The
normalizer detects disagreement and reports it, but the generator plants none:
the dataset exists to demonstrate the dashboard, not to exercise data cleaning.

**Failures are in the data on purpose.** Clean means no data-entry errors. It
does not mean no failures — see the caveat under [Tuning](#tuning-the-dataset).

**Fixed snapshot date.** `AS_OF = 2026-08-19` is stamped into `manifest.json` and
carried into both artifacts. Nothing reads the system clock. Without this the
stalled count would grow every week on its own and the numbers would differ in
November from the ones rehearsed today.

**Enrollment spans about 20 months** (2025-01-06 to 2026-08-12, ~5 patients a
month), which is what spreads the cohort across pipeline stages.

**No clinical layer.** PD-L1, TMB, TNM, RECIST and DCB are not in the dictionary,
so they are not generated. The dashboard's scope is sample provenance and
pipeline health; every KPI and all three user cases are operational. The trial
category's feasibility endpoints — turnaround, yield, percentage reaching the
tumour board — are all computable from pipeline data alone.

**Generated to the dictionary, not to the dashboard.** All 124 fields are
populated where branching logic allows, including the ones no view reads. The
dataset's contract is the dictionary; the dashboard consumes a subset. If a view
later needs one of those fields, the data is already there.

---

## Cohort as generated

| | |
|---|---|
| Patients enrolled | 100 |
| Awaiting collection | 5 (record with only the enrollment instrument filled) |
| Records | 181 — 168 original, 13 created as repeat analyses |
| Specimens collected | 163 original — by `sample_type`: FFPE 38, Tissue 40, Biopsy 17, Blood 68 |
| Blood continued to DNA extraction | 16; the rest are biobanked and finish at pathology |
| Aliquots | 321 — DNA 117, RNA 102, protein 102 |
| QC pass rate | 90.1% over 313 resolved aliquots |
| Stalled beyond 30 days | 13 — 12 specimens plus 1 patient awaiting collection |
| Deviations | 25 specimens, mostly timing |
| Graph | 3,534 nodes, 6,139 edges |

The graph sits well inside the 10³–10⁵ range the knowledge-graph design targets.
Stalled objects are spread across five stages, with last steps between 33 and 193
days old.

---

## Declared deviations

Points where the generated data departs from the dictionary as written. Reasoning
for each is in `../decisions_on_dataset_variables.md`.

| What | Why |
|---|---|
| `date_spec` added as an extra column | The `summary` instrument pipes it; the dictionary never defines it |
| Concentrations generated in ng/µl | The dictionary prints "µl/µg", which is inverted for a concentration |
| Protein and peptide aliquot IDs derived from `pmsc_id` | Neither has an identifier field of its own |

---

## Verification

Each build is checked for:

- no date later than the snapshot date
- checkbox columns strictly `0`/`1`, never blank
- branching logic honoured — blood-only fields absent on tissue records, and the
  FFPE and fresh-frozen prep branches mutually exclusive
- every `dna_repeat` / `rna_repeat` resolving to a real `pmsc_id`
- no aliquot carrying a concentration without a QC verdict
- patient fields consistent across each patient's records
- no dangling graph edges
- the generator's stalled set and the builder's stalled set agreeing exactly —
  the generator knows what it planted, the builder can only infer from the
  export, and a disagreement means the dataset contains something the dashboard
  could never detect
