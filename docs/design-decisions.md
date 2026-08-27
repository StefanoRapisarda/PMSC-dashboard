# PM-SC Dashboard — design decisions and rationale

*A record of the choices behind the WP2 dashboard: what each choice is, why we made it, and what
we rejected. A companion clickable demo (`demo.html`, self-contained, no network) shows the concept;
full detail lives in `knowledge-graph-design.html`.*

---

## What we are building

The **WP2 dashboard** is a web app that answers the operational questions around biosample handling —
*where are my samples, what's stuck, did QC pass, did the omics come back* — and, where the question is
about **how things connect**, visualises the sample metadata as a **knowledge graph**.

The November milestone is a **proof of concept (showcase)**: the real frontend, driven by **synthetic
data** generated from the REDCap schema. Synthetic data is a feature here, not a fallback — it lets us
exercise the failure paths (stalls, QC failures, repeats) on demand, which sparse early live data would
not even contain yet. Because the graph is a *derived, rebuildable* layer (see Architecture), the later
switch to live data is **a data-source change, not a redesign**.

---

## What this is — and what it is not

**This is a *provenance* graph.** It accounts for known physical samples and their history across
systems: origin, custody, processing, QC, deviations, and the cross-system identity chain.

**It is *not* a discovery or real-world-evidence (RWE) graph.** It holds no molecular or outcome data
and generates no biological findings. Asking "what real-world evidence can a researcher extract from
this" is a category error — there is nothing to correlate.

Its value to future evidence is as the **traceability foundation** that makes downstream analysis
defensible: the questions a reviewer asks of an omics cohort — *is this sample what it claims to be, do
we know its full lineage, were there deviations, is the ID chain intact?* — are exactly the questions
provenance answers. Provenance does not *produce* RWE; it is the layer that must exist before RWE is
**credible**. Coupling this spine with omics results and clinical outcomes (see Now/Future) is what would
later make cohort and biomarker discovery possible — and trustworthy.

---

## Now / Future

Every capability is recorded twice: what is real in the November showcase, and how the design leaves room
for it to grow. The *Kind* of expansion is tagged so it is clear which future items are a simple swap and
which are a genuine new capability.

- **Data-source** — synthetic → live; the premise of the whole showcase, no redesign.
- **Scale** — more nodes / more traffic; engineering, no redesign.
- **Scope** — a genuinely new capability that changes what the tool *is*.
- **Operations** — turning a demo into a running, accessed, monitored service.

| Feature | Now — November showcase (synthetic) | Future — production | Kind |
|---|---|---|---|
| **Data & pipeline** | Synthetic dataset generated from the REDCap dictionary; rebuilt on demand | Automatic **weekly** pipeline from REDCap; canonical conversion (OMOP) once data spans multiple sites, where harmonization makes it necessary; dashboard & graph rebuilt from live exports | Data-source |
| **Dashboard** | KPI tiles, Sankey flow, QC-by-type, turnaround, attention list — all computed from the synthetic snapshot; static page | Weekly-refreshed page over live data; role-based access; alerting on new stalls / QC failures | Data-source + Operations |
| **Sample workflow** | Annotated stage strip with a live count per stage, fanning out at AllPrep | Stage occupancy over live data (weekly refresh); alerts when a stage stalls | Data-source + Operations |
| **Knowledge graph — rendering** | SVG + a layout library (ELK/dagre); hundreds of nodes on screen; stage-locked static layout | Canvas / **Cytoscape.js** at 10⁴+ nodes; live re-layout, expand/collapse, minimap | Scale |
| **Knowledge graph — scope** | Provenance graph (labelled, directed): known physical objects and their lineage | **+ omics results + clinical outcomes** (CKG spine) → cohort & biomarker queries; toward discovery / RWE | Scope |
| **Provenance / trace** | Click a node → cross-system ID chain (the part the data holds) + trace to origin / results | Full identity chain across every handoff as the missing IDs are sourced; richer cross-system reconciliation | Data-source |
| **Facets & search** | Categorical + graph-native facets from the synthetic value sets; global ID search | Same over live data; saved cohorts; export | Data-source |
| **Access & deployment** | Self-contained static page (no network) | Deployed service with authentication; weekly-refreshed live data | Operations |

---

## Design decisions & rationale

Below, each choice with the reason in one line and the alternative we rejected.

