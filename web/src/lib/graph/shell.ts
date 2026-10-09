/**
 * The cohort as a globe: distance from the centre is how far the material got.
 *
 * The force layout places a node by how many edges it has. That is a fact about
 * the graph, not about the study — which is why the three analysis-lab nodes ended
 * up in the middle: each has hundreds of springs pulling on it from every
 * direction, so it cannot move, and everything else arranges itself around that
 * accident.
 *
 * Here position is computed, not simulated, from two things that mean something:
 *
 *   * RADIUS is the stage a thing reached, outer edge to core. A patient sits on
 *     the surface; a specimen that made it to the tumour board portal sits near the
 *     centre. The funnel is then a density gradient you can see: a dense shell
 *     outside, thinning inward. A spoke that stops short is material that
 *     stopped.
 *   * DIRECTION is the patient. Everything belonging to one patient lies along
 *     one ray, so a patient's whole chain reads as a single spoke.
 *
 * Because a sphere projects to a circle of the same radius under ANY rotation,
 * the stage rings can be drawn as plain concentric circles and stay correct as
 * the globe turns. That is what lets the radius be labelled rather than left as
 * a vibe — a layout where position means something and does not say what is
 * worse than one where it means nothing.
 */
import type { Point3 } from './force3d';
import type { GraphModel } from './model';
import type { GraphNode } from '$lib/types';

/** The pipeline, outer edge to core. Index doubles as the stage number the API
    already puts on every specimen as `reached`. */
export const STAGES = [
  'enrolled', 'collected', 'pathology', 'PM-SC prep', 'AllPrep',
  'QC', 'submitted', 'data back', 'MTB Portal',
];
const LAST = STAGES.length - 1;

/** The even ladder, core to surface, before any correction for crowding. */
const R_CORE = 430, R_SURFACE = 1250;
/** How far apart two nodes on the same shell should sit. */
const SPACING = 46;
/** Agents (operators) are not material and have no stage, so they ring the
    outside rather than pretending to a place on the ladder. */
const AGENT_MARGIN = 1.13;

export interface Ring { label: string; stage: number; r: number; count: number; }

/**
 * Where each stage's shell sits.
 *
 * The ladder is EVEN — ring 6 is as far from ring 5 as ring 5 is from ring 4 —
 * because an even ladder reads as a ladder. Two corrections make that work:
 *
 *   * A core radius, not a point. A shell is a surface, so how much it holds
 *     grows with the square of its radius. The first attempt ran the ladder down
 *     to almost nothing at the centre, and since most material DOES reach the
 *     end, everything that got there was crushed into a ball — the same hairball
 *     the force layout gave, in a different costume.
 *   * A single scale factor if any ring is still over-full, applied to the whole
 *     ladder so the even spacing survives. Switching the 791 identifiers on is
 *     what this is for.
 */
export function ringsFor(counts: Map<number, number>): Ring[] {
  const base = (stage: number) =>
    R_CORE + (R_SURFACE - R_CORE) * (1 - Math.max(0, Math.min(1, stage / LAST)));

  /* radius a ring needs to hold its nodes SPACING apart on a sphere */
  let scale = 1;
  for (let stage = 0; stage <= LAST; stage++) {
    const count = counts.get(stage) ?? 0;
    if (!count) continue;
    const need = SPACING * Math.sqrt(count / (4 * Math.PI));
    scale = Math.max(scale, need / base(stage));
  }

  return STAGES.map((label, stage) => ({
    label, stage, r: base(stage) * scale, count: counts.get(stage) ?? 0,
  }));
}

/** Radius for a stage, including the half-steps used by things that sit between
    two named stages (an analysis lab is past submitted, short of data back). */
function radiusAt(rings: Ring[], stage: number): number {
  if (stage <= 0) return rings[0].r;
  if (stage >= LAST) return rings[LAST].r;
  const lo = Math.floor(stage), hi = Math.ceil(stage);
  if (lo === hi) return rings[lo].r;
  const t = stage - lo;
  return rings[lo].r * (1 - t) + rings[hi].r * t;
}

