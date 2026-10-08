/**
 * The 3-D force layout from mockups/index-v3.html, kept as a layout engine.
 *
 * Cytoscape draws in two dimensions, which stops it from *computing* a 3-D
 * layout — not from displaying one. So the simulation lives here: it settles the
 * cohort in three dimensions using v3's edge-tier springs, and the view projects
 * those coordinates to 2-D positions every frame. Rotation therefore works
 * exactly as it did in the mockup, with Cytoscape as the renderer.
 *
 * Two differences from v3, both forced by cohort size:
 *
 *   * Repulsion is computed over a uniform grid with a cutoff radius rather than
 *     every pair. v3 capped the force layout at 520 nodes because O(n^2) stops
 *     holding a frame rate; the grid is near-linear, so the whole cohort can
 *     settle. Because repulsion already falls off as 1/d^2, truncating it past a
 *     few cell widths changes the picture very little.
 *   * Settling runs in slices off the animation frame, so the interface stays
 *     responsive and can show progress instead of freezing.
 */
import { SPRING, SPRING_DEFAULT } from './v3';

export interface Point3 { x: number; y: number; z: number; }

interface Body extends Point3 { vx: number; vy: number; vz: number; }

const REPULSION = 2600, REPULSION_CAP = 2.2;
const GRAVITY = 0.0004, DAMPING = 0.86, MAX_STEP = 6;
/** v3's schedule: full strength first, then cool. Decaying from the start
    freezes a half-built layout. */
const WARMUP = 420, ANNEAL = 0.97;
/** Ignore repulsion past this multiple of the cell size — the 1/d^2 term is
    negligible there and it is what makes the grid worth having. */
const CUTOFF_CELLS = 1;

export interface Edge3 { a: number; b: number; type: string; }

export class Force3D {
  bodies: Body[] = [];
  private index: number[] = [];           // body -> node id
  private slot = new Map<number, number>(); // node id -> body
  private edges: { a: number; b: number; L: number; k: number }[] = [];
  private radius = 360;
  private cell = 90;
  private alpha = 1;
  private ticks = 0;
  settled = false;

  /** Seeded so the same cohort always settles the same way — a reproducible
      picture can be screenshotted and argued about. */
  private seed = 1337;
  private rnd = () => {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  };

  /**
   * `warm` keeps every node that was already placed where it was, and starts a
   * newcomer next to a placed neighbour. Switching a node type on then adds
   * those nodes to the picture instead of scattering and re-settling all of it.
   */
  reset(nodeIds: number[], edges: Edge3[], warm = false) {
    const previous = new Map<number, Body>();
    if (warm) this.index.forEach((id, i) => previous.set(id, this.bodies[i]));

    this.slot.clear();
    this.index = nodeIds;
    nodeIds.forEach((id, i) => this.slot.set(id, i));

    if (!warm) this.radius = Math.max(330, Math.min(2600, 34 * Math.sqrt(nodeIds.length || 1)));
    const world = this.radius / 360;
    const neighbour = new Map<number, Body>();
    if (warm) {
      for (const edge of edges) {
        const pa = previous.get(edge.a), pb = previous.get(edge.b);
        if (pa && !pb && !neighbour.has(edge.b)) neighbour.set(edge.b, pa);
        if (pb && !pa && !neighbour.has(edge.a)) neighbour.set(edge.a, pb);
      }
    }
    this.bodies = nodeIds.map((id) => {
      const kept = previous.get(id);
      if (kept) return { ...kept, vx: 0, vy: 0, vz: 0 };
      const near = neighbour.get(id);
      const spread = near ? 20 : 320 * world;
      return {
        x: (near?.x ?? 0) + (this.rnd() - 0.5) * spread,
        y: (near?.y ?? 0) + (this.rnd() - 0.5) * spread,
        z: (near?.z ?? 0) + (this.rnd() - 0.5) * spread,
        vx: 0, vy: 0, vz: 0,
      };
    });

    this.edges = [];
    for (const edge of edges) {
      const a = this.slot.get(edge.a), b = this.slot.get(edge.b);
      if (a === undefined || b === undefined) continue;
      const spring = SPRING[edge.type] ?? SPRING_DEFAULT;
      this.edges.push({ a, b, L: spring.L, k: spring.k });
    }

    /* cell size tracks the longest spring, so a "loose" edge still finds its
       partner inside the neighbourhood search */
    this.cell = 110;
    /* a warm start only has to fit the newcomers in, not untangle everything */
    this.alpha = warm ? 0.3 : 1;
    this.ticks = 0;
    this.settled = false;
  }