### 1 · Technical stack

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Frontend | **SvelteKit + TypeScript** | Light, fast, gentle learning curve; matches the existing `DataHampPlatPrototype` | React (heavier), plain JS (no structure) |
| Backend | **FastAPI / Python** | Reuses our Python fluency — same language as the OMOP mapping and data work | Node backend (a second language to own) |
| Graph rendering | **SVG + a layout library (ELK/dagre)** *(decided for the PoC)* | At showcase scale the browser hands us hit-testing, styling, export and accessibility for free; the only hard part left is **layout**, which a small library computes | Cytoscape.js — deferred to the *future* (Scale): it earns its keep only at 10⁴+ nodes with live re-layout / expand-collapse / minimap |
| Charts | A JS chart library (**ECharts**, leaning) | Sankey + funnel + heatmap out of the box | d3 modules (assemble yourself — more control, more work) |
| Data | Synthetic, generated from the REDCap dictionary | No live pipeline data exists by November; synthetic lets us script the failure paths | — |

**On the rendering choice (why SVG now, Cytoscape.js later).** The line between "small" and "big" graphs
is not a node count — it is three questions: *how many nodes are on screen at once*, *is the layout
static or recomputed live*, and *do we need heavy interactive features (minimap, expand/collapse, live
re-layout)*. By all three tests our showcase is a small-graph problem: a stage-locked layout computed
once, filter-then-expand keeping the visible set to hundreds of nodes, and no live-interaction features.
SVG is comfortable there and less code we do not understand — better for the learning goal too. Cytoscape.js
(the browser library — *not* the Cytoscape desktop application) becomes the right tool only when the
graph grows large and interactive enough that we would otherwise reinvent it badly. That is the *future*
column, not an open decision.

### 2 · Architecture

- **The graph is a *derived, rebuildable* layer — not the system of record.** REDCap (later the
  LIMS/platform APIs) stays authoritative; we rebuild the graph from an export — on demand now, on a
  weekly cadence in production — never hand-edit it. *Consequence:* the synthetic→live switch is just a
  new data source, and a bad build is never data loss.
- **Hybrid by design.** The *design* serves counting questions (the Sankey flow, QC rates, turnaround) from a
  **relational/tabular** store, and traversal questions (provenance, "what's stuck", cohort assembly)
  from the **graph** — each tool for what it is good at, don't render a bar chart as a hairball. *(In the
  showcase both are precomputed from the synthetic source; the two-store split is the production shape.)*
- **Four views, split by the *kind* of question:** *Workflow* (what is the process) · *Dashboard* (is it
  healthy — counting) · *Knowledge graph* (how is it connected — traversal) · *Provenance* (what happened
  to this one).
- **State lives in the URL.** Facet + selection state is encoded in the query string → any view is
  shareable in an email ("this sample is stuck") and the demo is reproducible.
- **One reactive store per cross-cutting control** (e.g. the "as of" date) that every view derives from.

**Data flow — how the dashboard and graph are built.**
*Now (showcase):* a synthetic dataset generated from the REDCap dictionary is the single source; the
dashboard and graph are built directly from it (precomputed, no live backend).
*Future (production):* an automatic pipeline ingests from REDCap and rebuilds the dashboard and graph on a
**weekly** cadence. Whether it first converts to a **canonical model (OMOP)** depends on scope: a single
source may not require it, but once data is aggregated across multiple Swedish sites, **harmonization makes
it necessary** — so at national scope OMOP (or an equivalent canonical form) is the likely target. If OMOP
is used, the REDCap→OMOP transform *is* the WP2 OMOP-mapping / ontology work (§3): the same effort that
anchors node typing (§3) also materialises the production pipeline. This pipeline is the "builder" the
*derived/rebuildable* principle names — because it is the single point of change, swapping synthetic for
live is a data-source change, not a redesign.

### 3 · Knowledge-graph design

**Graph type — a labelled, directed knowledge graph, used as a *provenance* graph.** Nodes have types,
edges have types and direction, and edges can carry attributes (for example `submitted {sent_on, volume}`).
Technically this is a labelled property graph (LPG). It is not a *discovery* graph like Hetionet/PrimeKG —
those predict unknown links over millions of nodes; ours **accounts for known physical objects** at 10³–10⁵
scale. (See "What this is — and what it is not".)

**Ontology / semantic backbone** — we don't invent vocabulary, we adopt:
- **PROV-O** for the provenance spine — Entity (specimen/aliquot) · Activity (sectioning, cryoprep,
  AllPrep, MS) · Agent (operator, facility). A W3C standard that already answers "derived from what, by
  whom."
