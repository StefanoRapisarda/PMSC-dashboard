# PM-SC Dashboard — Questions for the team: extract integrity & purity

*Working notes for a conversation with the PM-SC lab staff and, where noted, the SciLifeLab platforms.*
*v0.1 — 2026-08-20. Companion to `data-inventory.md` and `design-decisions.md`.*

> **Purpose.** While defining the "extraction yield" use case for the dashboard, one gap became
> load-bearing: the REDCap dictionary records **how much** DNA and RNA we extract, but nothing about
> **what condition it is in**. Before we build a view on top of that, we should find out whether the
> missing measurements are (a) never taken, (b) taken but recorded somewhere else, or (c) taken by the
> platforms downstream. Each answer leads somewhere different, and only one of them is a real gap.
>
> These questions are written as arguments, not as a checklist — each one states what we have, what is
> missing, why it might matter, and why it might legitimately not. The point is to find out, not to
> arrive with a verdict.

---

## 1. The three things you can measure about an extract

Plain definitions first, so the questions below are readable by anyone in the room.

- **Quantity (yield)** — *how much* material came out. Concentration × elution volume = total mass.
  Measured here on a **Qubit**: a fluorescent dye that binds only to DNA (or only to RNA), so it counts
  the molecule you actually care about and ignores everything else.
- **Integrity** — *is the molecule intact, or broken into fragments?* For RNA the standard score is
  **RIN** (RNA Integrity Number, a 1–10 scale; above roughly 7 is considered good). For material from
  FFPE blocks the usual score is **DV200** instead — the percentage of RNA fragments longer than 200
  bases. FFPE means formalin-fixed, paraffin-embedded: the formalin chemically cross-links and shatters
  RNA, so FFPE material is routinely the most damaged in any lab. DNA has an equivalent score, **DIN**,
  used less often because DNA is far more robust.
- **Purity** — *did contaminants come along for the ride?* Reported as two absorbance ratios:
  **A260/280** (around 1.8 for DNA, 2.0 for RNA — a low value suggests protein carryover) and
  **A260/230** (around 2.0–2.2 — a low value suggests salt or solvent carryover from the extraction
  chemistry itself).

These three fail independently. You can have plenty of RNA that is too degraded to sequence, and a tiny
amount that is perfect. That independence is the whole reason this document exists.

**One practical note that shapes question 4:** the purity ratios cannot be produced by a Qubit. They
require an **absorbance** reading — a spectrophotometer such as a NanoDrop — which measures anything
absorbing light at those wavelengths, contaminants included. That difference is exactly why the two
instruments answer different questions. If the lab runs Qubit only, asking for A260/280 is asking for a
second instrument in the workflow, not just a second field in the form.

---

## 2. What the schema captures today, and what it does not

| Question about the extract | Field(s) in REDCap | Status |
|---|---|---|
| How much DNA? | `dna_elution`, `dna_conc`, `dna_total` | ✅ captured |
| How much RNA? | `rna_elution`, `rna_conc`, `total_rna` | ✅ captured |
| How much protein / peptide? | `prot_conc`, `total_protein`, `peptide_conc`, `total_peptide` | ✅ captured |
| Was it acceptable? | `qc_dna`, `qc_rna`, `ms_qcheck` (Pass/Fail) | ⚠️ a verdict, but the rule behind it is not recorded |
| What was done about a failure? | `qc_fail_action`, `rna_fail` (repeat / exclude / investigate) | ✅ captured |
| Was the RNA intact? | — | ❌ **no RIN, no DV200** |
| Was the DNA intact? | — | ❌ **no DIN** |
| Was it clean? | — | ❌ **no A260/280, no A260/230** |
| How much tissue went in? | `sample_size_mm`, `pieces_taken`, `number_sections` | ⚠️ present; reliability unknown |
| Did the platform accept it? | `datafrom_cg`, `receive_rna` (dates only) | ❌ **outcome not captured, only that data came back** |

We also already record four **deviation** classes at pathology — timing, temperature, handling,
labelling (`pat_sample_prep_dev1`–`dev_4`) — plus a transport temperature range
(`transport_temp_range`).

---

## 3. The core argument, in one paragraph

**We record the suspected causes of damage but never the damage itself.** Timing delays, temperature
excursions, rough handling — these are logged carefully at pathology, and every one of them is a
mechanism that degrades RNA. But the only downstream number we capture is mass, and mass is largely
*unaffected* by degradation: shattered RNA weighs the same as intact RNA. So today a cold-chain
excursion and a clean cold chain produce identical-looking records. We cannot demonstrate that a
deviation harmed a sample, and — the part that matters more for morale and for process improvement — we
cannot demonstrate that it *didn't*. Every deviation stays an open worry forever. One integrity number
per extraction would close that loop.

That argument cuts both ways, and we should say so out loud: if the lab's cold chain is tight and the
material is nearly all fresh-frozen, integrity may be reliably fine, and measuring it routinely would
buy very little for real money and real bench time. That is a legitimate answer. We just want to know
whether it is the *reason*, or whether nobody has been asked.

