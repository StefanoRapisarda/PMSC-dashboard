/**
 * Adjacency and the provenance closures, carried over from v3.
 *
 * "Trace this" is not a filter — it is a walk. Selecting an aliquot should light
 * its specimen, that specimen's patient, its QC, its platform and its box, even
 * when those layers are switched off. These closures are what make the graph
 * answer a provenance question instead of just colouring dots.
 */
import type { GraphEdge, GraphNode } from '$lib/types';

export interface Adjacency {
  [id: number]: { o: number; t: string; dir: 'in' | 'out' }[];
}

export function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]): Adjacency {
  const adj: Adjacency = {};
  nodes.forEach((n) => { adj[n.id] = []; });
  edges.forEach((e) => {
    adj[e.a]?.push({ o: e.b, t: e.type, dir: 'out' });
    adj[e.b]?.push({ o: e.a, t: e.type, dir: 'in' });
  });
  return adj;
}

export class GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  adj: Adjacency;
  samples: GraphNode[];
  patients: GraphNode[];
  boxes: Record<string, GraphNode> = {};

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.adj = buildAdjacency(nodes, edges);
    this.samples = nodes.filter((n) => n.type === 'sample');
    this.patients = nodes.filter((n) => n.type === 'patient');
    nodes.forEach((n) => {
      if (n.type === 'storage' && n.kind === 'box') this.boxes[n.label] = n;
    });
    this.rollUp();
  }

  /** The per-sample facts the sidebar and the use-case views ask about. */
  private rollUp() {
    for (const s of this.samples) {
      s._alis = (s._alisIdx ?? []).map((i) => this.nodes[i]).filter(Boolean);
      s._act = s._actIdx != null ? this.nodes[s._actIdx] : null;
      s._num = s.label.replace('S-', '');
      s._hasFail = s._alis.some((a) => a.qc === 'fail');
      s._hasRepeat = this.edges.some(
        (e) => e.type === 'repeat_of' && (e.a === s.id || e.b === s.id));
      s._pending = s._alis.some((a) => a.qc === 'pending');
      s._incomplete = s.stype === 'Blood';
      s._stuck = !!s.stalled;
    }
  }

  /**
   * Which outcome bucket a node belongs to.
   *
   * Outcome is a property of MATERIAL, so it is resolved from the specimen a
   * thing came from rather than invented per node type. An aliquot that failed
   * its own QC is a failure even if its specimen carried on, because that
   * fraction did not. A patient takes the worst outcome among their specimens:
   * "this patient has something stuck" is the question a cohort raises, and an
   * average would hide it.
   *
   * Platforms, boxes, operators and the board are not material and get no
   * outcome — calling them "on track" would be inventing a fact.
   */
  outcomeOf(node: GraphNode): string {
    if (node.type === 'aliquot' && node.qc === 'fail') return 'QC failure';
    if (node.type === 'patient') {
      const specimens = (this.adj[node.id] ?? [])
        .filter((x) => x.t === 'has_sample' && x.dir === 'out')
        .map((x) => this.nodes[x.o]).filter(Boolean);
      /* enrolled, nothing taken yet — that IS an outcome, and the one a cohort
         most wants counted */
      if (!specimens.length) return 'not collected';
      const RANK = ['not collected', 'stalled', 'QC failure', 'on track'];
      let worst = 'on track';
      for (const s of specimens) {
        const o = this.specimenOutcome(s);
        if (RANK.indexOf(o) < RANK.indexOf(worst)) worst = o;
      }
      return worst;
    }
    const specimen = this.specimenBehind(node);
    return specimen ? this.specimenOutcome(specimen) : 'context';
  }

  /** The specimen a node's material came from, or null if it is not material. */
  private specimenBehind(node: GraphNode): GraphNode | null {
    if (node.type === 'sample') return node;
    const out = (type: string) =>
      (this.adj[node.id] ?? []).find((x) => x.t === type && x.dir === 'out')?.o ?? null;
    const inn = (type: string) =>
      (this.adj[node.id] ?? []).find((x) => x.t === type && x.dir === 'in')?.o ?? null;
    let id: number | null = null;
    if (node.type === 'aliquot') {
      /* An aliquot can derive from another aliquot, not only from a specimen —
         SP3 digests a protein fraction into a peptide one. Stopping at the first
         hop left 87 peptide aliquots pointing at an aliquot, whose `reached` is
         undefined, so they were all filed as "not collected". */
      const from = out('derived_from');
      const fromNode = from == null ? null : this.nodes[from];
      if (fromNode && fromNode.type === 'aliquot') return this.specimenBehind(fromNode);
      id = from;
    }
    else if (node.type === 'activity') id = out('used');
    else if (node.type === 'identifier') {
      const owner = inn('identified_as');
      const ownerNode = owner == null ? null : this.nodes[owner];
      return ownerNode ? this.specimenBehind(ownerNode) : null;
    }
    return id == null ? null : this.nodes[id] ?? null;
  }

  private specimenOutcome(specimen: GraphNode): string {
    if ((specimen.reached ?? 0) < 1) return 'not collected';
    if (specimen._stuck) return 'stalled';
    if (specimen._hasFail) return 'QC failure';
    return 'on track';
  }

  aliquotClosure(id: number): Set<number> {
    const set = new Set<number>([id]);
    for (const x of this.adj[id] ?? []) {
      if (x.t === 'derived_from' && x.dir === 'out') {
        set.add(x.o);
        for (const y of this.adj[x.o] ?? []) {
          if (y.t === 'has_sample' && y.dir === 'in') set.add(y.o);
        }
      }
      if (x.t === 'has_qc') set.add(x.o);
      if (x.t === 'submitted_to') set.add(x.o);
      if (x.t === 'repeat_of') set.add(x.o);
      if (x.t === 'stored_at') {
        set.add(x.o);
        for (const z of this.adj[x.o] ?? []) {
          if (z.t === 'contains' && z.dir === 'in') set.add(z.o);
        }
      }
    }
    return set;
  }

  sampleClosure(id: number): Set<number> {
    const set = new Set<number>([id]);
    for (const x of this.adj[id] ?? []) {
      if (x.t === 'has_sample' && x.dir === 'in') set.add(x.o);
      if (x.t === 'identified_as' && x.dir === 'out') set.add(x.o);
      if (x.t === 'has_deviation' && x.dir === 'out') set.add(x.o);
      if (x.t === 'has_mtb' && x.dir === 'out') set.add(x.o);
      if (x.t === 'repeat_of') set.add(x.o);
      if (x.t === 'used' && x.dir === 'in') {
        set.add(x.o);
        for (const y of this.adj[x.o] ?? []) {
          if (y.t === 'performed' && y.dir === 'in') set.add(y.o);
        }
      }
      if (x.t === 'derived_from' && x.dir === 'in') {
        this.aliquotClosure(x.o).forEach((y) => set.add(y));
      }
    }
    return set;
  }

  boxClosure(id: number): Set<number> {
    const set = new Set<number>([id]);
    for (const x of this.adj[id] ?? []) {
      if (x.t === 'contains' && x.dir === 'in') set.add(x.o);
      if (x.t === 'stored_at' && x.dir === 'in') {
        this.aliquotClosure(x.o).forEach((y) => set.add(y));
      }
    }
    return set;
  }

  /** What a click should light up, by the type of thing clicked. */
  focusFor(node: GraphNode): Set<number> | null {
    if (node.type === 'sample') return this.sampleClosure(node.id);
    if (node.type === 'aliquot') return this.aliquotClosure(node.id);
    if (node.type === 'identifier' || node.type === 'deviation') {
      const owner = (this.adj[node.id] ?? []).find(
        (x) => (x.t === 'identified_as' || x.t === 'has_deviation') && x.dir === 'in');
      return owner ? this.sampleClosure(owner.o) : null;
    }
    if (node.type === 'qc') {
      const owner = (this.adj[node.id] ?? []).find((x) => x.t === 'has_qc' && x.dir === 'in');
      return owner ? this.aliquotClosure(owner.o) : null;
    }
    if (node.type === 'storage' && node.kind === 'box') return this.boxClosure(node.id);
    if (node.type === 'activity') {
      const used = (this.adj[node.id] ?? []).find((x) => x.t === 'used' && x.dir === 'out');
      return used ? this.sampleClosure(used.o) : null;
    }
    return null;
  }

  /**
   * The whole chain a node sits on, in the order it happened.
   *
   * Follows the spine only, both ways: everything upstream that led to this
   * node, and everything downstream that came out of it. Sideways links are
   * left out — a freezer box would otherwise drag in every unrelated aliquot
   * that happened to share it, which is not a path through time.
   *
   * Siblings are not on the path. The RNA taken from a specimen is not part of
   * the DNA's history; both are descendants of the specimen, so selecting the
   * specimen includes them and selecting one aliquot does not.
   */
  lineage(node: GraphNode, direction: 'both' | 'up' | 'down' = 'both'): Set<number> {
    const forward: Record<number, number[]> = {};
    const backward: Record<number, number[]> = {};
    for (const edge of this.edges) {
      const flip = SPINE[edge.type];
      if (flip === undefined) continue;
      const [from, to] = flip ? [edge.b, edge.a] : [edge.a, edge.b];
      (forward[from] = forward[from] ?? []).push(to);
      (backward[to] = backward[to] ?? []).push(from);
    }

    const walk = (start: number, edges: Record<number, number[]>) => {
      const seen = new Set<number>();
      const queue = [start];
      while (queue.length) {
        const current = queue.shift()!;
        for (const next of edges[current] ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      return seen;
    };

    const path = new Set<number>([node.id]);
    if (direction !== 'down') walk(node.id, backward).forEach((id) => path.add(id));
    if (direction !== 'up') walk(node.id, forward).forEach((id) => path.add(id));
    return path;
  }

  /**
   * The chain in the order it happened, for listing beside the graph.
   *
   * Sorting by date alone does not work: an aliquot and a platform carry no date
   * of their own, so they would all sort to the front. The order comes from
   * position along the chain — how many steps from the start — with dates
   * breaking ties between things at the same depth.
   */
  lineageSteps(node: GraphNode): { node: GraphNode; when: string | null }[] {
    const path = this.lineage(node);

    const forward: Record<number, number[]> = {};
    const incoming: Record<number, number> = {};
    for (const id of path) incoming[id] = 0;
    for (const edge of this.edges) {
      const flip = SPINE[edge.type];
      if (flip === undefined) continue;
      const [from, to] = flip ? [edge.b, edge.a] : [edge.a, edge.b];
      if (!path.has(from) || !path.has(to)) continue;
      (forward[from] = forward[from] ?? []).push(to);
      incoming[to] += 1;
    }

    /* longest path from a start point, so a node always sits after everything
       that had to happen before it */
    const depth: Record<number, number> = {};
    const queue: number[] = [];
    for (const id of path) if (!incoming[id]) { depth[id] = 0; queue.push(id); }
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of forward[current] ?? []) {
        depth[next] = Math.max(depth[next] ?? 0, (depth[current] ?? 0) + 1);
        if (--incoming[next] === 0) queue.push(next);
      }
    }

    const shown = ['patient', 'sample', 'activity', 'aliquot', 'platform', 'mtb'];
    return [...path]
      .map((id) => this.nodes[id])
      .filter((n) => shown.includes(n.type))
      .map((n) => ({ node: n, when: n.date ?? n.collected ?? null }))
      /* Stage first: the tumour board is the end of the story even though it
         hangs directly off the specimen, so depth alone would list it before the
         fractions. Dates order steps within a stage; depth breaks the rest. */
      .sort((a, b) => {
        const byStage = shown.indexOf(a.node.type) - shown.indexOf(b.node.type);
        if (byStage !== 0) return byStage;
        if (a.when && b.when && a.when !== b.when) return a.when.localeCompare(b.when);
        return (depth[a.node.id] ?? 0) - (depth[b.node.id] ?? 0);
      });
  }

  /** A node together with everything directly above and below it in the chain. */
  /** The names one thing is known by, and only that thing. The chain across a
      whole family is idChain; this is the single node's own row of it. */
  identifiersOf(node: GraphNode): GraphNode[] {
    return (this.adj[node.id] ?? [])
      .filter((x) => x.t === 'identified_as' && x.dir === 'out')
      .map((x) => this.nodes[x.o])
      .filter(Boolean);
  }

  neighbourhood(node: GraphNode): Set<number> {
    const set = new Set<number>([node.id]);
    for (const link of this.adj[node.id] ?? []) set.add(link.o);
    return set;
  }

  /** One hop outward through the types currently switched on. */
  expand(node: GraphNode, typeOn: Record<string, boolean>, current: Set<number> | null): Set<number> {
    const set = new Set<number>(current ?? []);
    set.add(node.id);
    for (const x of this.adj[node.id] ?? []) {
      if (typeOn[this.nodes[x.o].type]) set.add(x.o);
    }
    return set;
  }

  /**
   * Every name this material is known by, from the patient down to each fraction.
   *
   * A chain, not a list: the same physical thing is renamed at every handover,
   * and showing only the specimen's own names breaks it at both ends — which is
   * exactly the join WP2 exists to reconstruct.
   */
  idChain(sample: GraphNode): { role: string; identifier: GraphNode }[] {
    const namesOf = (id: number) => (this.adj[id] ?? [])
      .filter((x) => x.t === 'identified_as' && x.dir === 'out')
      .map((x) => this.nodes[x.o]);

    const chain: { role: string; identifier: GraphNode }[] = [];

    const patient = (this.adj[sample.id] ?? [])
      .find((x) => x.t === 'has_sample' && x.dir === 'in');
    if (patient) {
      for (const identifier of namesOf(patient.o)) chain.push({ role: 'Patient', identifier });
    }
    for (const identifier of namesOf(sample.id)) chain.push({ role: 'Sample', identifier });
    for (const aliquot of sample._alis ?? []) {
      for (const identifier of namesOf(aliquot.id)) {
        chain.push({ role: aliquot.molLabel ?? aliquot.mol ?? 'Aliquot', identifier });
      }
    }
    return chain;
  }

}

