# PM-SC Dashboard — Domain Brief

*Living reference for the Precision Medicine Sample Central (PM-SC) data dashboard.*
*Status: draft, v0.1 — 2026-07-09. Built during domain-discovery interview. Correct freely; this is what we design against.*

> **Sources of truth vs. exploratory material.** This brief synthesizes: the PM-SC research plan,
> the PreDDLung deck, the Teams project files (deliverables, WP2 planning workbook, meeting notes),
> and the **REDCap data dictionary** (`TESTPMSampleCentral_DataDictionary_2026-07-09.csv`) — the last
> is the schema source of truth. The earlier `PMSC_knowledge_graph_concept/` folder is *exploratory*,
> not authoritative.

---

## 1. What this is

A **proof-of-concept data dashboard** for **Precision Medicine Sample Central (PM-SC)** — a 2025–2027
infrastructure project at Karolinska (KI + Karolinska University Hospital + SciLifeLab), PI **Päivi
Östling**, funded by Radiumhemmets forskningsfonder (4 MSEK/yr × 3).

The dashboard is a **named WP2 deliverable**. PM-SC has three work packages:

- **WP1 — Sample flow**: advanced fresh sample preparation at the hospital's sample central.
- **WP2 — Data flow & structure**: unique sample ID + pseudonymization tool, and a **metadata
  knowledge graph for visualization, integration, analytics**. ← *this dashboard*
- **WP3 — Standard processes**: linking stakeholders.

The WP2 planning workbook lists, verbatim, two work tasks this dashboard fulfils:
*"Dashboard showing where samples are in the process"* and *"Visualise data from database in a
knowledge graph."* Plus the **Final Product Feature Requirements**: create unique sample ID ·
knowledge graph · storage of clinical metadata · storage of life-science metadata · import from biobanks.

### The showcase
Real pipeline data won't exist by the milestone, so the November deliverable is a **showcase**: a
working frontend of the intended operational tool, populated with **schema-driven synthetic data**.
Later switch to live data should be a *data-source change, not a redesign*.

- **Milestone:** November 2026 (exact date TBC).
- **Dual objective:** (1) ship the showcase; (2) **vehicle for the author to learn frontend
  development** — Claude scaffolds/guides, the author builds. Coupled to a full-stack learning track.

### The author's role
**Stefano** — Data Steward, DSN-PMD (Data Science Node, Precision Medicine & Diagnostics), KI/TEF-funded,
since June 2025. WP2 deliverables: *write REDCap fields in OMOP format · own life-science metadata ·
export & evaluate test data*. (Team: Päivi lead; Jan Lorenz WP2/product owner; Maria Ahlsén coordinator;
Karthick/Sebastian/Saman developers.)

---

## 2. The showcase subject: PreDDLung

**PreDDLung** (“Predictive Diagnostic Development – Lung”) is the pilot case study — a feasibility study
for **multimodal ICI precision medicine in NSCLC** (non-small-cell lung cancer), PI **Simon Ekman**,
run for the Precision Medicine Task Force (PMDU) at Karolinska.

