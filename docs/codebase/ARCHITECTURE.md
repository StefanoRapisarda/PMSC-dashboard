# Architecture

## System Architecture

The application is a three-tier system with a data pipeline in front of it. The pipeline stands in for a source system that does not exist yet, which is a REDCap project feeding a weekly ingest. Everything downstream of the export is written as though that source were real, so that replacing synthetic data with a live export changes an input path and nothing else. The database sits under the API for the same reason. Every number on the dashboard is derived by a query at request time, rather than read from a precomputed file, so that the numbers stay correct when the data moves.

### Design Principles

1. **The dictionary is the contract** — The REDCap data dictionary defines the export's shape, and the code derives columns, checkbox expansions and choice codes from it. A newer dictionary therefore changes the export without changing the code that writes it.
2. **Emit the real format, then decode it** — The generator writes a genuine REDCap export with all of its quirks rather than tidy tables. The builder must then decode it, so the decoding a live ingest needs is exercised on every build.
3. **Counting and traversal are different questions** — Counting runs as `GROUP BY` over entity tables. The design intends traversal to walk a single indexed `edge` table, and in production these would be two stores. In the current code the seeder fills the `edge` table but nothing reads it. The graph service rebuilds every relationship from foreign keys and the identifier table, so the split exists in the schema but not yet in the queries.
4. **A fixed snapshot instead of the clock** — Every duration is measured against `AS_OF`, a date stamped into the data. No layer reads the system clock, so a rehearsed demo shows the same numbers in November as it did in August.
5. **Reproducibility by seeding** — The generator is seeded, so the same commit produces byte-identical output. The Docker build and the Pages workflow regenerate the cohort rather than carrying it in git, so published numbers cannot drift from the code that made them.
6. **Say what cannot be measured** — Where the data cannot support a number, the payload states it rather than omitting it. The proteomics lab, for example, carries a note that no send date was recorded instead of a fabricated wait time.
7. **The mockup is the design base** — `mockups/index-v3.html` was shaped by team feedback. Its palette, node sizes, ontology anchors and per-edge spring lengths are carried into `lib/graph/v3.ts` unchanged, and only the renderer was replaced.

---

## Directory Structure

```
PMSampleCentral/
├── start.sh                    # starts API and front end together; installs what is missing
├── Dockerfile                  # two stages: build the web app with Node, run everything on Python
├── DOCKER.md                   # beginner's guide to building and running the image
├── TESTING.md / TESTING.docx   # walkthrough for colleagues reviewing the showcase
├── decisions_on_dataset_variables.md   # per-variable generation decisions (Quarto source + HTML)
├── .github/workflows/pages.yml # regenerate, seed, export, build and publish to GitHub Pages
├── data/                       # the mock source system; standard library only
│   ├── reference/              # vendored REDCap dictionary (tab-separated)
│   ├── common/dictionary.py    # dictionary parser; derives the export header
│   ├── generator/
│   │   ├── config.py           # seed, AS_OF, cohort mix, QC rates, stall settings, step timings
│   │   ├── model.py            # Simulation: patients, specimens, timelines, stalls, repeats, values
│   │   ├── emit.py             # REDCap encoding and the CSV writer
│   │   └── generate.py         # CLI; writes the export and manifest.json
│   ├── builder/
│   │   ├── normalize.py        # decode, collapse patients, split into two tables
│   │   ├── graph.py            # GraphBuilder: typed provenance graph and derived stage state
│   │   ├── aggregates.py       # KPI and flow layer over the tables (not read by the API)
│   │   └── build.py            # CLI; runs the three builder stages
│   └── out/                    # generated output, git-ignored
├── api/
│   ├── requirements.txt        # fastapi, uvicorn, sqlalchemy, pydantic
│   ├── run.sh                  # seeds if the database is missing, then runs uvicorn with reload
│   ├── export_static.py        # writes meta, overview and graph JSON for the static build
│   ├── app/
│   │   ├── config.py           # paths, stall threshold, stage order, CORS origins
│   │   ├── db.py               # engine with foreign keys on, session factory, get_session()
│   │   ├── models.py           # 14 tables: 13 entity tables plus the edge table
│   │   ├── schemas.py          # thin Pydantic response models for the OpenAPI page
│   │   ├── seed.py             # graph.json and the export -> database rows
│   │   ├── main.py             # app, lifespan check, CORS, routers, /healthz, SPA fallback
│   │   ├── routers/            # meta.py, overview.py, graph.py; each a thin wrapper
│   │   └── services/           # analytics.py (counting) and graph.py (traversal)
│   └── tests/test_api.py       # 18 end-to-end checks over the seeded database
├── web/
│   ├── vite.config.ts          # SvelteKit plugin, static adapter, BASE_PATH, runes forced on
│   ├── src/app.css             # the mockup's stylesheet, carried over
│   ├── src/lib/
│   │   ├── api.ts, types.ts    # typed client and hand-mirrored response types
│   │   ├── workflow.ts         # the planned journey as static data
│   │   ├── stores/asOf.svelte.ts   # a runes store left as an exercise; nothing imports it
│   │   ├── components/         # Sankey, SampleTypes, Turnaround, Inspector, PathWindow
│   │   └── graph/              # v3, model, cy, force3d, rotator, shell, clusters, export
│   ├── src/routes/             # +layout, +page (redirect), workflow/, dashboard/, graph/
│   └── tests/*.mjs             # seven puppeteer scripts against a running dev server
├── docs/                       # domain brief, lab concepts, design decisions, data inventory, questions
└── mockups/                    # index.html, index-v2.html, index-v3.html (the design base)
```