/**
 * The provenance spine, and which way each edge points along the flow.
 * `true` means the stored edge runs against the direction the pipeline moves.
 *
 * Only these edges are bridged when a level is hidden. Everything else —
 * storage, identifiers, QC results, operators — hangs off the spine rather than
 * carrying it, and joining a hidden node's neighbours across one of those would
 * invent a relationship ("these two aliquots shared a freezer box") that is not
 * provenance. It is also what causes the projection to explode: bridging every
 * pair of a hub's neighbours turns 3 platform nodes into ~14,000 edges, while
 * bridging along the spine turns them into none, because nothing flows past a
 * platform.
 */
export const SPINE: Record<string, boolean> = {
  has_sample: false, generated: false, submitted_to: false, has_mtb: false,
  used: true, derived_from: true,
};

/** An edge standing in for one or more hidden steps of the chain. */
export interface Bridge { a: number; b: number; via: string[]; }

export interface Projection {
  visible: Set<number>;
  bridges: Bridge[];
  /** specimens that survived the facet filters — the subcohort on screen */
  specimens: number;
}

export interface Facets {
  sex: Record<string, boolean>;
  /** deviation classes recorded at pathology, plus 'none' for a clean specimen */
  deviation: Record<string, boolean>;
  /** which processing steps to draw */
  activity: Record<string, boolean>;
  age: Record<string, boolean>;
  stype: Record<string, boolean>;
  mol: Record<string, boolean>;
  qc: Record<string, boolean>;
  ntype: Record<string, boolean>;
}

