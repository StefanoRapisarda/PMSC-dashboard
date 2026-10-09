# Components

## Data Pipeline Components

### Dictionary (`data/common/dictionary.py`)
- **Responsibility**: This parses the tab-separated REDCap dictionary into `Field` records and derives the export's full column list, including checkbox expansion and one `<form>_complete` column per instrument.
- **Key Methods**: `load()`, `Dictionary.export_header()`, `Dictionary.choice_code()`, `Field.export_columns()`
- **Dependencies**: The standard library `csv` and `dataclasses` modules, and the vendored dictionary file.
- **Complexity**: Simple

### Generation config (`data/generator/config.py`)
- **Responsibility**: This holds every number the simulation uses, from the seed and the snapshot date to QC failure rates, stall settings, per-step day ranges and assay value ranges.
- **Key Methods**: `SEED`, `AS_OF`, `N_STALLED`, `STALL_THRESHOLD_DAYS`, `P_RNA_FAIL_FFPE`
- **Dependencies**: None.
- **Complexity**: Simple

### Simulation (`data/generator/model.py`)
- **Responsibility**: This simulates the cohort in six ordered phases. It builds patients, assigns specimen kinds by quota, lays out an ideal timeline with QC decided up front, truncates by the snapshot date and by forced stalls, creates repeat records for failed aliquots, and finally writes REDCap field values for the steps that actually happened.
- **Key Methods**: `Simulation.run()`, `_plan()`, `_decide_qc()`, `_assign_stalls()`, `_truncate()`, `_make_repeats()`, `_fill_values()`, `open_streams()`, `is_stalled()`
- **Dependencies**: `config.py` and the standard library `random` module seeded from `SEED`.
- **Complexity**: Complex
- **Behavior notes**: `_order_same_day_times()` sorts already-drawn clock times rather than redrawing them, because a redraw would shift every later random value and change the whole cohort.

### REDCap emitter (`data/generator/emit.py`)
- **Responsibility**: This encodes domain values as REDCap would export them and writes the CSV, adding the declared extra column `date_spec`.
- **Key Methods**: `write_export()`, `record_row()`, `_encode()`, `_form_status()`
- **Dependencies**: `dictionary.py`.
- **Complexity**: Simple

### Normalizer (`data/builder/normalize.py`)
- **Responsibility**: This decodes codes back to labels, groups records by `study_id`, collapses each patient's repeated enrollment fields into one row while reporting any disagreement, and writes `patients.csv` and `samples.csv`.
- **Key Methods**: `normalize()`, `decode_row()`, `collapse_patient()`, `write_tables()`
- **Dependencies**: `dictionary.py`.
- **Complexity**: Moderate

### Graph builder (`data/builder/graph.py`)
- **Responsibility**: This turns the normalized tables into a labelled, directed graph of thirteen node types, with every cross-system identifier promoted to a node. It also derives `stage_reached` and `stalled_days` for each specimen without reading the clock.
- **Key Methods**: `GraphBuilder.build()`, `_specimen()`, `_aliquots()`, `_aliquot()`, `_mass_spec()`, `stage_of()`, `open_streams()`, `stalled_days()`, `identifier()`
- **Dependencies**: The standard library `datetime` module.
- **Complexity**: Complex

### Aggregates (`data/builder/aggregates.py`)
- **Responsibility**: This computes KPIs, the flow, QC by sample type, turnaround, the stage distribution and the attention list from the normalized tables. The running API recomputes all of these in SQL and never reads this file's output.
- **Key Methods**: `build()`, `_kpis()`, `_flow()`, `_turnaround()`, `_attention()`
- **Dependencies**: `graph.py`, from which it reuses `STAGES` and the `GraphBuilder` stage logic.
- **Complexity**: Moderate
- **Behavior notes**: It passes its `GraphBuilder` to `_attention()` through a module-level list `_GB`, which works but couples two functions through hidden state.

---

## API Components

### Configuration (`api/app/config.py`)
- **Responsibility**: This resolves file paths, the database URL, the stall threshold, the stage order, the molecule list and the CORS origins.
- **Key Methods**: `DATABASE_URL`, `GRAPH_JSON`, `REDCAP_CSV`, `WEB_DIR`, `STALL_THRESHOLD_DAYS`
- **Dependencies**: The environment variable `PMSC_WEB_DIR`.
- **Complexity**: Simple

### Database session (`api/app/db.py`)
- **Responsibility**: This creates the SQLAlchemy engine, switches on SQLite foreign-key enforcement for every connection, and yields one session per request.
- **Key Methods**: `engine`, `SessionLocal`, `get_session()`, `_enable_foreign_keys()`
- **Dependencies**: SQLAlchemy and `config.py`.
- **Complexity**: Simple

