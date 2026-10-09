# PM Sample Central dashboard - Code Analysis

**Analyzed**: October 9, 2026
**Complexity**: Complex
**Primary Languages**: Python, TypeScript, Svelte
**Framework**: FastAPI with SQLAlchemy 2 (API), SvelteKit 2 with Svelte 5 runes (web), Cytoscape.js (graph rendering)

## Quick Summary

This repository is the WP2 showcase for Precision Medicine Sample Central (PM-SC), a sample-provenance dashboard for the PreDDLung lung-cancer pilot at Karolinska. It has three tiers. A standard-library Python pipeline generates a synthetic cohort as a genuine REDCap export and rebuilds it into a provenance graph. A FastAPI service loads that graph into a fourteen-table SQLite database and answers counting and traversal questions over it. A SvelteKit front end draws three views of the result, namely a planned-workflow swimlane, a study dashboard, and a rotatable three-dimensional knowledge graph.

This analysis describes commit `23cadb6` of 2026-10-09, in which the analysis platforms became labs, information systems became a node type of their own, and the journey ends at the Molecular Tumor Board Portal. At that commit the API's 18 tests pass and `svelte-check` reports no errors.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Architecture Overview](#architecture-overview)
3. [Key Files](#key-files)
4. [Data Sources](#data-sources)
5. [Dependencies](#dependencies)

---

## Getting Started

### Prerequisites
- Python 3.12 or newer is needed for the API. The data pipeline needs only the standard library.
- Node 22 and npm are needed for the front end.
- Google Chrome at its default macOS path is needed for the end-to-end browser tests, because they use `puppeteer-core` without a bundled browser.
- Docker Desktop is needed only if you want the single-container build.

### Installation

```bash
# the synthetic cohort, then the database built from it
python3 data/generator/generate.py
python3 data/builder/build.py --web /tmp/discard   # see the warning under Data Sources
cd api
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.seed --force

# the front end
cd ../web && npm install
```

### Running

```bash
./start.sh                       # API and front end together; Ctrl-C stops both
# or separately:
cd api && ./run.sh               # http://localhost:8000, with /docs for the OpenAPI page
cd web && npm run dev            # http://localhost:5173
```

In development the API listens on port 8000 and Vite serves the front end on port 5173, and the browser talks across the two origins under a CORS allowance. In the Docker image a single process on port 8000 serves both the API and the compiled front end. On GitHub Pages there is no API at all, and the front end reads three pre-written JSON files instead.

---

## Architecture Overview

The system is a pipeline of four stages, each of which reads only the output of the stage before it. The generator simulates a cohort and writes it in REDCap's export format. The builder decodes that export into normalized tables and then into a typed provenance graph. The seeder loads the graph into a relational schema that keeps a denormalized `edge` table beside the entity tables. The API answers questions from that database, and the front end renders the answers.

Two design decisions run through every layer. The first is that counting questions and traversal questions are answered differently, with counting done by `GROUP BY` over entity tables and traversal done by walking edges. The second is that nothing reads the system clock, because every date is measured against a fixed snapshot date (`AS_OF = 2026-08-19`) stamped into the data, which keeps the numbers identical from one build to the next.

### Entry Points
- **Generator CLI**: `data/generator/generate.py:main()` writes `data/out/redcap_export.csv` and `manifest.json`.
- **Builder CLI**: `data/builder/build.py:main()` writes `patients.csv`, `samples.csv`, `graph.json` and `aggregates.json`.
- **Seeder CLI**: `api/app/seed.py:main()` loads `data/out/graph.json` and the export into `api/pmsc.db`.
- **API application**: `api/app/main.py:app` is the FastAPI instance that uvicorn serves.
- **Static exporter**: `api/export_static.py:main()` writes the three API responses to `web/static/data/`.
- **Front end**: `web/src/routes/+layout.svelte` is the shell, and `+page.svelte` redirects to `/workflow`.

### Data Flow

```
config.py (seed, AS_OF, rates)
      |
generator/model.py  Simulation.run()  -> 181 records
      |
generator/emit.py   REDCap encoding   -> data/out/redcap_export.csv (141 columns) + manifest.json
      |
builder/normalize.py decode + split   -> patients.csv, samples.csv
      |
builder/graph.py    GraphBuilder      -> data/out/graph.json (3,538 nodes, 6,691 edges)
builder/aggregates.py                 -> data/out/aggregates.json (not read by the API)
      |
api/app/seed.py     graph -> rows     -> api/pmsc.db (14 tables)
      |
api/app/services    analytics.py (counting), graph.py (traversal)
      |
api/app/routers     /api/meta  /api/overview  /api/graph  /api/specimens/{id}  /api/search
      |
web/src/lib/api.ts  fetch, or read web/static/data/*.json when VITE_STATIC_DATA=1
      |
routes: /workflow (static process model)  /dashboard (overview)  /graph (Cytoscape + 3-D)
```

---

## Key Files

| File | Purpose |
|------|---------|
| `data/common/dictionary.py` | This file parses the REDCap data dictionary and derives the export's column list from it. |
| `data/generator/config.py` | This file holds every tunable number of the simulation, including the seed and the snapshot date. |
| `data/generator/model.py` | This file runs the six-phase cohort simulation that plans, truncates, stalls and repeats specimens. |
| `data/generator/emit.py` | This file encodes simulated values the way REDCap exports them, with checkbox expansion and choice codes. |
| `data/builder/normalize.py` | This file decodes the export back to labels and splits it into a patient table and a specimen table. |
| `data/builder/graph.py` | This file builds the labelled, directed provenance graph and derives `stage_reached` and `stalled_days`. |
| `data/builder/aggregates.py` | This file computes KPIs and flows from the normalized tables. The running API does not read its output. |
| `api/app/models.py` | This file declares the fourteen SQLAlchemy tables, including the denormalized `edge` table. |
| `api/app/seed.py` | This file is the mock of the production ingest, turning graph nodes and edges into rows. |
| `api/app/services/analytics.py` | This file answers every counting question in SQL, including the funnel and the turnaround phases. |
| `api/app/services/graph.py` | This file assembles the node-and-edge payload the front end draws (2,483 nodes and 5,162 edges for the full cohort), plus one specimen's detail and ID search. |
| `api/app/main.py` | This file wires the routers, CORS, the health check and the single-page-app fallback. |
| `api/export_static.py` | This file writes the three API responses to disk for the GitHub Pages build. |
| `web/src/lib/api.ts` | This file is the typed API client and switches between HTTP and static files at build time. |
| `web/src/lib/types.ts` | This file mirrors the API's response shapes in TypeScript by hand. |
| `web/src/lib/graph/v3.ts` | This file holds the visual vocabulary carried over from the mockup, including the spring lengths per edge type. |
| `web/src/lib/graph/model.ts` | This file holds adjacency, provenance closures, lineage walks, facet projection and bridge edges. |
| `web/src/lib/graph/force3d.ts` | This file is a three-dimensional force simulation with grid-bucketed repulsion. |
| `web/src/lib/graph/rotator.ts` | This file projects 3-D coordinates into Cytoscape every frame and owns rotation, panning and zoom. |
| `web/src/lib/graph/shell.ts` | This file computes the "shell by progress" globe layout from the data rather than by simulation. |
| `web/src/lib/graph/clusters.ts` | This file places nodes inside one ball per group for the clustered and grouped layouts. |
| `web/src/routes/graph/+page.svelte` | This file is the knowledge-graph view, with facets, layers, highlighting, menus and export. |
| `web/src/lib/components/Sankey.svelte` | This file draws the cohort-flow ribbon as hand-built SVG paths. |
| `web/src/lib/workflow.ts` | This file is the planned PreDDLung journey as a static list of stages with planned durations. |
| `Dockerfile` | This file builds a two-stage image that generates the cohort and the database at build time. |
| `.github/workflows/pages.yml` | This file publishes the static build to GitHub Pages on every push to `main`. |

---

## Data Sources

### 1. The REDCap data dictionary
The schema source of truth is `data/reference/TESTPMSampleCentral_DataDictionary_2026-07-09.csv`, a tab-separated REDCap dictionary with 124 fields across eight instruments. `common/dictionary.py` derives the export header from it, so a newer dictionary changes the export without code changes. A new field is exported automatically but is not populated until someone adds it to a `_fill_*` method in `model.py`.

### 2. The synthetic REDCap export
`data/out/redcap_export.csv` holds 181 records and 141 columns, one record per specimen, with patient fields repeated on every record of that patient. It reproduces REDCap's quirks on purpose, so the builder exercises the same decoding a live export would need. The directory `data/out/` is git-ignored and regenerated on every build.

### 3. The provenance graph artefact
`data/out/graph.json` is the builder's typed graph, with node ids prefixed by kind (for example `patient:PDL-0042` or `aliquot:PMSC-2025-0042-DNA`). The seeder reads it together with the raw export, because one fact, the mass-spectrometry QC outcome, is attached in the seeder from the export rather than from the graph.

### 4. The application database
`api/pmsc.db` is a SQLite file with fourteen tables. It is git-ignored, built by `python -m app.seed --force`, and never written to by the running API. The API refuses to start against an empty database.

### 5. The static data files
`web/static/data/meta.json`, `overview.json` and `graph.json` are written by `api/export_static.py` for the Pages build and are git-ignored. One hazard deserves a warning. `data/builder/build.py` also writes a file called `graph.json` into the same directory by default, with a different shape. Running the builder without `--web` overwrites the API-shaped file, and a static build made afterwards will fail at runtime. The Dockerfile and the Pages workflow both pass `--web /tmp/discard` for this reason.

---

## Dependencies

### API
| Package | Purpose |
|---------|---------|
| `fastapi>=0.115` | This package provides the routing, dependency injection, validation and the OpenAPI page. |
| `uvicorn[standard]>=0.32` | This package is the ASGI server that runs the application. |
| `sqlalchemy>=2.0` | This package provides the typed ORM models and the query builder used by every service. |
| `pydantic>=2` | This package defines the response models in `schemas.py`. |

### Front end, runtime
| Package | Purpose |
|---------|---------|
| `cytoscape` | This package renders the knowledge graph and provides hit-testing and styling. |
| `cytoscape-dagre`, `cytoscape-fcose` | These layout extensions are declared but no source file imports them. |
| `html-to-image` | This package rasterises DOM elements for the timeline export. |
| `jspdf` | This package writes the PDF exports of the graph and the path window. |

### Front end, build and test
| Package | Purpose |
|---------|---------|
| `@sveltejs/kit`, `svelte` | These are the application framework and the compiler, with runes forced on for project files. |
| `@sveltejs/adapter-static` | This adapter emits plain files with an `index.html` fallback, which suits both the container and Pages. |
| `@sveltejs/adapter-auto` | This scaffold leftover is still declared, although `vite.config.ts` uses the static adapter. |
| `vite`, `typescript`, `svelte-check` | These provide the build, the language and the type checking. |
| `puppeteer-core` | This package drives a real Chrome in the seven end-to-end scripts under `web/tests/`. |

### Data pipeline
| Package | Purpose |
|---------|---------|
| Python standard library only | The generator and builder deliberately depend on nothing else, so the Docker image can build the cohort with no extra installs. |