export function ageBucket(age: number | undefined): string {
  if (age == null) return 'unknown';
  return age < 65 ? '<65' : age < 75 ? '65-74' : '75+';
}

/**
 * Which nodes are on screen, and what has to be bridged to keep the chain intact.
 *
 * Two controls, two meanings, deliberately different:
 *   * A facet ticks a subcohort. Unticking "Female" should remove those patients
 *     AND everything hanging off them, not fade them — a half-transparent
 *     specimen is still a specimen you have to read past.
 *   * A layer toggle picks a level of detail. The objects still exist; you have
 *     chosen not to draw them, so the chain across them is bridged and marked.
 */
export function project(model: GraphModel, facets: Facets): Projection {
  const passesFacets = new Set<number>();

  /* start from specimens: they are what a facet actually selects */
  const narrowedByMolecule = Object.values(facets.mol).some((on) => !on);
  const narrowedByQc = Object.values(facets.qc).some((on) => !on);

  const keptAliquots = new Set<number>();
  const keptSpecimens: GraphNode[] = [];

  for (const specimen of model.samples) {
    if (specimen.stype && facets.stype[specimen.stype] === false) continue;
    if (specimen._psex && facets.sex[specimen._psex] === false) continue;
    if (specimen._page != null && facets.age[ageBucket(specimen._page)] === false) continue;
    if (!passesDeviation(specimen, facets)) continue;

    const aliquots = (specimen._alis ?? []).filter(
      (a) => (!a.mol || facets.mol[a.mol] !== false)
          && (!a.qc || facets.qc[a.qc] !== false));

    /* narrowing to a molecule or a QC outcome is a question about aliquots, so a
       specimen with none that match drops out of the subcohort entirely */
    if ((narrowedByMolecule || narrowedByQc) && (specimen._alis ?? []).length
        && aliquots.length === 0) continue;

    keptSpecimens.push(specimen);
    passesFacets.add(specimen.id);
    aliquots.forEach((a) => { passesFacets.add(a.id); keptAliquots.add(a.id); });
  }

  /* A patient with no specimen is not an empty row to be dropped: enrolled with
     nothing collected is exactly the state this view exists to surface. They are
     selected on their own attributes, not on their material. */
  for (const patient of model.patients) {
    if (patient.sex && facets.sex[patient.sex] === false) continue;
    if (patient.age != null && facets.age[ageBucket(patient.age)] === false) continue;
    passesFacets.add(patient.id);
  }

  /* everything attached to a surviving specimen or aliquot comes with it */
  for (const id of [...passesFacets]) {
    for (const link of model.adj[id] ?? []) {
      const other = model.nodes[link.o];
      if (other.type === 'sample' || other.type === 'aliquot') continue;
      if (other.type === 'patient') { passesFacets.add(other.id); continue; }
      /* shared hubs and side attachments ride along with whatever they serve */
      passesFacets.add(other.id);
      if (other.type === 'activity') {
        /* a step you have filtered out takes its operator with it: the person is
           only on the canvas because of the work they did */
        if (other.kind && facets.activity[other.kind] === false) {
          passesFacets.delete(other.id);
          continue;
        }
        for (const staff of model.adj[other.id] ?? []) {
          if (model.nodes[staff.o].type === 'operator') passesFacets.add(staff.o);
        }
      }
      if (other.type === 'storage') {
        for (const parent of model.adj[other.id] ?? []) {
          if (parent.t === 'contains' && parent.dir === 'in') passesFacets.add(parent.o);
        }
      }
    }
  }

  /* now apply the layer toggles on top: same subcohort, less detail */
  const visible = new Set<number>();
  for (const id of passesFacets) {
    if (facets.ntype[model.nodes[id].type]) visible.add(id);
  }

  /* Bridge BEFORE pruning. A platform reached only through a hidden aliquot
     still belongs on screen — the bridge is what connects it, so deciding it is
     orphaned before the bridges exist throws away the very thing that keeps the
     chain intact. */
  const bridges = bridgeChain(model, passesFacets, visible);

  /* now anything with nothing left to attach to is noise rather than
     information: a freezer with no aliquots in view, a deviation whose specimen
     is hidden. Things ON the spine stay, because a bridge may reach them. */
  const bridged = new Set<number>();
  bridges.forEach((b) => { bridged.add(b.a); bridged.add(b.b); });
  const attachments = ['platform', 'mtb', 'operator', 'storage', 'identifier',
                       'qc', 'deviation'];
  for (const id of [...visible]) {
    const node = model.nodes[id];
    if (!attachments.includes(node.type)) continue;
    if (bridged.has(id)) continue;
    const connected = (model.adj[id] ?? []).some((link) => visible.has(link.o));
    if (!connected) visible.delete(id);
  }

  const kept = bridges.filter((b) => visible.has(b.a) && visible.has(b.b));

  return { visible, bridges: kept, specimens: keptSpecimens.length };
}