### ORM models (`api/app/models.py`)
- **Responsibility**: This declares fourteen tables with typed `Mapped[...]` columns. Thirteen hold entities, and `Edge` holds every relationship as `(src_type, src_id, dst_type, dst_id, type)` for traversal.
- **Key Methods**: `Study`, `Patient`, `Specimen`, `Aliquot`, `QCResult`, `PlatformRun`, `Activity`, `Identifier`, `InformationSystem`, `Edge`
- **Dependencies**: SQLAlchemy's declarative API.
- **Complexity**: Moderate

### Seeder (`api/app/seed.py`)
- **Responsibility**: This loads `graph.json` and the raw export into the database in dependency order, resolving each graph edge into a foreign key where one exists and copying every edge into the `edge` table.
- **Key Methods**: `seed()`, `main()`, `_split_location()`, `_date()`
- **Dependencies**: `models.py`, `db.py` and the builder's output files.
- **Complexity**: Complex
- **Behavior notes**: It reads `ms_qcheck` from the CSV and attaches it to each peptide aliquot, because the builder places the mass-spectrometry QC on the run node rather than on the aliquot.

### Analytics service (`api/app/services/analytics.py`)
- **Responsibility**: This answers every counting question in SQL, including KPIs, the funnel with its unit changes, sample-type shares, QC by type, the three-phase turnaround and the attention list.
- **Key Methods**: `kpis()`, `flow()`, `sample_types()`, `qc_by_sample_type()`, `turnaround()`, `attention()`, `stage_distribution()`
- **Dependencies**: `models.py` and `config.py`.
- **Complexity**: Complex
- **Behavior notes**: `attention()` issues one query per aliquot of each stalled specimen, which is negligible at twelve specimens but would grow linearly with a live cohort.

### Graph service (`api/app/services/graph.py`)
- **Responsibility**: This builds the front end's graph payload in the mockup's vocabulary, collapsing storage into a freezer-and-box hierarchy, linking activities to labs and operators, hanging peptide off protein, and attaching identifiers to patients, specimens and aliquots. There is no separate tumour-board node. A specimen that reached the end links to the Molecular Tumor Board Portal system through an `ordered_in` edge, and the order date is kept on the specimen as `ordered_on`.
- **Key Methods**: `build()`, `specimen_detail()`, `search()`, `_Builder.add()`, `_Builder.link()`
- **Dependencies**: `models.py`.
- **Complexity**: Complex

### Routers (`api/app/routers/`)
- **Responsibility**: These expose seven GET endpoints and wrap service results in Pydantic models.
- **Key Methods**: `meta()`, `overview()`, `attention()`, `graph()`, `specimen()`, `search()`
- **Dependencies**: FastAPI, `db.get_session` and the two services.
- **Complexity**: Simple

### Application (`api/app/main.py`)
- **Responsibility**: This creates the FastAPI app, refuses to start on an empty database, adds GET-only CORS for the Vite origin, mounts the routers under `/api`, serves `/healthz`, and serves the built front end with an `index.html` fallback when a build exists.
- **Key Methods**: `lifespan()`, `healthz()`, `SinglePageApp.get_response()`
- **Dependencies**: FastAPI, Starlette and every router.
- **Complexity**: Simple

### Static exporter (`api/export_static.py`)
- **Responsibility**: This calls the same service functions the routes call and writes the three responses the application uses as JSON files.
- **Key Methods**: `build_meta()`, `build_overview()`, `build_graph()`, `main()`
- **Dependencies**: The API package.
- **Complexity**: Simple
- **Behavior notes**: `build_meta()` and `build_overview()` duplicate the router bodies rather than calling them, so a change to a router must be repeated here.

---

## Frontend Library Components

### API client (`web/src/lib/api.ts`)
- **Responsibility**: This provides five typed fetch calls and switches between HTTP and static files at build time.
- **Key Methods**: `api.meta()`, `api.overview()`, `api.graph()`, `api.specimen()`, `api.search()`, `get()`
- **Dependencies**: `$app/paths` for `base`, and `types.ts`.
- **Complexity**: Simple

### Response types (`web/src/lib/types.ts`)
- **Responsibility**: This mirrors the API's payloads in TypeScript, including the `GraphNode` interface that also carries client-side physics and rollup fields. The node types are study, patient, identifier, sample, activity, operator, aliquot, qc, deviation, lab, system and storage, although the API emits no qc, deviation or study nodes.
- **Key Methods**: `GraphNode`, `GraphPayload`, `Overview`, `Turnaround`, `SpecimenDetail`
- **Dependencies**: None.
- **Complexity**: Moderate
- **Behavior notes**: The types are written by hand, so the TypeScript compiler cannot detect when the Python payload changes shape.

