# PM-SC dashboard

This repository holds the sample-provenance showcase for Precision Medicine Sample Central (PM-SC), a work package 2 (WP2) deliverable at Karolinska. It follows samples from the PreDDLung lung-cancer pilot through collection, pathology, preparation, extraction, quality control, analysis and the Molecular Tumor Board Portal. It shows where each sample is, what has stalled, whether material passed QC, and how a sample is renamed by every system it passes through.

Every patient, sample and date in it is synthetic. The data is generated from the project's REDCap data dictionary, so the showcase exercises the same format a live export will have. Moving to real data is meant to be a change of input, not a redesign.

## What is in the repository

| Directory | What it holds |
|---|---|
| `data/` | This is the mock source system. A standard-library Python generator simulates the cohort and writes a REDCap export, and a builder turns that export into normalized tables and a provenance graph. |
| `api/` | This is the application store and service. FastAPI and SQLAlchemy load the graph into a SQLite database and answer every question the front end asks. |
| `web/` | This is the front end. SvelteKit with Svelte 5 and TypeScript draws three views, and Cytoscape.js renders the knowledge graph. |
| `docs/` | These are the design documents, the domain brief, the lab concepts, the open questions, and the code documentation in `docs/codebase/`. |
| `mockups/` | These are the HTML mockups. `index-v3.html` was shaped by team feedback and is the design base, and it is left unchanged. |

## Running it

You need Python 3.12 or newer and Node 22. The generated data and the database are not in git, so a fresh clone has to build them once before anything starts.

```bash
# build the synthetic cohort and the database (once, and after any change to data/)
python3 data/generator/generate.py
python3 data/builder/build.py --web /tmp/discard
cd api && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.seed --force
cd ..

# start the API and the front end together; Ctrl-C stops both
./start.sh
```

The API runs at http://localhost:8000, with its interactive documentation at `/docs`, and the dashboard runs at http://localhost:5173. To run them separately, use `api/run.sh` and `npm run dev` in `web/`.

Always pass `--web` to the builder. By default it writes its own `graph.json` into `web/static/data/`, where the static build expects a file of a different shape, and the next static build would then fail.

## How it works

The application is a pipeline of four stages, and each stage reads only what the stage before it wrote.

| Stage | Where it lives | What it reads | What it writes |
|---|---|---|---|
| Generate | `data/generator/` | `config.py` and the REDCap dictionary | `data/out/redcap_export.csv`, with 181 records and 141 columns, and `manifest.json` |
| Build | `data/builder/` | The export | `patients.csv`, `samples.csv` and `graph.json`, which has 13 node types and 18 edge types |
| Seed and serve | `api/` | The graph and the export | `api/pmsc.db` with 14 tables, then JSON over HTTP |
| Render | `web/` | JSON from the API or from static files | The workflow, the study dashboard and the knowledge graph |

The cohort has 100 patients, 176 specimens and 419 aliquots. A fixed snapshot date, `AS_OF = 2026-08-19`, is stamped into the data, and no part of the system reads the clock. That keeps every number identical from one build to the next, so a rehearsed demonstration shows the same figures months later. The generator is seeded for the same reason, and the same commit always produces byte-identical output.

### The API

Every endpoint is a GET, and every number is computed from the database when it is requested.

| Endpoint | What it returns |
|---|---|
| `/healthz` | This reports whether the database can be read. Docker's health check calls it. |
| `/api/meta` | This returns the study, three counts and the value sets the filters use. |
| `/api/overview` | This returns every dashboard number in one payload. |
| `/api/attention` | This returns the stalled specimens and what each one is waiting on. |
| `/api/graph` | This returns the cohort graph, which has 2,483 nodes and 5,162 edges, optionally limited to the first N patients. |
| `/api/specimens/{id}` | This returns one specimen's identifier chain, steps and fractions. |
| `/api/search?q=` | This finds any captured identifier and the specimen behind it. |

The routers hold no logic. `services/analytics.py` answers the counting questions in SQL, and `services/graph.py` assembles the graph the front end draws.

### The three views

| View | What it shows |
|---|---|
| Workflow | This view shows the planned PreDDLung journey as a swimlane, with one row per department or lab and one bar per step. It shows planned durations rather than measured data. |
| Study dashboard | This view shows the headline figures, the sample types and their QC, time to the tumour board by phase, and the cohort flow. Three panels at the foot are left empty for the team to decide. |
| Knowledge graph | This view shows every patient, sample, activity, aliquot, identifier, lab, information system, freezer box and operator as a graph you can filter, trace and rotate. |

The knowledge graph has four layouts, and all of them are three-dimensional and can be rotated.

