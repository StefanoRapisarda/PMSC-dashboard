# Use Cases

## 1. Find samples that have stopped moving

**Scenario**: A lab coordinator wants to know which specimens are stuck and what each one is waiting for, so that someone can act on it.

**Input**: The seeded database and the 30-day stall threshold in `api/app/config.py`.

**Process**:
1. The builder marks each specimen with `stalled_days` when it still has an open stream and its last recorded step is older than the threshold.
2. The seeder copies that value into `specimen.stalled_days`.
3. `analytics.kpis()` counts specimens with a non-null value for the dashboard tile, and `analytics.attention()` lists them oldest first with the streams each one is waiting on.
4. In the graph view, the "clustered by outcome" layout gathers stalled material into its own ball.

**Output**: The "Stalled samples" tile reads 12, and the clustered layout shows a "stalled" ball.

**Notes**: The dashboard no longer renders the attention list, because that panel is reserved for the team to define, but `/api/overview` and `/api/attention` still return it. The builder's own count is 13, because it also counts one consented patient still awaiting collection. The API cannot count that patient, because the specimen table holds only collected specimens.

---

## 2. Trace one specimen's provenance

**Scenario**: A researcher wants to know where a particular aliquot came from, who handled it, where it is stored, and which systems know it by which identifier.

**Input**: A node selected in the graph view, or an identifier pasted into `/api/search`.

**Process**:
1. Right-click the node and choose "Highlight path", which calls `GraphModel.lineage()` to walk the provenance spine upstream and downstream.
2. `withAttachments()` adds the identifiers, storage boxes and operators one hop away.
3. The page fades everything else and marks the faded nodes as inert so that a stray click cannot replace the selection.
4. Opening the path window draws the same chain on a real date axis, one row per kind of node.

**Output**: A highlighted chain from patient to the MTB Portal in the graph, including the information systems behind each identifier,, and a dated timeline of the same steps.

**Notes**: Only spine edges are walked, so a shared freezer box does not pull in every unrelated aliquot stored in it. Siblings are excluded, so the RNA from a specimen is not part of the DNA aliquot's path.

---

## 3. Judge pipeline health by sample type

**Scenario**: A stakeholder wants to know whether some kinds of material perform worse than others.

**Input**: The overview payload.

**Process**:
1. `analytics.sample_types()` reports specimen and aliquot counts and shares for each type.
2. `analytics.qc_by_sample_type()` groups pass and fail counts by sample type and molecule.
3. The dashboard draws the donut beside per-type QC bars with the pass rate in its own column.

**Output**: A card that shows, for example, that FFPE RNA fails more often than fresh-frozen RNA.

**Notes**: The pass rate is computed over resolved aliquots only, which is the same definition the KPI tile and the cohort flow use. QC here means concentration, total yield and a pass or fail flag. The schema records no RIN, DV200 or purity ratio, so the application cannot say whether material was intact.

---

## 4. Explain where the turnaround time goes

**Scenario**: The team wants the headline feasibility number, median time from surgery to tumour board, and wants to know which part of it is in its own hands.

**Input**: Activity dates, platform-run dates and collection dates in the database.

**Process**:
1. `analytics.turnaround()` collects the earliest date of each activity kind per specimen.
2. It measures six segments per specimen, with the analysis labs measured from the first dispatch to the last result because the three fractions are analysed in parallel.
3. It sums segment medians into pre-analytical, analytical and post-analytical phases.
4. `Turnaround.svelte` draws a strip whose segment widths are median days and flags the longest in-house segment.

**Output**: A median of 39 days end to end, of which 18 are spent at the analysis labs. The longest in-house segment is the 8 days from results to tumour board, closely followed by the 7.5 days a specimen is held at pathology.

**Notes**: Medians do not add, so the segments will not sum exactly to the headline figure, and a test keeps the gap under 15%. The proteomics lab records a return date but no send date, so its own wait is reported as unmeasurable.

---

## 5. Publish the showcase as a static site

**Scenario**: Colleagues need a link to the demo without installing anything.

**Input**: A push to `main`, or a manual run of the Pages workflow.

**Process**:
1. The workflow regenerates the cohort, builds the graph with `--web /tmp/discard`, and seeds the database.
2. `api/export_static.py` writes `meta.json`, `overview.json` and `graph.json` to `web/static/data/`.
3. Vite builds with `BASE_PATH` set to the repository name and `VITE_STATIC_DATA=1`.
4. `build:pages` copies `index.html` to `404.html`, so that GitHub Pages serves the application for deep links such as `/graph`.

**Output**: The same three views at a GitHub Pages address, backed by about 520 KB of JSON.

**Notes**: Specimen detail and search are unavailable in this mode, because they have no published file. The client throws a clear error for any other path.

---

## 6. Run the whole system in one container

**Scenario**: Someone wants to hand the application to a colleague or put it on a server.

**Input**: Docker Desktop and the repository.

**Process**:
1. Stage one installs the front end's packages with Node and runs `npm run build` with an empty `VITE_API_BASE`, so every request is relative.
2. Stage two installs the API's packages, generates the cohort, builds the graph, and seeds the database at image-build time.
3. It copies the compiled front end in, switches to a non-root user, and starts uvicorn on `0.0.0.0:8000`.
4. `SinglePageApp` serves the built files and answers unknown paths with `index.html`.

**Output**: One image of about 420 MB that serves the API and the front end from a single origin and reports healthy through `/healthz`.

**Notes**: The Dockerfile uses `npm install` rather than `npm ci`, because the lock file was produced on a Mac and contains no Linux build of Rollup.

---

## 7. Point the builder at a real REDCap export

**Scenario**: Live data arrives and the team wants to see it in the dashboard.

**Input**: A REDCap CSV export and its snapshot date.

**Process**:
1. Run `python3 data/builder/build.py --export <file> --as-of <date> --stall-threshold 30 --web /tmp/discard`.
2. Read the normalizer's report of patients whose repeated enrollment fields disagree.
3. Check for unexpectedly empty columns, because an undefined choice code decodes to `None` instead of failing.
4. Seed the database and restart the API.

**Output**: The same views over real data, with no change to the API or the front end.

**Notes**: The pipeline assumes one record per specimen. A project that uses repeating instruments would export `redcap_repeat_instrument` columns and need an extra grouping pass in `normalize.py`. The builder refuses to guess the snapshot date when there is no manifest.
