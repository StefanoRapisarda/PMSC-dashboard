<script lang="ts">
  /* Knowledge graph — v3's three-column view: facets, canvas, inspector.
     Rendered by Cytoscape rather than v3's own canvas, because the cohort is
     large and grows. Everything else is kept: the palette, the dark canvas, the
     red QC ring, click-to-trace, double-click-to-expand, and the edge-tier
     spring lengths that make distance mean tightness of relationship. */
  import { page } from '$app/state';
  import type { Core } from 'cytoscape';
  import type cytoscape from 'cytoscape';

  import { api } from '$lib/api';
  import Inspector from '$lib/components/Inspector.svelte';
  import PathWindow from '$lib/components/PathWindow.svelte';
  import {
    drawHulls, mount, runLayout, setInteraction, toElements, type Layout,
  } from '$lib/graph/cy';
  import { Rotator, type RotatorState } from '$lib/graph/rotator';
  import { clusterPlacement } from '$lib/graph/clusters';
  import { shellPlacement, type Ring } from '$lib/graph/shell';
  import { currentView, detailedView, savePdf, savePng, stamp,
           type Caption } from '$lib/graph/export';
  import { GraphModel, project, type Facets, type Projection } from '$lib/graph/model';
  import {
    ACTIVITY_LABEL, ACTIVITY_ORDER, COLORS, DESCRIPTION, ONTOLOGY, TYPE_LABEL, TYPE_ORDER,
  } from '$lib/graph/v3';
  import type { GraphNode, GraphPayload } from '$lib/types';

  let container = $state<HTMLDivElement | null>(null);
  let hullCanvas = $state<HTMLCanvasElement | null>(null);
  let cy: Core | null = null;
  let model = $state<GraphModel | null>(null);
  let payload = $state<GraphPayload | null>(null);
  let error = $state<string | null>(null);

  let layout = $state<Layout>('force');
  let laying = $state(false);
  let rotator: Rotator | null = null;
  /* The gesture list is reference material: useful once, in the way afterwards.
     It lives behind a button so the canvas stays the thing you are looking at. */
  let helpOpen = $state(false);
  /* the shell's stage guides, sized from what is currently on screen */
  let rings = $state<Ring[]>([]);
  /* Whose whole path is open as a straight line. Following a chain by eye
     through a rotating cloud is not reading a workflow, so tracing opens the
     same steps laid out end to end. */
  let pathWindow = $state<GraphNode | null>(null);
  let exportOpen = $state(false);
  /* while a picture is being taken — the detailed one moves the viewport, so it
     is worth saying that something is happening rather than looking frozen */
  let exporting = $state<string | null>(null);
  /* Whose family a double click put up. Only a double click sets this: a single
     click describes one node and nothing else, which is the whole point of the
     panel being readable. */
  let familyOf = $state<GraphNode | null>(null);
  let rotation = $state<RotatorState>({ settling: true, first: true, progress: 0,
                                        spinning: true, nodes: 0 });
  let selected = $state<GraphNode | null>(null);
  let hovered = $state<{ node: GraphNode; x: number; y: number } | null>(null);
  let focus = $state<Set<number> | null>(null);
  let expanded = $state<Set<number> | null>(null);
  /* nodes the user has picked out by hand; everything else recedes */
  let highlighted = $state<Set<number>>(new Set());
  /* whole node types lit up by their sun; the union with `highlighted` is what
     stays bright */
  let lit = $state<Set<string>>(new Set());

  /* v3's defaults: the four spine types plus platform, MTB and deviations on;
     the detail layers off until asked for. Keeping the visible set small is what
     makes the distance rule legible. */
  let facets = $state<Facets>({
    sex: { F: true, M: true },
    age: { '<65': true, '65-74': true, '75+': true },
    stype: {},
    mol: { DNA: true, RNA: true, Protein: true, Peptide: true },
    qc: { pass: true, fail: true, pending: true },
    deviation: { timing: true, temperature: true, handling: true,
                 labelling: true, none: true },
    activity: Object.fromEntries(ACTIVITY_ORDER.map((k) => [k, true])),
    ntype: {
      patient: true, sample: true, aliquot: true, platform: true, mtb: true,
      identifier: false, storage: false, activity: false, operator: false,
    },
  });

  const DEVIATION_LABEL: Record<string, string> = {
    timing: 'Timing', temperature: 'Temperature', handling: 'Handling',
    labelling: 'Labelling', none: 'No deviation recorded',
  };

  const typeCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    payload?.nodes.forEach((n) => { counts[n.type] = (counts[n.type] ?? 0) + 1; });
    return counts;
  });

  $effect(() => {
    api.graph()
      .then((data) => {
        payload = data;
        facets.stype = Object.fromEntries(data.sample_types.map((t) => [t, true]));
        model = new GraphModel(data.nodes, data.edges);
      })
      .catch((e) => (error = String(e)));
  });

  /* build the cytoscape instance once the payload and the container are both up */
  $effect(() => {
    if (!container || !payload || cy) return;
    cy = mount(container, toElements(payload.nodes, payload.edges, model), {
      onSelect: (node) => selectNode(node),
      onHighlight: (node) => toggleHighlight(node),
      onMenu: (node, at) => openMenu(node, at),
      onExpand: (node) => highlightNeighbourhood(node),
      onHover: (node, position) =>
        (hovered = node ? { node, x: position.x, y: position.y } : null),
    });
    cy.on('render', () => paintOverlay());
    /* handles for the browser tests. __cy gives the PROJECTED positions, which
       is all a flat view has; __rotator reaches the 3-D coordinates behind them.
       The projection flattens one axis, so a stage holding four nodes can look
       nearer the centre than the stage outside it purely by where its spokes
       happen to point — measuring the shell's claim needs the real radius. */
    (window as unknown as { __cy?: Core }).__cy = cy;
    applyVisibility();
    rotator = new Rotator(cy, (state) => (rotation = state));
    (window as unknown as { __rotator?: Rotator }).__rotator = rotator;
    relayout('force');

    /* deep link from the dashboard's attention list */
    const wanted = page.url.searchParams.get('specimen');
    if (wanted && model) {
      const node = model.samples.find((s) => String(s.specimen_id) === wanted);
      if (node) selectNode(node);
    }
  });

  $effect(() => () => { rotator?.stop(); rotator = null; cy?.destroy(); cy = null; });

  /* A selected node is a node you are reading — the panel beside it, its
     neighbours, its ring. Turning the picture while you do that moves the one
     thing you are looking at, so the spin waits. Clearing the selection lets it
     go again, unless the Rotation button says otherwise. */
  $effect(() => {
    /* Read `selected` FIRST. `rotator?.hold(…, selected !== null)` short-circuits
       while the rotator is still null on the first run, so the argument is never
       evaluated, `selected` never registers as a dependency, and the effect never
       runs again. */
    const holding = selected !== null;
    rotator?.hold('selection', holding);
    /* only the hold is set here. The rotator publishes the new spin state on its
       next frame — writing `rotation` from an effect that also reads it would
       make the effect its own dependency, and it would never stop re-running. */
  });

  $effect(() => {
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement)?.closest?.('.ctx')) menu = null;
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') menu = null; };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
    };
  });

  /**
   * Switch layout.
   *
   * `frame` is false when the caller is a layer toggle rather than a button: the
   * world barely changes, and re-fitting then makes the picture lurch just as
   * you are trying to read what the toggle did.
   */
  function relayout(next: Layout, frame = true) {
    if (!cy) return;
    layout = next;
    laying = true;
    /* hand position and viewport control to whichever thing owns them here */
    setInteraction(cy, next);

    /* both 3-D views run over the switched-on types only, which is what makes
       the picture legible — and keeps the force settle affordable */
    const visible = cy.nodes().not('.hidden');
    const ids = visible.map((n) => Number(n.id()));

    if (next === 'shell' && model) {
      /* nothing to settle: the coordinates come from the data */
      const placement = shellPlacement(ids, model);
      rings = placement.rings;
      if (frame) rotator?.tilt(-0.25);
      rotator?.startFixed(ids, placement.positions, 0.62, frame);
      laying = false;
      return;
    }

    /* the two clustered views are balls in three dimensions, not flat discs, so
       they go through the rotator too — that is what lets them be turned */
    if ((next === 'clustered' || next === 'grouped') && model) {
      rings = [];
      const by = next === 'clustered' ? 'outcome' : 'type';
      /* look further down on these: the balls sit on a horizontal ring, and at
         the near-level default the far ones hide behind the near ones */
      if (frame) rotator?.tilt(-0.62);
      rotator?.startFixed(ids, clusterPlacement(ids, model, by).positions, 1, frame);
      laying = false;
      return;
    }

    if (next === 'force') {
      const idSet = new Set(ids);
      const edges = [
        ...(payload?.edges ?? []).filter((e) => idSet.has(e.a) && idSet.has(e.b)),
        ...(projection?.bridges ?? [])
          .filter((b) => idSet.has(b.a) && idSet.has(b.b))
          .map((b) => ({ a: b.a, b: b.b, type: 'bridge' })),
      ];
      if (frame) rotator?.tilt(-0.25);
      rotator?.start(ids, edges, frame);
      /* the rotator frames the view itself once the layout lands — fitting on a
         timer used to catch it mid-settle, which is what made the zoom lurch */
      laying = false;
      clearOverlay();
      return;
    }

    rotator?.stop();
    runLayout(cy, next, () => {
      laying = false;
      paintOverlay();
    });
  }

  function clearOverlay() {
    if (!hullCanvas) return;
    hullCanvas.getContext('2d')?.clearRect(0, 0, hullCanvas.width, hullCanvas.height);
  }

  /**
   * What gets painted behind the nodes, per layout.
   *
   * The shell view needs its radius labelled or "near the middle" is only a
   * feeling. A sphere of radius r projects to a circle of radius r under ANY
   * rotation, so the stage rings are plain concentric circles and stay correct
   * as the globe turns — no per-frame geometry, just the viewport transform.
   */
  function paintOverlay() {
    if (!cy || !hullCanvas) return;
    if (layout === 'grouped') { drawHulls(cy, hullCanvas, 'type'); return; }
    if (layout === 'clustered') { drawHulls(cy, hullCanvas, 'outcome'); return; }
    if (layout !== 'shell') { clearOverlay(); return; }

    const ctx = hullCanvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = hullCanvas.clientWidth, height = hullCanvas.clientHeight;
    hullCanvas.width = width * dpr; hullCanvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    /* world → model → rendered. The globe is centred on the world origin, which
       is model (0, 0), which renders at the pan offset. */
    const zoom = cy.zoom(), pan = cy.pan();
    const unit = (rotator?.worldScale ?? 1) * zoom;
    ctx.textAlign = 'center';
    for (const ring of rings) {
      const r = ring.r * unit;
      if (r < 8 || r > Math.hypot(width, height)) continue;
      /* An empty ring still gets drawn, faintly: "nothing is sitting at
         pathology" is a reading, and a missing ring would just look like a
         stage that does not exist. A ring holding something is drawn to be
         read. */
      ctx.strokeStyle = ring.count ? 'rgba(158, 178, 208, .55)' : 'rgba(142, 160, 186, .14)';
      ctx.lineWidth = 1;
      ctx.setLineDash(ring.count ? [4, 4] : [2, 7]);
      ctx.beginPath(); ctx.arc(pan.x, pan.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      if (!ring.count) continue;
      /* label at the top of the ring, with what it holds — the ring spacing is
         ordinal, so the count is what makes it a reading rather than a guess.
         A dark plate behind it keeps it legible over the nodes. */
      const text = `${ring.label} · ${ring.count}`;
      ctx.font = '700 11px system-ui';
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(9, 15, 26, .82)';
      ctx.fillRect(pan.x - w / 2 - 5, pan.y - r - 15, w + 10, 15);
      ctx.fillStyle = 'rgba(214, 226, 242, .95)';
      ctx.fillText(text, pan.x, pan.y - r - 4);
    }
  }

  /* Rotation is only meaningful in the two 3-D views. Layered, Grouped and
     Clustered are flat: turning a flat picture cannot reveal depth there is none
     of, and in Layered it destroys the left-to-right pipeline axis, which is the
     one thing that view is for. So the control is disabled there rather than
     advertising something it does not do. */
  /* Layered is the one flat view: its left-to-right axis IS the point, and
     turning it destroys the only thing it says. Everything else lives in three
     dimensions and can be turned. */
  const spatial = $derived(layout !== 'layered');
  /* What position means, per layout. Stating it is not decoration: a picture
     where position means something and does not say what invites the reader to
     invent a meaning, and they will pick the wrong one. */
  const LAYOUT_NAME: Record<Layout, string> = {
    force: 'force layout', shell: 'shell by progress', clustered: 'clustered by outcome',
    grouped: 'grouped by type', layered: 'layered by pipeline',
  };
  const RULE: Record<Layout, string> = {
    shell: 'further in = further along the pipeline · rings are labelled',
    force: 'distance = how tightly two things belong together',
    clustered: 'one ball per outcome — where the material stopped · turn it to see inside',
    layered: 'left to right = the pipeline, one column per kind of thing',
    grouped: 'one ball per kind of thing · turn it to see inside',
  };
  const flat = $derived(!spatial);
  /* Covered only while the FIRST layout is being worked out. A re-settle after
     a toggle stays in view — hiding it would hide the very change you asked to
     see. */
  const busy = $derived(!payload || (layout === 'force' && rotation.settling
                                     && rotation.first) || laying);
  const resettling = $derived(rotation.settling && !rotation.first && !busy);

  function toggleSpin() {
    rotator?.toggleSpin();
    rotation = { ...rotation, spinning: rotator?.spinning ?? false };
  }

  /**
   * What is on screen.
   *
   * Facets and layer toggles now REMOVE rather than dim: a half-transparent
   * specimen is still a specimen you have to read past, and the question a facet
   * asks — "show me this subcohort" — is answered by taking the rest away.
   *
   * Selecting a node is the exception and stays as a trace: clicking a specimen
   * dims everything its provenance does not touch rather than deleting it,
   * because "how did this get here" has to show the path.
   */
  let projection = $state<Projection | null>(null);

  function applyVisibility() {
    if (!cy || !model) return;
    const p = project(model, facets);
    projection = p;

    cy.batch(() => {
      cy!.nodes().forEach((element) => {
        const id = Number(element.id());
        const inView = p.visible.has(id);
        element.toggleClass('hidden', !inView);
        /* a trace dims what it is not about; a filter has already removed it */
        const focused = !focus || focus.has(id);
        const expandedIn = !expanded || expanded.has(id);
        /* a highlight overrides the trace: it is the more specific thing to
           have asked for. A lit type keeps its nodes bright; only a node you
           picked by hand also gets a ring, or lighting a type of 419 aliquots
           would cover the canvas in rings. */
        const bright = isBrightNode(id, element.data('type'));
        element.toggleClass('marked', highlighted.has(id));
        element.toggleClass('dim', inView && !(bright && focused && expandedIn));
        element.toggleClass('faded', inView && anyHighlight && !bright);
        element.toggleClass('bright', inView && anyHighlight && bright);
      });
      cy!.edges().forEach((edge) => {
        const a = Number(edge.data('source')), b = Number(edge.data('target'));
        const shown = p.visible.has(a) && p.visible.has(b);
        edge.toggleClass('hidden', !shown);
        const bothPicked = isBrightNode(a, cy!.getElementById(String(a)).data('type'))
          && isBrightNode(b, cy!.getElementById(String(b)).data('type'));
        edge.toggleClass('dim', shown && (
          !bothPicked
          || (!!focus && !(focus.has(a) && focus.has(b)))
          || (!!expanded && !(expanded.has(a) && expanded.has(b)))));
        edge.toggleClass('faded', shown && anyHighlight && !bothPicked);
        edge.toggleClass('bright', shown && anyHighlight && bothPicked);
      });
    });

    syncBridges(p);
  }

  /**
   * Draw the chain across whatever is hidden.
   *
   * Bridges run along the derivation spine only. Joining a hidden node's
   * neighbours in general would invent relationships that are not provenance —
   * and would turn three platform nodes into fourteen thousand edges.
   */
  function syncBridges(p: Projection) {
    if (!cy) return;
    const wanted = new Map(p.bridges.map((b) => [`br_${b.a}_${b.b}`, b]));
    cy.batch(() => {
      cy!.edges('.bridge').forEach((edge) => {
        if (!wanted.has(edge.id())) edge.remove();
      });
      const additions: cytoscape.ElementDefinition[] = [];
      for (const [id, bridge] of wanted) {
        if (cy!.getElementById(id).nonempty()) continue;
        additions.push({ group: 'edges', data: {
          id, source: String(bridge.a), target: String(bridge.b),
          type: 'BRIDGE', via: bridge.via.join(' → '),
          hops: bridge.via.length,
        }, classes: 'bridge' });
      }
      if (additions.length) cy!.add(additions);
    });
  }

  /* any change to what is on screen re-applies visibility */
  $effect(() => {
    void facets.ntype; void facets.sex; void facets.age;
    void facets.stype; void facets.mol; void facets.qc; void facets.deviation;
    void facets.activity;
    void focus; void expanded; void highlighted; void lit;
    applyVisibility();
  });

  /* switching a node type on or off changes the placed set, so the 3-D views are
     rebuilt — this is what makes "toggle Identifier on and watch the ID chain
     glue itself to each specimen" work in the force view, and what keeps the
     shell's rings holding only what is switched on */
  let lastVisibleSignature = '';
  $effect(() => {
    const signature = Object.entries(facets.ntype)
      .filter(([, on]) => on).map(([type]) => type).sort().join(',');
    const owned = layout !== 'layered';
    if (!cy || !rotator || !owned) { lastVisibleSignature = signature; return; }
    if (signature === lastVisibleSignature) return;
    lastVisibleSignature = signature;
    relayout(layout, false);
  });

  function selectNode(node: GraphNode | null) {
    /* one click, one node — the family view belongs to the double click */
    familyOf = null;
    /* a click on empty canvas is how you get back to the whole picture */
    if (!node) { clearHighlight(); }
    selected = node;
    /* A click selects and shows the panel — nothing more. Dimming the whole
       canvas is a bigger act than a single click should carry, so tracing moved
       to the right-click menu where it can be named. */
    cy?.nodes().removeClass('selected');
    if (node) cy?.getElementById(String(node.id)).addClass('selected');
  }

  /**
   * Double-click highlights a node with its parents and children.
   *
   * Doing it again while something is already highlighted narrows to what the
   * two have in common — an AND, not an OR. That is what makes it a question:
   * "of these, which also belong to that". An OR would only ever grow the set,
   * which the sun beside a type already does.
   */
  function highlightNeighbourhood(node: GraphNode) {
    if (!model) return;
    const around = model.neighbourhood(node);
    if (highlighted.size === 0) {
      highlighted = around;
    } else {
      highlighted = new Set([...highlighted].filter((id) => around.has(id)));
    }
    selected = node;
    familyOf = node;
    focus = null;
    expanded = null;
  }

  /** Shift-click adds or removes a node from the highlight. */
  function toggleHighlight(node: GraphNode) {
    const next = new Set(highlighted);
    if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
    highlighted = next;
    selected = node;
  }

  function toggleLit(type: string) {
    const next = new Set(lit);
    if (next.has(type)) next.delete(type); else next.add(type);
    lit = next;
  }

  /* Turning off the last sun ends the highlight on its own, so Reset is a
     shortcut rather than the only way out. It clears both kinds at once. */
  function clearHighlight() {
    highlighted = new Set();
    lit = new Set();
    pathOf = null;
    familyOf = null;
  }

  type MenuState = { node: GraphNode; x: number; y: number } | null;
  let menu = $state<MenuState>(null);
  let pathOf = $state<GraphNode | null>(null);

  /**
   * Right-click on a node opens the commands that are too many to hang off a
   * gesture. It does that whatever is lit up: making it clear the highlight
   * instead meant the menu took two right-clicks to reach, once to clear and
   * once to open. Getting back to the whole picture has a button of its own,
   * which appears only while there is something to clear.
   */
  function openMenu(node: GraphNode | null, at: { x: number; y: number }) {
    if (!node) return;
    selected = node;
    menu = { node, x: at.x, y: at.y };
  }

  /** Put everything back: no highlight, no selection, no path. */
  function clearSelection() {
    clearHighlight();
    selectNode(null);
    menu = null;
  }

  /**
   * Light the whole chain a node sits on, in the order it happened.
   *
   * Three directions because they are three different questions: the whole
   * path, "where did this come from", and "what became of it". None of them
   * fits on a gesture, which is why they live on a menu that can name them.
   */
  function tracePath(node: GraphNode, direction: 'both' | 'up' | 'down') {
    if (!model) return;
    highlighted = model.lineage(node, direction);
    pathOf = node;
    selected = node;
    menu = null;
    /* a path that ran through a switched-off layer would show gaps, so the
       layers it needs come on with it */
    facets.ntype.activity = true;
    /* a trace is a chain, not a family — the panel lists it as a path instead */
    familyOf = null;
    /* The whole path is a workflow, so it opens as one. Up and down are partial
       questions — "where did this come from" — and answering those with a window
       titled "the whole path" would be a lie; they light the chain in place. */
    if (direction === 'both') pathWindow = node;
  }

  /**
   * What the picture is of, written onto the detailed export.
   *
   * A graph without this is a cloud of dots that nobody can place three weeks
   * later. The layout is what position means, the counts say how much of the
   * cohort is in view, and the filters say what was left out — which is the fact
   * most likely to be forgotten and most likely to mislead.
   */
  function caption(): Caption {
    const offTypes = TYPE_ORDER.filter((t) => !facets.ntype[t]).map((t) => TYPE_LABEL[t]);
    const offTypeLine = offTypes.length
      ? `Layers switched off: ${offTypes.join(', ')}`
      : 'All layers switched on';
    const stypes = Object.entries(facets.stype).filter(([, on]) => !on).map(([t]) => t);
    const molecules = Object.entries(facets.mol).filter(([, on]) => !on).map(([m]) => m);
    const qc = Object.entries(facets.qc).filter(([, on]) => !on).map(([q]) => q);
    const narrowed = [
      stypes.length ? `sample types ${stypes.join('/')}` : null,
      molecules.length ? `molecules ${molecules.join('/')}` : null,
      qc.length ? `QC ${qc.join('/')}` : null,
    ].filter(Boolean);

    return {
      title: `PM Sample Central · knowledge graph · ${LAYOUT_NAME[layout]}`,
      lines: [
        RULE[layout],
        `${visibleCount} of ${payload?.counts.nodes ?? 0} nodes shown`
          + ` · ${projection?.specimens ?? 0} samples`
          + (anyHighlight ? ` · ${brightCount} highlighted` : ''),
        offTypeLine,
        narrowed.length ? `Also filtered out: ${narrowed.join('; ')}` : 'No other filters applied',
        `Synthetic PreDDLung cohort · exported ${new Date().toISOString().slice(0, 10)}`,
      ],
    };
  }

  async function exportGraph(kind: 'current' | 'detailed', format: 'png' | 'pdf') {
    if (!cy) return;
    exportOpen = false;
    exporting = `${kind} ${format}`;
    try {
      const shot = kind === 'current'
        ? await currentView(cy, hullCanvas)
        /* paintOverlay is passed in so the rings and hulls are redrawn for the
           framed viewport, and again for the one we put back */
        : await detailedView(cy, hullCanvas, caption(), paintOverlay);
      const name = stamp(`graph-${layout}${kind === 'detailed' ? '-full' : ''}`);
      if (format === 'png') savePng(shot, name);
      else await savePdf(shot, name);
    } finally {
      exporting = null;
    }
  }

  /** Undo a pan: frame the graph again. Nothing about the layout changes — only
      where the camera is pointing — so this is safe to press at any time. */
  function recentre() {
    if (layout !== 'layered') rotator?.fit();
    else cy?.fit(undefined, 40);
  }

  const anyHighlight = $derived(highlighted.size > 0 || lit.size > 0);
  /* The lit family, as nodes, for the panel. Only what is actually on screen:
     the family reaches through layers that may be switched off, and describing
     something the reader cannot see is how the panel got confusing in the first
     place. */
  const familyNodes = $derived.by(() => {
    if (!familyOf || !model) return null;
    const seen = projection?.visible;
    return [...highlighted]
      .filter((id) => !seen || seen.has(id))
      .map((id) => model!.nodes[id])
      .filter(Boolean);
  });
  const pathSteps = $derived(pathOf && model ? model.lineageSteps(pathOf) : []);

  /**
   * Which nodes stay bright.
   *
   * A sun lights a whole type; a double-click lights one node's family. With
   * both in play they narrow each other rather than adding up — "the aliquots
   * of THIS specimen" is a question worth asking, "everything of either kind"
   * is not.
   */
  function isBrightNode(id: number, type: string): boolean {
    if (!anyHighlight) return true;
    if (lit.size && highlighted.size) return lit.has(type) && highlighted.has(id);
    if (lit.size) return lit.has(type);
    return highlighted.has(id);
  }

  /* count what is actually on screen, not the size of the set: a family
     includes identifiers and storage that may be switched off, and a panel that
     says 11 while you can see 6 is just wrong */
  const brightCount = $derived.by(() => {
    if (!anyHighlight || !projection || !cy) return 0;
    let n = 0;
    for (const id of projection.visible) {
      const type = cy.getElementById(String(id)).data('type');
      if (type && isBrightNode(id, type)) n += 1;
    }
    return n;
  });
  const visibleCount = $derived(projection?.visible.size ?? 0);
  const bridgeCount = $derived(projection?.bridges.length ?? 0);
</script>

<section class="view active" id="view-graph">
  <aside class="left">
    <p class="panel-title">Node types
      <span style="font-weight:400;color:var(--muted);text-transform:none;letter-spacing:0">
        ({TYPE_ORDER.length}) — toggle to show / hide · doubles as the colour key</span></p>
    <div id="layerbox">
      {#each TYPE_ORDER as type}
        <div class="chk layerrow">
          <button class="icon eye" class:off={!facets.ntype[type]}
                  aria-pressed={facets.ntype[type]}
                  aria-label="{facets.ntype[type] ? 'Hide' : 'Show'} {TYPE_LABEL[type]}"
                  title="{facets.ntype[type] ? 'Hide' : 'Show'} this type"
                  onclick={() => (facets.ntype[type] = !facets.ntype[type])}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 3.4C4.7 3.4 2 5.7 1.2 8c.8 2.3 3.5 4.6 6.8 4.6s6-2.3 6.8-4.6
                       C14 5.7 11.3 3.4 8 3.4Z" fill="none" stroke="currentColor"
                    stroke-width="1.3" />
              <circle cx="8" cy="8" r="2" fill="currentColor" />
              {#if !facets.ntype[type]}
                <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor"
                      stroke-width="1.4" stroke-linecap="round" />
              {/if}
            </svg>
          </button>

          <button class="icon sun" class:lit={lit.has(type)}
                  aria-pressed={lit.has(type)}
                  aria-label="Highlight all {TYPE_LABEL[type]}"
                  title="Highlight every {TYPE_LABEL[type].toLowerCase()}"
                  onclick={() => toggleLit(type)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="3.1" fill={lit.has(type) ? 'currentColor' : 'none'}
                      stroke="currentColor" stroke-width="1.3" />
              <g stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
                <line x1="8" y1="0.9" x2="8" y2="2.6" /><line x1="8" y1="13.4" x2="8" y2="15.1" />
                <line x1="0.9" y1="8" x2="2.6" y2="8" /><line x1="13.4" y1="8" x2="15.1" y2="8" />
                <line x1="3.1" y1="3.1" x2="4.3" y2="4.3" /><line x1="11.7" y1="11.7" x2="12.9" y2="12.9" />
                <line x1="12.9" y1="3.1" x2="11.7" y2="4.3" /><line x1="4.3" y1="11.7" x2="3.1" y2="12.9" />
              </g>
            </svg>
          </button>

          <span class="dot" style="background:{COLORS[type]}"></span>{TYPE_LABEL[type]}
          <button class="info" type="button"
                  aria-label="{DESCRIPTION[type]} Anchored to {ONTOLOGY[type]}.">ⓘ
            <span class="tip">
              {DESCRIPTION[type]}
              <em>anchored to {ONTOLOGY[type]}</em>
            </span>
          </button>
          <span style="color:var(--muted);margin-left:auto;font-size:11px">
            {typeCounts[type] ?? 0}</span>
        </div>
      {/each}
    </div>

    <!-- only the three appearances an edge can actually have; a legend listing
         things that all look the same teaches nothing -->
    <p class="panel-title" style="margin-top:15px">Connections</p>
    <div class="edgekey">
      <div><i class="plain"></i>part of the chain</div>
      <div><i class="repeat"></i>repeat of a failed sample</div>
      <div><i class="bridge"></i>steps hidden — hover to see which</div>
    </div>

    <p class="panel-title" style="margin-top:15px">Filters</p>
    <div class="facet">Patient sex</div>
    <label class="chk"><input type="checkbox" bind:checked={facets.sex.F} />Female</label>
    <label class="chk"><input type="checkbox" bind:checked={facets.sex.M} />Male</label>
    <div class="facet" style="margin-top:8px">Patient age</div>
    {#each Object.keys(facets.age) as band}
      <label class="chk"><input type="checkbox" bind:checked={facets.age[band]} />{band}</label>
    {/each}
    <div class="facet" style="margin-top:8px">Sample type</div>
    {#each Object.keys(facets.stype) as type}
      <label class="chk"><input type="checkbox" bind:checked={facets.stype[type]} />{type}</label>
    {/each}
    <div class="facet" style="margin-top:8px">Molecule</div>
    {#each Object.keys(facets.mol) as molecule}
      <label class="chk"><input type="checkbox" bind:checked={facets.mol[molecule]} />{molecule}</label>
    {/each}
    <div class="facet" style="margin-top:8px">QC outcome</div>
    <label class="chk"><input type="checkbox" bind:checked={facets.qc.pass} />Pass</label>
    <label class="chk"><input type="checkbox" bind:checked={facets.qc.fail} />Fail</label>
    <label class="chk"><input type="checkbox" bind:checked={facets.qc.pending} />Not yet QC'd</label>
    <div class="facet" style="margin-top:8px">Processing step
      {#if !facets.ntype.activity}
        <span class="needs">turn on the Activity eye to see these</span>
      {/if}
    </div>
    {#each ACTIVITY_ORDER as kind}
      <label class="chk"><input type="checkbox" bind:checked={facets.activity[kind]} />
        {ACTIVITY_LABEL[kind] ?? kind}</label>
    {/each}
    <div class="facet" style="margin-top:8px">Deviation recorded at pathology</div>
    {#each Object.keys(facets.deviation) as kind}
      <label class="chk"><input type="checkbox" bind:checked={facets.deviation[kind]} />
        {DEVIATION_LABEL[kind] ?? kind}</label>
    {/each}
  </aside>

  <div class="graphcol">
    <!-- The counts describe the cohort, not the canvas, so they belong in the
         page chrome rather than floating over the picture they are about. -->
    <div class="hud">
      {#if error}
        <span class="bad">Could not reach the API — {error}</span>
      {:else if !payload}
        loading the cohort…
      {:else}
        <span class="lead">Knowledge graph</span>
        <span><b>{payload.counts.nodes}</b> nodes</span>
        <span><b>{payload.counts.edges}</b> edges</span>
        <span><b>{visibleCount}</b> on screen</span>
        <span><b>{projection?.specimens ?? 0}</b> samples</span>
        {#if anyHighlight}
          <!-- what is actually bright on screen, not the size of the set: a
               family includes layers that may be switched off, and a count that
               says 11 while you can see 6 is just wrong -->
          <span class="lit"><b>{brightCount}</b> highlighted{brightCount ? '' : ' — nothing in common'}</span>
        {/if}
        {#if bridgeCount}
          <!-- the long version is a tooltip: the bar is for the number, not the
               paragraph explaining it -->
          <span title="Connections that jump over a switched-off step. Drawn dashed.">
            <b>{bridgeCount}</b> bridged</span>
        {/if}
        <span class="rule">{RULE[layout]}</span>
        {#if !flat}
          <span class="state">
            {rotation.settling && rotation.first
              ? `settling… ${Math.round(rotation.progress * 100)}%`
              : !rotation.settling ? `settled · ${rotation.nodes} placed` : ''}
          </span>
        {/if}
      {/if}
    </div>

  <div class="graphwrap">
    <canvas bind:this={hullCanvas} class="hulls"></canvas>
    <div bind:this={container} class="cyhost" class:settling={busy}></div>

    {#if busy}
      <div class="loading">
        <div class="spinner"></div>
        <div class="msg">
          {#if !payload}
            Loading the cohort…
          {:else if rotation.settling}
            Settling the layout
            <span class="pct">{Math.round(rotation.progress * 100)}%</span>
          {:else}
            Arranging…
          {/if}
        </div>
        <div class="bar"><div class="fill"
          style="width:{payload ? Math.round(rotation.progress * 100) : 8}%"></div></div>
        <div class="sub">
          {#if payload}
            {rotation.nodes || visibleCount} nodes · distance is being solved in three
            dimensions, so the picture is worth waiting for
          {:else}
            fetching from the API
          {/if}
        </div>
      </div>
    {/if}

    <!-- Two pictures, two formats. Kept behind one button because four
         buttons over the canvas would be four things to read past every time
         you are not exporting anything. -->
    <div class="exportbox">
      <button class="iconbtn" onclick={() => (exportOpen = !exportOpen)}
              aria-expanded={exportOpen} aria-controls="graph-export"
              title="Save a picture of this graph" disabled={!!exporting}>
        {exporting ? '…' : '⭳'}
      </button>
      {#if exportOpen}
        <div class="exportmenu" id="graph-export">
          <p class="mh">This view</p>
          <p class="mnote">Exactly what is on screen now, at twice the resolution.</p>
          <div class="row">
            <button onclick={() => exportGraph('current', 'png')}>PNG</button>
            <button onclick={() => exportGraph('current', 'pdf')}>PDF</button>
          </div>
          <p class="mh">Whole graph, with a caption</p>
          <p class="mnote">
            Everything currently switched on, framed in full, with the layout,
            the counts and the filters written underneath.
          </p>
          <div class="row">
            <button onclick={() => exportGraph('detailed', 'png')}>PNG</button>
            <button onclick={() => exportGraph('detailed', 'pdf')}>PDF</button>
          </div>
        </div>
      {/if}
    </div>

    <!-- How to drive the thing, folded away. Open once, learn the four
         gestures, close it and get the whole canvas back. -->
    <div class="helpbox" class:open={helpOpen}>
      <button class="helpbtn" onclick={() => (helpOpen = !helpOpen)}
              aria-expanded={helpOpen} aria-controls="graph-help"
              title={helpOpen ? 'Hide the controls' : 'How to move around'}>
        {helpOpen ? '✕' : '?'}
      </button>
      {#if helpOpen}
        <div class="helppanel" id="graph-help">
          <p class="hh">Moving around</p>
          <dl>
            {#if flat}
              <dt>Drag</dt><dd>move the picture</dd>
              <dt>Drag a node</dt><dd>put it where you want it</dd>
            {:else}
              <dt>Left-drag</dt><dd>turn the graph</dd>
              <dt>Right-drag</dt><dd>move the picture</dd>
            {/if}
            <dt>Scroll / pinch</dt><dd>zoom towards the pointer</dd>
            {#if layout === 'shell'}
              <dt>Rings</dt><dd>each is a pipeline stage, with how many are on it</dd>
            {/if}
            {#if !flat}
              <dt>⌖</dt><dd>bring it all back to the middle</dd>
            {/if}
          </dl>
          <p class="hh">Reading a node</p>
          <dl>
            <dt>Hover</dt><dd>what it is</dd>
            <dt>Click</dt><dd>select it — the spin waits while you read</dd>
            <dt>Double-click</dt><dd>light up its family</dd>
            <dt>Right-click</dt><dd>the full menu — trace a path, hide a type</dd>
            <dt>Shift-click</dt><dd>pick it out by hand</dd>
          </dl>
        </div>
      {/if}
    </div>

    {#if resettling}
      <div class="resettle" role="status">
        <span class="dot"></span>
        rearranging… {Math.round(rotation.progress * 100)}%
      </div>
    {/if}

    <button class="spinsw" class:off={!rotation.spinning} disabled={flat}
            onclick={toggleSpin}
            title={flat ? 'Rotation only applies to the force layout — this view is flat'
                        : selected ? 'Paused while a node is selected — press to spin anyway'
                        : ''}
            style={flat ? 'opacity:.35;cursor:not-allowed' : ''}>
      {rotation.spinning ? '⏸ Rotation' : '▶ Rotation'}
      {#if selected && !rotation.spinning}<span class="why">· node selected</span>{/if}
    </button>

    {#if anyHighlight || selected}
      <!-- Only here while there is something to clear. A control that is always
           present but usually does nothing teaches you to ignore it. -->
      <button class="clearsel" onclick={clearSelection}>
        ✕ Clear selection
        <span class="n">{brightCount || (selected ? 1 : 0)}</span>
      </button>
    {/if}

    <!-- A graph you can move is a graph you can push off the edge of the
         screen, so the way back has to be one click, not a hunt. -->
    <button class="recentre" onclick={recentre}
            title="Bring the graph back to the middle">⌖ Recentre</button>

    <div class="layoutsw">
      <button class:on={layout === 'force'} onclick={() => relayout('force')}
              title="Springs and repulsion — position shows how tightly things connect">Force</button>
      <button class:on={layout === 'shell'} onclick={() => relayout('shell')}
              title="Distance from the centre is how far that material got">Shell · progress</button>
      <button class:on={layout === 'clustered'} onclick={() => relayout('clustered')}
              title="One ball per outcome — turn it to see inside">Clustered · outcome</button>
      <button class:on={layout === 'grouped'} onclick={() => relayout('grouped')}
              title="One ball per kind of thing — turn it to see inside">Grouped · by type</button>
      <button class:on={layout === 'layered'} onclick={() => relayout('layered')}>Layered · pipeline</button>
    </div>

    {#if menu}
      {@const item = menu}
      <div class="ctx" style="left:{item.x + 6}px; top:{item.y + 6}px" role="menu">
        <div class="ctxhead">{item.node.label}</div>
        <button onclick={() => tracePath(item.node, 'both')}>Trace the whole path</button>
        <button onclick={() => tracePath(item.node, 'up')}>Where did this come from</button>
        <button onclick={() => tracePath(item.node, 'down')}>What became of it</button>
        <div class="ctxsep"></div>
        <button onclick={() => { highlightNeighbourhood(item.node); menu = null; }}>
          Highlight its family</button>
        <div class="ctxsep"></div>
        <button onclick={() => { facets.ntype[item.node.type] = false; menu = null; }}>
          Hide every {TYPE_LABEL[item.node.type].toLowerCase()}</button>
        {#if anyHighlight}
          <button onclick={() => { clearHighlight(); menu = null; }}>Clear the highlight</button>
        {/if}
      </div>
    {/if}

    {#if hovered}
      <div class="tip" style="display:block; left:{hovered.x + 14}px; top:{hovered.y + 12}px">
        <div class="t">{hovered.node.label}{hovered.node.stype ? ` · ${hovered.node.stype}` : ''}</div>
        <div class="s">{hovered.node.type}{hovered.node.qc ? ` · QC ${hovered.node.qc}` : ''}</div>
      </div>
    {/if}
  </div>
  </div>

  <aside class="right">
    <Inspector node={selected} family={familyNodes} {model} steps={pathSteps} />
  </aside>

  <PathWindow node={pathWindow} {model} onClose={() => (pathWindow = null)} />
</section>

<style>
  /* the popover sits below its row rather than beside it: the sidebar scrolls,
     and anything hanging outside it would be cut off */
  /* anchored to the whole row, not to the icon: the sidebar scrolls and clips,
     so a popover hung off a narrow icon runs off the left edge */
  .layerrow { position: relative; }
  .info { color: var(--muted); font-size: 11px; margin-left: 4px; cursor: help;
          border: 0; background: none; padding: 0; font: inherit; font-size: 11px; }
  .info .tip {
    display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px);
    z-index: 40; background: #22303b; color: #fff; font-size: 11.5px;
    line-height: 1.45; padding: 9px 11px; border-radius: 8px;
    box-shadow: 0 8px 22px rgba(16, 24, 40, .3); font-weight: 400; text-align: left;
  }
  .info:hover .tip, .info:focus .tip, .info:focus-visible .tip { display: block; }
  .info .tip em { display: block; margin-top: 5px; color: #9fb0c9; font-style: normal;
                  font-size: 10.5px; }

  /* small, out of the way, and never over the graph you are trying to read */
  .resettle {
    position: absolute; right: 14px; bottom: 14px; z-index: 5;
    display: flex; align-items: center; gap: 8px;
    background: rgba(12, 19, 32, .82); border: 1px solid #2a3b57;
    color: #cdd6e2; font-size: 11.5px; font-weight: 600;
    padding: 6px 11px; border-radius: 9px; backdrop-filter: blur(3px);
  }
  .resettle .dot { width: 8px; height: 8px; border-radius: 50%;
                   background: var(--accent); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .resettle .dot { animation: none; } }

  .needs { display: block; color: #a35c00; font-weight: 400; text-transform: none;
           letter-spacing: 0; font-size: 10.5px; margin-top: 2px; }

  .edgekey { display: flex; flex-direction: column; gap: 6px; font-size: 12px;
             color: var(--ink); }
  .edgekey div { display: flex; align-items: center; gap: 9px; }
  .edgekey i { flex: 0 0 auto; width: 26px; border-top-width: 2px; }
  .edgekey .plain { border-top-style: solid; border-top-color: #9db3cc; }
  .edgekey .repeat { border-top-style: dashed; border-top-color: #e76f51; }
  .edgekey .bridge { border-top-style: dashed; border-top-color: #8fa0b4; }

  .icon { border: 0; background: none; padding: 0; cursor: pointer; line-height: 0;
          color: var(--muted); flex: 0 0 auto; }
  .icon svg { width: 15px; height: 15px; display: block; }
  .icon.eye { color: var(--accent); }
  .icon.eye.off { color: #c3ccd4; }
  .icon.sun { color: #c3ccd4; margin-right: 1px; }
  .icon.sun:hover { color: #d9a441; }
  .icon.sun.lit { color: #e0a83a; }
  /* v3's stylesheet flexes `label.chk`, and these rows are divs now that the
     checkbox is gone — without this they lose the layout and the colour dot
     collapses to nothing */
  .layerrow { display: flex; align-items: center; gap: 6px;
              padding: 3px 0; font-size: 13px; position: relative; }
  .layerrow :global(.dot) { display: inline-block; }

  /* the bottom-left stack, in the order you reach for them: layout at 12px,
     Rotation at 52px, and the way back above both */
  .spinsw .why { color: #7f8ea6; font-weight: 500; }

  /* top left, the one corner of the canvas nothing else uses */
  .clearsel { position: absolute; top: 12px; left: 14px; z-index: 6;
              display: flex; align-items: center; gap: 7px;
              background: var(--accent); border: 1px solid var(--accent);
              border-radius: 9px; padding: 6px 12px; color: #fff; font: inherit;
              font-size: 12px; font-weight: 700; cursor: pointer;
              box-shadow: 0 4px 14px rgba(8, 13, 22, .35); }
  .clearsel:hover { filter: brightness(1.08); }
  .clearsel .n { background: rgba(255, 255, 255, .22); border-radius: 6px;
                 padding: 0 6px; font-weight: 700; }

  .recentre { position: absolute; bottom: 92px; left: 14px; z-index: 4;
              background: rgba(12, 19, 32, .82); border: 1px solid #2a3b57;
              border-radius: 9px; padding: 6px 12px; color: #cdd6e2; font: inherit;
              font-size: 12px; font-weight: 600; cursor: pointer;
              backdrop-filter: blur(3px); }
  .recentre:hover { color: #fff; }

  /* The graph column: a bar of page chrome, then the canvas under it. The
     counts used to float over the picture in the same corner as the controls,
     which put two unrelated things in one crowded place. */
  .graphcol { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .graphcol .graphwrap { flex: 1 1 auto; }

  /* Top right, opposite the layout and rotation controls at bottom left, so the
     two clusters never crowd each other. */
  .helpbox { position: absolute; top: 12px; right: 12px; z-index: 6;
             display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .helpbtn, .iconbtn { width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
             background: rgba(12, 19, 32, .82); border: 1px solid #2a3b57;
             color: #cdd6e2; font: inherit; font-size: 13px; font-weight: 700;
             line-height: 1; backdrop-filter: blur(3px); }
  .helpbtn:hover, .iconbtn:hover { color: #fff; border-color: #3d5480; }
  .helpbox.open .helpbtn { color: #fff; }
  .iconbtn:disabled { cursor: progress; color: #8ea0ba; }

  /* directly under the help button, sharing its right edge */
  .exportbox { position: absolute; top: 48px; right: 12px; z-index: 6;
               display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .exportmenu { width: 250px; background: rgba(12, 19, 32, .93);
                border: 1px solid #2a3b57; border-radius: 10px; padding: 11px 12px;
                backdrop-filter: blur(4px); box-shadow: 0 10px 28px rgba(0, 0, 0, .45); }
  .exportmenu .mh { margin: 0; font-size: 10px; letter-spacing: .06em;
                    text-transform: uppercase; color: #8ea0ba; font-weight: 700; }
  .exportmenu .mh:not(:first-child) { margin-top: 13px; }
  .exportmenu .mnote { margin: 3px 0 7px; font-size: 11px; line-height: 1.4;
                       color: #9fb0c9; }
  .exportmenu .row { display: flex; gap: 6px; }
  .exportmenu .row button { flex: 1 1 0; border: 1px solid #2a3b57; border-radius: 7px;
                            background: rgba(255, 255, 255, .06); color: #e8eef7;
                            font: inherit; font-size: 12px; font-weight: 700;
                            padding: 6px 0; cursor: pointer; }
  .exportmenu .row button:hover { background: var(--accent); border-color: var(--accent);
                                  color: #fff; }
  .helppanel { width: 262px; background: rgba(12, 19, 32, .93);
               border: 1px solid #2a3b57; border-radius: 10px; padding: 10px 12px;
               backdrop-filter: blur(4px); box-shadow: 0 10px 28px rgba(0, 0, 0, .45); }
  .helppanel .hh { margin: 0 0 5px; font-size: 10px; letter-spacing: .06em;
                   text-transform: uppercase; color: #8ea0ba; font-weight: 700; }
  .helppanel .hh:not(:first-child) { margin-top: 11px; }
  .helppanel dl { margin: 0; display: grid; grid-template-columns: auto 1fr;
                  gap: 3px 9px; font-size: 11.5px; line-height: 1.35; }
  .helppanel dt { color: #e8eef7; font-weight: 600; white-space: nowrap; }
  .helppanel dd { margin: 0; color: #9fb0c9; }

  .ctx { position: absolute; z-index: 30; min-width: 208px; background: #fff;
         border: 1px solid var(--border); border-radius: 10px; padding: 5px;
         box-shadow: 0 12px 30px rgba(16, 24, 40, .22); }
  .ctxhead { font-size: 11px; color: var(--muted); padding: 4px 9px 6px;
             font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .ctx button { display: block; width: 100%; text-align: left; border: 0;
                background: none; font: inherit; font-size: 13px; color: var(--ink);
                padding: 6px 9px; border-radius: 7px; cursor: pointer; }
  .ctx button:hover { background: #f2f5f7; }
  .ctxsep { height: 1px; background: var(--border); margin: 4px 6px; }

  .graphwrap { position: relative; }
  .cyhost { position: absolute; inset: 0; transition: opacity .35s ease; }
  .cyhost.settling { opacity: 0; }

  .loading {
    position: absolute; inset: 0; z-index: 4;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; color: #aeb9c9; font-size: 13px; pointer-events: none;
  }
  .spinner {
    width: 34px; height: 34px; border-radius: 50%;
    border: 3px solid rgba(174, 185, 201, .18);
    border-top-color: var(--accent);
    animation: spin 900ms linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading .msg { font-weight: 600; color: #e8eef7; }
  .loading .pct { color: var(--accent); margin-left: 4px; }
  .loading .bar {
    width: 220px; height: 3px; border-radius: 2px;
    background: rgba(174, 185, 201, .18); overflow: hidden;
  }
  .loading .fill { height: 100%; background: var(--accent); transition: width .2s linear; }
  .loading .sub { max-width: 300px; text-align: center; color: #8ea0ba; font-size: 11.5px;
                  line-height: 1.5; }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
  .hulls { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
</style>