/**
 * Reconnect what a hidden level was carrying.
 *
 * Walks forward along the spine from every visible node, through hidden ones,
 * and stops at the first visible node it reaches — so several hidden levels in a
 * row still produce one honest edge, carrying the list of what it stands for.
 */
function bridgeChain(model: GraphModel, inCohort: Set<number>,
                     visible: Set<number>): Bridge[] {
  const forward: Record<number, number[]> = {};
  for (const edge of model.edges) {
    const flip = SPINE[edge.type];
    if (flip === undefined) continue;
    const [from, to] = flip ? [edge.b, edge.a] : [edge.a, edge.b];
    if (!inCohort.has(from) || !inCohort.has(to)) continue;
    (forward[from] = forward[from] ?? []).push(to);
  }

  const bridges: Bridge[] = [];
  const seen = new Set<string>();
  for (const start of visible) {
    const queue: [number, string[]][] = [[start, []]];
    const walked = new Set<number>([start]);
    while (queue.length) {
      const [current, elided] = queue.shift()!;
      if (elided.length > 4) continue;                 // stop runaway chains
      for (const next of forward[current] ?? []) {
        if (walked.has(next)) continue;
        walked.add(next);
        if (visible.has(next)) {
          if (!elided.length) continue;                // a real edge, not a bridge
          const key = `${start}>${next}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bridges.push({ a: start, b: next, via: elided });
        } else {
          queue.push([next, [...elided, model.nodes[next].type]]);
        }
      }
    }
  }
  return bridges;
}

/** A specimen with no deviation is a state worth filtering for in its own right. */
export function passesDeviation(specimen: GraphNode, facets: Facets): boolean {
  const recorded = specimen.deviations ?? [];
  if (!recorded.length) return facets.deviation.none !== false;
  return recorded.some((kind) => facets.deviation[kind] !== false);
}

export function nodePasses(node: GraphNode, facets: Facets): boolean {
  if (!facets.ntype[node.type]) return false;
  if (node.type === 'patient') {
    if (node.sex && facets.sex[node.sex] === false) return false;
    if (facets.age[ageBucket(node.age)] === false) return false;
  }
  if (node.type === 'sample') {
    if (node.stype && facets.stype[node.stype] === false) return false;
    if (node._psex && facets.sex[node._psex] === false) return false;
    if (node._page != null && facets.age[ageBucket(node._page)] === false) return false;
  }
  if (node.type === 'aliquot') {
    if (node.qc && facets.qc[node.qc] === false) return false;
    if (node.mol && facets.mol[node.mol] === false) return false;
  }
  return true;
}
