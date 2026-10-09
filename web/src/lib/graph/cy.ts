/**
 * Cytoscape.js set up to look and behave like mockups/index-v3.html.
 *
 * Why Cytoscape rather than v3's hand-rolled canvas: the cohort is large and
 * grows, and Cytoscape brings hit-testing, styling, layouts and export with it.
 * What is carried over from v3 unchanged: the palette and node sizes, the dark
 * canvas, the red QC ring, dashed red repeat edges, the three layout modes, and
 * — the part that matters — the edge-tier spring lengths, so distance still
 * means how tightly two things belong together.
 *
 * The one thing that cannot survive the move is rotation: Cytoscape is 2-D, so
 * v3's drag-to-rotate and auto-spin have no equivalent.
 */
import cytoscape from 'cytoscape';
import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';

import type { GraphEdge, GraphNode } from '$lib/types';
import type { GraphModel } from './model';
import { COLORS, RADIUS, TYPE_LABEL, hexA, type NodeType } from './v3';

export type Layout = 'force' | 'shell' | 'clustered' | 'grouped';

/**
 * The four outcome buckets the clustered view sorts material into.
 *
 * Ordered worst to best so the eye reads the clusters left to right as "what
 * needs attention" through to "fine". Nodes that are not material — labs, systems,
 * boxes, operators, the board — have no outcome and are not pretended into one;
 * they get their own cluster and are named as context.
 */
