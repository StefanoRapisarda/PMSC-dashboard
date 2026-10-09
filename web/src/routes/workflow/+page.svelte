<script lang="ts">
  /* The sample journey — v3's custodian swimlane, rebuilt as a component.
     Each lane is a custodian, so you can see the handovers. Bars run left to
     right in the order the steps happen. Their widths are compressed durations,
     not positions on a time axis, so the axis carries no times at all, only the
     names of the milestones. The page shows the journey as planned. It reads no
     measured data, which belongs on the study dashboard. */
  import {
    LANES, PHASES, PLATFORM_LANES, STAGES,
    barWidth, cumulative, formatDuration, type Phase,
  } from '$lib/workflow';

  const AXIS_H = 44, LANE_H = 56, BAR_H = 30, GAP = 6;

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
    if (card?.contains(t) || t.closest('.wfbar, .pin')) return;
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
      /* the three platforms run side by side, so they share one width: the widest label's */
      const w = Math.max(...PLATFORM_LANES.map(([, label]) => barWidth(s.dur, label)));
      PLATFORM_LANES.forEach(([lane, label]) => out.push({ i, lane, x, w, label, dur: s.dur }));
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
    { x: barOf(step('Platform analysis')).x, name: 'Sent to platforms' },
    { x: barOf(step('Data analysis')).x, name: 'Data back' },
    { x: barOf(step('Molecular Tumor Board')).x, name: 'Tumour board' },
  ]);

  const allprep = step('AllPrep extraction') + 1;

</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && closeCard()}
               onpointerdown={onPointerDown} onresize={closeCard} />

<section class="view active">
  <div class="jrn">
    <div class="jhead">
      <div>
        <h2 style="margin:0">PreDDLung sample journey</h2>
        <p class="lede">Each row is a participant in the journey, meaning a department, a lab or
          a service provider that carries out one or more of its steps. The steps run from left
          to right in the order they happen. A bar grows with the time its step takes, but the scale is compressed
          so that short steps stay readable, which means distance along a row is not time.
          The durations under the bars are the planned times of each step, and they do not
          include waiting between steps. Click a step to see its details.</p>
      </div>
    </div>

    <!-- Two columns. The chart and the step's details share the wide left column,
         where the chart scrolls sideways. The legend and the totals sit beside them. -->
    <div class="jbody">
      <div class="jmain">
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

      {#if stage && selected != null}
      <div class="jdetail popcard" role="dialog" aria-label={stage.name} bind:this={card}
           style="top:{cardPos.top}px; left:{cardPos.left}px">
        <button class="popx" onclick={closeCard} aria-label="Close">×</button>
        <span class="phase" style="background:{PHASES[stage.phase][1]}">
          {PHASES[stage.phase][0]}</span>
        <h2>{selected + 1}. {stage.name}</h2>
        <div class="kv"><span class="k">Location</span><span class="v">{stage.loc || '—'}</span></div>
        <div class="kv"><span class="k">System</span><span class="v">{stage.system || '—'}</span></div>
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
  .lede { margin: 6px 0 12px; max-width: 900px; font-size: 13px; line-height: 1.55;
          color: var(--muted); }
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