---

## Backend Architecture

### Request Routing

```
HTTP request
   |
   +-- /healthz ----------------------------> main.healthz()        reads the Study row
   |
   +-- /api/* --> CORSMiddleware (GET only, localhost:5173)
   |                 |
   |                 +-- routers/meta.py      -> analytics.study() + three COUNT queries
   |                 +-- routers/overview.py  -> analytics.kpis/flow/qc/sample_types/turnaround/
   |                 |                           stage_distribution/attention
   |                 +-- routers/graph.py     -> services/graph.build / specimen_detail / search
   |                        each handler receives a Session from Depends(get_session)
   |
   +-- anything else --> SinglePageApp (only when web/build exists)
                            serves the file, or index.html on a 404
```

### Service Layer

The routers hold no logic. Each one asks a service for a dictionary and wraps it in a Pydantic model so that `/docs` can describe it. The services are plain functions that take a SQLAlchemy `Session`.

- **analytics.kpis** — This counts patients, specimens, aliquots, QC outcomes, stalled specimens and deviations, and computes the pass rate over resolved aliquots only.
- **analytics.flow** — This builds the cohort funnel, counting specimens up to AllPrep and aliquots after it, with the protein stream reading its QC from the peptide child.
- **analytics.sample_types** — This reports specimen and aliquot shares per sample type side by side, because the two can disagree sharply.
- **analytics.qc_by_sample_type** — This groups QC outcomes by sample type and molecule.
- **analytics.turnaround** — This measures six segments of the journey per specimen, groups them into pre-analytical, analytical and post-analytical phases, and treats the three analysis labs as one parallel segment.
- **analytics.attention** — This lists stalled specimens with what each one is waiting on. The dashboard no longer renders it, although `/api/overview` still returns it.
- **graph.build** — This assembles the node-and-edge payload in the mockup's vocabulary, with integer node indices and edges written as `{a, b, type}`.
- **graph.specimen_detail** — This returns one specimen's identifier chain, steps and fractions.
- **graph.search** — This finds any captured identifier by substring and resolves it to a specimen.

### API Endpoints

| Method | Endpoint | Handler | Purpose |
|--------|----------|---------|---------|
| GET | `/healthz` | `main.healthz` | This reports whether the database can be read, and Docker's `HEALTHCHECK` calls it. |
| GET | `/api/meta` | `routers.meta.meta` | This returns the study, three counts and the value sets for facets. |
| GET | `/api/overview` | `routers.overview.overview` | This returns every dashboard number in one payload. |
| GET | `/api/attention` | `routers.overview.attention` | This returns the stalled-specimen list on its own, with a `limit` parameter. |
| GET | `/api/graph` | `routers.graph.graph` | This returns the cohort graph, optionally limited to the first N patients. |
| GET | `/api/specimens/{specimen_id}` | `routers.graph.specimen` | This returns one specimen's detail, or 404. |
| GET | `/api/search` | `routers.graph.search` | This finds identifiers matching `q` and the specimen behind each. |

---

## Frontend Architecture

### Component Hierarchy

```
+layout.svelte                       banner (from /api/meta) and the three tabs
├── +page.svelte                     redirects to {base}/workflow
├── workflow/+page.svelte            custodian swimlane drawn from lib/workflow.ts; reads no API data
├── dashboard/+page.svelte           loads /api/overview once
│   ├── KPI tiles                    inline markup
│   ├── SampleTypes.svelte           SVG donut drawn as dashed strokes
│   ├── QC-by-type bars              inline markup
│   ├── Turnaround.svelte            phase strip and segment rows
│   ├── Sankey.svelte                cohort-flow ribbons
│   └── three reserved panels        empty by design, awaiting the team's choice
└── graph/+page.svelte               loads /api/graph once, builds a GraphModel, mounts Cytoscape
    ├── left aside                   layer toggles (eye), type highlighting (sun), facets
    ├── canvas + hull overlay        Cytoscape container and a second canvas for rings and hulls
    ├── layout switch                force, shell, clustered, grouped
    ├── context menu                 highlight path, open the path window
    ├── Inspector.svelte             one card per node, a family of cards, or a relation card
    └── PathWindow.svelte            one path drawn on a real date axis, with lanes per kind
```