export const OUTCOMES = ['not collected', 'stalled', 'QC failure', 'on track', 'context'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_COLOR: Record<Outcome, string> = {
  'not collected': '#8ea0ba', stalled: '#e76f51', 'QC failure': '#c0432a',
  'on track': '#2a9d8f', context: '#6b7a90',
};

/** Past this many visible nodes the force layout is slow enough to be worth a
    warning. */
export const FORCE_WARN = 2200;

/** One relation as the inspector reads it. `via` is set only on a bridge, and
    lists the hidden steps it stands in for. */
export interface EdgePick {
  id: string;
  type: string;
  a: number;
  b: number;
  via?: string;
}

export interface Handlers {
  onSelect?: (node: GraphNode | null) => void;
  onSelectEdge?: (edge: EdgePick) => void;
  onHighlight?: (node: GraphNode) => void;
  /** node is null when the right-click landed on bare canvas */
  onMenu?: (node: GraphNode | null, at: { x: number; y: number }) => void;
  onExpand?: (node: GraphNode) => void;
  onHover?: (node: GraphNode | null, position: { x: number; y: number }) => void;
  onLayoutState?: (state: { running: boolean; visible: number }) => void;
}

export function style(): cytoscape.StylesheetStyle[] {
  const byType = (Object.keys(COLORS) as NodeType[]).flatMap((type) => ([
    {
      selector: `node[type="${type}"]`,
      style: {
        'background-color': COLORS[type],
        width: RADIUS[type] * 2,
        height: RADIUS[type] * 2,
        /* No resting glow. v3 drew a coloured halo around every node and this
           reproduced it with an underlay — but a translucent ring the same
           colour as the dot, padded to nearly half its radius, has no edge. At
           cohort scale several hundred of them read as the whole picture being
           out of focus. A glow now means something happened: hover, selection,
           a hand-picked node. */
      },
    },
  ]));

  return [
    {
      selector: 'node',
      style: {
        label: '', shape: 'ellipse', 'border-width': 0,
        'transition-property': 'opacity', 'transition-duration': 160,
      },
    },
    ...byType,
    /* Sized by connections, when that is switched on. The page writes the
       diameter onto each node as data, so the rule stays declarative and
       overrides the per-type sizes above only while the class is set. */
    { selector: 'node.bydegree', style: { width: 'data(size)', height: 'data(size)' } },
    /* labs and systems are the only nodes labelled at rest, as in v3, because
       they are the few named hubs the rest of the graph hangs from */
    {
      selector: 'node[type="lab"], node[type="system"]',
      style: {
        label: 'data(label)', color: '#c3d0e2', 'font-size': 11,
        'text-valign': 'top', 'text-margin-y': -4, 'text-outline-width': 2,
        'text-outline-color': '#0c1320',
      },
    },
    { selector: 'node.labelled', style: {
        label: 'data(label)', color: '#ffffff', 'font-size': 11,
        'text-valign': 'top', 'text-margin-y': -4, 'text-outline-width': 2,
        'text-outline-color': '#0c1320', 'z-index': 30 } },
    /* QC failure: a red ring. Kept from v3 — it survives greyscale. */
    { selector: 'node[qc="fail"]', style: {
        'border-width': 2, 'border-color': '#e76f51', 'border-opacity': 1 } },
    /* depth cue from the 3-D projection: far things recede, near things come
       forward. Written by the rotator as node data so the style stays declarative. */
    { selector: 'node[fog]', style: { opacity: 'data(fog)' } },
    /* a crisp ring, not a halo — it has to read as a decision, not a smudge */
    { selector: 'node.hovered', style: {
        'border-width': 2, 'border-color': '#ffffff', 'border-opacity': 1 } },
    { selector: 'node.selected', style: {
        'border-width': 3, 'border-color': '#2a9d8f', 'border-opacity': 1,
        'z-index': 40 } },

    { selector: 'edge', style: {
        width: 1, 'line-color': 'rgba(150,175,210,0.28)',
        'curve-style': 'straight', 'target-arrow-shape': 'none',
        'transition-property': 'opacity', 'transition-duration': 160 } },
    { selector: 'edge[type="repeat_of"]', style: {
        width: 1.6, 'line-color': 'rgba(231,111,81,0.75)', 'line-style': 'dashed' } },

    /* A bridge stands in for one or more hidden steps of the derivation chain.
       It is drawn differently from a real edge on purpose: a provenance tool
       that shows an elision as a direct relationship is lying, and one that
       drops the connection entirely is lying the other way. */
    { selector: 'edge.bridge', style: {
        'line-style': 'dashed', 'line-color': '#8fa0b4', width: 1.4,
        'line-dash-pattern': [4, 3], opacity: 0.85 } },
    { selector: 'edge.bridge.labelled', style: {
        label: (ele: EdgeSingular) => `via ${ele.data('via')}`,
        color: '#c3d0e2', 'font-size': 9, 'text-outline-width': 2,
        'text-outline-color': '#0c1320', 'z-index': 30 } },

    /* dimming is now only for tracing: a filter removes, a trace shows the path */
    { selector: '.dim', style: { opacity: 0.08 } },
    /* A highlight pushes everything else right back. A picked node's glow has to
       go with it: an underlay is drawn wider than the node, so it would stay
       visible as a smudge after the dot itself had gone. */
    { selector: '.faded', style: { opacity: 0.02 } },
    { selector: 'node.faded', style: {
        'underlay-opacity': 0, 'border-width': 0, 'text-opacity': 0 } },
    /* Picking by hand fades the rest far less, because the nodes still to be
       picked have to stay visible enough to click. Labels stay off. */
    { selector: 'node.receded', style: { opacity: 0.3 } },
    /* faded out by a path, a family or a lit type: not there to be clicked */
    { selector: '.inert', style: { events: 'no' } },
    /* and what IS highlighted comes fully forward: the depth shading otherwise
       holds it at whatever the 3-D projection decided, which eats the contrast
       the highlight exists to create */
    { selector: '.bright', style: { opacity: 1 } },
    /* The one place a glow survives: a node you picked out by hand has to be
       findable in a crowd, and a ring alone is lost among a few hundred dots.
       underlay-shape must be set explicitly — it defaults to a round rectangle,
       which puts a square halo on a circular node. */
    { selector: 'node.marked', style: {
        'border-width': 3, 'border-color': '#e9c46a', 'border-opacity': 1,
        'underlay-color': '#e9c46a', 'underlay-opacity': 0.55,
        'underlay-padding': 7, 'underlay-shape': 'ellipse', 'z-index': 50 } },
    /* A line has to say it can be clicked before it is, and say which one you
       picked afterwards. Teal is the colour a selected node's ring already uses.
       These come after the dimming rules so that a picked line stays readable
       inside a trace or a highlight. */
    { selector: 'edge.hovered', style: {
        width: 2.5, 'line-color': '#ffffff', opacity: 1, 'z-index': 30 } },
    { selector: 'edge.selected', style: {
        width: 3, 'line-color': '#2a9d8f', 'line-style': 'solid', opacity: 1,
        'z-index': 40 } },
    { selector: 'node.edge-end', style: {
        'border-width': 2, 'border-color': '#2a9d8f', 'border-opacity': 1,
        'z-index': 40 } },
    { selector: '.hidden', style: { display: 'none' } },
  ] as unknown as cytoscape.StylesheetStyle[];
}

/**
 * Cytoscape requires element ids to be strings, so the copy it holds has a
 * string where GraphNode declares a number. Everything read back out goes
 * through here, or a set of picked ids ends up holding "42" and being compared
 * against 42 — which matches nothing, silently.
 */
export function nodeData(element: NodeSingular): GraphNode {
  return { ...(element.data() as GraphNode), id: Number(element.id()) };
}

export function toElements(nodes: GraphNode[], edges: GraphEdge[],
                           model?: GraphModel | null): cytoscape.ElementDefinition[] {
  return [
    ...nodes.map((n) => ({
      group: 'nodes' as const,
      /* the outcome is baked in here rather than looked up per frame: the
         clustered layout reads it for every node on every relayout */
      data: { ...n, id: String(n.id), outcome: model?.outcomeOf(n) ?? 'context' },
    })),
    ...edges.map((e, i) => ({
      group: 'edges' as const,
      data: { id: `e${i}`, source: String(e.a), target: String(e.b), type: e.type },
    })),
  ];
}

/**
 * Who owns positions and the viewport.
 *
 * In every view the rotator owns both: a drag rotates the projection, so
 * Cytoscape's own panning must be off or one gesture drives two things at once
 * and the frame slides out from under the graph. Node dragging is off for the
 * same reason — the next frame would overwrite whatever you moved.
 */
export function setInteraction(cy: Core): void {
  /* Every view is placed in three dimensions and owned by the rotator. */
  cy.userPanningEnabled(false);
  cy.boxSelectionEnabled(false);
  cy.autoungrabify(true);
}

export function mount(container: HTMLElement, elements: cytoscape.ElementDefinition[],
                      handlers: Handlers = {}): Core {
  const cy = cytoscape({
    container, elements, style: style(),
    wheelSensitivity: 0.22, minZoom: 0.05, maxZoom: 4,
    layout: { name: 'preset' },
    textureOnViewport: true,   // keeps panning smooth at cohort scale
    /* Render at the display's real pixel density, capped at 2.
       pixelRatio:1 was set to halve the fill cost, but on any Retina screen it
       draws the whole canvas at half resolution and scales it up: every dot gets
       a soft edge, which reads as the picture being out of focus rather than as
       a performance setting. The spin is already throttled to 20 fps and nothing
       redraws while the graph is still, so the headroom is there to spend. */
    pixelRatio: Math.min(2, window.devicePixelRatio || 1),
  });

  cy.on('mouseover', 'node', (event) => {
    const node = event.target as NodeSingular;
    node.addClass('hovered labelled');
    const rendered = node.renderedPosition();
    handlers.onHover?.(nodeData(node), { x: rendered.x, y: rendered.y });
  });
  /* a bridge says what it stands for when you point at it */
  cy.on('mouseover', 'edge.bridge', (event) => event.target.addClass('labelled'));
  cy.on('mouseout', 'edge.bridge', (event) => event.target.removeClass('labelled'));
  cy.on('mouseover', 'edge', (event) => event.target.addClass('hovered'));
  cy.on('mouseout', 'edge', (event) => event.target.removeClass('hovered'));

  cy.on('mouseout', 'node', (event) => {
    (event.target as NodeSingular).removeClass('hovered labelled');
    handlers.onHover?.(null, { x: 0, y: 0 });
  });

  /* single click selects and traces; double click expands one hop. The click is
     deferred so the double click can cancel it — same interaction as v3. */
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  cy.on('tap', 'node', (event) => {
    const node = event.target as NodeSingular;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    /* shift-click picks a node out by hand rather than tracing from it — no
       delay, because there is no double-click meaning to wait for */
    const original = event.originalEvent as MouseEvent | undefined;
    /* Ctrl/Cmd is the modifier every graph tool uses to add to a selection —
       Bloom, Linkurious and the rest. Shift is kept working because it was here
       first and costs nothing. */
    if (original?.ctrlKey || original?.metaKey || original?.shiftKey) {
      handlers.onHighlight?.(nodeData(node));
      return;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      handlers.onSelect?.(nodeData(node));
    }, 220);
  });
  cy.on('dbltap', 'node', (event) => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    handlers.onExpand?.(nodeData(event.target as NodeSingular));
  });
  /* A click on a line selects the relation. There is no double-click meaning
     for a line, so nothing waits. Cytoscape tests nodes before edges, so a click
     on a dot that a line runs into still lands on the dot. */
  cy.on('tap', 'edge', (event) => {
    const edge = event.target as EdgeSingular;
    handlers.onSelectEdge?.({
      id: edge.id(), type: edge.data('type'),
      a: Number(edge.data('source')), b: Number(edge.data('target')),
      via: edge.data('via'),
    });
  });
  cy.on('tap', (event) => {
    if (event.target === cy) handlers.onSelect?.(null);
  });

  /* Right-click is the conventional home for the commands that are too big, or
     too many, to hang off a gesture. The page decides what a right-click means
     while a highlight is up — see onMenu's caller. */
  cy.on('cxttap', 'node', (event) => {
    const original = event.originalEvent as MouseEvent | undefined;
    original?.preventDefault();
    const rendered = (event.target as NodeSingular).renderedPosition();
    handlers.onMenu?.(nodeData(event.target as NodeSingular),
                      { x: rendered.x, y: rendered.y });
  });
  container.addEventListener('contextmenu', (event) => event.preventDefault());

  return cy;
}

