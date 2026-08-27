# PM-SC Dashboard — Data Inventory (variable-by-variable)

*Every variable in the REDCap data dictionary (`TESTPMSampleCentral_DataDictionary_2026-07-09.csv`),
with a plain-language description and my confidence in that interpretation.*
*v0.1 — 2026-07-09. Companion to `domain-brief.md`.*

## How to read the confidence column
- **High** — the field's own label states this; I'm just restating it. Low risk I'm wrong.
- **Med** — label is present but abbreviated, typo'd, domain-specific, or I'm inferring the *meaning,
  units, or purpose* beyond the literal label. Worth a quick check with the instrument authors.
- **Low** — label is ambiguous/garbled or the field's role is genuinely unclear to me; treat as a guess.

> **Domain terms I inferred** (verify): *PAD* = patologisk-anatomisk diagnos (hospital pathology ID);
> *AllPrep* = Qiagen kit co-extracting DNA/RNA/protein; *cryoprep/cryopowder* = cryopulverization of
> frozen tissue; *SP3* = a proteomics digestion protocol; *Qubit* = fluorometric concentration assay;
> *Genomics Express* = presumed an RNA-seq service; *TimsTOF/Astral* = mass-spectrometer models;
> *Spectronaut* = proteomics DIA analysis software; *MTBP* = Molecular Tumor Board Portal; *HSA-ID* =
> Swedish healthcare personnel ID (used here to tag operators).

---

## Form 1 — `research_subjects_enrollment` (the Patient/Subject)

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `record_id` | text | REDCap's internal row key (auto). | High | Standard REDCap first field; technical key, *not* a clinical ID. |
| `study_id` | text | **The patient's study ID** — the per-patient identifier within the study; root of the ID chain. | High | Confirmed by the team (2026-07-09). |
| `res_sub_consent` | yes/no | Signed informed consent? | High | Label explicit. |
| `res_sub_date_birth` | date | Date of birth. | High | Explicit; flagged as a direct identifier. |
| `res_sub_enroll_date` | date | Date enrolled in the study. | High | Explicit. |
| `res_sub_name` | text (HSA-ID) | The **enrolling oncologist** (clinician), by HSA-ID. | High | Label "Patient's enrolling oncologist" + HSA-ID note. ⚠️ Variable *name* (`res_sub_name`) misleadingly suggests the subject's name — it's the doctor. |
| `res_sub_email` | email | An email address, labelled the patient's. | Low | Label "Email address of the patient" — but storing a patient email in a pseudonymised study is unusual; could really be a coordinator/contact. Verify. |
| `res_sub_sex` | radio | Biological sex (Female/Male). | High | Explicit. |
| `res_sub_exactage` | calc | Exact age (yrs) at enrollment, from DOB & enroll date. | High | Calculation shown. |
| `other_studies` | yes/no | Is the patient in other studies? | Med | Label garbled ("If the patient other studies"); meaning inferred. |

## Form 2 — `sample_collection` (the collected specimen)

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `sample_date` | date | Sample collection date (= surgery date). | High | Label "Sample collection date / Surgery". |
| `sample_time` | time | Time samples were collected. | High | Explicit. |
| `sample_comments1` | text | Free-text comments. | High | — |
| `sample_type` | checkbox | Type(s) collected: Blood / Tissue / Biopsy / FFPE / Other. | Med | Options exist, but they overlap oddly — *FFPE* is a processing state and *Biopsy* a collection method, not clean peers of "Tissue/Blood". Category scheme may be imprecise; confirm intent. |
| `if_other` | text | Free-text if "Other". | High | — |
| `sample_blood_loc` | checkbox | Blood draw site (vein/artery × arm/hand/groin). | High | Explicit. |
| `sample_blood_ven_no` | radio | Number of (venous) tubes collected (1–3). | High | Explicit. |
| `sample_tube_loc` | radio | Blood tube type by additive/cap colour (Heparin/EDTA/Citrate/Serum). | High | Explicit. |
| `sample_blood_ven_biob` | yes/no | Venous-blood tubes sent to biobank? | High | Explicit. |
| `sample_blood_ven_biob_no` | number | Number of venous-blood tubes sent to biobank. | High | Explicit. |
| `sample_blood_ven_pat` | yes/no | Venous-blood tubes sent to pathology dept? | High | Explicit. |
| `centrifugation_time` | time | Clock time at centrifugation (blood processing). | Med | Label "Centrifugation Time"; validation is a *time-of-day*, so I read it as a timestamp, not a duration. |
| `calc_centrifufation` | text | Elapsed time from collection to centrifugation (a delay/quality metric). | Med | Label says so, but it's stored as free text (not a calc) and typo'd; role inferred. |
| `sample_comments2` | text | Comments on sample handling. | High | — |