---

## 4. The questions

### Q1 — Is integrity measured at all, and if so, where does the number live?
**What we have:** a Pass/Fail verdict and a total mass, and nothing else.
**What is missing:** any RIN, DV200 or DIN value in the export.
**Why it matters:** if someone is running a TapeStation or Bioanalyzer at the bench and simply not
typing the number into REDCap, then the measurement already exists and is being discarded at the point
of data entry. That is not a lab problem — it is an integration problem, and it is squarely WP2's
business. It would also be the cheapest possible win: the cost has already been paid, we are just not
keeping the result.
**Why it might not matter:** if no instrument is available, this is a purchasing conversation, not a
form-design one.
**Ask:** *"When you QC a DNA or RNA extraction, do you run anything besides the Qubit — a TapeStation,
a Bioanalyzer, a Fragment Analyzer? If so, where does that result end up, and could it come to us?"*

### Q2 — What rule does the Pass/Fail actually encode?
**What we have:** `qc_dna` and `qc_rna` as a binary Pass/Fail.
**What is missing:** the criterion. We cannot reconstruct it from the data.
**Why it matters:** the dashboard will display this verdict prominently, and we need to describe it
honestly in a caption. "Passed QC" means something very different if it is a fixed mass threshold, an
operator's judgement, or a composite that already silently includes an integrity check. If it is the
last of those, then integrity *is* being assessed — just not stored — and Q1 becomes urgent.
**Why it might not matter:** if it is a simple, stable mass threshold, we can state the threshold in
the caption and move on.
**Ask:** *"What has to be true for you to tick Pass? Is it a fixed number, and has it changed over
time?"*

### Q3 — FFPE RNA specifically: is anything gating it?
**What we have:** `sample_type1` tells us which extractions came from FFPE blocks.
**What is missing:** DV200, which is the field's standard gate for whether FFPE RNA is worth sequencing
at all.
**Why it matters:** FFPE RNA is the material most likely to pass on mass and fail on the sequencer,
because the formalin has already fragmented it. If FFPE is a meaningful share of the cohort, a
yield-only view will be systematically over-optimistic about exactly the samples most likely to fail.
Our own synthetic model already assumes a higher RNA failure rate for FFPE — we should check that
assumption against reality rather than inherit it.
**Why it might not matter:** if FFPE RNA is never sent for sequencing, or if the platform gates it on
receipt, the check exists elsewhere and we only need to know where.
**Ask:** *"For FFPE material, does anyone check DV200 before it is sent? If not, how do we know a
given FFPE RNA is sequenceable?"*

### Q4 — Purity: is it measured, and is there an instrument for it?
**What we have:** Qubit concentrations only.
**What is missing:** A260/280 and A260/230.
**Why it matters:** contaminants do not reduce the mass, they interfere with the enzymes used in library
preparation. A sample can look entirely healthy on yield and still fail downstream. A260/230 in
particular catches carryover from the extraction chemistry — a known failure mode for column-based
co-extraction kits, which is what AllPrep is.
**Why it might not matter, and this is the honest part:** the Qubit was chosen precisely because it is
insensitive to contaminants, and for many routine workflows that is a deliberate, sensible choice, not
an oversight. Adding absorbance readings means a second instrument, a second measurement per sample, and
more bench time per extraction. If library prep is not actually failing, the ratios would be data
collected for its own sake.
**Ask:** *"Do you have a NanoDrop or similar in the workflow? And separately — have you ever had a
sample that looked fine on the Qubit and then failed at the platform?"* The second half is the real
question; the first is just logistics.

### Q5 — Do the platforms run their own incoming QC, and does the result come back?
**What we have:** `send_dna` / `send_rna` (sent on), `datafrom_cg` / `receive_rna` (data came back).
**What is missing:** what the platform thought of the sample when it arrived, and what happens to
samples they reject.
**Why it matters:** the platforms almost certainly run their own QC on receipt, and that result is the
closest thing to ground truth we could ever get — someone else's independent assessment of the same
material. It would also tell us, for free, whether our own QC is calibrated correctly. As things stand,
a rejected sample appears in our data as an extraction that simply never got data back, which is
indistinguishable from one still in the queue. That is a real hole in the "stalled samples" logic on the
dashboard, not just a quality question.
**Why it might not matter:** if rejections are vanishingly rare, the effort of wiring up a feedback path
may be disproportionate.
**Ask (to Clinical Genomics and Genomics Express, not to the lab):** *"What incoming QC do you run, what
are your acceptance criteria, and can that result be returned to us in a structured form? What happens
to a sample you reject?"*