  /**
   * Place bodies at coordinates worked out elsewhere and call it finished.
   *
   * The shell layout computes position from the data rather than settling it, so
   * there is nothing to simulate: the coordinates ARE the answer. Marking it
   * settled means the rotator projects and rotates exactly as it does for a
   * solved force layout, with no waiting and no drift.
   */
  place(nodeIds: number[], at: Map<number, Point3>) {
    this.slot.clear();
    this.index = nodeIds;
    nodeIds.forEach((id, i) => this.slot.set(id, i));
    this.bodies = nodeIds.map((id) => {
      const p = at.get(id) ?? { x: 0, y: 0, z: 0 };
      return { x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0 };
    });
    this.edges = [];
    let far = 1;
    for (const b of this.bodies) far = Math.max(far, Math.hypot(b.x, b.y, b.z));
    this.radius = far;
    this.alpha = 0;
    this.ticks = 0;
    this.settled = true;
  }

  positionOf(nodeId: number): Point3 | null {
    const i = this.slot.get(nodeId);
    return i === undefined ? null : this.bodies[i];
  }

  get progress(): number {
    return this.settled ? 1 : Math.min(0.99, this.ticks / (WARMUP + 160));
  }

  /** One simulation step. Returns false once the layout has stopped moving. */
  step(): boolean {
    if (this.settled) return false;
    const bodies = this.bodies;
    const n = bodies.length;
    if (!n) { this.settled = true; return false; }

    // ---- repulsion, over a uniform grid ------------------------------------
    const buckets = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) =>
      `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const k = key(b.x, b.y, b.z);
      const bucket = buckets.get(k);
      if (bucket) bucket.push(i); else buckets.set(k, [i]);
    }

    for (const [k, members] of buckets) {
      const [cx, cy, cz] = k.split(',').map(Number);
      const neighbours: number[] = [];
      for (let dx = -CUTOFF_CELLS; dx <= CUTOFF_CELLS; dx++) {
        for (let dy = -CUTOFF_CELLS; dy <= CUTOFF_CELLS; dy++) {
          for (let dz = -CUTOFF_CELLS; dz <= CUTOFF_CELLS; dz++) {
            const other = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (other) neighbours.push(...other);
          }
        }
      }
      for (const i of members) {
        const a = bodies[i];
        for (const j of neighbours) {
          if (j <= i) continue;
          const b = bodies[j];
          const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          const d2 = dx * dx + dy * dy + dz * dz + 0.01;
          const d = Math.sqrt(d2);
          let f = Math.min(REPULSION_CAP, REPULSION / d2);
          f /= d;
          a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
          b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
        }
      }
    }

    // ---- springs: one rest length per edge type ----------------------------
    for (const edge of this.edges) {
      const a = bodies[edge.a], b = bodies[edge.b];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const f = ((d - edge.L) * edge.k) / d;
      a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
      b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
    }

    // ---- integrate, with gravity toward the centre and annealing -----------
    for (const body of bodies) {
      body.vx -= body.x * GRAVITY;
      body.vy -= body.y * GRAVITY;
      body.vz -= body.z * GRAVITY;
      body.vx *= DAMPING; body.vy *= DAMPING; body.vz *= DAMPING;
      body.x += Math.max(-MAX_STEP, Math.min(MAX_STEP, body.vx)) * this.alpha;
      body.y += Math.max(-MAX_STEP, Math.min(MAX_STEP, body.vy)) * this.alpha;
      body.z += Math.max(-MAX_STEP, Math.min(MAX_STEP, body.vz)) * this.alpha;
      const r = Math.sqrt(body.x * body.x + body.y * body.y + body.z * body.z);
      if (r > this.radius) {
        const k = this.radius / r;
        body.x *= k; body.y *= k; body.z *= k;
      }
    }

    this.ticks++;
    if (this.ticks > WARMUP) {
      this.alpha *= ANNEAL;
      if (this.alpha < 0.02) this.settled = true;
    }
    return !this.settled;
  }
}

/** Rotate around Y then X and flatten to the plane Cytoscape draws on. */
export function project(p: Point3, rotY: number, rotX: number, scale = 1) {
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const x = p.x * cosY - p.z * sinY;
  let z = p.x * sinY + p.z * cosY;
  const y = p.y * cosX - z * sinX;
  z = p.y * sinX + z * cosX;
  return { x: x * scale, y: y * scale, depth: z };
}