- **CKG** (Clinical Knowledge Graph, *Nat Biotechnol* 2022) for the biological spine —
  Patient → Biological_sample → Analytical_sample. Same domain, proven. *(This is also the destination
  for the graph's future scope expansion.)*
- **Node typing anchored to** OMOP (Patient→Person), SNOMED-CT (clinical vars), MIABIS/SPREC (specimens).
  *This is literally our WP2 OMOP-mapping work — the field mapping IS building the ontology.*

**Node types — 12 in total.** Promotion rule: a field becomes a node only if it is *shared* (many
things point at it), has *its own attributes*, or you *traverse through it*. **Bold = core node with its
own data; plain = thin root/context node, kept for structure but with little or no data of its own.**

> Study · **Patient** · **Specimen** · **AnalyticalSample** (DNA/RNA/Protein/Peptide) · **QCResult** ·
> **Deviation** · **Activity** · **PlatformRun** · **Facility** · **Staff** · **StorageLocation** ·
> **Identifier**

*Study is a thin root node.* The dataset is a single study, and REDCap has no study-level field of its own
(`study_id`, despite the name, is a per-patient identifier — part of the `Identifier` ID chain, not a study
entity). Study is kept as the root every patient hangs off. It becomes a real node with attributes and
multiple values once data spans several studies or sites (the same multi-site case that forces OMOP
harmonization — see Data flow).

*Note the collapses:* the six operator fields → **one** `Staff` node (role on the edge). The five ID
fields → `Identifier` nodes — because **the cross-system ID chain is the WP2 deliverable**.

*The MTB step is an event, not an entity.* REDCap holds a single MTB field (`order_date`, the date the
case was placed to the Molecular Tumor Board Portal). It has one attribute and nothing downstream, so it
is not a node type — it is an instance of the existing `Activity` type (the last event in the workflow),
carrying `order_date`. It remains the final stage of the workflow strip and the Sankey flow. A richer
tumor-board concept (molecular findings, treatment decisions) is future scope, not present in the data.

**Edges (~20 types), each carrying attributes:** `HAS_SPECIMEN` · `IDENTIFIED_AS` · `DERIVED_FROM` ·
`SUBMITTED_TO {sent_on, volume}` · `RETURNED_DATA {returned_on}` · `HAS_QC` · **`REPEAT_OF`** (the schema
literally encodes this — `dna_repeat`/`rna_repeat` hold the retry's ID) · `PERFORMED {role}` ·
`STORED_AT {from, to}` · `HAS_DEVIATION` · … *(full edge list in `knowledge-graph-design.html`)*

**Node attributes** stay as properties when they're not shared and you don't traverse them: concentrations,
yields, buffers, volumes, dates, comments, colour. (Of 124 variables: ~35 become nodes, ~25 edges/edge-props,
~49 stay properties, ~15 dropped.)

### 4 · The three user cases we optimised for

Everything is built to serve exactly these three decisions:

1. **Spot a stalled or failed sample and act on it.** → "stuck" is the *absence of a next edge*; the
   attention list + the "Stalled / QC failures" graph views.
2. **Trace one sample's full provenance across systems.** → click a node → its cross-system ID chain +
   "trace to origin / results". The sample is re-identified at each institutional handoff
   (Hospital → Surgery → Pathology → CCK → PMSC → TCB); reconciling these identities is the WP2 deliverable.
   The current data captures only part of the chain — see Open questions.
3. **Judge whether the pipeline is healthy** for a study or sample type. → Sankey flow, QC-by-type,
   turnaround, filterable.

### 5 · KPIs (numbers to display)

The headline tiles — all computed from the data, never hard-coded:

- **Patients enrolled** · **Specimens collected** · **Aliquots** (the cohort size)
- **QC pass rate %** — pipeline quality. Computed as passed ÷ (passed + failed), excluding aliquots not
  yet QC'd (the "resolved" aliquots).
- **Reached data-back %** — throughput. Computed as (specimens with ≥1 result returned) ÷ (all collected
  specimens).
- **Stalled samples** (count) — the daily action number. A stalled sample is **any object — a specimen or
  an aliquot — that has had no next step for longer than a set threshold** (provisionally 30 days; see Open
  questions). "No next step" means the absence of a next edge in the graph. Both are counted, so a specimen
  stuck before it is split (e.g. sitting at pathology, no aliquots yet) is caught as well as an aliquot
  stuck later (e.g. an RNA aliquot never sent). Each stuck object is one item to act on; the count mixes
  units by design, because it is a to-do list, not a flow chart.

Plus, on the dashboard body: the **Sankey flow** (Collected → Pathology → PMSC → AllPrep → QC pass →
Submitted → Data back → MTB, with the specimen stream splitting into DNA / RNA / protein aliquot streams at
AllPrep), **QC pass/fail by sample type**, and **turnaround** (separating hands-on time from the 3–5 days of
platform + analysis waiting — otherwise a long bar reads as inefficiency).

> Counting-unit discipline: ribbon width is a **count**, and the unit changes at the split, shown
> explicitly — **specimens** before AllPrep, **aliquots** after (one specimen becomes up to three aliquots).
> Never put patients and specimens in the same stream (one patient can give two specimens). Specimen-level
> KPIs such as *Reached data-back %* still roll aliquots back up to their specimen (a specimen counts if at
> least one of its aliquots reached the stage).

### 6 · Graphical choices per view

- **Sample workflow** → an **annotated stage strip** (the pipeline as columns with a live count per stage),
  fanning out at AllPrep into DNA/RNA/Protein. The idiom that says "here is the process, here is where
  things are."
- **Dashboard** → **chart-first**: a **Sankey flow** (the specimen stream fanning out into DNA/RNA/protein
  at AllPrep, with per-stream drop-offs), stacked QC bars, KPI tiles, a clickable attention list. Charts are
  computed by aggregating the relational/tabular store.
- **Knowledge graph** → **layered node-link, x-axis locked to pipeline stage** (Patient → Specimen →
  Aliquot → Platform → MTB), *not* force-directed. The data flows one way in time and never loops (a
  directed acyclic graph, DAG), so we lay it out left-to-right by stage; a force-directed layout (nodes
  floating freely, positioned by a physics simulation) would scramble that order everyone already knows.
  Hue = node type; **red ring = QC fail**; dashed red = repeat; shape doubles the colour so it survives
  greyscale. Force/3D layouts are kept only for an *Explore* mode, not the default.

### 7 · Facets, filters & visualisation options in the graph

- **By node type** — the 12 node types (toggle; doubles as legend).
- **Categorical** — sample type, molecule, QC outcome, tube type, instrument, buffer… (straight from the
  REDCap value sets).
- **Graph-native** (the useful ones a table can't offer) — **stage reached**, **stalled beyond the
  threshold** (see Open questions), **has repeat**, **deviation count**, **orphan** (no parent). Computed
  from topology.
- **Interaction rule that matters:** *filter, then re-expand along paths.* Filtering to "QC = fail" shows
  the failures **and how they got there** (their provenance path dimmed in), never a field of disconnected
  dots.
- **Views/actions:** click = select + inspector; "trace to origin / results" = one-click provenance; the
  three use-case buttons; global ID search (paste any captured ID → land on the object; which IDs are
  available depends on the ID-chain open question).

---

## Open questions (to confirm with the team)

- **The cross-system ID chain — which IDs are actually captured?** The sample is re-identified at each
  institutional handoff: Hospital → Surgery → Pathology → CCK → PMSC → TCB. Reconciling these identities is
  the WP2 deliverable. The IDs are generated by the workflow, but the REDCap form is filled in by PMSC staff,
  so the export holds IDs for only part of the chain: study/enrollment (`study_id`), pathology PAD number
  (`pat_sample_id_1`), biobank tube barcode (`tube_label`), and PMSC IDs (`pmsc_id`, `pmscid_dna`,
  `pmscid_rna`). Surgery appears only as a date (`sample_date`); CCK has no ID field; TCB has only the MTBP
  `order_date`. **Ask the team:** which IDs are captured, where the missing ones live, and whether the full
  chain can be assembled from other systems.
- **What are CCK and TCB?** Confirm full names and roles (working guesses: CCK = Cancer Centrum Karolinska;
  TCB = unknown).
- **OMOP as the canonical model** — whether the production pipeline converts to OMOP depends on multi-site
  scope; needed for harmonization across sites, maybe not for a single source (see Data flow). Unconfirmed.
- **The stall threshold** — how many days without a next step counts as stalled? Provisionally 30. Also
  decide whether a single threshold fits all stages, or whether different stages need different thresholds:
  platform analysis legitimately takes 3–5 days, so one flat number may flag normal waits as stalls or miss
  genuinely stuck samples. Discuss with the group.

---

*Files: `demo.html` (the clickable concept) · `knowledge-graph-design.html` (the full report). All data is
synthetic. PreDDLung is an internal pilot name — describe the data as "synthetic, modelled on verified
Swedish platform-trial analogues (MEGALiT, FOCU.SE)", not a published study.*
