# Patterns

## Schema-derived export shape

**What it is**: The code computes the export's columns from the data dictionary instead of listing them by hand.

**Used in**: `data/common/dictionary.py`, `data/generator/emit.py` and `data/builder/normalize.py`.

**Why it's used**: The dictionary is still being written by the study team. Deriving from it means a new dictionary version changes the export with no code edit, and the encoder and the decoder cannot disagree about which columns exist.

**How it works**:
```python
def export_columns(self) -> list:
    """The column name(s) this field occupies in a REDCap CSV export."""
    if self.is_descriptive:
        return []
    if self.is_checkbox:
        return [f"{self.name}___{code}" for code in self.choices]
    return [self.name]
```

---

## Plan the ideal, then truncate

**What it is**: The simulation first gives every specimen a complete timeline as though nothing went wrong, and only afterwards cuts it back at the snapshot date or at a planted stall.

**Used in**: `Simulation._plan()`, `_assign_stalls()` and `_truncate()` in `data/generator/model.py`.

**Why it's used**: Truncation by date is what spreads the cohort across pipeline stages, and planting a stall needs to know where a specimen would have gone. Doing both on a finished timeline keeps each rule simple and keeps every date consistent with the ones before it.

**How it works**:
```python
reached_idx = 0
for i, stage in enumerate(STAGES):
    if i > limit:
        break
    d = stage_dates.get(stage)
    if d is None:
        continue
    if d > self.cfg.AS_OF:
        break
    reached_idx = i
s.reached = STAGES[reached_idx]
```

---

## Allocation by quota rather than by chance

**What it is**: A cohort property such as "40% of tissue is FFPE" is met exactly by building a list of the right composition, shuffling it, and dealing it out.

**Used in**: `Simulation.build_specimens()` in `data/generator/model.py`.

**Why it's used**: With 95 draws a 40% coin flip lands anywhere from 32 to 46, and the cohort mix is a stated property of the dataset that should match the configuration exactly.

**How it works**:
```python
kinds = ["tissue_ffpe"] * round(n * cfg.P_TISSUE_FFPE)
kinds += ["tissue_ff"] * (n - len(kinds))
rng.shuffle(kinds)
```

---

## Identifier promotion

**What it is**: Every cross-system identifier becomes a node of its own, joined to its owner by `IDENTIFIED_AS` and to the issuing system by `ISSUED_BY` where a source names one.

**Used in**: `GraphBuilder.identifier()` in `data/builder/graph.py`, the `identifier` table in `api/app/models.py`, and `attach_identifiers()` in `api/app/services/graph.py`.

**Why it's used**: Reconciling the chain of identifiers across systems is the WP2 deliverable. Identifiers held as string attributes could be displayed but not traversed or searched as objects, and the issuing system is left blank where no source names it rather than guessed.

**How it works**:
```python
nid = f"id:{scheme}:{value}"
self.node(nid, "Identifier", value, scheme=scheme)
self.edge(owner, nid, "IDENTIFIED_AS")
if scheme in ISSUED_BY:
    self.edge(nid, self.information_system(ISSUED_BY[scheme]), "ISSUED_BY")
```

---

## Entity tables plus a denormalized edge table

**What it is**: The relational schema keeps typed tables for counting and one generic `edge` table, indexed on both ends, for traversal.

**Used in**: `api/app/models.py` and `api/app/seed.py`.

**Why it's used**: Counting is a `GROUP BY` over typed columns, while "what touches this" is a lookup on one indexed table without a join per relationship type. Keeping the two visible makes it cheap to move traversal to a graph store later.

**How it works**:
```python
class Edge(Base):
    __tablename__ = "edge"
    id: Mapped[int] = mapped_column(primary_key=True)
    src_type: Mapped[str] = mapped_column(String(20), index=True)
    src_id: Mapped[int] = mapped_column(Integer, index=True)
    dst_type: Mapped[str] = mapped_column(String(20), index=True)
    dst_id: Mapped[int] = mapped_column(Integer, index=True)
    type: Mapped[str] = mapped_column(String(30), index=True)

Index("ix_edge_src", Edge.src_type, Edge.src_id)
```

**Current state**: The seeder writes 3,965 rows to this table, but no service, router, test or exporter reads it. The pattern is present in the schema and absent from the queries.

---

## Thin router over a service layer

**What it is**: Each route only obtains a session, calls a service function, and wraps the result in a response model.