/**
 * How far along a node is.
 *
 * Specimens carry `reached` from the API. Everything else is placed by what it
 * IS: an AllPrep activity happens at AllPrep whatever specimen it touched, and
 * an aliquot's own dates say how far that fraction itself travelled — which is
 * the point, because a specimen can reach the tumour board portal while one of its
 * three fractions is still sitting in a freezer.
 */
export function stageOf(node: GraphNode, ownerStage: number | null): number {
  switch (node.type) {
    case 'patient': return 0;
    case 'sample': return node.reached ?? 0;
    /* an analysis lab sits between submitted and data back; the in-house labs
       sit at the steps they carry out */
    case 'lab': return node.analysis ? 6.5 : node.label.startsWith('Pathology') ? 3 : 4;
    /* software is not a stage, except the portal the journey ends in */
    case 'system': return node.endpoint ? LAST : -1;
    case 'storage': return 4.5;               // where material waits, mid-pipeline
    case 'operator': return -1;               // an agent, not a stage — see R_AGENT
    case 'aliquot':
      if (node.returned_on) return 7;
      if (node.sent_on) return 6;
      if (node.qc) return 5;
      return 4;
    case 'activity': return ACTIVITY_STAGE[node.kind ?? ''] ?? 3;
    /* an identifier is a name for something else, so it sits where that thing
       sits — otherwise the ID chain would be a ring of its own, which says
       nothing */
    default: return ownerStage ?? 2;
  }
}

const ACTIVITY_STAGE: Record<string, number> = {
  collection: 1, pathology: 2, sectioning: 3, cryoprep: 3,
  allprep: 4, protein_extraction: 4, sp3: 4,
};

/** Evenly spread directions on a sphere. Successive indices land far apart, so
    neighbouring patients do not form a stripe. */
function sphereDirection(i: number, n: number): Point3 {
  const y = n > 1 ? 1 - (i / (n - 1)) * 2 : 0;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * 2.399963229728653;                 // golden angle
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

/** Evenly spaced around a gently tilted great circle — for the handful of nodes
    that belong to no patient and so have no spoke to join. */
function ringDirection(i: number, n: number): Point3 {
  const a = (i / n) * Math.PI * 2;
  return norm({ x: Math.cos(a), y: 0.22 * Math.sin(a * 2), z: Math.sin(a) });
}

/** Any two unit vectors perpendicular to `d`, for spreading a spoke's nodes
    across the shell instead of stacking them on the ray. */
function basis(d: Point3): [Point3, Point3] {
  const away = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = norm(cross(d, away));
  return [u, norm(cross(d, u))];
}
const cross = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v: Point3): Point3 => {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
};

/** Which patient a node belongs to, following the edges back one or two hops. */
function patientOf(node: GraphNode, model: GraphModel): number | null {
  const id = node.id;
  const up = (from: number, type: string) =>
    (model.adj[from] ?? []).find((x) => x.t === type && x.dir === 'in')?.o ?? null;
  const down = (from: number, type: string) =>
    (model.adj[from] ?? []).find((x) => x.t === type && x.dir === 'out')?.o ?? null;

  switch (node.type) {
    case 'patient': return id;
    case 'sample': return up(id, 'has_sample');
    case 'aliquot': {
      const specimen = down(id, 'derived_from');
      return specimen == null ? null : up(specimen, 'has_sample');
    }
    case 'activity': {
      const specimen = down(id, 'used');
      return specimen == null ? null : up(specimen, 'has_sample');
    }
    case 'identifier': {
      const owner = up(id, 'identified_as');
      if (owner == null) return null;
      const ownerNode = model.nodes[owner];
      return ownerNode ? patientOf(ownerNode, model) : null;
    }
    default: return null;                     // lab, system, storage, operator
  }
}

export interface ShellPlacement {
  positions: Map<number, Point3>;
  /** the guides to draw, so the radius is labelled rather than left as a feeling */
  rings: Ring[];
}

