<script lang="ts">
  /* The sample journey — v3's custodian swimlane, rebuilt as a component.
     Each lane is a custodian, so you can see the handovers. Bars run left to
     right in the order the steps happen. Their widths are compressed durations,
     not positions on a time axis, so the axis carries no times at all, only the
     names of the milestones. The page shows the journey as planned. It reads no
     measured data, which belongs on the study dashboard. */
  import {
    LANES, PHASES, ANALYSIS_LAB_LANES, STAGES,
    barWidth, cumulative, formatDuration, type Phase,
  } from '$lib/workflow';
  import HowToRead, { type KeyItem } from '$lib/components/HowToRead.svelte';

  const AXIS_H = 44, LANE_H = 56, BAR_H = 30, GAP = 6;

  /* The journey can be drawn two ways, and the tabs under the heading switch
     between them. The swimlane is the original chart. The metro view is new. */
  const VIEWS = [['metro', 'Metro view'], ['swimlane', 'Swimlane view']] as const;
  let view = $state<'swimlane' | 'metro'>('metro');

  /* Each view's key: a drawing of one chart element and one short sentence about it. */
  const KEYS: Record<'swimlane' | 'metro', KeyItem[]> = {
    metro: [
      { glyph: 'stop', text: 'Each stop is a step.' },
      { glyph: 'ring', text: 'Rings mark key moments.' },
      { glyph: 'fork', text: 'The sample splits into DNA, RNA and protein.' },
      { glyph: 'time', text: 'Times are planned, without waiting.' },
      { glyph: 'click', text: 'Click a stop for details.' },
    ],
    swimlane: [
      { glyph: 'lane', text: 'Each row is a team or lab.' },
      { glyph: 'bar', text: 'Longer bars take longer, but not to scale.' },
      { glyph: 'pin', text: 'A pin is a moment.' },
      { glyph: 'time', text: 'Times are planned, without waiting.' },
      { glyph: 'click', text: 'Click a step for details.' },
    ],
  };

  /* The step whose card is open, and where on screen its bar is. The card floats
     above the page rather than sitting inside the chart, because the chart scrolls
     sideways and would clip it. */
  let selected = $state<number | null>(null);
  let anchor = $state<DOMRect | null>(null);
  let card = $state<HTMLElement | null>(null);
  let cardPos = $state({ top: 0, left: 0 });

  function openCard(i: number, e: MouseEvent) {
    if (selected === i) { closeCard(); return; }
    selected = i;
    anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }
  function closeCard() { selected = null; anchor = null; }

  /* Below the step when it fits, above it when it does not, and never off screen. */
  $effect(() => {
    if (!card || !anchor) return;
    const h = card.offsetHeight, w = card.offsetWidth;
    let top = anchor.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, anchor.top - h - 8);
    const left = Math.min(Math.max(8, anchor.left), innerWidth - w - 8);
    cardPos = { top, left };
  });

  /* A scroll anywhere moves the step away from its card, so the card closes.
     Scroll events do not bubble, hence the capturing listener. */
  $effect(() => {
    if (selected == null) return;
    const onScroll = (e: Event) => { if (!card?.contains(e.target as Node)) closeCard(); };
    addEventListener('scroll', onScroll, true);
    return () => removeEventListener('scroll', onScroll, true);
  });

  function onPointerDown(e: PointerEvent) {
    if (selected == null) return;
    const t = e.target as Element;
    if (card?.contains(t) || t.closest('.wfbar, .pin, .stop')) return;
    closeCard();
  }

  const cum = cumulative();
  const total = cum[cum.length - 1];
  const handsOn = STAGES.filter((s) => s.phase !== 'analysis')
    .reduce((sum, s) => sum + s.dur, 0);

  const laneIndex = Object.fromEntries(LANES.map(([key], i) => [key, i]));

  interface Bar { i: number; lane: string; x: number; w: number; label: string; dur: number;
                  event?: boolean; }

  /* Steps are found by name, not by position, so adding a step cannot quietly
     point a milestone or a note at the wrong one. */
  const step = (name: string) => {
    const i = STAGES.findIndex((s) => s.name === name);
    if (i < 0) throw new Error(`no workflow step named ${name}`);
    return i;
  };

  const bars = $derived.by(() => {
    const out: Bar[] = [];
    let x = 0;
    STAGES.forEach((s, i) => {
      if (s.lane) {
        /* a pin's dot is centred on its stem, so it needs clearance on the left
           as well as room for its label on the right */
        if (s.event) x += 10;
        const w = barWidth(s.dur, s.short) + (s.event ? 4 : 0);
        out.push({ i, lane: s.lane, x, w, label: s.short, dur: s.dur, event: s.event });
        x += w + GAP;
        return;
      }
      /* the three analysis labs run side by side, so they share one width: the widest label's */
      const w = Math.max(...ANALYSIS_LAB_LANES.map(([, label]) => barWidth(s.dur, label)));
      ANALYSIS_LAB_LANES.forEach(([lane, label]) => out.push({ i, lane, x, w, label, dur: s.dur }));
      x += w + GAP;
    });
    return out;
  });

  const width = $derived(Math.max(...bars.map((b) => b.x + b.w)) + 70);
  const barTop = (lane: string) => AXIS_H + laneIndex[lane] * LANE_H + 6;
  const barOf = (i: number) => bars.find((b) => b.i === i)!;
  const stage = $derived(selected == null ? null : STAGES[selected]);

  /* The milestones that the grid hangs from, each standing at its step. */
  const milestones = $derived([
    { x: barOf(step('Surgery')).x, name: 'Surgery' },
    { x: barOf(step('Withdraw for prep (UTTAG)')).x, name: 'Prep starts' },
    { x: barOf(step('Analysis at the labs')).x, name: 'Sent to analysis labs' },
    { x: barOf(step('Data analysis')).x, name: 'Data back' },
    { x: barOf(step('Order in the MTB Portal')).x, name: 'MTB Portal' },
  ]);

  const allprep = step('AllPrep extraction') + 1;

  /* The metro map. One line runs through every step up to co-extraction. There it
     splits into a DNA, an RNA and a protein line, because the three fractions are
     checked and analysed in parallel, and the lines meet again at data analysis.
     Stops are evenly spaced, so as in the swimlane, distance along a line is not
     time. The time is written on the line instead.

     The line is folded into three rows so that the whole journey fits in the box
     without scrolling. The first row runs left to right and ends at pathology, the
     second runs back from right to left, and the third holds the split and the
     merge. The drawing is scaled to the width of the box. */
  const METRO_W = 1200, METRO_H = 510, FORK = 60;
  const Y1 = 70, Y2 = 210, Y3 = 400, X_LEFT = 80, X_RIGHT = 1060;

  interface Stop { i: number; x: number; y: number; label: string; big: boolean;
                   above: boolean; anchor: 'start' | 'middle' | 'end'; }
  interface Segment { d: string; colour: string; dur: number; mx: number; my: number; }

  const split = step('AllPrep extraction'), qc = step('Concentration & QC');
  const labs = step('Analysis at the labs'), merge = step('Data analysis');
  const firstRowEnd = step('Pathology — cut & rack');
  const last = STAGES.length - 1;

  /* The three lab stops take their names from the analysis lab rows of the swimlane. */
  const FRACTIONS = [
    { name: 'DNA', dy: -FORK, lab: ANALYSIS_LAB_LANES[0][1] },
    { name: 'RNA', dy: 0, lab: ANALYSIS_LAB_LANES[1][1] },
    { name: 'protein', dy: FORK, lab: ANALYSIS_LAB_LANES[2][1] },
  ];

  /* Each of the first two rows spreads its stops across the full width. The
     second row starts under the first row's last stop and stops short of the
     left bend. */
  const X_ROW2_END = 260;
  const DX1 = (X_RIGHT - X_LEFT) / firstRowEnd;
  const DX2 = (X_RIGHT - X_ROW2_END) / (split - firstRowEnd - 2);
  const trunkAt = (i: number) => i <= firstRowEnd
    ? { x: X_LEFT + i * DX1, y: Y1 }
    : { x: X_RIGHT - (i - firstRowEnd - 1) * DX2, y: Y2 };

  const xSplit = 230, xQc = 420, xLab = 620, xMerge = 860, xEnd = 1000;
  const colourOf = (i: number) => PHASES[STAGES[i].phase][1];

  const stops: Stop[] = [
    ...STAGES.slice(0, split).map((s, i): Stop => ({
      i, ...trunkAt(i), label: s.short, big: !!s.event,
      above: i % 2 === 0, anchor: 'middle',
    })),
    { i: split, x: xSplit, y: Y3, label: STAGES[split].short, big: true,
      above: true, anchor: 'end' },
    ...FRACTIONS.flatMap((f): Stop[] => [
      { i: qc, x: xQc, y: Y3 + f.dy, label: `Check ${f.name}`, big: false,
        above: f.dy < 0, anchor: 'middle' },
      { i: labs, x: xLab, y: Y3 + f.dy, label: f.lab, big: false,
        above: f.dy < 0, anchor: 'middle' },
    ]),
    { i: merge, x: xMerge, y: Y3, label: STAGES[merge].short, big: true,
      above: true, anchor: 'start' },
    { i: last, x: xEnd, y: Y3, label: STAGES[last].short, big: true,
      above: false, anchor: 'middle' },
  ];

  /* A stretch between two stops on the same row is straight. The two stretches
     that change row are drawn as half-circle bends, on the right and then on the
     left, and their time label sits at the outermost point of the bend. */
  function trunkSegment(i: number): Segment {
    const a = trunkAt(i);
    const b = i + 1 === split ? { x: xSplit, y: Y3 } : trunkAt(i + 1);
    const base = { colour: colourOf(i + 1), dur: STAGES[i].dur };
    if (a.y === b.y) return { ...base, d: `M${a.x},${a.y} H${b.x}`,
                              mx: (a.x + b.x) / 2, my: a.y };
    const r = (b.y - a.y) / 2;
    if (i === firstRowEnd) {
      const xr = X_RIGHT + 40;
      return { ...base, d: `M${a.x},${a.y} H${xr} A${r},${r} 0 0 1 ${xr},${b.y} H${b.x}`,
               mx: xr + r, my: a.y + r };
    }
    const xl = 160;
    return { ...base, d: `M${a.x},${a.y} H${xl} A${r},${r} 0 0 0 ${xl},${b.y} H${b.x}`,
             mx: xl - r, my: a.y + r };
  }

  const segments: Segment[] = [
    ...STAGES.slice(0, split).map((_, i) => trunkSegment(i)),
    /* Each branch leaves the fork on a diagonal and rejoins it on another. */
    ...FRACTIONS.flatMap(({ dy }): Segment[] => [
      { d: `M${xSplit},${Y3} L${xSplit + Math.abs(dy)},${Y3 + dy} H${xQc}`,
        colour: colourOf(qc), dur: STAGES[split].dur,
        mx: (xSplit + FORK + xQc) / 2, my: Y3 + dy },
      { d: `M${xQc},${Y3 + dy} H${xLab}`, colour: colourOf(labs), dur: STAGES[qc].dur,
        mx: (xQc + xLab) / 2, my: Y3 + dy },
      { d: `M${xLab},${Y3 + dy} H${xMerge - Math.abs(dy)} L${xMerge},${Y3}`,
        colour: colourOf(merge), dur: STAGES[labs].dur,
        mx: (xLab + xMerge - FORK) / 2, my: Y3 + dy },
    ]),
    { d: `M${xMerge},${Y3} H${xEnd}`, colour: colourOf(last), dur: STAGES[merge].dur,
      mx: (xMerge + xEnd) / 2, my: Y3 },
  ];