**Used in**: `api/app/routers/*.py`, with the logic in `api/app/services/`.

**Why it's used**: Because the routes hold no logic, `export_static.py` can call the same services without HTTP and write identical payloads to disk for the Pages build.

**How it works**:
```python
@router.get("/overview", response_model=Overview)
def overview(session: Session = Depends(get_session)) -> Overview:
    return Overview(
        kpis=analytics.kpis(session),
        flow=analytics.flow(session),
        ...
    )
```

---

## Build-time switch between API and static files

**What it is**: One client module chooses at build time whether each call is an HTTP request or a read of a pre-written file.

**Used in**: `web/src/lib/api.ts`, driven by `VITE_STATIC_DATA` and `VITE_API_BASE`.

**Why it's used**: The showcase's database never changes within a release, so three files can answer the only three questions the published site asks, and colleagues can open a link instead of installing Docker.

**How it works**:
```ts
const STATIC = import.meta.env.VITE_STATIC_DATA === '1';
const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
...
url = STATIC ? `${base}${FILES[path.split('?')[0]]}` : `${BASE}${path}`;
```

---

## Simulate in three dimensions, render in two

**What it is**: A custom force simulation computes 3-D coordinates, and a rotator projects them into Cytoscape's 2-D positions on each frame.

**Used in**: `web/src/lib/graph/force3d.ts` and `web/src/lib/graph/rotator.ts`.

**Why it's used**: Cytoscape can display any positions it is given but cannot compute a 3-D layout. Separating the simulation from the renderer kept the mockup's rotation while gaining Cytoscape's hit-testing and styling.

**How it works**:
```ts
export function project(p: Point3, rotY: number, rotX: number, scale = 1) {
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const x = p.x * cosY - p.z * sinY;
  let z = p.x * sinY + p.z * cosY;
  const y = p.y * cosX - z * sinX;
  z = p.y * sinX + z * cosX;
  return { x: x * scale, y: y * scale, depth: z };
}
```

**Trade-offs**: Every frame writes every node position, so the cost scales with node count and frame rate. The rotator caps the spin at 20 frames per second for that reason.

---

## Distance encodes relationship strength

**What it is**: Every edge type has its own spring rest length and stiffness, grouped into tight, family and loose tiers.

**Used in**: `SPRING` in `web/src/lib/graph/v3.ts`, consumed by `Force3D.reset()` and described in words by `relationTier()`.

**Why it's used**: With uniform springs a node's position would encode only its degree. With tiered springs one patient's material collapses into a clump, and shared hubs such as a lab or a freezer box settle between the clumps they serve.

**How it works**:
```ts
export const SPRING: Record<string, { L: number; k: number }> = {
  has_qc: { L: 26, k: 0.095 },        // tight
  has_sample: { L: 64, k: 0.035 },    // family
  submitted_to: { L: 185, k: 0.012 }, // loose
  ...
};
```

---

## Bridging hidden levels along the spine

**What it is**: When a layer is hidden, the projection walks forward along provenance edges through the hidden nodes and adds a single dashed bridge edge that lists what it stands for.

**Used in**: `project()` and `bridgeChain()` in `web/src/lib/graph/model.ts`, and `syncBridges()` in the graph page.

**Why it's used**: Dropping hidden nodes silently breaks the chain, and drawing a plain edge across them claims a direct relationship that does not exist. Restricting bridges to the spine also prevents a hidden hub from generating thousands of invented edges.

**How it works**:
```ts
if (visible.has(next)) {
  if (!elided.length) continue;                // a real edge, not a bridge
  bridges.push({ a: start, b: next, via: elided });
} else {
  queue.push([next, [...elided, model.nodes[next].type]]);
}
```

---

## Svelte 5 runes for local reactive state

**What it is**: Components declare reactive state with `$state`, computed values with `$derived` and `$derived.by`, side effects with `$effect`, and props with `$props`.

**Used in**: Every `.svelte` file, with runes forced on for project files in `web/vite.config.ts`.

**Why it's used**: It gives fine-grained reactivity without stores. The graph page's comments record the one trap that matters here, which is that an effect registers only the reactive values it actually reads on its first run.

**How it works**:
```svelte
$effect(() => {
  /* Read `selected` FIRST, or a short-circuit on the first run
     means it never becomes a dependency. */
  const holding = selected !== null || selectedEdge !== null;
  rotator?.hold('selection', holding);
});
```
