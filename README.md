# PM-SC dashboard

Sample provenance for **Precision Medicine Sample Central** (WP2). Three tiers:
a database, an API over it, and a SvelteKit frontend that talks to the API over
HTTP. The cohort is synthetic, generated from the REDCap data dictionary.

```
data/          the synthetic export (generator + builder)  — the mock "source system"
api/           FastAPI + SQLAlchemy over SQLite            — the application store & service
web/           SvelteKit + TypeScript + Cytoscape.js       — the frontend
mockups/       index-v3.html                               — the design base, unchanged
```

## Running it

Two processes. First the API:

```bash
cd api
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.seed --force      # load the export into pmsc.db
./run.sh                                  # http://localhost:8000  (/docs for the API)
```

Then the frontend:

```bash
cd web
npm install
npm run dev                               # http://localhost:5173
```

`npm run check` type-checks the frontend and `npm run test:e2e` drives a real
Chrome against it (it asserts that the layout settles, that rotation moves the
projection, that pausing holds it still, and that it is disabled in the flat
views). `.venv/bin/python -m pytest` runs the API tests.

## The three tiers

**Database (`api/pmsc.db`).** Thirteen tables — study, patient, specimen, aliquot,
qc_result, deviation, activity, staff, facility, platform_run, storage_location,
identifier, and an `edges` table. Two shapes on purpose: counting questions
("how many specimens cleared QC") are a GROUP BY over the entity tables, while
traversal questions ("what else is in this freezer box") walk edges. In
production those would be two stores; here one file serves both and the API
keeps the split visible so that swap stays cheap.

`app/seed.py` is the mock of the production ingest. In the real system a weekly
pipeline reads REDCap and writes these same tables. Nothing above that line
changes when it does — which is the point of putting a database under the app
rather than serving JSON files.

**API (`api/app`).** FastAPI. `services/analytics.py` answers the counting
questions in SQL; `services/graph.py` answers the traversal ones and returns the
node/edge vocabulary the frontend's graph already speaks. Routers are thin.
Nothing reads a precomputed aggregate file — every number on the dashboard is
derived, so it stays right when the data moves.

**Frontend (`web/src`).** SvelteKit 2 with Svelte 5 runes, TypeScript throughout.
Three routes matching the three views. Cytoscape.js renders the graph.

## v3 is the design base

`mockups/index-v3.html` was shaped by team feedback, so it is the reference and
it is left untouched. The app carries over its stylesheet verbatim
(`web/src/app.css`), its palette, node sizes and ontology anchors
(`lib/graph/v3.ts`), its provenance closures (`lib/graph/model.ts`), its journey
swimlane (`lib/workflow.ts`) and its cohort-flow ribbon
(`lib/components/Sankey.svelte`).

**Rotation is kept, including the 3-D layout behind it.** Cytoscape.js draws in
two dimensions, which stops it from *computing* a 3-D layout — not from
displaying one. So the simulation lives in `lib/graph/force3d.ts`: it settles the
cohort in three dimensions using v3's springs, and `lib/graph/rotator.ts`
projects those coordinates into Cytoscape node positions every frame. Drag to
rotate, the auto-spin and the depth cue all behave as they did in the mockup,
with Cytoscape as the renderer.

Two differences from v3, both forced by cohort size:

- Repulsion runs over a uniform grid with a cutoff rather than every pair. v3
  capped its force view at 520 nodes because O(n²) stops holding a frame rate;
  the grid is near-linear, so the whole cohort settles — 724 nodes in about
  0.6 s, and 1196 with the ID chain switched on.
- Settling runs in slices off the animation frame, so the page stays responsive
  and reports progress instead of freezing.

The settle runs behind a loading state rather than on screen. Watching a cloud
explode out of the origin and re-frame itself several times is noise, not
information — so the canvas stays covered, the progress is reported, and the
viewport is framed exactly once, when there is a layout worth looking at.

Rotation is disabled in Layered and Grouped, exactly as in v3: those views are
flat, and turning a flat picture only foreshortens an axis that carries meaning.

The part that makes the view an argument rather than a picture also survives:
**distance means how tightly two things belong together.** Every edge type has
its own rest length (`SPRING` in `lib/graph/v3.ts`), so one patient's samples
pull into a clump and shared things — a platform, an operator, a freezer box —
settle between the clumps. Measured after settling: 50 units for
`derived_from` (tight), 95 for `has_sample` (family), 312 for `submitted_to`
(loose) — the same ratios v3 measured.

## Things the data forced

Three places where the source disagreed with the mockup, each resolved in favour
of the data and commented where it happens:

- **Sample types** are FFPE / Tissue / Biopsy / Blood, not the FFPE /
  Fresh-Frozen / Blood the mockup guessed. The facets read the value set from
  the export.
- **A repeat is a whole new REDCap record**, so `repeat_of` runs specimen to
  specimen, not aliquot to aliquot.
- **The mass-spec QC (`ms_qcheck`) was missing from the graph artefact**, so the
  entire proteomics stream arrived with no QC outcome. The seeder reads it from
  the CSV and attaches it to the peptide, which is what was injected.

## Rotation costs CPU while it spins

Cytoscape redraws every node and edge whenever positions move, so an animated
700-node graph is real work: measured on the graph view, the main thread runs at
about 67% while spinning and 1–2% the moment rotation is paused or a flat layout
is selected. That is why the spin runs at 20 fps rather than the display's 60,
pauses itself when the tab is hidden, and does nothing at all once the layout has
settled and the spin is off.

If the browser devtools feel unresponsive on that page, it is this: press
**⏸ Rotation** and the main thread is handed straight back. The other two views
are idle throughout.

**Who owns the drag.** In the force view the simulation owns node positions and
the viewport, so Cytoscape's own panning and node-grabbing are switched off —
otherwise one gesture drives two things at once and the frame slides out from
under the graph while you turn it. The flat views are the opposite: nothing is
animating there, so panning and grabbing are back on. For the duration of a
rotate gesture the graph is stripped to plain dots (edges and glow dropped),
which is worth about a fifth of the frame cost; they return the moment you let
go, and a plain click never triggers it.

## Known limits

- **Proteomics wait time cannot be measured.** The mass-spec run records a
  returned date but no send date, so the turnaround row appears with "no send
  date recorded" rather than being quietly dropped.
- **The stall threshold is 30 days, flat.** One number may not fit every stage —
  platform analysis legitimately takes weeks. Open question with the team.
- **Yield is not quality.** QC here is concentration plus total yield plus a
  Pass/Fail. There is no RIN, no DV200 and no purity ratio in the schema, so the
  app cannot say whether material was intact. See `docs/questions.md`.