> ⚠️ **Honesty caveat (verified 2026-07-09):** "PreDDLung"/"lungpiloten" has **no public footprint**
> (no registry, publication, or KI page). Treat it as an **internal pilot name**. The showcase should
> state that its data is **synthetic**, modeled on the *verified category* below — not presented as a
> real published study. (Don't conflate with the unrelated Stockholm lung-CT-screening "lungpiloten".)

### Category templates (verified, use for realistic synthetic data)
Swedish DRUP-like platform trials with multimodal/omics sub-studies — the closest documented analogues:

- **MEGALiT** (Acta Oncologica 2025): prospective, non-randomized basket+umbrella phase-2; ICI arm
  (atezolizumab) allocated on TMB ≥7. **Attrition for a realistic funnel:** 148 enrolled → 29% allocated
  a drug → 25% started; median time to molecular tumor board 28 days (ctDNA 21 d, biopsy 35 d).
- **FOCU.SE** (Acta Oncologica 2025): non-randomized pragmatic phase-2 platform trial, Simon two-stage
  design; part of European PRIME-ROSE / PCM4EU. **FOCU.SE-Explore** collects tissue + blood + baseline
  proteomics (+ optional WGS/WTS/spatial). This exploratory layer *is* the PreDDLung category.
- Family: **DRUP** (NL), **IMPRESS-Norway**, Danish/Finnish siblings, coordinated under PCM4EU/PRIME-ROSE.

Category hallmarks: prospective, non-randomized, biomarker-driven; **feasibility endpoints dominate**
(turnaround time, % samples yielding actionable results, % patients reaching MTB/treatment) alongside
clinical ORR / DCB (durable clinical benefit = PFS ≥6 mo) / PFS / OS.

---

## 3. Users & purpose

- **Primary users (operational):** researchers and lab staff of PM-SC — *"where are my samples, what's
  stuck, did they pass QC, did the omics come back."*
- **Secondary:** stakeholders (funders / DSN / collaborating departments) — a **study-status snapshot**.
- **Decision the tool drives:** spot a stalled or failed sample and act; trace one sample's full
  provenance; judge whether the pipeline is healthy for a study/sample-type.

---

## 4. Domain model (from the REDCap data dictionary)

8 instruments → entities + a cross-system **ID chain**. This is the schema the graph is typed against.

| Instrument | Entity | Identifier | Notable fields |
|---|---|---|---|
| `research_subjects_enrollment` | **Patient / Subject** | `study_id` | DOB, sex, enrolling oncologist (HSA-ID), consent, enroll date, exact age (calc) |
| `sample_collection` | **Specimen (collected)** | — | type (Blood/Tissue/Biopsy/FFPE/Other), date = surgery, tube type (EDTA/Heparin/Citrate/Serum), centrifugation timing |
| `pathology_sample_handling_and_registration` | **Pathology registration** | `pat_sample_id_1` = **PAD number**; biobank tube barcode | rack/position, 4 deviation types (timing/temp/handling/labeling) |
| `pmsc_sample_registration` | **PMSC prep** | `pmsc_id` | sample type, sectioning (FFPE) / cryoprep (fresh-frozen), operator (HSA-ID), sections, microdissection, size/color |
| `pmsc_sample_dnarna` | **DNA aliquot** + **RNA aliquot** | `PMSC-ID-DNA`, `PMSC-ID-RNA` | elution vol/buffer, conc (Qubit), total (calc), **QC Pass/Fail**, fail-action, **repeat-ID link**, → Clinical Genomics / Genomics Express, storage loc |
| `pmsc_sample_proteomik` | **Protein / Peptide** | (pmsc_id) | protein/peptide totals, **MS run: TimsTOF / Astral / Other**, MS QC, storage |
| `summary` | (journey timeline) | — | pipes the key dates — already a per-sample timeline |
| `mtb_portal` | **MTB order** | `order_date` | → Molecular Tumor Board Portal |

### The ID chain (the provenance story — WP2's whole point)
A sample is **re-identified at every handoff**; linking these IDs is the deliverable.

```
study_id (eCRF, pseudonymised)
  → PAD number (pathology, Sympathy LIMS; hospital naming e.g. K2347-25 3C)
  → biobank tube barcode (SMB / KI Biobank)
  → pmsc_id (PM-SC prep)
  → PMSC-ID-DNA / PMSC-ID-RNA (per-assay aliquots)
code-key (personal-ID ↔ study-ID) kept securely at K / KI Biobank; operators tagged by HSA-ID
```

### Failure / repeat is in the data
`dna_repeat` / `rna_repeat` hold *"the Study ID or PMSC ID used for the repeat analysis"* — i.e. the
schema literally encodes a **`repeat_of` edge** from a failed aliquot to its retry. QC uses Pass/Fail +
fail-action (repeat / exclude / investigate).

---

## 5. The PreDDLung sample journey (with timings, from the deck)

```
Consent (Alltid Öppet/Nybesök) → TakeCare (register consent w/ StudyID, 15m)
→ Orbit (surgery schedule, 30m) → Transport co. (10m) → CCK pack ice+temp logger (15m)
→ Surgery: tumor tissue → transport bag (15m) → Pathology: cut tissue, mark tubes, -80 rack;
  register in Labware w/ remiss (30m) → Pathology -80 freezer → Fryshotellet: move to CCK freezer A0 (5-10m)
→ UTTAG (withdrawal, dry ice, 20m) → CCK Cryo Prep (10m) → CCK AllPrep (2-2.5h)
     → Protein fraction / DNA fraction / RNA fraction
→ Conc. measurement (Qubit for RNA/DNA, Bradford/Qubit for protein, 1h)
→ Protein → Clinical Proteomics MS (SciLifeLab, 60-72h);  RNA/DNA → Clinical Genomics
→ Data Analysis (24-48h) → MTBP (Molecular Tumor Board Portal)
```

The pipeline is the *process schema*. Each real sample is an *instance* traversing it (see §6).

---

## 6. The two views

### View A — "Classic" study dashboard (stats & status)
Aggregate, chart-first. High-impact for the stakeholder snapshot; easy to build.
- **Cohort funnel / attrition** (CONSORT-style): enrolled → collected → pathology → PMSC → QC-passed →
  sent → data received. Seed ratios from MEGALiT (148 → 29% → 25%).
- **QC health**: pass/fail per modality and per sample type; failure & repeat counts.
- **Throughput / turnaround**: time-in-stage, bottlenecks (the timings above).
- **Swimmer plot** (per-sample bars) is a strong idiom for the temporal journey.

### View B — Knowledge-graph view (provenance & relationships)
**A pipeline diagram is *not* a KG.** A KG's nodes are **instances** (this patient, this specimen, this
DNA aliquot, this platform run, this operator, this PAD-ID), and its edges are **typed relationships**.

