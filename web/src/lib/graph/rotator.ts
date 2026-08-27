/**
 * Drives the 3-D layout and writes its projection into Cytoscape.
 *
 * Settling runs in slices so the page stays responsive and can show progress.
 * Once settled, the only per-frame work is projecting and writing positions —
 * which is what makes rotation affordable at cohort scale.
 */
import type { Core, NodeSingular } from 'cytoscape';

import { Force3D, project, type Edge3, type Point3 } from './force3d';

/** ms between spin frames — 20 fps. See the note in the loop. */
const SPIN_INTERVAL = 50;
/** ms between frames while dragging — 30 fps. Faster than the idle spin because
    a drag has to feel like it is tracking the pointer, but still capped: writing
    every node position 60 times a second is what made the gesture feel heavy. */
const DRAG_INTERVAL = 33;

export interface RotatorState {
  settling: boolean;
  /** true only while the very first layout is being worked out */
  first: boolean;
  progress: number;
  spinning: boolean;
  nodes: number;
}

export class Rotator {
  sim = new Force3D();
  rotY = 0;
  rotX = -0.25;
  /** What the user asked for with the Rotation button. The spin can be held for
      other reasons — a hidden tab, a node under inspection — without that
      forgetting what they wanted. */
  private wanted = true;
  /** Reasons the spin is held right now, each independent of the others and of
      `wanted`. A held spin resumes on its own once the reason goes away. */
  private holds = new Set<string>();

  get spinning(): boolean { return this.wanted && this.holds.size === 0; }
  /** Radians per 60 fps frame — one full turn in 160 seconds (v3 took 33). At
      cohort scale there is far more on screen than the mockup had, and a faster
      rate reads as restless rather than gentle: it keeps moving the thing you
      are trying to read. The spin runs at a lower frame rate than the display
      (see SPIN_INTERVAL) and the step is scaled to match, so this is the
      apparent speed regardless of the frame rate. */
  private speed = (2 * Math.PI) / (160 * 60);
  private cy: Core;
  private ids: number[] = [];
  /* resolved once per settle: getElementById allocates a fresh collection on
     every call, which at 700 nodes x 60 fps is most of the frame budget */
  private handles: NodeSingular[] = [];
  private raf = 0;
  private dragging = false;
  private moved = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private scale = 1;
  private fogTick = 0;
  private lastState = '';
  private lastFrame = 0;
  private placed = false;
  /* Whether the next placement should re-frame the view. A layout SWITCH should
     — the world it lands in is a different size and shape. A layer toggle should
     not: re-framing then makes the picture lurch just as you are trying to read
     the change you asked for. */
  private frameNext = true;
  /* The very first settle is hidden behind a loading state, because watching a
     cloud explode out of the origin says nothing. Every settle after that is a
     RESPONSE to something the user just did — ticking a layer on — so it plays
     out in view: seeing the ID chain pull itself onto each specimen is the whole
     point of that toggle. */
  private firstRun = true;
  private live = false;
  private onState: (state: RotatorState) => void;
  private detach: (() => void)[] = [];

  constructor(cy: Core, onState: (state: RotatorState) => void) {
    this.cy = cy;
    this.onState = onState;
  }

  /** Settle the given nodes in three dimensions and start projecting. */
  start(nodeIds: number[], edges: Edge3[], frame = true) {
    this.begin(nodeIds, 1.6, frame);
    this.sim.reset(nodeIds, edges);
    this.ready();
  }

  /** Project coordinates that were computed rather than settled — the shell
      layout. Same rotation, same projection; only the source of the numbers
      differs. */
  startFixed(nodeIds: number[], at: Map<number, Point3>, scale = 0.62, frame = true) {
    this.begin(nodeIds, scale, frame);
    this.sim.place(nodeIds, at);
    this.ready();
  }

  /** How far the camera looks down on the scene. A layout can ask for its own:
      the clustered views arrange their balls on a horizontal ring, which at the
      default near-level angle projects to a thin ellipse with the far balls
      hiding behind the near ones. */
  tilt(rotX: number) { this.rotX = rotX; }