</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && closeCard()}
               onpointerdown={onPointerDown} onresize={closeCard} />

<section class="view active">
  <div class="jrn">
    <div class="jhead">
      <div>
        <h2 style="margin:0">PreDDLung sample journey</h2>
        <div class="viewtabs" role="tablist" aria-label="How the journey is drawn">
          {#each VIEWS as [key, label]}
            <button role="tab" aria-selected={view === key} class:active={view === key}
                    onclick={() => { closeCard(); view = key; }}>{label}</button>
          {/each}
        </div>
        <HowToRead items={KEYS[view]} />
      </div>
    </div>

    <!-- Two columns. The chart and the step's details share the wide left column,
         where the chart scrolls sideways. The legend and the totals sit beside them. -->
    <div class="jbody">
      <div class="jmain">
    {#if view === 'metro'}
    <div class="metrowrap">
      <svg viewBox="0 0 {METRO_W} {METRO_H}" role="group" aria-label="The journey as a metro map">
        {#each segments as seg}
          <path d={seg.d} stroke={seg.colour} class="track" />
        {/each}
        {#each segments.filter((s) => s.dur > 0) as seg}
          {@const text = formatDuration(seg.dur)}
          {@const w = text.length * 6.4 + 12}
          <g class="dur" transform="translate({seg.mx},{seg.my})">
            <rect x={-w / 2} y="-9" width={w} height="18" rx="9" stroke={seg.colour} />
            <text y="4">{text}</text>
          </g>
        {/each}
        {#each stops as stop}
          <g class="stop" class:active={stop.i === selected} role="button" tabindex="0"
             aria-label={STAGES[stop.i].name}
             onclick={(e) => openCard(stop.i, e)}
             onkeydown={(e) => (e.key === 'Enter' || e.key === ' ')
               && openCard(stop.i, e as unknown as MouseEvent)}>
            <title>{STAGES[stop.i].name}</title>
            <circle cx={stop.x} cy={stop.y} r={stop.big ? 10 : 6}
                    stroke-width={stop.big ? 3 : 2.5} />
            <text x={stop.x + (stop.anchor === 'start' ? 14 : stop.anchor === 'end' ? -14 : 0)}
                  y={stop.y + (stop.above ? -18 : 26)} text-anchor={stop.anchor}
                  class:big={stop.big}>{stop.label}</text>
          </g>
        {/each}
      </svg>
    </div>
    {:else}
    <div id="jrail">
      <div class="swim">
        <div class="lanescol">
          <div class="sp" style="height:{AXIS_H}px"></div>
          {#each LANES as [, label]}<div class="lanelab" title={label}>{label}</div>{/each}
        </div>
        <div class="tlwrap">
          <div class="tl" style="width:{width}px; height:{AXIS_H + LANES.length * LANE_H}px">
            <!-- The grid. A dashed line runs down from each milestone through every
                 row, and the stretch between two milestones is shaded in alternate
                 bands, so a step can be read as falling between two milestones.
                 There are no evenly spaced time lines, because the bars are not
                 drawn to a time scale. -->
            {#each milestones as m, k}
              {#if k < milestones.length - 1 && k % 2 === 0}
                <div class="band" style="left:{m.x}px; width:{milestones[k + 1].x - m.x}px;
                                         top:{AXIS_H}px; height:{LANES.length * LANE_H}px"></div>
              {/if}
              <div class="vline" style="left:{m.x}px; top:{AXIS_H - 4}px;
                                        height:{LANES.length * LANE_H + 4}px"></div>
            {/each}
            {#each LANES as _, k}
              <div class="hline" style="top:{AXIS_H + k * LANE_H}px"></div>
            {/each}

            {#each milestones as m}
              <div class="axtick ms" style="left:{m.x}px">{m.name}</div>
            {/each}

            {#each bars as bar}
              {@const phase = STAGES[bar.i].phase as Phase}
              {#if bar.event}
              <!-- An event is a moment, so it is a pin rather than a bar: a stem
                   standing where the event happens, a dot level with the bars,
                   and the name beside it as plain text. -->
              <button class="pin" class:active={bar.i === selected}
                      style="left:{bar.x}px; top:{AXIS_H + laneIndex[bar.lane] * LANE_H}px;
                             width:{bar.w}px; height:{LANE_H}px; --c:{PHASES[phase][1]}"
                      onclick={(e) => openCard(bar.i, e)} title={STAGES[bar.i].name}>
                <span class="stem"></span><span class="dot"></span>
                <span class="plabel">{bar.label}</span>
              </button>
              {:else}
              <button class="wfbar" class:light={phase === 'decision'}
                      class:active={bar.i === selected}
                      style="left:{bar.x}px; top:{barTop(bar.lane)}px;
                             width:{bar.w}px; height:{BAR_H}px; background:{PHASES[phase][1]}"
                      onclick={(e) => openCard(bar.i, e)}
                      title="{STAGES[bar.i].name} · {formatDuration(bar.dur)}">
                <span class="bl">{bar.label}</span>
              </button>
              <div class="wfdur" style="left:{bar.x}px; top:{barTop(bar.lane) + BAR_H + 2}px;
                                        width:{bar.w}px">{formatDuration(bar.dur)}</div>
              {/if}
            {/each}
          </div>
        </div>
      </div>
    </div>
    {/if}

      {#if stage && selected != null}
      <div class="jdetail popcard" role="dialog" aria-label={stage.name} bind:this={card}
           style="top:{cardPos.top}px; left:{cardPos.left}px">
        <button class="popx" onclick={closeCard} aria-label="Close">×</button>
        <span class="phase" style="background:{PHASES[stage.phase][1]}">
          {PHASES[stage.phase][0]}</span>
        <h2>{selected + 1}. {stage.name}</h2>
        <div class="kv"><span class="k">Location</span><span class="v">{stage.loc || '—'}</span></div>
        <div class="kv"><span class="k">Information system</span><span class="v">{stage.system || '—'}</span></div>
        <div class="kv"><span class="k">Performed by</span><span class="v">{stage.actor || '—'}</span></div>
        <div class="kv"><span class="k">ID assigned</span><span class="v">{stage.id || '—'}</span></div>
        <div class="kv"><span class="k">Planned time</span>
          <span class="v">{stage.dur <= 0 && stage.durnote ? stage.durnote
            : `${formatDuration(stage.dur)}${stage.durnote ? ` · ${stage.durnote}` : ''}`}</span></div>
        <div class="kv"><span class="k">Recorded in REDCap</span>
          <span class="v">
            {#if stage.field}<span class="mono">{stage.field}</span>
            {:else}<span style="color:var(--muted);font-weight:400">not captured</span>{/if}
          </span></div>
        <p class="desc">{stage.desc}</p>
        {#if stage.note}<div class="note">{stage.note}</div>{/if}
      </div>
      {/if}
      </div>

      <div class="jside">
        <p class="panel-title">Colour shows the phase</p>
        <div class="phases">
          {#each Object.entries(PHASES) as [, [label, colour]]}
            <div class="pl"><i style="background:{colour}"></i>{label}</div>
          {/each}
        </div>

        <p class="panel-title" style="margin-top:14px">Totals</p>
        <div class="tot"><span>Hands-on work</span><b>~{formatDuration(handsOn)}</b></div>
        <div class="tot"><span>All steps, end to end</span><b>~{formatDuration(total)}</b></div>
        <p class="tnote">Both figures add up the planned time of each step. Neither includes
          time spent waiting between steps.</p>

        <div class="branchbox">After AllPrep, which is step {allprep}, the sample splits into DNA,
          RNA and protein fractions that proceed in parallel. Each fraction is checked
          separately, and a failed RNA check can trigger a repeat extraction.</div>
      </div>
    </div>
  </div>
</section>

<style>
  .viewtabs { display: flex; gap: 4px; margin: 10px 0 2px; }
  .viewtabs button { border: 1px solid var(--border); background: #fff; font: inherit;
                     font-size: 13px; padding: 6px 14px; border-radius: 8px; cursor: pointer;
                     color: var(--ink); }
  .viewtabs button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .metrowrap { background: #fff; border: 1px solid var(--border);
               border-radius: 12px; }
  .metrowrap svg { display: block; width: 100%; height: auto; }
  .track { fill: none; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
  .dur rect { fill: #fff; stroke-width: 1.5; }
  .dur text { font-size: 11px; font-weight: 600; fill: var(--muted); text-anchor: middle; }
  .stop { cursor: pointer; outline: none; }
  .stop circle { fill: #fff; stroke: #22303b; }
  .stop text { font-size: 12px; font-weight: 600; fill: var(--ink); }
  .stop text.big { font-size: 13px; font-weight: 800; }
  .stop:hover text, .stop:focus-visible text, .stop.active text { text-decoration: underline; }
  .stop.active circle, .stop:focus-visible circle { stroke: var(--accent); stroke-width: 4; }
  .wfbar { border: 0; font: inherit; }
  .pin { position: absolute; border: 0; padding: 0; background: none; cursor: pointer;
         font: inherit; z-index: 1; }
  .pin .stem { position: absolute; left: -1px; top: 4px; bottom: 4px; width: 2px;
               background: var(--c); opacity: .55; }
  .pin .dot { position: absolute; left: -7px; top: 14px; width: 14px; height: 14px;
              border-radius: 50%; background: var(--c); box-sizing: border-box;
              border: 2px solid #fff; box-shadow: 0 0 0 1px var(--c); }
  .pin .plabel { position: absolute; left: 12px; top: 13px; font-size: 12px; font-weight: 700;
                 color: var(--ink); white-space: nowrap; line-height: 16px; }
  .pin:hover .plabel { text-decoration: underline; }
  .pin.active .dot { box-shadow: 0 0 0 2px #22303b; }
  .pin.active .plabel { text-decoration: underline; }
  .popcard { position: fixed; z-index: 50; width: 400px; max-width: calc(100vw - 16px);
             max-height: calc(100vh - 16px); overflow: auto; box-sizing: border-box;
             box-shadow: 0 14px 36px rgba(20, 30, 40, .22); }
  .popx { position: absolute; top: 8px; right: 10px; border: 0; background: none;
          font-size: 22px; line-height: 1; color: var(--muted); cursor: pointer; padding: 2px 6px; }
  .popx:hover { color: var(--ink); }
  .jbody { align-items: start; margin-top: 0; }
  .jmain { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .kv { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0;
        border-bottom: 1px dashed var(--border); font-size: 13px; }
  .kv .k { color: var(--muted); }
  .kv .v { font-weight: 600; text-align: right; }
  .tot span { padding-right: 10px; }
  .tot b { white-space: nowrap; }
  .band { position: absolute; background: rgba(42, 157, 143, .06); z-index: 0;
          pointer-events: none; }
  .vline { position: absolute; width: 0; border-left: 1px dashed #b9c3cc; z-index: 0;
           pointer-events: none; }
  .hline { position: absolute; left: 0; right: 0; height: 0;
           border-top: 1px solid var(--border); z-index: 0; pointer-events: none; }
  .ms { text-align: center; }
  .panel-title { font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
                 color: var(--muted); margin: 0 0 8px; }
</style>
