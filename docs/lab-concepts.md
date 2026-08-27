# Sample-processing concepts, explained

*Plain-language guide to the biology/lab concepts behind the REDCap variables, for someone new to the
domain. Ordered as the sample's journey, so it reads as a story. Companion to `data-inventory.md`.*
*v0.1 — 2026-07-09.*

> Accuracy note: the generic lab science below (FFPE, extraction, QC, mass spec…) is well-established and
> reliable. Anything PMSC-**specific** that I inferred is flagged, and matches the open questions in
> `data-inventory.md`. I'm not a lab scientist — treat this as an orientation, and let the WP1 lab folks
> (Santeri, Mahnaz, Rita) correct specifics.

---

## 0. The big picture
A tumour sample is removed from a patient, preserved, split, and purified into **DNA, RNA, and protein**,
each of which is quality-checked and sent to a different analysis platform. The dashboard tracks *that
journey* and *its quality*. Most variables are one of: **what kind of sample**, **how it was handled**,
**how much/how pure** the extracted material is, **did it pass QC**, **where is it stored**, **who did
it**, and **when**.

---

## 1. Sample types — how tissue is preserved (the single most important distinction)

- **FFPE** — *Formalin-Fixed, Paraffin-Embedded*. The standard hospital-pathology way to preserve tissue:
  soak in formalin (a fixative), then embed in a paraffin-wax block. **Great for looking at cells under a
  microscope and for DNA; harsh on RNA** (the formalin chemically cross-links and fragments molecules).
  This is why RNA from FFPE has worse quality scores (see §4). Stored at room temperature for years.
- **Fresh-Frozen** — snap-frozen (often in liquid nitrogen) very soon after removal. **Best quality for
  RNA and protein**, because nothing degrades them. But it needs an unbroken **cold chain** (kept cold the
  whole time) — hence all the temperature-deviation and transport-temperature fields.
- **Blood** — collected in tubes; can yield plasma, serum, circulating tumour DNA (ctDNA), and germline
  DNA. The **tube type / cap colour** matters because each contains a different additive:
  - **EDTA (purple)** — anticoagulant; standard for plasma/DNA and ctDNA.
  - **Heparin (green)** — anticoagulant; some assays (can inhibit others).
  - **Citrate (blue)** — anticoagulant; coagulation tests.
  - **Serum (red/yellow)** — no anticoagulant; blood clots, you keep the liquid serum.
- **Biopsy vs. resection** — a *biopsy* is a small needle/core sample; a surgical *resection* is a larger
  piece. (In the schema these appear as sample-type options; note they overlap oddly — that's open Q3.)

## 2. Collection & early handling (quality starts here)

- **Surgery / collection** — the clock starts. `sample_date` is both the collection and surgery date.
- **Centrifugation** (blood) — spinning the tube at high speed to separate layers (plasma/serum on top,
  cells below). The **time from draw to spin** matters: delay degrades the analytes, so the schema records
  centrifugation time and the delay. A quality metric disguised as a timestamp.
- **Ischemia / cold-chain** — the time tissue spends warm and un-preserved (“warm ischemia”) degrades RNA
  and protein fast. The four **pathology deviation fields** (timing / temperature / handling / labelling)
  capture exactly the things that ruin a sample: delays, warm excursions, physical damage, and mix-ups.

## 3. Pathology & preparation at the sample central

- **PAD number** — the hospital pathology department's identifier for the specimen (Swedish
  *patologisk-anatomisk diagnos*). It's the pathology-side link in the ID chain.
- **Sectioning** (FFPE) — shaving thin slices off the wax block with a microtome. Thickness is in
  micrometres (µm); the **“rolls”/scrolls** are the curls of tissue collected into a tube for extraction.
- **Microdissection** — cutting out just the tumour-rich part of a slide, so you analyse tumour and not
  surrounding normal tissue (raises the "tumour cell content", which downstream assays care about).
- **Cryoprep / cryopulverization** (fresh-frozen) — grinding frozen tissue into a fine **powder** while
  keeping it frozen, so it's homogeneous before you split it. That's the "cryopowder" the fields refer to.
- **AllPrep** — a Qiagen lab kit that **co-extracts DNA + RNA + protein from the same sample** in one
  workflow. This is *why* one specimen fans out into three parallel aliquots in the data.

## 4. Extraction, yield & quality control (the QC metrics)

Once purified, each molecule type is dissolved ("**eluted**") into a small volume of a stabilising
**buffer**. Then two things are measured:

- **Concentration** — how much material per microlitre. Measured here with **Qubit** (a fluorescence-based
  method that's accurate because it binds only the molecule you want). *(The schema's concentration units
  look inverted — open Q4 — but the concept is mass-per-volume.)*
- **Total yield** = concentration × elution volume → total micrograms (µg). "Did we get enough material?"

Then a **QC Pass/Fail** decision, and if it fails, a **fail action**: *repeat* the extraction, *exclude*
the sample, or *investigate*. If repeated, `dna_repeat`/`rna_repeat` record the ID of the retry — that's
the "this sample was re-done" link.

> **Worth knowing (context):** the wider field uses named purity/integrity scores you'll see in the
> literature — **260/280 & 260/230** ratios (DNA purity), **RIN / RINe** (RNA Integrity Number, 1–10),
> **DV200** (% of RNA longer than 200 bases — the key metric for fragile FFPE RNA). **This particular
> REDCap doesn't record those named scores** — it uses *concentration + total yield + a Pass/Fail flag*
> instead. Good to know so you're not surprised the ratios are absent.

## 5. Downstream analysis platforms (where the aliquots go)

- **DNA → Clinical Genomics** — DNA sequencing (gene panels / whole-genome) to find mutations. Data comes
  back (`datafrom_cg`).
- **RNA → “Genomics Express”** — an RNA analysis destination. *(Exactly what this service is = open Q6.)*
- **Protein → Clinical Proteomics (mass spectrometry):**
  - **Peptide digestion** — proteins are chopped into shorter **peptides** (usually with the enzyme
    trypsin) because mass specs measure peptides, not whole proteins.
  - **SP3** — *Single-Pot Solid-phase-enhanced Sample Preparation*: a bead-based clean-up method to purify
    those peptides. (Inferred from the variable name — open Q on the ÷20 constant.)
  - **Injection amount** — how much peptide (in nanograms) is loaded into the instrument.
  - **Mass spectrometer** — weighs peptides to identify and quantify proteins. Models here: **TimsTOF**
    (Bruker) and **Astral** (Thermo) — both high-end instruments.
  - **Spectronaut** — software that turns the raw mass-spec signal into protein measurements
    (a "DIA" analysis tool). *(Referenced in the timeline but its data field seems missing — open Q7.)*
- **MTBP — Molecular Tumor Board Portal** — where clinicians review the combined molecular results to
  decide treatment. The end of the journey (`order_date`).

## 6. Cross-cutting things every stage records

- **Identifiers** — the same physical sample is **re-labelled at each handoff** (`study_id` → PAD →
  biobank barcode → `pmsc_id` → per-aliquot DNA/RNA IDs). Re-connecting these is the whole point of the
  knowledge graph.
- **Operators (HSA-ID)** — who performed each step, for accountability and workload.
- **Storage location** — freezer / box / position, so a physical tube can actually be found again.
- **Dates & times** — enable the timeline, the durations, and spotting where samples get stuck.

---

## One-line glossary (quick reference)
| Term | Meaning |
|---|---|
| FFPE | Formalin-fixed paraffin-embedded tissue (archival; good DNA, poor RNA) |
| Fresh-frozen | Snap-frozen tissue (best RNA/protein; needs cold chain) |
| Elution | Dissolving purified material into a buffer volume |
| Buffer (EB/AE/TE, RNase-free) | Chemical solution that stabilises DNA/RNA |
| Qubit | Fluorescent assay measuring concentration |
| Yield / total (µg) | Concentration × volume = how much you got |
| QC Pass/Fail | Did the material meet quality thresholds |
| 260/280, RIN, DV200 | Standard purity/integrity scores (*not* in this schema — context only) |
| PAD number | Hospital pathology specimen ID |
| Sectioning / microtome | Cutting thin slices from an FFPE block |
| Microdissection | Selecting the tumour-rich region only |
| Cryopulverization | Grinding frozen tissue into powder |
| AllPrep | Qiagen kit co-extracting DNA+RNA+protein |
| Peptide digestion / trypsin | Cutting proteins into peptides for mass spec |
| SP3 | Bead-based peptide clean-up method |
| Mass spec (TimsTOF/Astral) | Instrument that identifies/quantifies proteins |
| Spectronaut | Software analysing mass-spec (DIA) data |
| MTBP | Molecular Tumor Board Portal (treatment decisions) |