**Schema backbone — adopt the Clinical Knowledge Graph (CKG) spine** (Santos et al., Nat Biotechnol 2022):

```
Patient ──enrolled_in──▶ Study
Patient ──has_sample───▶ Biological_sample (Specimen)
Specimen ─identified_as▶ Identifier {PAD, biobank barcode, pmsc_id, ...}
Specimen ─aliquot_of───▶ Analytical_sample (DNA / RNA / Protein aliquot)
Analytical_sample ─analyzed_by─▶ Platform_run (Clinical Genomics / Genomics Express / MS)
Analytical_sample ─has_qc──────▶ QC_result {pass|fail}
Analytical_sample ─repeat_of───▶ Analytical_sample (failed → retry)
Operator ─performed────▶ Activity (sectioning / cryoprep / extraction / digestion)
Analytical_sample ─measured────▶ Clinical_variable / Gene / Protein  (future omics linkage)
```

Nodes are **semantically typed** (Patient→OMOP Person; Specimen→SPREC/ISBER/BioSamples) — that semantic
layer + integration across REDCap/LIMS/platforms is the "knowledge" in knowledge graph. *(This is the
author's WP2 work — the OMOP field mapping IS building this ontology.)*

**Staged build:**
1. **Single-sample provenance subgraph** — node-link of one real sample's entities + its ID chain across
   systems. Visually striking, unambiguously "a graph," 100% faithful. (Start here.)
2. **Multi-sample explorable graph** — shared entities (operators, platforms, studies, QC outcomes)
   become hubs; filter + traverse. Enables queries a table can't: *"female pts >65, RNA failed QC,
   repeated, reached Genomics Express."*

**Idiom discipline:** the journey is temporal, so a **timeline/swimlane** is often a *clearer* KG
projection than free node-link. Use node-link for cross-entity relationships, timeline for one journey,
matrix/heatmap for sample × QC. **Don't force a graph where a chart is clearer** (counting → chart;
provenance/traversal → graph).

---

## 7. Data strategy (synthetic)

