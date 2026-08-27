# Decisions on dataset variables

Variable-level calls made while building the synthetic dataset
(`data/`, 2026-08-20). Each entry records what the dictionary says, what we did,
and why. Companion to `docs/data-inventory.md`, which records what each variable
*means*; this file records what we *did about it*.

The dataset is generated to the dictionary, not to the dashboard: all 124 fields
are populated where branching logic allows, including fields no view reads.
These are the points where that was not possible or not sensible.

---

## 1. `date_spec` — a field that is piped but never defined

**Dictionary:** the `summary` instrument pipes `[date_spec]` into
`spectronaut_sum`, the last step of the per-sample timeline. No field named
`date_spec` is defined anywhere in the dictionary.

**Decision:** generate it, and append it to the export as a column outside the
dictionary's 141, flagged in `emit.DECLARED_ADDITIONS`.

**Why:** without it the timeline ends with a hole at the final step. Adding it as
a clearly separate column keeps the dictionary-derived part of the export exactly
faithful while still producing a complete timeline.

**Open with the team:** this looks like a genuine defect in the REDCap project —
either the field was deleted after the pipe was written, or it was never created.
Worth raising; it is item 7 in the data-inventory's open questions.

---

## 2. Concentration units are inverted in the dictionary

**Dictionary:** `dna_conc` and `rna_conc` carry the unit "µl/µg"; `peptide_conc`
carries "ng/µg". All three are inverted or dimensionless — a concentration is
mass per volume.

**Decision:** generate physically sensible values — DNA, RNA and peptide in
ng/µl, protein in µg/µl — and leave the field labels untouched.

**Why:** reproducing a probable typo would bake a data-quality defect into the
showcase and make every derived number wrong by construction. The calc fields are
still computed with the dictionary's own formulas, so `dna_total` and `total_rna`
come out in ng rather than the µg their labels claim. That inconsistency is the
dictionary's, and it is preserved rather than silently corrected.

**Open with the team:** item 4 in the data-inventory's open questions. This is a
real data note to raise regardless of the dashboard.

---

## 3. `total_peptide` divides by 20

**Dictionary:** `total_peptide = [peptide_elution] * [peptide_conc] / 20`.

**Decision:** use the formula exactly as written.

**Why:** the constant is presumably a protocol-specific dilution or aliquot
factor. We do not know what it represents, and inventing a different one would be
worse than carrying an unexplained one. Item 5 in the open questions.

---

## 4. Protein and peptide aliquots have no identifier field

**Dictionary:** DNA and RNA aliquots have `pmscid_dna` and `pmscid_rna`. The
proteomics instrument has no equivalent — it re-enters `pmsc_id` as
`pmsc_id_v2_v2` and addresses the protein and peptide fractions through it.

**Decision:** in the graph, derive `<pmsc_id>-PROT` and `<pmsc_id>-PEP` as node
identifiers. These are **not** written to the export, because they do not exist
in the source.

**Why:** the graph needs addressable nodes for the protein and peptide fractions
to hang QC, storage and mass-spec runs off. Deriving them in the builder keeps
the export faithful while giving the provenance graph the objects it needs.

**Consequence for the ID chain:** the cross-system chain is complete for DNA and
RNA and stops at `pmsc_id` for proteomics. If per-aliquot proteomics IDs matter
for WP2, that is a gap in the eCRF, not in the dashboard.

---

## 5. The peptide digest is not a fourth aliquot

**Decision:** AllPrep yields three fractions — DNA, RNA, protein. The peptide
digest is the protein fraction after SP3, so it is counted inside the protein
stream. It remains a separate node in the graph, linked `DERIVED_FROM` the
protein fraction.

**Why:** SP3 converts the protein into peptides; it is the same material in a
different state, not an additional extraction. Counting it separately would
inflate the aliquot KPI and put a fourth ribbon in the Sankey that does not
correspond to anything AllPrep produced.

---

## 6. QC is recorded when it happens, not when the aliquot is created

**Decision:** an aliquot extracted but not yet measured has its identifier,
elution volume, buffer and storage location filled, and its concentration, total
and QC outcome empty.

**Why:** the Qubit measurement is a later step than the extraction. Writing QC
values at extraction time would make the `allprep` stage unreachable — every
specimen would appear to have been QC'd the moment it was extracted, and the
stalled-at-AllPrep case would never occur.

---

## 7. `qc_dna` is a checkbox, `qc_rna` is a radio

**Dictionary:** the two QC outcome fields are typed differently, as are their
fail-action fields (`qc_fail_action` checkbox, `rna_fail` radio), despite holding
the same value sets.

**Decision:** reproduce both exactly. The export therefore has `qc_dna___1` and
`qc_dna___2` columns but a plain `qc_rna` column, and the normalizer decodes each
according to its declared type.

**Why:** this is what the live export will look like. It is a small inconsistency
in the instrument design, and code that assumes the two are alike would break on
real data.

---

## 8. Blood taken for the biobank ends at pathology

**Decision:** a blood specimen with `sample_blood_ven_biob` set and no `pmsc_id`
is complete at pathology. It is not counted as stalled, however long it sits.

**Why:** "stalled" means no next step when one is still expected. Biobanked blood
has no next step by design. Without this rule the stalled count would be
dominated by 56 blood specimens behaving exactly as intended.

**Consequence for the KPIs:** the same specimens cannot reach an omics result, so
including them in the *reached data-back* denominator understates throughput.
Both denominators are reported in `aggregates.json`; the tile needs one chosen.

**A gap this exposed.** Nothing in the dictionary records that a blood tube is
*earmarked* for extraction rather than for the biobank — the distinction only
becomes visible once a `pmsc_id` is assigned. So a blood specimen that gets stuck
before PM-SC registration is indistinguishable from one correctly biobanked, and
no dashboard built on this export can flag it. The generator therefore does not
plant such a case, because it could not be detected downstream. This is a real
limitation of the eCRF, worth raising with the team: it is a class of stuck
sample that is currently invisible.

---

## 9. `sample_type` gets exactly one box checked

**Dictionary:** `sample_type` is a checkbox with Blood / Tissue / Biopsy / FFPE /
Other, and the categories overlap — FFPE is a processing state and Biopsy a
collection method, neither a clean peer of Tissue.

**Decision:** since a record is one specimen, exactly one box is checked, chosen
to describe that specimen: Blood, FFPE, Biopsy, or Tissue.

**Why:** multi-checking would make the record's own type ambiguous and the
sample-type facet unusable. This sidesteps rather than resolves the taxonomy
problem — item 3 in the open questions, still to raise with Rita.

---

## 10. `res_sub_email` is generated as unroutable

**Decision:** every address is `coordinator.pdl####@example.invalid`.

**Why:** the field is labelled as the patient's email, which the data inventory
flags as unlikely in a pseudonymised study, and it is out of scope for the
dashboard. `.invalid` is reserved by RFC 2606 and can never resolve, so no
generated address can collide with a real one.

---

## 11. Fields generated but not read by any view

`res_sub_email`, `other_studies`, `if_other`, `sample_comments1`,
`sample_comments2`, `prep_wash`, `sample_color`, `sample_size_mm`,
`cryopowder_remain_am`, the comment fields, and the storage triples for material
that never moves.

**Decision:** generate them all.

**Why:** the generator's contract is the dictionary, not the dashboard. If a view
later needs one of these, the data is already there; if the dashboard changes,
the dataset does not have to be regenerated.