## Form 3 — `pathology_sample_handling_and_registration`

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `pat_sample_id_1` | text | **PAD number** — the hospital pathology specimen ID. | Med | Label "PAD number" (High); the expansion & its role as the pathology-side ID in the chain is inferred from meeting notes. |
| `pat_sample_date` | date | Date received at pathology. | High | Explicit. |
| `receive_time` | time | Time received. | High | Explicit. |
| `pat_sample_time` | time | Time processing started. | High | Label "Sample processing started". |
| `prep_wash` | yes/no | Sample washed during prep? | High | Explicit. |
| `pat_sample_prep_dev1` | text | Timing deviation (e.g. collection→processing delay). | High | Label + examples. |
| `pat_sample_prep_dev2` | text | Temperature deviation (cold-chain excursion). | High | Label + examples. |
| `pat_sample_prep_dev_3` | text | Handling deviation (damage, contamination, dissection). | High | Label + examples. |
| `pat_sample_prep_dev_4` | text | Labelling/documentation deviation (mismatched IDs, wrong label). | High | Label + examples. |
| `tube_label` | text | Biobank tube barcode number. | High | Explicit. |
| `rack_number` | text | Pathology plate/rack the tube is stored in. | High | Explicit. |
| `rack_position` | text | Tube position in the pathology box (e.g. A3). | High | Explicit. |