/**
 * Place every visible node on the globe.
 *
 * Nodes that share a patient AND a stage would land on the same point, so each
 * gets a small phyllotaxis offset across the shell at that radius. The offset is
 * tangential, which keeps the radius — the thing that means something — exact.
 */
export function shellPlacement(ids: number[], model: GraphModel): ShellPlacement {
  const positions = new Map<number, Point3>();

  /* stage every node first: the rings are sized from what is actually on screen,
     so switching a layer on widens the ring that layer lands on rather than
     packing it into the same shell */
  const stage = new Map<number, number>();
  const owner = new Map<number, number | null>();
  const counts = new Map<number, number>();
  for (const id of ids) {
    const node = model.nodes[id];
    if (!node) continue;
    const patient = patientOf(node, model);
    owner.set(id, patient);
    const ownerNode = patient != null ? model.nodes[patient] : null;
    const ownerStage = ownerNode && ownerNode.type !== 'patient'
      ? stageOf(ownerNode, null) : null;
    const st = stageOf(node, ownerStage);
    stage.set(id, st);
    const ring = Math.round(Math.max(0, st));
    counts.set(ring, (counts.get(ring) ?? 0) + 1);
  }

  const rings = ringsFor(counts);

  /* Patients define the spokes; everything of theirs joins the same ray. A
     spoke belongs to every patient who owns something on screen, whether or not
     the patient dots themselves are switched on. Taking spokes only from visible
     patient nodes meant that hiding the Patient layer left no spokes at all, and
     every sample and aliquot fell onto the same fallback direction in one pile.
     Visible patients come first, in the order they had before, so the picture
     with patients on is unchanged. */
  const order = new Map<number, number>();
  for (const id of ids) {
    if (model.nodes[id]?.type === 'patient') order.set(id, order.size);
  }
  for (const id of ids) {
    const patient = owner.get(id);
    if (patient != null && !order.has(patient)) order.set(patient, order.size);
  }
  const spokes = Math.max(1, order.size);

  /* Things with no patient — labs, systems, boxes, operators — get their own even
     spread so they do not pile onto somebody's spoke. Spread on a great circle
     rather than over the sphere: there are only a handful, and a sphere spread
     put the three analysis labs close enough together on screen that their labels
     overlapped. The portal is excluded because it sits at the centre. */
  const orphans = ids.filter((id) => owner.get(id) == null
                                  && model.nodes[id]?.type !== 'patient'
                                  && !model.nodes[id]?.endpoint);
  const orphanOrder = new Map<number, number>();
  orphans.forEach((id, i) => orphanOrder.set(id, i));

  const bucket = new Map<string, number>();

  for (const id of ids) {
    const node = model.nodes[id];
    if (!node) continue;
    const st = stage.get(id) ?? 0;

    /* the board is the destination, so it is the destination: dead centre */
    if (node.endpoint) { positions.set(id, { x: 0, y: 0, z: 0 }); continue; }

    const patient = owner.get(id) ?? null;
    const direction = patient != null && order.has(patient)
      ? sphereDirection(order.get(patient)!, spokes)
      : ringDirection(orphanOrder.get(id) ?? 0, Math.max(1, orphans.length));

    const r = st < 0 ? rings[0].r * AGENT_MARGIN : radiusAt(rings, st);

    /* spread within the shell: one phyllotaxis disc per (spoke, stage), so two
       aliquots of the same specimen sit side by side instead of on top of each
       other. The offset is tangential, which leaves the radius — the thing that
       means something — exact. */
    const key = `${patient ?? `o${orphanOrder.get(id) ?? 0}`}|${st}`;
    const k = bucket.get(key) ?? 0;
    bucket.set(key, k + 1);
    const [u, v] = basis(direction);
    const spread = 13 * Math.sqrt(k);
    const angle = k * 2.399963229728653;
    const ox = Math.cos(angle) * spread, oy = Math.sin(angle) * spread;

    positions.set(id, {
      x: direction.x * r + u.x * ox + v.x * oy,
      y: direction.y * r + u.y * ox + v.y * oy,
      z: direction.z * r + u.z * ox + v.z * oy,
    });
  }

  return { positions, rings };
}