### Q6 — How is repeat / exclude / investigate decided without an integrity number?
**What we have:** `qc_fail_action` with three options, and `dna_repeat` / `rna_repeat` linking a retry
to its original.
**What is missing:** the information that would make that choice rational.
**Why it matters:** the three actions correspond to different diagnoses. *Not enough material* means
take more tissue and repeat. *Degraded material* means repeating will produce the same degraded result —
the fix is upstream, in the cold chain. Without an integrity number, the operator is distinguishing
those two cases by experience alone, and we are repeating extractions that were never going to work.
This is also the point where wasted repeats cost real tissue: `cryopowder_all_used` tells us when there
is nothing left, and a repeat that consumes the last of the material is unrecoverable.
**Why it might not matter:** an experienced operator may well read this correctly from context — the
tissue type, the deviation log, the appearance of the sample. But that knowledge then lives only in
their head.
**Ask:** *"When an extraction fails, how do you decide whether it is worth repeating? What tells you the
difference between too little and too damaged?"*

### Q7 — Has a logged deviation ever been connected to a measurable effect?
**What we have:** four deviation classes and a transport temperature range, carefully recorded.
**What is missing:** any downstream measurement sensitive enough to register the harm.
**Why it matters:** this is the argument from section 3, put directly to the people filling in the
forms. They are spending time recording deviations that currently cannot be shown to matter either way.
Either the effort is protecting something, in which case we should be able to demonstrate it, or the
deviation fields are not earning their place.
**Why it might not matter:** deviations may be recorded for regulatory or accreditation reasons, where
documenting the event is the requirement regardless of whether we can quantify its effect. Worth knowing
if that is the case, since it changes what we can propose.
**Ask:** *"Have you ever been able to link a recorded deviation to something you could measure in the
extract? If not, would you want to be able to?"*

### Q8 — Is this dictionary final?
**What we have:** a file named `TESTPMSampleCentral_DataDictionary_2026-07-09.csv`.
**Why it matters:** the "TEST" in the filename may mean these fields exist in a newer version, or are
already planned. We should not propose additions to a form that has moved on without us.
**Ask:** *"Is this the current dictionary, and are there changes already queued that we should design
against instead?"*

---

## 5. The answers we should expect, and what each would mean for us

| If the answer is… | Then the situation is… | And we should… |
|---|---|---|
| "We measure it on the TapeStation but don't record it" | An integration gap, not a lab gap | Ask for two fields. Cheapest possible fix — the measurement is already paid for. |
| "The platform checks it on receipt" | The control exists downstream | Pursue Q5: get the platform's result returned and stored. |
| "We only run Qubit, deliberately" | A considered choice under time and cost pressure | Accept it, document it in the dashboard caption, and revisit only if failures at the platform turn out to be common. |
| "We don't, and nobody has asked" | A genuine gap | Propose the fields (section 6), with FFPE RNA as the concrete argument. |
| "Those fields are already in the new version" | We are designing against a stale export | Get the current dictionary before building anything on top of yield. |

---

## 6. If fields are to be added — what to ask for, in priority order

Not everything is worth the same. If we get one ask, it should be the first.

1. **RIN, or DV200 for FFPE material** — highest value by a wide margin. RNA is the fragile fraction,
   FFPE is in the cohort, and this is the number that separates "not enough" from "too damaged".
2. **The platform's incoming-QC outcome**, including rejections — someone else's measurement, free to
   us, and it also repairs the stalled-sample logic on the dashboard.
3. **A260/230** — catches carryover from the extraction chemistry, the failure mode most relevant to a
   column-based co-extraction kit.
4. **A recorded input amount** (tissue mass or volume actually put into the extraction) — not a quality
   measure, but without it yields cannot be fairly compared between samples, so it limits the yield use
   case too.
5. **A260/280** — lowest marginal value here, because the Qubit already sidesteps the protein problem
   for quantification. Worth having if a spectrophotometer is in the workflow anyway; not worth buying
   one for.
6. **DIN** — DNA is robust enough that this is optional outside FFPE.

---

## 7. What blocks the dashboard, and what does not

**Blocking the yield use case:**
- Q2 (what Pass/Fail means) — we cannot caption the chart honestly without it.
- Q5 (platform acceptance) — without it, "stalled" and "rejected" are indistinguishable in our data.
- The concentration units question already open in `data-inventory.md` (Q4 there) — it was parked as a
  data note, but a yield threshold cannot be drawn without knowing the unit. **It is now a blocker.**

**Not blocking — worth asking anyway:**
- Q1, Q3, Q4, Q6, Q7. These shape what we *recommend*, and they may change the schema for the better,
  but the November showcase can ship a yield view without them, as long as it is captioned as a yield
  view and not called a quality view.

---

## 8. The short version, for a meeting

> Our export tells us how much DNA and RNA came out of each sample, and whether an operator ticked Pass.
> It does not tell us whether the material was intact or clean. Those are different failure modes: RNA
> can be plentiful and still be too broken to sequence, and FFPE tissue makes that likely. We also record
> four kinds of deviation at pathology — timing, temperature, handling, labelling — but we capture nothing
> downstream that would register their effect, so we can neither prove a deviation caused harm nor clear
> it. One integrity number per extraction would close that loop. Before we propose adding fields, we want
> to know whether these measurements are already being taken and simply not stored, or whether the
> platforms are catching this on receipt — and if neither, whether the lab considers it worth the bench
> time. All three are reasonable answers; we just need to know which one is true.