### State Management

State is local to each route and held in Svelte 5 runes. Each page declares `$state` variables for fetched payloads and interface state, `$derived` values for anything computed from them, and `$effect` blocks for fetching, for mounting Cytoscape and for re-applying visibility when facets change. There is no global store in use. `lib/stores/asOf.svelte.ts` defines one as a teaching exercise, but nothing imports it, and its default reads the browser clock, which the rest of the system deliberately avoids.

The graph page keeps two kinds of state apart on purpose. Facets and layer toggles remove nodes from the canvas by adding a `hidden` class. Highlighting, tracing and selection keep nodes on the canvas and change their emphasis through `dim`, `faded`, `bright`, `inert` and `marked` classes. Cytoscape owns the drawn elements, and the page treats it as an imperative object held in a plain variable rather than in `$state`.

### Rendering Pipeline

```
/api/graph payload
   -> new GraphModel(nodes, edges)       adjacency, per-sample rollups, outcome buckets
   -> mount(container, toElements(...))  Cytoscape with string ids and a declarative stylesheet
   -> project(model, facets)             visible set + bridge edges across hidden spine levels
   -> applyVisibility()                  class toggles in one cy.batch()
   -> relayout(layout)
        force:     Force3D.reset() then step() in 10 ms slices per animation frame
        shell:     shellPlacement() computes positions from stage and patient
        clustered/grouped: clusterPlacement() fills one ball per group
   -> Rotator loop                       project 3-D to 2-D, write positions in one batch,
                                         refresh the depth fog every twelfth frame,
                                         spin at 20 fps, idle when paused or settled
   -> paintOverlay()                     stage rings or cluster hulls on a second canvas
```

---

## Cross-Cutting Concerns

### Counting-unit discipline

One specimen yields up to three aliquots at AllPrep, and protein yields a peptide child later. Every layer that counts must therefore say whether it counts specimens or aliquots. The funnel payload labels the unit at each stage, the analysis column switches back to specimens by counting distinct specimen ids, and a test asserts that the analysis column is smaller than the sum of the three aliquot streams.

### Stalled versus waiting

A specimen is stalled only if something is still expected of it and its last recorded step is older than the threshold. Failed aliquots that were repeated, excluded or sent for investigation count as resolved, and blood drawn for the biobank counts as finished at pathology. The generator's `open_streams`, the builder's `open_streams` and the API's `attention` each implement this rule separately. The generator plants stalls and the builder must rediscover them, and the README treats a disagreement between the two as evidence that the dashboard cannot detect something in the data.

### Configuration across three deployment modes

The same front end runs in three places. `VITE_API_BASE` chooses the API origin, with `http://localhost:8000` when unset and relative URLs when it is empty, which is how the container works. `VITE_STATIC_DATA=1` switches the client to pre-written JSON. `BASE_PATH` prefixes every link and asset for GitHub Pages, and every internal link in the layout and the redirect goes through SvelteKit's `base` for that reason.

### Performance of the animated graph

Cytoscape redraws every element whenever positions change, so the frame rate is the cost. The rotator spins at 20 frames per second, drags at 30, writes positions in one batch, refreshes the depth style only every twelfth frame, holds the spin while a node is selected or the tab is hidden, and does nothing per frame once the layout has settled and the spin is off. Repulsion in the force simulation is bucketed on a grid with a one-cell cutoff, which keeps a settle near-linear in node count.

### Honesty about elision

When a layer is switched off, the page bridges the provenance spine across the hidden nodes with dashed edges that name what they stand for. Bridges run only along the spine edges (`has_sample`, `generated`, `submitted_to`, `ordered_in`, `used` and `derived_from`). Bridging every neighbour of a hidden hub would invent relationships that are not provenance and would turn the three analysis-lab nodes into thousands of edges.

### Testing

`api/tests/test_api.py` runs 18 checks through FastAPI's `TestClient` against whatever `pmsc.db` currently holds. The checks assert properties that were wrong at some point during the build, such as funnel monotonicity, unit discipline, the presence of a proteomics QC outcome, and the issuing-system links on identifiers. The seven browser scripts in `web/tests/` drive a real Chrome against `http://localhost:5173` and assert behaviour that only exists in the browser, such as settling, rotation, dragging, zooming, filtering, export and the cohort-flow layout. There are no unit tests for the generator or builder. Their checks are the verification list in `data/README.md`, which describes what a build is checked for but is not wired to a runner.