### Visual vocabulary (`web/src/lib/graph/v3.ts`)
- **Responsibility**: This holds colours, radii, ontology anchors, plain-language descriptions, activity labels, the per-edge spring table and relation sentences, including the `ordered_in` relation that ends a journey at the portal.
- **Key Methods**: `COLORS`, `RADIUS`, `SPRING`, `RELATION`, `relationTier()`
- **Dependencies**: None.
- **Complexity**: Simple

### Graph model (`web/src/lib/graph/model.ts`)
- **Responsibility**: This builds adjacency and per-sample rollups, assigns outcome buckets, computes provenance closures and lineage walks, and projects facets into a visible set with bridge edges. Information systems are kept on screen even when nothing visible connects to them, and the portal counts as the end of a lineage.
- **Key Methods**: `GraphModel`, `outcomeOf()`, `sampleClosure()`, `lineage()`, `lineageSteps()`, `idChain()`, `project()`, `bridgeChain()`
- **Dependencies**: `types.ts`.
- **Complexity**: Complex

### Cytoscape adapter (`web/src/lib/graph/cy.ts`)
- **Responsibility**: This defines the stylesheet, converts nodes to Cytoscape elements with string ids, wires tap, double-tap, hover and right-click handlers, disables Cytoscape's own panning, and draws cluster hulls.
- **Key Methods**: `mount()`, `style()`, `toElements()`, `nodeData()`, `setInteraction()`, `drawHulls()`
- **Dependencies**: Cytoscape, `v3.ts` and `model.ts`.
- **Complexity**: Moderate
- **Behavior notes**: Its header comment still says rotation cannot survive the move to Cytoscape, which the rotator has since disproved.

### Force simulation (`web/src/lib/graph/force3d.ts`)
- **Responsibility**: This settles nodes in three dimensions using spring forces per edge type, grid-bucketed repulsion, gravity, damping, a step clamp and an annealing schedule, and it can also accept precomputed positions.
- **Key Methods**: `Force3D.reset()`, `step()`, `place()`, `positionOf()`, `project()`
- **Dependencies**: `v3.ts` for the spring table.
- **Complexity**: Complex

### Rotator (`web/src/lib/graph/rotator.ts`)
- **Responsibility**: This drives settling in time slices, projects positions into Cytoscape, handles left-drag rotation, right-drag panning and wheel zoom, manages spin holds, and publishes a compact state to Svelte only when it changes.
- **Key Methods**: `start()`, `startFixed()`, `tilt()`, `hold()`, `toggleSpin()`, `fit()`, `stop()`
- **Dependencies**: Cytoscape and `force3d.ts`.
- **Complexity**: Complex

### Shell layout (`web/src/lib/graph/shell.ts`)
- **Responsibility**: This places every node on a globe where radius encodes how far along the pipeline it got and direction encodes the patient, and it sizes the stage rings from what is on screen. The MTB Portal sits at the centre as the endpoint, and every other information system rings the outside.
- **Key Methods**: `shellPlacement()`, `ringsFor()`, `stageOf()`
- **Dependencies**: `model.ts` and `force3d.ts` types.
- **Complexity**: Moderate

### Cluster layout (`web/src/lib/graph/clusters.ts`)
- **Responsibility**: This fills one ball per group, by node type or by outcome, and spaces the balls on a tilted horizontal ring so that they orbit past each other. Labs and information systems are laid out as a vertical column in alphabetical order, so that their always-visible names do not overlap.
- **Key Methods**: `clusterPlacement()`, `ballPoint()`, `ballRadius()`
- **Dependencies**: `model.ts`.
- **Complexity**: Moderate

### Export (`web/src/lib/graph/export.ts`)
- **Responsibility**: This saves PNG and PDF pictures of the current view or the whole graph, composited with the overlay canvas and an optional caption.
- **Key Methods**: `currentView()`, `detailedView()`, `elementShot()`, `savePng()`, `savePdf()`, `stamp()`
- **Dependencies**: Cytoscape, and `html-to-image` and `jspdf` loaded on demand.
- **Complexity**: Moderate

