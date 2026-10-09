# Diagrams

## System Overview

```mermaid
graph LR
    DICT["REDCap dictionary (124 fields)"] --> GEN["generator: Simulation"]
    CFG["config.py: SEED, AS_OF"] --> GEN
    GEN --> CSV["redcap_export.csv"]
    CSV --> NORM["builder: normalize"]
    NORM --> GB["builder: GraphBuilder"]
    GB --> GJ["graph.json"]
    GJ --> SEED["api: seed.py"]
    CSV --> SEED
    SEED --> DB[("pmsc.db, 14 tables")]
    DB --> SVC["services: analytics and graph"]
    SVC --> API["FastAPI routers"]
    API --> WEB["SvelteKit front end"]
    SVC --> EXP["export_static.py"]
    EXP --> STATIC["static JSON for Pages"]
    STATIC --> WEB
```

The generator and the builder never meet the database, and the API never reads the export except for one field in the seeder. Replacing the generator with a live REDCap export changes only the leftmost box.

## Database Schema

```mermaid
erDiagram
    STUDY ||--o{ PATIENT : has
    STAFF |o--o{ PATIENT : enrolled
    PATIENT ||--o{ SPECIMEN : gave
    SPECIMEN |o--o| SPECIMEN : repeat_of
    SPECIMEN ||--o{ ALIQUOT : yields
    ALIQUOT |o--o| ALIQUOT : parent
    ALIQUOT ||--o{ QC_RESULT : checked
    ALIQUOT ||--o{ PLATFORM_RUN : submitted
    FACILITY |o--o{ PLATFORM_RUN : runs
    SPECIMEN ||--o{ ACTIVITY : underwent
    SPECIMEN ||--o{ DEVIATION : recorded
    STORAGE_LOCATION |o--o{ ALIQUOT : stores
    INFORMATION_SYSTEM |o--o{ IDENTIFIER : issues
```

The `identifier` table points at its owner through `owner_type` and `owner_id` rather than a foreign key, because an identifier can belong to a patient, a specimen or an aliquot. The `edge` table is not drawn, because it relates every table to every other through type-and-id pairs.

## Graph Payload Classes

```mermaid
classDiagram
    class GraphModel {
        +nodes
        +edges
        +adj
        +outcomeOf(node)
        +sampleClosure(id)
        +lineage(node, direction)
        +lineageSteps(node)
        +idChain(sample)
    }
    class Force3D {
        +bodies
        +reset(ids, edges, warm)
        +step()
        +place(ids, positions)
    }
    class Rotator {
        +sim
        +start(ids, edges, frame)
        +startFixed(ids, at, scale, frame)
        +hold(reason, on)
        +toggleSpin()
    }
    class GraphPage {
        +applyVisibility()
        +relayout(layout)
        +paintOverlay()
    }
    GraphPage --> GraphModel : projects facets with
    GraphPage --> Rotator : drives
    Rotator --> Force3D : owns
    Force3D ..> GraphModel : reads spring table v3
```

## Generator Phases

```mermaid
flowchart TD
    A["build_patients: 100 enrolled across 20 months"] --> B["build_specimens: kinds dealt by quota"]
    B --> C["_plan: ideal timeline, QC decided up front"]
    C --> D["_assign_stalls: 12 specimens across 5 stages"]
    D --> E["_truncate: cut at AS_OF and at the stall"]
    E --> F["_make_repeats: new record per failed aliquot marked Repeat"]
    F --> G["_fill_values: REDCap fields for steps that happened"]
    G --> H["emit.write_export"]
```

The order matters. QC must be decided before the timeline is cut, because a failed aliquot is never submitted and so has no later dates to cut.

## Request Flow: Opening the Dashboard

```mermaid
sequenceDiagram
    participant B as Browser
    participant L as layout.svelte
    participant D as dashboard page
    participant A as FastAPI
    participant S as analytics service
    participant Q as SQLite
    B->>L: navigate to /dashboard
    L->>A: GET /api/meta
    D->>A: GET /api/overview
    A->>S: kpis, flow, sample_types, qc, turnaround, attention
    S->>Q: COUNT and GROUP BY queries
    Q-->>S: rows
    S-->>A: dictionaries
    A-->>D: Overview model as JSON
    D->>D: derive tiles, render Sankey and Turnaround
```

## Graph View: From Payload to Frame

```mermaid
flowchart LR
    P["GET /api/graph"] --> M["new GraphModel"]
    M --> C["mount Cytoscape"]
    C --> V["project facets, add bridges"]
    V --> K{"layout"}
    K -->|force| F["Force3D settles in 10 ms slices"]
    K -->|shell| S["shellPlacement computes"]
    K -->|clustered or grouped| G["clusterPlacement computes"]
    F --> R["Rotator projects and writes positions"]
    S --> R
    G --> R
    R --> O["paintOverlay draws rings or hulls"]
```

## Specimen Stage State

```mermaid
stateDiagram-v2
    [*] --> enrolled
    enrolled --> collected
    collected --> pathology
    pathology --> finished_biobank : blood kept for the biobank
    pathology --> pmsc_prep
    pmsc_prep --> allprep
    allprep --> qc
    qc --> submitted
    submitted --> data_back
    data_back --> mtb
    mtb --> [*]
    finished_biobank --> [*]
```

A specimen whose last step is older than thirty days, and which still has an open stream, is flagged as stalled at whichever of these states it stopped in.