| Layout | What position means |
|---|---|
| Force | Distance shows how tightly two things belong together. Each edge type has its own spring length, so one patient's material pulls into a clump and shared things such as a lab, an operator or a freezer box settle between clumps. |
| Shell · progress | Distance from the centre shows how far the material got. The MTB Portal sits at the centre, and each patient's material lies along one spoke. |
| Clustered · outcome | Each ball holds the material with one outcome, namely not collected, stalled, QC failure or on track. |
| Grouped · by type | Each ball holds one kind of thing. Labs and information systems are laid out as a labelled column so that their names do not overlap. |

Cytoscape draws in two dimensions, so the layout is computed separately. `lib/graph/force3d.ts` settles the cohort in three dimensions, and `lib/graph/rotator.ts` projects those coordinates into Cytoscape on every frame. The first settle happens behind a loading state, so the view is framed once there is a layout worth looking at.

Rotation costs CPU while it spins. Cytoscape redraws every node and edge whenever positions move, and an earlier measurement found the main thread at about 67% while spinning and 1 to 2% when paused. The spin therefore runs at 20 frames per second, pauses when the tab is hidden or a node is selected, and does nothing once the layout has settled and the spin is off. If the browser's developer tools feel slow on the graph page, press ⏸ Rotation.

In the graph view the rotation owns the mouse. A left drag turns the graph, a right or middle drag moves it, and the wheel zooms toward the pointer. Cytoscape's own panning and node dragging are switched off, because one gesture would otherwise drive two things at once.

## Design decisions

### The dictionary is the contract

The export's columns, checkbox expansions and choice codes are derived from the REDCap dictionary in `data/reference/`, not written by hand. A newer dictionary therefore changes the export without code changes. A new field is exported automatically, but nothing fills it until someone adds it to the simulation.

### The generator writes a real export

The generator writes a genuine REDCap export, with all of REDCap's quirks, rather than tidy tables. The builder must decode it, so the work a live ingest will need is exercised on every build. `api/app/seed.py` is the mock of the production ingest, and nothing above the database changes when a weekly REDCap pipeline replaces it.

### Counting and traversal are different questions

A counting question such as "how many specimens cleared QC" is a `GROUP BY` over the entity tables. A traversal question such as "what else is in this freezer box" follows relationships. The schema keeps an `edge` table beside the entity tables so that traversal could later move to a graph store. In the current code the seeder fills that table but no query reads it, because the graph service rebuilds relationships from foreign keys.

### Identifiers are objects

A sample is renamed at every handover, from the eCRF study ID to the PAD number, the biobank barcode, the PMSC ID and the per-aliquot IDs. Reconciling that chain is the point of WP2, so every identifier is a node in the graph and a row in its own table. REDCap, Sympathy and Labware are linked to the identifiers they issue, and TakeCare records the study ID. The PMSC IDs carry no issuing system, because no source names one.

### Labs and information systems are different things

A lab is a place where work is done on the material. Pathology, the PMSC lab and the three analysis labs at SciLifeLab are labs. An information system is software where something is registered, and it does no work on the material. The journey ends in the Molecular Tumor Board Portal, which is an information system, so a sample that reached the end links to the portal rather than to a separate board node.

### Some places say they cannot measure

Where the data cannot support a number, the payload says so instead of hiding the row or inventing a value. The clearest case is the proteomics wait, described under known limits.

## Things the data forced

Three places in the source disagreed with the mockup, and each was resolved in favour of the data.

| Topic | What the data says |
|---|---|
| Sample types | The sample types are FFPE, Tissue, Biopsy and Blood, not the FFPE, Fresh-Frozen and Blood the mockup guessed. The filters read the value set from the export. |
| Repeats | A repeat is a whole new REDCap record, so `repeat_of` runs from specimen to specimen rather than from aliquot to aliquot. |
| Mass-spec QC | The mass-spec QC (`ms_qcheck`) sits on the platform run in the graph, so the seeder reads it from the export and attaches it to the peptide that was injected. Without that, the proteomics stream would have no QC outcome. |

## Known limits

| Limit | Why it matters |
|---|---|
| Proteomics wait time cannot be measured. | The mass-spec run records a returned date but no send date, so the dashboard shows the row with "no send date recorded". |
| The stall threshold is a flat 30 days. | One number may not fit every stage, because analysis at the labs legitimately takes weeks. This is an open question with the team. |
| Yield is not quality. | QC here is concentration, total yield and a pass or fail. The schema holds no RIN, DV200 or purity ratio, so the application cannot say whether material was intact. See `docs/questions.md`. |
| The two stall counts differ. | The builder counts 13 stalled records, including one consented patient still awaiting collection. The dashboard shows 12, because the database holds only collected specimens. |

## Known issues in the code

These were found while documenting the code on 2026-10-09, and none of them has been fixed yet.