### Workflow model (`web/src/lib/workflow.ts`)
- **Responsibility**: This describes the planned PreDDLung journey as nineteen stages with lanes, phases, planned durations and the REDCap field that records each one, where there is one. The three analysis labs share one step, and the journey ends with the order in the MTB Portal.
- **Key Methods**: `STAGES`, `LANES`, `cumulative()`, `formatDuration()`, `barWidth()`
- **Dependencies**: The browser canvas API for measuring label widths.
- **Complexity**: Simple

---

## Frontend View Components

### Layout (`web/src/routes/+layout.svelte`)
- **Responsibility**: This draws the showcase banner from `/api/meta` and the three tabs, prefixing every link with `base`.
- **Key Methods**: `link()`, `active()`
- **Dependencies**: `api.ts`, `$app/state` and `$app/paths`.
- **Complexity**: Simple
- **Props**: `children: Snippet`

### Dashboard page (`web/src/routes/dashboard/+page.svelte`)
- **Responsibility**: This loads the overview once and lays out the KPI tiles, the sample-type and QC card, the turnaround card, the cohort flow and three reserved empty panels.
- **Key Methods**: `tiles`, `pct()`
- **Dependencies**: `api.ts`, `Sankey`, `SampleTypes` and `Turnaround`.
- **Complexity**: Moderate

### Sankey (`web/src/lib/components/Sankey.svelte`)
- **Responsibility**: This draws the cohort flow as cubic Bézier ribbons whose width is a count, with one specimen band to AllPrep, three tapering aliquot tracks, and a merge back to specimens.
- **Key Methods**: `tracks`, `ribbon()`, `dropoffs`
- **Dependencies**: `types.ts`.
- **Complexity**: Complex
- **Props**: `flow: Overview['flow']`

### Turnaround (`web/src/lib/components/Turnaround.svelte`)
- **Responsibility**: This shows the end-to-end median, a phase split, a strip whose segment widths are median days, and a row per segment with the parallel analysis-lab segment broken out.
- **Key Methods**: `biggestInHouse`, `measurable`, `unmeasurable`, `days()`
- **Dependencies**: `types.ts`.
- **Complexity**: Moderate
- **Props**: `turnaround: Overview['turnaround']`

### SampleTypes (`web/src/lib/components/SampleTypes.svelte`)
- **Responsibility**: This draws a donut from dashed strokes along one circular path, with a legend carrying specimen and aliquot counts.
- **Key Methods**: `slices`, `lighten()`
- **Dependencies**: `types.ts`.
- **Complexity**: Simple
- **Props**: `types: Overview['sample_types']`

### Workflow page (`web/src/routes/workflow/+page.svelte`)
- **Responsibility**: This draws the custodian swimlane from `workflow.ts`, with pins for events, bars for work, milestone guides and a floating detail card.
- **Key Methods**: `openCard()`, `closeCard()`, `bars`, `milestones`
- **Dependencies**: `workflow.ts`.
- **Complexity**: Moderate

### Graph page (`web/src/routes/graph/+page.svelte`)
- **Responsibility**: This owns the knowledge-graph view. It fetches the graph, mounts Cytoscape, applies facets and layers, switches layouts, manages selection, families, traced paths and hand-picked highlights, paints the overlay, and exports pictures.
- **Key Methods**: `applyVisibility()`, `syncBridges()`, `relayout()`, `paintOverlay()`, `selectNode()`, `highlightNeighbourhood()`, `tracePath()`, `isBrightNode()`, `exportGraph()`
- **Dependencies**: `api.ts`, every module under `lib/graph/`, `Inspector` and `PathWindow`.
- **Complexity**: Complex
- **Behavior notes**: It reads `?specimen=` to preselect a node, a deep link that the dashboard's attention list used to produce and no longer does.

### Inspector (`web/src/lib/components/Inspector.svelte`)
- **Responsibility**: This describes one selected node, a double-clicked family as a stack of cards, or a selected relation, in the vocabulary of the adopted ontology.
- **Key Methods**: `cards`
- **Dependencies**: `v3.ts` and `model.ts`.
- **Complexity**: Moderate
- **Props**: `node`, `family`, `model`, `steps`, `edge`, `onPick`, `connectionsOf`, `visibility`

### PathWindow (`web/src/lib/components/PathWindow.svelte`)
- **Responsibility**: This draws one traced path on a real date axis, with one row per kind of node, one block of rows per sample when a patient's path covers several samples, and measured card heights.
- **Key Methods**: `sampleOf()`, `whenOf()`, `dateLabel()`, `platformRuns`
- **Dependencies**: `model.ts`, `v3.ts` and `export.ts`.
- **Complexity**: Complex
- **Props**: `node: GraphNode | null`, `model: GraphModel | null`, `onClose: () => void`
