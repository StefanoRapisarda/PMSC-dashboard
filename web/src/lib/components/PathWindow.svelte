<script lang="ts">
  /**
   * One sample's journey, on a single time axis.
   *
   * The graph answers what is connected to what. It cannot answer what happened
   * to this particular material, in what order, and where the time went.
   * Following a chain by eye through a rotating cloud is not reading a workflow.
   *
   * The first version of this window was a rail, meaning every step in one
   * left-to-right line with the wait in days written on the connector between
   * each pair. That shape cannot tell the truth about this pipeline. A sample
   * yields up to three fractions which are made together and analysed at the
   * same time on three different platforms, so a rail had to invent an order for
   * them. It ended up printing a wait of minus one day between two steps that
   * were never sequential at all.
   *
   * Position on the horizontal axis is now the date itself. Anything that
   * happened at the same time therefore lands at the same place and is stacked
   * vertically, which is what makes parallel work look parallel. Each kind of
   * thing gets its own row, so the eye can follow one band across the page.
   *
   * A path traced from a patient reaches every sample that patient gave, and
   * most patients here gave two or more. One shared Activity row then mixed the
   * steps of different samples with nothing to say which was which. Such a path
   * is drawn as one block of rows per sample instead, all on the same time axis,
   * with the patient above the blocks and the tumour board below them. A path
   * with a single sample has no blocks and looks as it always did.
   */
  import { ACTIVITY_LABEL, COLORS, TYPE_LABEL, type NodeType } from '$lib/graph/v3';
  import { elementShot, savePdf, savePng, stamp } from '$lib/graph/export';
  import type { GraphModel } from '$lib/graph/model';
  import type { GraphNode } from '$lib/types';

  let { node, model, onClose }: {
    node: GraphNode | null; model: GraphModel | null; onClose: () => void;
  } = $props();

  /** A wait worth calling out rather than leaving the reader to subtract dates. */
  const SLOW_DAYS = 14;
  /**
   * Card geometry, in pixels.
   *
   * A card is only as tall as the text inside it. Fixing the height meant
   * clamping the name to two lines and cutting the detail off with an ellipsis,
   * so a sample read "FFPE · Pathology r…" and a platform read "Clinical
   * Genomics,…". A card that hides what it says is not worth the space it takes.
   * Height is therefore measured after the text has been laid out, and the lanes
   * are spaced from those measurements.
   *
   * The scale reserves one card width on the right so that a step on the very
   * last date still fits inside the plot.
   */
  const CARD_W = 190, MIN_CARD_H = 62, LANE_GAP = 8;
  /** How much room a day gets, and how wide the plot is at its narrowest. Wider
      cards need more room per day or they pile into extra lanes; a timeline that
      scrolls sideways is normal, one that stacks six deep is not. */
  const PX_PER_DAY = 34, MIN_PLOT = 640;
  /** Two date labels closer together than this would overlap, so only the first
      of them is written. */
  const LABEL_GAP = 66;

  /** The rows, in pipeline order. A kind of thing with nothing in it is dropped. */
  const ROW_ORDER: NodeType[] = ['patient', 'sample', 'activity', 'aliquot', 'platform', 'mtb'];

  const steps = $derived(node && model ? model.lineageSteps(node) : []);

  /** Every sample on the path, in the order they were collected. */
  const samples = $derived(steps.map((s) => s.node).filter((n) => n.type === 'sample')
    .sort((a, b) => (a.collected ?? '').localeCompare(b.collected ?? '')
                    || a.label.localeCompare(b.label)));
  /** Several samples on one path are drawn as one block of rows each. */
  const grouped = $derived(samples.length > 1);
  /** The sample the path is about, when there is just one. The patient and the
      board are context. */
  const sample = $derived(
    node?.type === 'sample' ? node : samples.length === 1 ? samples[0] : null);
  const patient = $derived(steps.find((s) => s.node.type === 'patient')?.node ?? null);

  /**
   * Which sample a step belongs to, read from the graph. A step points at the
   * sample it was carried out on. A fraction points at what it was extracted
   * from, which for a peptide is the protein fraction, so that chain is followed
   * down until it reaches a sample.
   */
  function sampleOf(n: GraphNode): number | null {
    if (!model) return null;
    const m = model;
    const out = (id: number, type: string) =>
      (m.adj[id] ?? []).find((x) => x.t === type && x.dir === 'out')?.o ?? null;
    if (n.type === 'sample') return n.id;
    if (n.type === 'activity') return out(n.id, 'used');
    if (n.type === 'aliquot') {
      let at = n.id;
      for (let hops = 0; hops < 4; hops++) {
        const parent = out(at, 'derived_from');
        if (parent == null) return null;
        if (m.nodes[parent]?.type === 'sample') return parent;
        at = parent;
      }
    }
    return null;
  }

  /**
   * Which samples sent material to each platform, and when the last of that
   * sample's results came back from it. One platform serves several samples of
   * the same patient, so in a grouped path it appears once in each of their
   * blocks, dated by that sample's own return rather than by the patient's.
   */
  const platformRuns = $derived.by(() => {
    const runs = new Map<number, Map<number, string | null>>();
    if (!model) return runs;
    for (const step of steps) {
      if (step.node.type !== 'aliquot') continue;
      const group = sampleOf(step.node) ?? -1;
      for (const link of model.adj[step.node.id] ?? []) {
        if (link.t !== 'submitted_to' || link.dir !== 'out') continue;
        const byGroup = runs.get(link.o) ?? new Map<number, string | null>();
        runs.set(link.o, byGroup);
        const before = byGroup.get(group) ?? null;
        const back = step.node.returned_on ?? null;
        byGroup.set(group, back && (!before || back > before) ? back : before);
      }
    }
    return runs;
  });

  /**
   * When a step happened.
   *
   * The model's own date covers the activities and the collection, which left
   * the whole back half of the path undated. An end-to-end total that stopped at
   * SP3 reported sixteen days when the material had actually taken twice that.
   * The later steps do carry dates, only under different names. An aliquot went
   * out on `sent_on`, and a platform's moment is when it sent the data back.
   */
  function whenOf(n: GraphNode, back: string | null): string | null {
    /* A fraction that has no dispatch date but does have a return date was
       plainly out at some point, so the return date places it. Falling straight
       through to null instead parked it at the very start of the axis, where a
       protein fraction appeared to exist before the sample was collected. */
    if (n.type === 'aliquot') return n.sent_on ?? n.date ?? n.returned_on ?? null;
    if (n.type === 'platform' || n.type === 'mtb') return back;
    return n.date ?? n.collected ?? null;
  }

  /**
   * What the date on a card actually means.
   *
   * The steps are dated from different fields, so a bare date invites the reader
   * to assume they all mean the same thing. Saying which one it is costs a word.
   */
  /**
   * The clock time of a step, where the record has one.
   *
   * Only the collection and the pathology registration carry a time in the
   * REDCap form. That is exactly where it is needed, because those two routinely
   * land on the same date and a date alone cannot say which came first.
   */
  function timeOf(n: GraphNode): string | null {
    return n.type === 'activity' ? n.time ?? null : null;
  }

  function dateLabel(n: GraphNode, when: string | null, showYear: boolean): string {
    if (!when) return 'no date recorded';
    /* The year is the same for every step of almost every journey, so it is
       stated once on the axis and left off the cards, where it was pushing the
       line past the width of the card and getting clipped. A journey that
       crosses a year boundary keeps the full date. */
    const d = (v: string) => (showYear ? v : v.slice(5));
    if (n.type === 'sample') return `collected ${d(when)}`;
    if (n.type === 'platform' || n.type === 'mtb') return `data back ${d(when)}`;
    if (n.type === 'aliquot') {
      const out = n.sent_on ? `sent ${d(n.sent_on)}` : null;
      const home = n.returned_on ? `back ${d(n.returned_on)}` : null;
      return [out, home].filter(Boolean).join(' · ') || d(when);
    }
    const clock = timeOf(n);
    return clock ? `${d(when)} · ${clock}` : d(when);
  }

  /** The last date on which any fraction of this sample came back. It is what
      the platform and tumour board steps are dated by. */
  const dataBack = $derived.by(() => {
    const dates = steps.map((s) => s.node.returned_on).filter(Boolean) as string[];
    return dates.length ? [...dates].sort()[dates.length - 1] : null;
  });

  /** All the dates in the record, used to decide whether the year is needed. */
  const allDates = $derived(steps.flatMap((step) =>
    [step.when ?? whenOf(step.node, dataBack), step.node.returned_on]
      .filter(Boolean) as string[]));
  const years = $derived([...new Set(allDates.map((d) => d.slice(0, 4)))].sort());
  const showYear = $derived(years.length > 1);

  /**
   * One entry per card. `group` is the sample whose block the card sits in, or
   * null for the patient and the board, which belong to no single sample. The
   * key is unique per card rather than per node, because a platform can appear
   * in more than one block.
   */
  type Entry = { key: string; group: number | null; node: GraphNode; when: string | null;
                 time: string | null; detail: string; dates: string };
  const dated = $derived(steps.flatMap((step): Entry[] => {
    const n = step.node;
    const make = (group: number | null, back: string | null): Entry => {
      const when = step.when ?? whenOf(n, back);
      return { key: `${group ?? 'all'}:${n.id}`, group, node: n, when, time: timeOf(n),
               detail: detailOf(n), dates: dateLabel(n, when, showYear) };
    };
    if (!grouped || n.type === 'patient' || n.type === 'mtb') return [make(null, dataBack)];
    if (n.type === 'platform') {
      const byGroup = platformRuns.get(n.id);
      if (!byGroup?.size) return [make(-1, dataBack)];
      return [...byGroup].map(([group, back]) => make(group, back));
    }
    return [make(sampleOf(n) ?? -1, dataBack)];
  }));

  const days = (a: string, b: string) =>
    Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

  /**
   * Every distinct date something happened on, earliest first.
   *
   * A fraction coming back from a platform is one of those dates even though the
   * card is positioned by its dispatch. Leaving returns out made the axis claim
   * a seventeen-day silence in the middle of the run, when in fact the peptide
   * fraction reported back partway through it.
   */
  const marks = $derived([...new Set(dated.flatMap((d) =>
    [d.when, d.node.type === 'aliquot' ? d.node.returned_on : null]
      .filter(Boolean) as string[]))].sort());
  const first = $derived(marks[0] ?? null);
  const last = $derived(marks.length ? marks[marks.length - 1] : null);
  const span = $derived(first && last ? Math.max(1, days(first, last)) : 1);
  const elapsed = $derived(first && last ? days(first, last) : null);

  /** The widest empty stretch on the axis. It is the wait you can actually see,
      which is what makes it the one worth reporting. */
  const slowest = $derived.by(() => {
    let worst = 0;
    for (let i = 1; i < marks.length; i++) worst = Math.max(worst, days(marks[i - 1], marks[i]));
    return worst;
  });

  /* Width available to the axis once the row names and one card's overhang are
     taken out. Measured, because the dialog is sized against the viewport. */
  let frameW = $state(0);
  const GUTTER = 128, GUTTER_GAP = 12;
  /* clientWidth includes the scroller's own padding, which is not room */
  const SCROLL_PAD = 36;
  const room = $derived(
    Math.max(0, frameW - SCROLL_PAD - GUTTER - GUTTER_GAP - CARD_W));

  /**
   * How wide the axis is.
   *
   * A day gets PX_PER_DAY of room, but never at the cost of pushing the end of
   * the journey off the side of the window. The three platforms reporting on the
   * same day are the whole point of the view, and having to scroll right to find
   * them defeats it. A journey long enough that even the fitted width would be
   * unreadable scrolls instead.
   */
  const plot = $derived(Math.max(MIN_PLOT, Math.min(span * PX_PER_DAY, room || Infinity)));
  /** Position on the axis. Only dated steps are placed here. */
  const xOf = (when: string | null) =>
    !when || !first ? 0 : (days(first, when) / span) * plot;

  /**
   * The rows, each packed into as few lanes as its steps need.
   *
   * Two cards in the same lane must not overlap, so a card goes into the first
   * lane whose previous card has already finished by the time this one starts.
   * Three platforms reporting on the same day therefore end up in three lanes,
   * one above the other, at the same point on the axis.
   */
  type Placed = Entry & { x: number; lane: number };
  type Row = { key: string; type: NodeType; label: string; group: number | null;
               count: number; lanes: number; cards: Placed[]; off: Entry[] };

  /** Rows inside a sample's block. The patient and the board sit outside them. */
  const BLOCK_ORDER: NodeType[] = ['sample', 'activity', 'aliquot', 'platform'];

  function rowOf(key: string, type: NodeType, group: number | null,
                 members: Entry[]): Row | null {
    if (!members.length) return null;
    /* A step with no date anywhere in the record cannot go on a time axis at
       all. Putting it at the start would be a claim about when it happened, so
       it goes in a strip of its own beside the axis instead. */
    const off = members.filter((d) => !d.when);
    /**
     * Within one day the axis cannot separate two steps, so the pipeline order
     * does. Not the clock: sample S-6 is recorded as collected at 14:35 and
     * registered at pathology at 09:55 on the same day, and sorting by the
     * clock would put pathology first, which cannot have happened. The order a
     * sample must pass through is the thing we actually know; the clock is a
     * form field with nothing keeping it consistent. So the pipeline places
     * the cards, the clock is shown on them, and a disagreement between the
     * two is flagged rather than silently obeyed.
     */
    const timed = members.filter((d) => d.when)
      .map((d, i) => ({ ...d, seq: i }))
      .sort((a, b) => (xOf(a.when) - xOf(b.when)) || (a.seq - b.seq));
    const laneEnds: number[] = [];
    const cards = timed.map((card) => {
      const x = xOf(card.when);
      let lane = laneEnds.findIndex((end) => end <= x);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = x + CARD_W + 8;
      return { ...card, x, lane };
    });
    return { key, type, label: TYPE_LABEL[type] ?? type, group, count: members.length,
             lanes: Math.max(1, laneEnds.length), cards, off };
  }

  /**
   * The rows, each packed into as few lanes as its steps need.
   *
   * Two cards in the same lane must not overlap, so a card goes into the first
   * lane whose previous card has already finished by the time this one starts.
   * Three platforms reporting on the same day therefore end up in three lanes,
   * one above the other, at the same point on the axis.
   */
  const rows = $derived.by(() => {
    const of = (type: NodeType, group: number | null) =>
      dated.filter((d) => d.node.type === type && d.group === group);
    const out: (Row | null)[] = [];
    if (!grouped) {
      for (const type of ROW_ORDER) out.push(rowOf(type, type, null, of(type, null)));
    } else {
      out.push(rowOf('patient', 'patient', null, of('patient', null)));
      const groups = [...samples.map((s) => s.id),
                      ...(dated.some((d) => d.group === -1) ? [-1] : [])];
      for (const group of groups) {
        for (const type of BLOCK_ORDER) {
          out.push(rowOf(`${group}:${type}`, type, group, of(type, group)));
        }
      }
      out.push(rowOf('mtb', 'mtb', null, of('mtb', null)));
    }
    return out.filter((r): r is Row => r !== null);
  });

  /** What a block is called, above its first row and in the list of undated steps. */
  function groupName(group: number | null): string {
    if (group == null) return '';
    if (group === -1) return 'Not tied to one sample';
    const s = model?.nodes[group];
    return s ? `${TYPE_LABEL.sample} ${s.label}${s.stype ? ` · ${s.stype}` : ''}` : '';
  }

  /**
   * Steps whose recorded time runs backwards against the pipeline order.
   *
   * The export records a clock time for the collection and for the pathology
   * registration, and nothing keeps the two consistent. Sample S-6 is recorded
   * as collected at 14:35 and registered at pathology at 09:55 on the same day,
   * which cannot have happened in that order. Showing the times without saying
   * so would make the timeline look wrong; saying so makes it a finding, and a
   * timing deviation is already one of the four classes this study records.
   */
  const outOfOrder = $derived.by(() => {
    const bad = new Set<string>();
    /* compared within one sample: two samples' steps are not one sequence */
    const prev = new Map<number | null, { when: string; time: string }>();
    for (const step of dated) {
      if (!step.when || !step.time) continue;
      const before = prev.get(step.group);
      if (before && before.when === step.when && step.time < before.time) bad.add(step.key);
      prev.set(step.group, { when: step.when, time: step.time });
    }
    return bad;
  });

  /** True when anything at all is undated, which the footer line names. */
  const anyOff = $derived(rows.some((r) => r.off.length));
  /* A row whose every step is undated has nothing to draw on the axis, and an
     empty band with a label beside it reads as a gap in the record rather than
     as steps listed underneath. */
  const bands = $derived(rows.filter((r) => r.cards.length).map((row, i, all) => ({
    ...row,
    /* the first drawn row of each sample's block carries the block's name */
    head: row.group != null && (i === 0 || all[i - 1].group !== row.group)
      ? groupName(row.group) : null,
  })));

  /**
   * How tall each card turned out to be, once its text was laid out.
   *
   * Filled in by the browser through `bind:clientHeight`, so the first frame
   * uses the minimum and the second uses the truth. That is one extra frame in
   * a dialog that has just opened, which nobody sees, and it is the price of
   * never cutting a word off.
   */
  let heights = $state<Record<string, number>>({});
  const heightOf = (key: string) => Math.max(MIN_CARD_H, heights[key] ?? MIN_CARD_H);

  /** Where each lane starts inside its row, and how tall the row therefore is. */
  const layout = $derived.by(() => {
    const out = new Map<string, { tops: number[]; height: number }>();
    for (const row of rows) {
      const laneH: number[] = Array(row.lanes).fill(MIN_CARD_H);
      for (const c of row.cards) laneH[c.lane] = Math.max(laneH[c.lane], heightOf(c.key));

      const tops: number[] = [];
      let y = 0;
      for (let i = 0; i < laneH.length; i++) { tops[i] = y; y += laneH[i] + LANE_GAP; }
      out.set(row.key, { tops, height: Math.max(0, y - LANE_GAP) });
    }
    return out;
  });
  const topOf = (row: string, lane: number) => layout.get(row)?.tops[lane] ?? 0;
  const heightOfRow = (row: string) => layout.get(row)?.height ?? MIN_CARD_H;

  /**
   * How long each fraction was away.
   *
   * A card is a moment, but a fraction sent to a platform is not a moment. It is
   * away for a stretch and then reports back, and that stretch is most of where
   * the time goes. The bar is drawn behind the cards, so only the part that
   * reaches past the card shows, which is exactly the period still outstanding.
   */
  const outAndBack = $derived.by(() =>
    rows.filter((r) => r.type === 'aliquot').flatMap((row) =>
      row.cards
        .filter((c) => c.node.sent_on && c.node.returned_on
                       && c.node.returned_on > (c.when ?? ''))
        .map((c) => ({
          id: c.key, row: row.key, lane: c.lane, x: c.x,
          w: Math.max(0, xOf(c.node.returned_on!) - c.x),
          days: days(c.when!, c.node.returned_on!),
        }))));


  /** Date labels, thinned so that two of them never sit on top of each other. */
  const ticks = $derived.by(() => {
    let lastLabelled = -Infinity;
    return marks.map((when) => {
      const x = xOf(when);
      const label = x - lastLabelled >= LABEL_GAP;
      if (label) lastLabelled = x;
      /* a centred label on the first tick hangs off the left of the plot and
         collides with the row names, so the edges are anchored instead */
      const anchor = x < 30 ? 'start' : x > plot + CARD_W - 30 ? 'end' : 'mid';
      return { when, x, label, anchor };
    });
  });

  /** Runs of empty axis long enough to be worth naming. */
  const waits = $derived(
    marks.slice(1).map((when, i) => ({
      from: marks[i], to: when, n: days(marks[i], when),
      x: xOf(marks[i]), w: xOf(when) - xOf(marks[i]),
    })).filter((w) => w.n >= SLOW_DAYS));

  const undated = $derived(dated.filter((d) => !d.when).length);

  function detailOf(n: GraphNode): string {
    switch (n.type) {
      case 'patient': return `${n.sex === 'F' ? 'Female' : 'Male'} · ${n.age}`;
      case 'sample': return `${n.stype ?? ''}${n.box ? ` · ${n.box}` : ''}`;
      case 'activity': {
        /* "Sectioning" over "Sectioning (FFPE)" is the same word twice and a
           whole line of height on every card in the tallest row */
        const full = ACTIVITY_LABEL[n.kind ?? ''] ?? n.kind ?? '';
        return full.startsWith(n.label) || n.label.startsWith(full) ? '' : full;
      }
      case 'aliquot': {
        const bits = [n.molLabel ?? n.mol];
        if (n.qc) bits.push(`QC ${n.qc}`);
        return bits.filter(Boolean).join(' · ');
      }
      case 'platform': return '';
      case 'mtb': return '';
      default: return n.type;
    }
  }

  /**
   * Saving the timeline.
   *
   * This one is HTML rather than a canvas, so it is captured from the page
   * itself. The whole element is taken at its full extent rather than the part
   * scrolled into view, because a timeline cropped to the visible window is a
   * different timeline.
   */
  let win = $state<HTMLDivElement | null>(null);
  let saving = $state(false);

  async function save(format: 'png' | 'pdf') {
    if (!win) return;
    saving = true;
    try {
      const shot = await elementShot(win, '#ffffff');
      const name = stamp(`timeline-${sample?.label ?? node?.label ?? 'path'}`);
      if (format === 'png') savePng(shot, name);
      else await savePdf(shot, name);
    } finally {
      saving = false;
    }
  }

  /* Escape closes the window, as it does every other dialog here. */
  $effect(() => {
    if (!node) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
</script>

{#if node}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={onClose}></div>
  <div class="win" bind:this={win} role="dialog" aria-modal="true"
       aria-label="The whole path, on one time axis">
    <header>
      <div>
        <p class="eyebrow">The whole path, on one time axis</p>
        <h2>
          {#if grouped && patient}
            {TYPE_LABEL.patient} {patient.label}
            <span class="qual">· {samples.length} samples</span>
          {:else}
            {sample ? `${TYPE_LABEL.sample} ${sample.label}` : node.label}
            {#if sample?.stype}<span class="qual">· {sample.stype}</span>{/if}
          {/if}
        </h2>
      </div>
      <div class="totals">
        {#if elapsed !== null}<span><b>{elapsed}</b> days end to end</span>{/if}
        <span><b>{steps.length}</b> steps</span>
        {#if slowest >= SLOW_DAYS}
          <span class="slow">longest wait <b>{slowest}</b> days</span>
        {/if}
      </div>
      <div class="save" data-noexport>
        <button onclick={() => save('png')} disabled={saving}
                title="Save this timeline as an image">PNG</button>
        <button onclick={() => save('pdf')} disabled={saving}
                title="Save this timeline as a PDF">PDF</button>
      </div>
      <button class="x" data-noexport onclick={onClose} aria-label="Close">✕</button>
    </header>

    {#if !dated.length}
      <p class="empty">Nothing has been recorded for this one yet.</p>
    {:else}
      <div class="scroll" bind:clientWidth={frameW}>
        <div class="chart">
          <div class="gutter" aria-hidden="true">
            <div class="axislabel">date{years.length === 1 ? ` · ${years[0]}` : ''}</div>
            {#each bands as row (row.key)}
              {#if row.head}<div class="blockhead">{row.head}</div>{/if}
              <div class="rowlabel" class:inblock={row.group != null}
                   style="height:{heightOfRow(row.key)}px">
                <span class="swatch" style="background:{COLORS[row.type] ?? '#8ea0ba'}"></span>
                {row.label}
                <span class="n">{row.count}</span>
              </div>
            {/each}
          </div>

          <div class="plot" style="width:{plot + CARD_W}px">
            <div class="axis">
              {#each ticks as tick}
                <div class="tick" style="left:{tick.x}px">
                  {#if tick.label}<span class={tick.anchor}>{tick.when.slice(5)}</span>{/if}
                </div>
              {/each}
              <!-- a long empty stretch is the finding, so the axis names it -->
              {#each waits as wait}
                <div class="wait" style="left:{wait.x}px; width:{wait.w}px">
                  <span>{wait.n} days</span>
                </div>
              {/each}
            </div>

            {#each bands as row (row.key)}
              {#if row.head}<div class="blockline"></div>{/if}
              <div class="band" style="height:{heightOfRow(row.key)}px">
                {#each ticks as tick}
                  <div class="grid" style="left:{tick.x}px"></div>
                {/each}
                {#if row.type === 'aliquot'}
                  {#each outAndBack.filter((b) => b.row === row.key) as bar (bar.id)}
                    <div class="outbar"
                         style="left:{bar.x}px; width:{bar.w}px;
                                top:{topOf(row.key, bar.lane) + MIN_CARD_H / 2 - 3}px"
                         title="away at the platform for {bar.days} days">
                      <span class="cap"></span>
                    </div>
                  {/each}
                {/if}
                {#each row.cards as card (card.key)}
                  <div class="card" bind:clientHeight={heights[card.key]}
                       style="left:{card.x}px; top:{topOf(row.key, card.lane)}px;
                              --c:{COLORS[card.node.type] ?? '#8ea0ba'}">
                    <div class="name">{card.node.label}</div>
                    {#if card.detail}<div class="detail">{card.detail}</div>{/if}
                    <div class="foot-row">
                      <span class="when">{card.dates}</span>
                      {#if card.node.qc === 'fail'}<span class="flag bad">fail</span>{/if}
                      {#if card.node.qc === 'pending'}<span class="flag pending">pending</span>{/if}
                      {#if card.node.stalled_days}
                        <span class="flag bad">{card.node.stalled_days} d</span>
                      {/if}
                      {#if outOfOrder.has(card.key)}
                        <span class="flag bad"
                              title="The clock time recorded for this step is earlier in the day than the one recorded for the step above it, which the pipeline says came first.">earlier than the step above</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      </div>

      {#if anyOff}
        <!-- Steps the record never dated. They cannot sit on a time axis at all,
             so they are named underneath it rather than being given a date they
             do not have. They used to occupy a column of their own beside the
             axis, which cost two hundred pixels of the width the timeline
             needed. -->
        <p class="notdated">
          <b>Not dated in the record:</b>
          {#each rows.filter((r) => r.off.length) as row, i}
            {i > 0 ? ' · ' : ''}{row.group != null ? `${groupName(row.group)}, ` : ''}{row.label}
            {#each row.off as card, j}
              {j > 0 ? ', ' : ' '}<span class="who">{card.node.label}</span
              >{card.detail ? ` (${card.detail})` : ''}
            {/each}
          {/each}
        </p>
      {/if}

      {#if grouped}
        {#each samples.filter((s) => s.deviations?.length) as s (s.id)}
          <p class="devs">
            <b>Deviations recorded at pathology for {s.label}:</b>
            {s.deviations?.join(' · ')}
          </p>
        {/each}
      {:else if sample?.deviations?.length}
        <p class="devs">
          <b>Deviations recorded at pathology:</b>
          {sample.deviations.join(' · ')}
        </p>
      {/if}
      <p class="foot">
        A card sits at the date its step was recorded, so anything stacked in a
        column happened at the same time. The three platforms run in parallel on
        three fractions of the one sample, which is why they share a column. The
        dashed bar behind a fraction runs from the day it was sent to the day its
        results came back, and the dot marks the return.
        {#if grouped}
          Each sample has its own block of rows, so every step and fraction sits
          with the sample it came from. A platform that analysed more than one of
          these samples appears in each of their blocks.
        {/if}

      </p>
    {/if}
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 60; background: rgba(8, 13, 22, .55);
           backdrop-filter: blur(2px); }
  .win {
    position: fixed; z-index: 61; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(1280px, calc(100vw - 56px)); max-height: calc(100vh - 72px);
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
    box-shadow: 0 26px 70px rgba(8, 13, 22, .45);
  }
  header { display: flex; align-items: flex-start; gap: 18px; padding: 15px 18px 13px;
           border-bottom: 1px solid var(--border); }
  .eyebrow { margin: 0 0 3px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
             text-transform: uppercase; color: var(--muted); }
  h2 { margin: 0; font-size: 17px; }
  h2 .qual { color: var(--muted); font-weight: 600; }
  .totals { margin-left: auto; display: flex; gap: 16px; align-items: baseline;
            font-size: 12px; color: var(--muted); flex: 0 1 auto; }
  .totals b { color: var(--ink); font-size: 14px; }
  .totals .slow, .totals .slow b { color: #b3401f; }
  .save { display: flex; gap: 5px; }
  .save button { border: 1px solid var(--border); background: #fff; border-radius: 7px;
                 padding: 5px 10px; font: inherit; font-size: 11.5px; font-weight: 700;
                 color: var(--muted); cursor: pointer; }
  .save button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .save button:disabled { cursor: progress; opacity: .5; }
  .x { border: 1px solid var(--border); background: #fff; border-radius: 8px;
       width: 28px; height: 28px; cursor: pointer; color: var(--muted); font: inherit; }
  .x:hover { color: var(--ink); }

  .scroll { overflow: auto; padding: 14px 18px 6px; }
  .chart { display: flex; align-items: flex-start; gap: 12px; }

  /* the row names stay put while the axis scrolls under them */
  .gutter { position: sticky; left: 0; z-index: 2; flex: 0 0 128px;
            background: var(--panel); }
  /* the same height and gap as .axis, so each name lines up with its band */
  .axislabel { height: 38px; margin-bottom: 10px; display: flex; align-items: flex-end;
               padding-bottom: 6px; font-size: 10px; font-weight: 700; letter-spacing: .06em;
               text-transform: uppercase; color: var(--muted); }
  .rowlabel { display: flex; align-items: center; gap: 6px; font-size: 12px;
              font-weight: 700; color: var(--ink); margin-bottom: 12px; }
  /* Every other row is shaded, name and band together. Without it the names read
     as a legend rather than as the labels of the rows beside them. The shadow's
     spread is half the 12px gap on every side, so the label's shading and the
     band's shading meet across the gutter and stack without seams. */
  .rowlabel:nth-child(even), .band:nth-child(even) {
    background: var(--bg); box-shadow: 0 0 0 6px var(--bg); }
  /* A block's name, and the rule across the plot level with it. Both are the
     same height, so the rows under them stay aligned with their bands. */
  .blockhead, .blockline { height: 24px; margin: 4px 0 8px; }
  .blockhead { display: flex; align-items: flex-end; padding-bottom: 3px;
               font-size: 11px; font-weight: 700; letter-spacing: .04em;
               text-transform: uppercase; color: var(--muted);
               border-bottom: 2px solid var(--border);
               /* the name may run on over the rule beside it rather than wrap */
               white-space: nowrap; overflow: visible; }
  .blockline { border-bottom: 2px solid var(--border); }
  .rowlabel.inblock { padding-left: 10px; }
  .rowlabel .swatch { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .rowlabel .n { margin-left: auto; color: var(--muted); font-weight: 600; font-size: 11px; }

  .plot { position: relative; flex: 0 0 auto; }
  /* A visible spine, not just a boundary. The events hang off this line, so it
     is drawn as a line rather than left implicit in the gap above the rows. */
  .axis { position: relative; height: 38px; margin-bottom: 10px;
          border-bottom: 2px solid #9aa8bd; }
  .tick { position: absolute; bottom: -4px; width: 2px; height: 10px;
          background: #9aa8bd; border-radius: 1px; }
  .tick span { position: absolute; bottom: 8px; left: 0; font-size: 10px;
               color: var(--muted); white-space: nowrap;
               font-family: ui-monospace, Menlo, monospace; }
  .tick span.mid { transform: translateX(-50%); }
  .tick span.end { transform: translateX(-100%); }
  .wait { position: absolute; top: 4px; height: 13px; border-radius: 7px;
          background: #fdece7; border: 1px solid #f3cfc3; }
  .wait span { position: absolute; inset: 0; display: grid; place-items: center;
               font-size: 9.5px; font-weight: 700; color: #b3401f; }

  .band { position: relative; margin-bottom: 12px; }
  /* one line per date dropped from the axis, so that a column reads as a column
     and every card is visibly tied to a point on the timeline */
  .grid { position: absolute; top: 0; bottom: 0; width: 1px;
          background: var(--border); opacity: .8; }
  /* drawn behind the cards, so only the stretch beyond the card shows — which
     is the part where the fraction was still away */
  .outbar { position: absolute; height: 6px; border-radius: 3px; z-index: 0;
            background: repeating-linear-gradient(90deg,
              #cfd8e3 0 6px, #e6ecf3 6px 12px); }
  .outbar .cap { position: absolute; right: -1px; top: -2px; width: 10px; height: 10px;
                 border-radius: 50%; background: #8ea0ba; }

  /* The card is as tall as its text. Nothing is clamped and nothing is cut off
     with an ellipsis: a card that hides what it says is not worth the space it
     takes. The row spacing is measured from the rendered heights instead. */
  .card { position: absolute; z-index: 1; width: 190px; min-height: 62px;
          display: flex; flex-direction: column;
          border: 1px solid var(--border); border-left: 3px solid var(--c);
          border-radius: 8px; padding: 7px 10px 8px; background: #fff; }
  .card.nodate { border-style: dashed; }
  .name { font-size: 12.5px; font-weight: 700; line-height: 1.25;
          overflow-wrap: anywhere; }
  .detail { font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 1.35; }
  .foot-row { margin-top: auto; padding-top: 4px; display: flex; align-items: center;
              flex-wrap: wrap; gap: 4px; }
  .when { font-size: 10px; color: var(--muted);
          font-family: ui-monospace, Menlo, monospace; }
  .flag { flex: 0 0 auto; font-size: 9.5px; font-weight: 700;
          padding: 1px 5px; border-radius: 4px; }
  .flag.bad { background: #fdece7; color: #b3401f; }
  /* NOT `.wait` — that is the axis gap bar, which is absolutely positioned at
     the top of its band. Sharing the name pulled this pill out of the card's
     bottom row and dropped it on top of the name. */
  .flag.pending { background: #eef1f4; color: #5b6570; }

  .notdated { margin: 0; padding: 8px 18px 2px; font-size: 12px; color: var(--muted);
              line-height: 1.5; }
  .notdated b { color: var(--ink); }
  .notdated .who { font-weight: 700; color: var(--ink); }
  .devs { margin: 0; padding: 6px 18px 8px; font-size: 12px; color: #b3401f; }
  .foot { margin: 0; padding: 0 18px 15px; font-size: 11.5px; color: var(--muted);
          line-height: 1.5; }
  .empty { padding: 26px 18px; color: var(--muted); }
</style>