## Form 4 — `pmsc_sample_registration` (prep at PM Sample Central)

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `pmsc_id` | text | PMSC sample ID assigned at the sample central. | High | Explicit. |
| `sample_type1` | checkbox | Sample type as registered at PMSC (FFPE / Fresh-Frozen / Blood / Other) — drives the prep branch. | High | Explicit; FFPE→sectioning fields, Fresh-Frozen→cryoprep fields (via branching logic). |
| `sample_type_3` | text | Free-text if "Other". | High | — |
| `prep_sectioning` | checkbox | Sectioning performed? (Yes/No/N/A) — FFPE branch. | High | Explicit. |
| `prep_sectioning_date` | date | Date of sectioning. | High | Explicit. |
| `prep_sectioning_sign` | text (HSA-ID) | Operator who sectioned. | High | "Operator" + HSA-ID. |
| `if_microdissection` | yes/no | Microdissection done? | High | Explicit. |
| `number_sections` | text | Number of sections cut. | High | Explicit. |
| `misrodissection_thickness` | text | Section thickness (µm). | Med | Label only "Thickness" (typo'd var name); the µm unit & "section thickness" reading are inferred. |
| `number_role` | text | Number of tissue "rolls"/scrolls placed in the tube. | Med | Label "Number of the rolls in the tube"; "rolls" = sectioning curls is domain-inferred. |
| `tube_number` | text | Number of tubes. | High | Explicit. |
| `transport_temp_range` | checkbox | Transport temp range (2–10 °C / outside / unknown) — fresh-frozen cold-chain check. | High | Explicit incl. "Acceptable range 2–10 °C". |
| `prep_cryoprep_2` | yes/no | Cryoprep (cryopulverization prep) performed? — fresh-frozen branch. | High | Explicit. |
| `pmsc_cryoprep_date` | date | Date of cryoprep. | High | Explicit. |
| `prep_cryoprep_sign` | text (HSA-ID) | Operator who did cryoprep. | High | Explicit. |
| `pieces_taken` | text | Number of tissue pieces taken. | High | Explicit. |
| `leftover_material` | text | Number of tissue pieces left over. | High | Explicit. |
| `sample_size_mm` | text (mm³) | Sample size (volume). | High | Explicit. |
| `sample_color` | text | Colour of the sample (visual note). | High | Explicit. |

## Form 5 — `pmsc_sample_dnarna` (DNA & RNA aliquots)

*Shared header*

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `pmsc_id_v2` | text | PMSC ID, re-entered here to link this record to the sample. | Med | Same ID repeated per instrument; linkage purpose inferred (REDCap forms don't auto-join). |
| `allprep_date_v2` | date | Date of AllPrep co-extraction (DNA/RNA/protein). | Med | Label "AllPrep extraction date" (High); "AllPrep = Qiagen kit" inferred. |
| `allprep_operator` | text (HSA-ID) | Operator performing AllPrep. | High | Explicit. |
| `cryopowder_all_used` | yes/no | Was all the cryopulverized tissue (powder) used? | High | Explicit. |
| `cryopowder_remain_am` | text | Amount of cryopowder remaining. | High | Explicit. |
| `cryopowder_storage_loc` | text | Storage location of remaining cryopowder. | High | Explicit. |

*DNA*

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `pmscid_dna` | text | Identifier of the DNA aliquot. | High | Explicit (PMSC-ID-DNA). |
| `dna_elution` | text (µl) | DNA elution volume. | High | Explicit. |
| `dna_elution_choice` | radio | DNA elution buffer (EB/AE/TE/nuclease-free water). | High | Explicit. |
| `dna_conc` | text | DNA concentration by Qubit. | Med | Metric is clear; **units printed "µl/µg" look inverted** (concentration = mass/volume). Likely a data-entry slip — confirm the intended unit. |
| `dna_total` | calc (µg) | Total DNA = elution × concentration. | Med | Formula shown; total-DNA reading is solid, but unit consistency depends on the `dna_conc` unit issue above. |
| `qc_dna` | checkbox | DNA QC outcome (Pass/Fail). | High | Explicit. |
| `qc_fail_action` | checkbox | If failed: Repeat / Exclude / Investigate. | High | Explicit. |
| `dna_repeat` | text | The Study/PMSC ID used for the **repeat** DNA analysis (links a retry to its origin). | High | Explicit — this is the "repeat_of" relationship. |
| `dnaqc_comment` | text | DNA QC comment. | High | — |
| `send_dna` | date | Date DNA sent to **Clinical Genomics**. | High | Explicit. |
| `sub_dna` | text (µl) | Volume of DNA submitted. | High | Explicit. |
| `datafrom_cg` | date | Date sequencing data received back from Clinical Genomics. | High | Explicit. |
| `dna_location` / `dna_box` / `dna_positon` | text | DNA storage: freezer / box / position. | High | Explicit (`positon` is a typo for position). |

*RNA*

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `pmscid_rna` | text | Identifier of the RNA aliquot. | High | Explicit. |
| `rna_elution` | text (µl) | RNA elution volume. | High | Explicit. |
| `rna_elution_choice` | radio | RNA elution buffer. | High | Explicit. |
| `rna_conc` | text | RNA concentration by Qubit. | Med | Same inverted-unit caveat as `dna_conc`. |
| `total_rna` | calc (µg) | Total RNA = elution × conc. | Med | As `dna_total`. |
| `qc_rna` | radio | RNA QC outcome (Pass/Fail). | High | Explicit. |
| `rna_fail` | radio | If failed: Repeat / Exclude / Investigate. | High | Explicit. |
| `rna_repeat` | text | Study/PMSC ID used for the repeat RNA analysis. | High | Explicit — "repeat_of" edge. |
| `rna_comment` | text | RNA QC comment. | High | — |
| `send_rna` | date | Date RNA sent to **Genomics Express**. | Med | Label explicit; *what "Genomics Express" is* (an RNA-seq service/pipeline vs. a lab name) is inferred. Verify. |
| `sub_rna` | text (µl) | Volume of RNA submitted. | High | Explicit. |
| `receive_rna` | date | Date data received from Genomics Express. | High | Explicit. |
| `rna_loc` / `rna_box` / `rna_pos` | text | RNA storage: freezer / box / position. | High | Explicit. |

## Form 6 — `pmsc_sample_proteomik` (protein → peptide → mass spec)

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `pmsc_id_v2_v2` | text | PMSC ID, re-entered to link the proteomics record. | Med | Linkage purpose inferred. |
| `prot_extr_operator` | text (HSA-ID) | Operator: protein extraction. | High | Explicit. |
| `comment_prot` | text | Comment on lysate appearance/colour. | High | Explicit. |
| `protein_date` | date | Protein extraction date. | High | Explicit. |
| `prot_conc` | text (µg/µl) | Protein concentration. | High | Explicit (units sensible here). |
| `prot_elution` | text (µl) | Protein elution volume. | High | Explicit. |
| `total_protein` | calc (µg) | Total protein = conc × elution. | High | Formula shown. |
| `allprep_comment_v2` | text | Comment. | High | — |
| `sp3_digestion` | date | Peptide extraction / SP3 digestion date. | Med | Label "Peptide extraction date" (High); "SP3 = a digestion protocol" inferred from the var name. |
| `prot_extr_operator_2` | text (HSA-ID) | Operator: peptide/digestion step. | High | Explicit. |
| `peptide_elution` | text (µl) | Peptide elution volume. | High | Explicit. |
| `peptide_conc` | text | Peptide concentration. | Med | Units printed "ng/µg" look odd (mass/mass); likely ng/µl. Confirm. |
| `total_peptide` | calc (ng) | Total peptide = elution × conc ÷ 20. | Med | Formula shown, but the **÷20** is a protocol-specific constant whose meaning I don't know — check. |
| `injection_amount` | text (ng) | Peptide amount injected into the mass spec. | High | Explicit. |
| `prot_extr_operator_3` | text (HSA-ID) | Operator: MS step. | High | Explicit. |
| `masspec_run` | radio | Mass-spec instrument used (TimsTOF / Astral / Other). | High | Explicit. |
| `ms_other` | text | If other instrument. | High | Explicit. |
| `ms_qcheck` | radio | Mass-spec QC outcome (Pass/Fail). | High | Explicit. |
| `peptide_loc` / `peptide_box` / `peptide_pos` | text | Peptide storage: freezer / box / position. | High | Explicit. |

## Form 7 — `summary` (read-only timeline; not data entry)

| Variable(s) | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `date_en_sum`, `samplecoll_sum`, `samplepat_sum`, `cryoprep_sum`, `allprep_sum`, `send_dna1`, `received_sum`, `sendrna_sum`, `receiver_sum`, `protextr_sum`, `spectronaut_sum` | descriptive | Display-only fields that echo previously-entered dates as a per-sample **timeline** (enrollment → collection → pathology → cryoprep → allprep → send/receive CG → send/receive Genomics Express → protein extraction → Spectronaut search). | High | They're `descriptive` (no data stored). ⚠️ `spectronaut_sum` pipes a field `date_spec` (Spectronaut = proteomics DIA search) that I **didn't see defined** as its own enterable field — possible missing field; flag. |

## Form 8 — `mtb_portal`

| Variable | Type | Description (my reading) | Conf. | Why / note |
|---|---|---|---|---|
| `order_date` | date | Date the case/order was placed to the Molecular Tumor Board Portal. | Med | Label is only "Date"; the MTBP-order reading comes from the *instrument name*. It's the sole field in this form — sparse; likely a stub. |

---

## Categorical variables — complete list (the dashboard's filter/group dimensions)

*Requested 2026-07-09. These are the fields with a fixed set of values — the natural axes for
filtering, grouping, faceting, and colour-coding. Values shown as stored in the dictionary.*

### A. Primary dimensions (multi-value — the useful facets)
| Variable | Entity / form | Possible values |
|---|---|---|
| `sample_type` | Specimen (collection) | Blood · Tissue · Biopsy · FFPE · Other  ⚠️*categories overlap — see open Q3* |
| `sample_type1` | PMSC prep | FFPE · Fresh-Frozen · Blood · Other |
| `res_sub_sex` | Patient | Female · Male |
| `sample_tube_loc` | Specimen (blood) | Heparin (green) · EDTA (purple) · Citrate (blue) · Serum (yellow) · Serum (red) |
| `sample_blood_loc` | Specimen (blood) | Vein arm · Vein hand · Vein groin · Artery arm · Artery hand · Artery groin |
| `qc_dna`, `qc_rna`, `ms_qcheck` | DNA / RNA / MS | Pass · Fail |
| `qc_fail_action`, `rna_fail` | DNA / RNA | Repeat analysis · Exclude sample · Investigate / troubleshooting |
| `masspec_run` | Proteomics | TimsTOF · Astral · Other |
| `transport_temp_range` | PMSC prep (fresh-frozen) | 2–10 °C · Outside 2–10 °C · Unknown |
| `prep_sectioning` | PMSC prep (FFPE) | Yes · No · N/A |
| `dna_elution_choice` | DNA | EB buffer (Qiagen) · AE buffer · TE buffer · Nuclease-free water |
| `rna_elution_choice` | RNA | RNase-free water · RNase-free Tris buffer · Buffer RE (Qiagen) · Low-EDTA TE buffer · Other |
| `sample_blood_ven_no` | Specimen (blood) | 1 · 2 · 3 (tube count) |

### B. Binary flags (yes/no — status, also categorical)
`res_sub_consent` · `other_studies` · `sample_blood_ven_biob` · `sample_blood_ven_pat` ·
`prep_wash` · `if_microdissection` · `prep_cryoprep_2` · `cryopowder_all_used`

### C. High-cardinality categorical (people — not a fixed vocabulary)
Operators by **HSA-ID**: `res_sub_name` (enrolling oncologist) · `prep_sectioning_sign` ·
`prep_cryoprep_sign` · `allprep_operator` · `prot_extr_operator` (×3 steps). *Great for grouping
(workload/accountability), but the value set is open (a list of people), not a closed choice list.*

---

## Open questions for the team — status (2026-07-09)
1. ✅ `study_id` = **the patient's study ID**. *Resolved.*
2. ⏭️ `res_sub_email` — **out of scope** for the dashboard; leave as-is.
3. ❓ `sample_type` vs `sample_type1` overlap — **ask Rita.** For the dashboard we only need "sample type
   exists + its value set" (captured above); the taxonomy cleanup is a data question, not a UI blocker.
4. 🚩 **Concentration units** (`dna_conc`/`rna_conc` "µl/µg", `peptide_conc` "ng/µg" look inverted) —
   a real **data-quality red flag** to raise, but **not relevant to the dashboard**. Parked as a data note.
5. ❓ `total_peptide` ÷ 20 constant — **unknown, ask team.**
6. ❓ **"Genomics Express"** (RNA destination) — **unknown, ask team.**
7. ❓ `date_spec` / Spectronaut field — **unknown, ask team.**
8. ❓ `number_role` ("rolls") / `misrodissection_thickness` — **unknown, ask team.**