  private begin(nodeIds: number[], scale: number, frame: boolean) {
    this.ids = nodeIds;
    this.handles = nodeIds
      .map((id) => this.cy.getElementById(String(id)))
      .filter((element) => !element.empty()) as unknown as NodeSingular[];
    this.placed = false;
    this.frameNext = frame;
    this.live = !this.firstRun;
    /* the 3-D world is sized in its own units; scale it into something
       Cytoscape's viewport frames comfortably */
    this.scale = scale;
  }

  private ready() {
    this.bindDrag();
    if (!this.raf) this.loop(performance.now());
  }

  /** World units to Cytoscape model units — what the ring overlay needs to draw
      a stage radius in the same space as the nodes. */
  get worldScale(): number { return this.scale; }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.detach.forEach((off) => off());
    this.detach = [];
  }

  /** Does this press mean "move the picture" rather than "turn it"?
      Two gestures, no modes: left turns, right moves. Middle does the same as
      right for anyone whose habit it is — it costs a comparison and conflicts
      with nothing. */
  private wantsPan(e: MouseEvent): boolean {
    return e.button === 1 || e.button === 2;
  }

  private bindDrag() {
    if (this.detach.length) return;
    const host = this.cy.container();
    if (!host) return;

    const down = (e: MouseEvent) => {
      /* Left drag turns the graph, so moving it belongs on the right button —
         which is what a 3-D viewer trains people to reach for anyway. Two
         gestures cover the whole viewport, so there is no mode to switch into
         and no control to hunt for. */
      if (this.wantsPan(e)) {
        this.panning = true;
        this.lastX = e.clientX; this.lastY = e.clientY;
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      /* Cytoscape's panning is switched off in this view (see setInteraction),
         so the drag belongs to us alone — otherwise one gesture would both
         rotate the projection and slide the viewport under it. */
      this.dragging = true;
      this.moved = false;
      this.lastX = e.clientX; this.lastY = e.clientY;
      e.preventDefault();
    };
    const up = () => {
      this.panning = false;
      if (!this.dragging) return;
      this.dragging = false;
      if (!this.moved) return;
      this.moved = false;
      this.applyPositions(true);
    };
    /* Only record the angle here. Positions are written once per animation
       frame by the loop — applying them per mousemove would do the work several
       times for a single painted frame, which is what makes a drag feel heavy. */
    const move = (e: MouseEvent) => {
      if (this.panning) {
        this.cy.panBy({ x: e.clientX - this.lastX, y: e.clientY - this.lastY });
        this.lastX = e.clientX; this.lastY = e.clientY;
        return;
      }
      if (!this.dragging) return;
      if (!this.moved) {
        if (Math.abs(e.clientX - this.lastX) + Math.abs(e.clientY - this.lastY) < 3) return;
        this.moved = true;
      }
      this.rotY += (e.clientX - this.lastX) * 0.008;
      this.rotX += (e.clientY - this.lastY) * 0.008;
      this.rotX = Math.max(-1.4, Math.min(1.4, this.rotX));
      this.lastX = e.clientX; this.lastY = e.clientY;
    };

    /* Cytoscape's own wheel handler refuses to act unless user panning is
       enabled, because zooming toward the cursor pans as part of the operation.
       User panning is off in this view (the drag belongs to the rotation), so
       zooming is driven here instead — programmatic zoom is unaffected by that
       flag. Same gesture, same zoom-toward-the-pointer behaviour as v3. */
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      /* trackpad pinch arrives as a ctrl-wheel with much smaller deltas */
      const strength = e.ctrlKey ? 0.01 : 0.0018;
      const level = this.cy.zoom() * Math.pow(2, -e.deltaY * strength);
      this.cy.zoom({
        level,
        renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };

    /* nothing should spin in a tab nobody is looking at */
    const visibility = () => this.hold('hidden', document.hidden);

    host.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);
    host.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('visibilitychange', visibility);
    this.detach = [
      () => host.removeEventListener('mousedown', down),
      () => window.removeEventListener('mouseup', up),
      () => window.removeEventListener('mousemove', move),
      () => host.removeEventListener('wheel', wheel),
      () => document.removeEventListener('visibilitychange', visibility),
    ];
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);

    if (!this.sim.settled) {
      /* Settle in slices so the page stays responsive and can report progress —
         but do NOT write positions while it does. Watching a cloud explode out
         of the origin and re-frame itself several times is noise, not
         information: the view shows a loading state until there is a layout
         worth looking at. */
      const budget = performance.now() + 10;
      while (performance.now() < budget && this.sim.step()) { /* keep stepping */ }
      if (this.live) this.applyPositions();
      this.publish();
      return;
    }

    /* first frame after settling: place every node, then frame it once */
    if (!this.placed) {
      this.placed = true;
      this.applyPositions(true);
      if (this.firstRun || this.frameNext) this.cy.fit(undefined, 40);
      this.firstRun = false;
      this.publish();
      return;
    }

    /* A settled, paused graph is a finished picture — doing anything per frame
       would burn the main thread for nothing, which is what made the devtools
       unusable on this page. */
    if (!this.spinning && !this.dragging) {
      this.publish();
      return;
    }

    /* Spin at 20 fps rather than the display's 60. Cytoscape redraws every node
       and edge whenever positions move, so the frame rate IS the cost; at this
       rate the motion still reads as continuous but the main thread is left with
       room to breathe — which is what the browser devtools need to stay usable.
       Dragging is exempt: that has to track the pointer. */
    if (this.dragging) {
      if (now - this.lastFrame < DRAG_INTERVAL) return;
      this.lastFrame = now;
    } else if (this.spinning) {
      if (now - this.lastFrame < SPIN_INTERVAL) return;
      const elapsed = Math.min(4, (now - this.lastFrame) / 16.7);   // in 60 fps frames
      this.lastFrame = now;
      this.rotY += this.speed * elapsed;
    }

    this.applyPositions();
    this.publish();
  };

  /** Only tell Svelte when something actually changed: a state write per frame
      re-renders the whole view, sidebar included. */
  private publish() {
    const state: RotatorState = {
      settling: !this.sim.settled || !this.placed,
      first: this.firstRun,
      progress: Math.round(this.sim.progress * 20) / 20,
      spinning: this.spinning,
      nodes: this.ids.length,
    };
    const signature = `${state.settling}|${state.first}|${state.progress}|${state.spinning}|${state.nodes}`;
    if (signature === this.lastState) return;
    this.lastState = signature;
    this.onState(state);
  }

  private applyPositions(force = false) {
    const count = this.handles.length;
    if (!count) return;

    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const depths = new Float64Array(count);
    let minDepth = Infinity, maxDepth = -Infinity;

    for (let i = 0; i < count; i++) {
      const point = this.sim.positionOf(this.ids[i]);
      if (!point) continue;
      const p = project(point, this.rotY, this.rotX, this.scale);
      xs[i] = p.x; ys[i] = p.y; depths[i] = p.depth;
      if (p.depth < minDepth) minDepth = p.depth;
      if (p.depth > maxDepth) maxDepth = p.depth;
    }

    const span = Math.max(1, maxDepth - minDepth);
    this.fogTick += 1;
    /* The depth cue is a style write, which is far dearer than a position write,
       so it is refreshed every dozen frames or so. The eye does not notice the
       difference; the profiler does. */
    const withFog = force || this.fogTick % 12 === 0;

    this.cy.batch(() => {
      for (let i = 0; i < count; i++) {
        const element = this.handles[i];
        element.position({ x: xs[i], y: ys[i] });
        if (withFog) {
          const near = (depths[i] - minDepth) / span;   // 0 far, 1 near
          element.data('fog', Math.round((0.45 + 0.55 * near) * 20) / 20);
        }
      }
    });
  }

  /** Hold the spin for a named reason, or let it go. Nothing here touches what
      the user asked for, so a hold is always temporary. */
  hold(reason: string, on: boolean) {
    if (on) this.holds.add(reason); else this.holds.delete(reason);
  }

  /** The Rotation button. Pressing play while something is holding the spin
      means "spin anyway", so it lets that hold go — otherwise the button would
      do nothing and read as broken. The hidden-tab hold is left alone: a tab
      nobody is looking at should not be animating whatever the button says. */
  toggleSpin() {
    if (this.spinning) { this.wanted = false; return; }
    this.wanted = true;
    this.holds.delete('selection');
  }

  /** Frame the projection. Called once when the layout lands; the view does not
      re-frame during rotation, because a camera that keeps re-fitting reads as
      the picture lurching. */
  fit() {
    this.cy.fit(undefined, 40);
  }
}