/** Translucent labelled hull behind each cluster — by type in the grouped view,
    by outcome in the clustered one. */
export function drawHulls(cy: Core, canvas: HTMLCanvasElement, by: 'type' | 'outcome' = 'type'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const groups: Record<string, { x: number; y: number }[]> = {};
  /* groups holding nodes whose names are printed at rest: labs and systems */
  const named = new Set<string>();
  cy.nodes().not('.hidden').forEach((node) => {
    const key = (node.data(by) as string) ?? 'context';
    const p = node.renderedPosition();
    (groups[key] = groups[key] || []).push(p);
    if (node.data('type') === 'lab' || node.data('type') === 'system') named.add(key);
  });

  for (const key in groups) {
    const points = groups[key];
    let mx = 0, my = 0;
    points.forEach((p) => { mx += p.x; my += p.y; });
    mx /= points.length; my /= points.length;
    let r = 0;
    points.forEach((p) => { r = Math.max(r, Math.hypot(p.x - mx, p.y - my)); });
    /* A name sits above its node, so a circle drawn round the nodes alone cuts
       through the top name, and the header written above the circle lands on
       it. Where names are printed, the circle also takes in the top one: half
       the node, the margin and a line of text, all of which scale with zoom. */
    r += named.has(key) ? Math.max(22, 44 * cy.zoom()) : 22;
    const colour = by === 'outcome'
      ? OUTCOME_COLOR[key as Outcome] ?? '#888'
      : COLORS[key as NodeType] ?? '#888';
    ctx.fillStyle = hexA(colour, 0.1);
    ctx.strokeStyle = hexA(colour, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = colour;
    ctx.font = '600 12px system-ui';
    ctx.textAlign = 'center';
    /* the count is what turns a labelled blob into a reading — and the name is
       the display label, not the raw node type */
    const name = by === 'type' ? TYPE_LABEL[key as NodeType] ?? key : key;
    ctx.fillText(`${name.toUpperCase()} · ${points.length}`, mx, my - r - 6);
  }
}