| Issue | Detail |
|---|---|
| The shell layout's rings are labelled one stage off. | The API numbers stages from 1 and the ring labels count from 0, so a specimen at pathology sits on the ring labelled "PM-SC prep". The rings from "submitted" inward are correct. |
| Identifiers and peptides are misplaced in the shell layout. | Every identifier lands on the pathology ring, and peptides fall off their patient's spoke because they derive from protein rather than from a specimen. |
| Protein totals carry the wrong unit. | The Inspector labels every aliquot total in ng, but protein totals are in µg. |
| Three browser tests import from an old location. | `loading.mjs`, `dragging.mjs` and `exporting.mjs` import puppeteer from the project's former directory and fail where it is absent. |
| The builder writes duplicate edges. | Shared PAD numbers produce 13 duplicate `ISSUED_BY` edges, and there is one duplicate `REPEAT_OF` edge. |
| Some code is no longer used. | `/api/attention` and the graph page's `?specimen=` link served an attention list the dashboard no longer shows. `lib/stores/asOf.svelte.ts` is imported by nothing, and `cytoscape-dagre`, `cytoscape-fcose` and `@sveltejs/adapter-auto` are declared but not imported. |
| The front-end types are written by hand. | `web/src/lib/types.ts` mirrors the API's payloads, so a renamed field in the API passes the type check and fails only in the browser. |

## Shipping it

### Docker

`docker build -t pmsc:latest .` builds one image that serves the API and the front end from port 8000. The first stage compiles the front end with Node. The second installs the API, generates the cohort, builds the graph, seeds the database and copies the compiled front end in, so the image needs no network, database server or configuration. It runs as a non-root user and reports its health through `/healthz`. `DOCKER.md` explains every command for someone new to Docker.

### GitHub Pages

The showcase is also published as a static site, so colleagues can open a link instead of installing anything. This works because the published front end asks only three questions, `/api/meta`, `/api/overview` and `/api/graph`, and their answers never change within a release. `api/export_static.py` calls the same service functions the routes use and writes the three answers as files, and `VITE_STATIC_DATA=1` makes `web/src/lib/api.ts` read them.

```bash
cd api && .venv/bin/python export_static.py
cd ../web && BASE_PATH=/PMSC-dashboard VITE_STATIC_DATA=1 npm run build:pages
```

`.github/workflows/pages.yml` does the same on every push to `main`, and it regenerates the cohort each time so the published numbers cannot drift from the code. `BASE_PATH` is needed because Pages serves a project site from a subdirectory named after the repository. `build:pages` copies `index.html` to `404.html`, because that is how Pages serves `/graph` and `/dashboard`, which exist only inside the application.

The static site is a published build of a fixed cohort. The real system will serve data that changes, and it still needs the API and the database.

## Testing

| Suite | How to run it | What it covers |
|---|---|---|
| API | `cd api && .venv/bin/python -m pytest` | Eighteen checks run against the seeded database. Each one guards something that was wrong at some point, such as the funnel never growing along a stream, the unit change at AllPrep, and the issuing system on each identifier. |
| Type check | `cd web && npm run check` | This runs `svelte-check` over the front end. |
| Browser | `cd web && npm run test:e2e` | Seven scripts drive a real Chrome against the dev server, which must be running at port 5173. They check loading, settling, rotation, dragging, zooming, filtering, export and the cohort flow. |

The API tests depend on the seeded data, so a cohort generated with another seed can fail them. The generator and the builder have no tests of their own. Their checks are described in `data/README.md` but are not run automatically.

`TESTING.md` is a different kind of document. It is a walkthrough for colleagues reviewing the showcase, with what to try in each view.

## Further documentation

| Document | What it covers |
|---|---|
| `docs/codebase/README.md` | This is an overview of the code, with the data flow, key files and dependencies. |
| `docs/codebase/ARCHITECTURE.md` | This covers the design principles, directory structure, request routing, front-end structure and cross-cutting concerns. |
| `docs/codebase/COMPONENTS.md` | This describes every module and component, with its responsibility, main functions and dependencies. |
| `docs/codebase/DIAGRAMS.md` | This holds diagrams of the system, the schema, the generator phases, the request flow and the stage states. |
| `docs/codebase/PATTERNS.md` | This explains the patterns the code relies on, each with an excerpt from the code. |
| `docs/codebase/USECASES.md` | This walks through seven tasks from start to finish, from finding stalled samples to loading a real export. |
| `data/README.md` | This explains how the synthetic cohort is generated and built, and how to tune it or point it at a real export. |
| `docs/domain-brief.md` and `docs/lab-concepts.md` | These explain the project, the PreDDLung pilot and the laboratory concepts behind the data. |
| `docs/design-decisions.md` | This records the design choices behind the dashboard and the knowledge graph. |
| `docs/questions.md` | This lists the open questions for the team. |
| `DOCKER.md` | This explains how to build and run the container. |
| `TESTING.md` | This guides colleagues reviewing the showcase. |