- **Generate from the REDCap schema** (§4). Faithful field set already known.
- **Realism from the category** (§2): QC ranges — DNA 260/280 ~1.8–2.0, RNA RIN/DV200 (FFPE low; DV200
  >50% good), protein yield µg; cohort funnel from MEGALiT attrition; clinical vars PD-L1 TPS, TMB, TNM
  stage, RECIST, DCB.
- **Include edge cases** deliberately: a QC failure + repeat; an incomplete/stuck pipeline; a blood-only
  vs full-FFPE path.
- **Ownership:** author owns test-data export/eval (WP2 role) → can drive faithful generation.
- **Scale:** enough patients/samples to be convincing, not unwieldy (tune during build; ~MEGALiT scale).

---

## 8. Tech stack (decided)

> **Frontend:** SvelteKit + **TypeScript**  ·  **Backend:** **FastAPI / Python**  ·
> **Graph rendering:** Cytoscape.js (or similar)  ·  **Charts:** a JS chart lib (TBD).

Rationale: leverages the author's **Python** fluency for the data/API layer (and the OMOP work), while
learning **TypeScript + Svelte** on the frontend. Matches the existing `DataHampPlatPrototype`
(SvelteKit + FastAPI + Cytoscape), proven for this domain.

> 📝 **Note (clears a misconception): Svelte does NOT require Rust.** SvelteKit runs on Node.js and is
> written in JS/TS; the language to learn is **TypeScript**. The "Rust" association comes from *Tauri*
> (desktop apps, not us) or JS build tools written in Rust under the hood (Vite/Rolldown — invisible to
> you). No Rust anywhere in this project.

---

## 9. Systems landscape (eventual live data sources)

REDCap (eCRF being built, PID 3225) · Sympathy → future LifeCare (pathology LIMS) · KI Biobank
(LabVantage+Labware) / SMB (LabWare+FreezerPro) · **Omics Leaderboard** (Johan Lindberg/Karthick's custom
Flask+Postgres "LIMS" that tracks sample location — *its frontend is undecided*) · SciLifeLab Clinical
Genomics + Clinical Proteomics · **IDS User Portal** (future, API↔REDCap) · **MTBP** (Molecular Tumor
Board Portal, David Tamborero) · **BioSamples** (EBI export) · **PM Portal** (public home for the KG).

Live-data path: REDCap export / API on a cadence; APIs pull clinical data from EHR + sample data from LIMS.

---

## 10. Open questions / parked

- 🅿️ **Omics Leaderboard linkage** — can the dashboard link to per-sample omics data given it's on a
  different platform? Author to ask the team. Architecture-level, not a V1 blocker.
- 🅿️ **Hosting / visual identity** (SciLifeLab DC / PM-Portal design system) — external org call; design so
  hosting is a deployment detail. Flag early.
- ❓ Exact November showcase date.
- ❓ Chart library choice; graph library confirm (Cytoscape vs alternatives).
- ❓ Synthetic-data scale (patient/sample counts).

---

## 11. Key sources

- REDCap data dictionary: `…/Studies/PM_sample_central/metadata/TESTPMSampleCentral_DataDictionary_2026-07-09.csv`
- PM-SC research plan (`Research_plan_PM_infra.docx`); PreDDLung deck (`PM_Sample_Central.pptx`);
  WP2 planning workbook + meeting notes (`Docs/FromTeams/`).
- Clinical Knowledge Graph — Santos et al., *Nat Biotechnol* 2022;40(5):692-702 — https://pmc.ncbi.nlm.nih.gov/articles/PMC9110295/
- MEGALiT — https://pmc.ncbi.nlm.nih.gov/articles/PMC12160592/ · FOCU.SE — https://pmc.ncbi.nlm.nih.gov/articles/PMC13081547/
- Simon Ekman (KI) — https://ki.se/en/people/simon-ekman · PMCK — https://ki.se/en/collaboration/healthcare-services/precision-medicine-center-karolinska
- Swedish Biobank Act / pseudonymization — https://biobanksverige.se/en/research/research-guide/
- FFPE RNA/DNA QC — https://pmc.ncbi.nlm.nih.gov/articles/PMC9479231/
