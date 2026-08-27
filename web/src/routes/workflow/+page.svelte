<script lang="ts">
  /* The sample journey — v3's custodian swimlane, rebuilt as a component.
     Bars are positioned along an elapsed-time axis; each lane is a custodian, so
     you can see the handovers as well as the durations. */
  import { api } from '$lib/api';
  import {
    LANES, PHASES, PLATFORM_LANES, STAGES, STAGE_LANE,
    barWidth, cumulative, formatDuration, type Phase,
  } from '$lib/workflow';
  import type { Overview } from '$lib/types';

  const AXIS_H = 44, LANE_H = 56, BAR_H = 30;

  let selected = $state(0);
  let overview = $state<Overview | null>(null);
  $effect(() => { api.overview().then((d) => (overview = d)).catch(() => {}); });

  const cum = cumulative();
  const total = cum[cum.length - 1];
  const handsOn = STAGES.filter((s) => s.phase !== 'analysis')
    .reduce((sum, s) => sum + s.dur, 0);

  const laneIndex = Object.fromEntries(LANES.map(([key], i) => [key, i]));

  interface Bar { i: number; lane: string; x: number; w: number; label: string; dur: number; }

  const bars = $derived.by(() => {
    const out: Bar[] = [];
    let x = 0;
    for (let i = 0; i <= 14; i++) {
      const w = barWidth(STAGES[i].dur);
      out.push({ i, lane: STAGE_LANE[i], x, w, label: STAGES[i].short, dur: STAGES[i].dur });
      x += w + 8;
    }
    const platformX = x, platformW = barWidth(STAGES[15].dur);
    PLATFORM_LANES.forEach(([lane, label]) =>
      out.push({ i: 15, lane, x: platformX, w: platformW, label, dur: STAGES[15].dur }));
    x += platformW + 8;
    const analysisW = barWidth(STAGES[16].dur);
    out.push({ i: 16, lane: 'mtb', x, w: analysisW, label: STAGES[16].short, dur: STAGES[16].dur });
    x += analysisW + 8;
    out.push({ i: 17, lane: 'mtb', x, w: barWidth(STAGES[17].dur),
               label: STAGES[17].short, dur: STAGES[17].dur });
    return out;
  });

  const width = $derived(Math.max(...bars.map((b) => b.x + b.w)) + 30);
  const barTop = (lane: string) => AXIS_H + laneIndex[lane] * LANE_H + 6;
  const stage = $derived(STAGES[selected]);

  /* stage counts, where the export can answer for that step */
  const reached = $derived.by(() => {
    if (!overview) return {} as Record<string, number>;
    const order = ['enrolled', 'collected', 'pathology', 'pmsc_prep', 'allprep',
                   'qc', 'submitted', 'data_back', 'mtb'];
    const counts = Object.fromEntries(
      overview.stage_distribution.map((s) => [s.stage, s.count]));
    const out: Record<string, number> = {};
    let running = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      running += counts[order[i]] ?? 0;
      out[order[i]] = running;
    }
    return out;
  });

  const STAGE_TO_KEY: Record<number, string> = {
    0: 'enrolled', 5: 'collected', 6: 'pathology', 7: 'pathology', 8: 'pathology',
    12: 'pmsc_prep', 13: 'allprep', 14: 'qc', 15: 'submitted', 16: 'data_back', 17: 'mtb',
  };
</script>

<section class="view active">
  <div class="jrn">
    <div class="jhead">
      <div><h2 style="margin:0">PreDDLung sample journey</h2></div>
    </div>

    <div id="jrail">
      <div class="swim">
        <div class="lanescol">
          <div class="sp"></div>
          {#each LANES as [, label]}<div class="lanelab" title={label}>{label}</div>{/each}
        </div>
        <div class="tlwrap">
          <div class="tl" style="width:{width}px; height:{AXIS_H + LANES.length * LANE_H}px">
            {#each [[bars[5].x, 'surgery · 0 h'],
                    [bars[14].x + bars[14].w, `≈${formatDuration(cum[14])} → to labs`],
                    [bars[15].x + bars[15].w, `≈${formatDuration(cum[15])}`],
                    [bars[bars.length - 1].x, `≈${formatDuration(total)} → MTB`]] as [x, label]}
              <div class="axtick" style="left:{x}px">{label}</div>
            {/each}

            {#each bars as bar}
              {@const phase = STAGES[bar.i].phase as Phase}
              <button class="wfbar" class:light={phase === 'decision'}
                      class:active={bar.i === selected}
                      style="left:{bar.x}px; top:{barTop(bar.lane)}px;
                             width:{bar.w}px; height:{BAR_H}px; background:{PHASES[phase][1]}"
                      onclick={() => (selected = bar.i)}
                      title="{STAGES[bar.i].name} · {formatDuration(bar.dur)}">
                <span class="bl">{bar.label}</span>
              </button>
              <div class="wfdur" style="left:{bar.x}px; top:{barTop(bar.lane) + BAR_H + 2}px;
                                        width:{bar.w}px">{formatDuration(bar.dur)}</div>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <div class="jbody">
      <div class="jdetail">
        <span class="phase" style="background:{PHASES[stage.phase][1]}">
          {PHASES[stage.phase][0]}</span>
        <h2>{selected + 1}. {stage.name}</h2>
        <div class="kv"><span class="k">Location</span><span class="v">{stage.loc || '—'}</span></div>
        <div class="kv"><span class="k">System</span><span class="v">{stage.system || '—'}</span></div>
        <div class="kv"><span class="k">Performed by</span><span class="v">{stage.actor || '—'}</span></div>
        <div class="kv"><span class="k">ID assigned</span><span class="v">{stage.id || '—'}</span></div>
        <div class="kv"><span class="k">Duration</span>
          <span class="v">{formatDuration(stage.dur)}{stage.durnote ? ` · ${stage.durnote}` : ''}</span></div>
        <div class="kv"><span class="k">Recorded in REDCap</span>
          <span class="v">
            {#if stage.field}<span class="mono">{stage.field}</span>
            {:else}<span style="color:var(--muted);font-weight:400">not captured</span>{/if}
          </span></div>
        {#if STAGE_TO_KEY[selected] && reached[STAGE_TO_KEY[selected]] != null}
          <div class="kv"><span class="k">Samples that reached here</span>
            <span class="v">{reached[STAGE_TO_KEY[selected]]}</span></div>
        {/if}
        <p class="desc">{stage.desc}</p>
        {#if stage.note}<div class="note">{stage.note}</div>{/if}
      </div>

      <div class="jside">
        <p class="panel-title">Phases</p>
        <div class="phases">
          {#each Object.entries(PHASES) as [, [label, colour]]}
            <div class="pl"><i style="background:{colour}"></i>{label}</div>
          {/each}
        </div>
        <p class="panel-title" style="margin-top:14px">Totals</p>
        <div class="tot"><span>Active handling</span><b>~{formatDuration(handsOn)}</b></div>
        <div class="tot"><span>Total elapsed</span><b>~{formatDuration(total)}</b></div>
        {#if overview}
          <div class="tot"><span>Measured, end to end</span>
            <b>{overview.turnaround.end_to_end.median_days} days</b></div>
          <p class="tnote">The first two are the process as described. The last is the median
            actually observed in the data — collection to tumour board.</p>
        {/if}
        <div class="branchbox"><b>After AllPrep (step 14)</b> the sample splits into
          <b>DNA</b>, <b>RNA</b> and <b>Protein</b> fractions that proceed in parallel; each is
          QC'd separately, and a failed RNA can trigger a repeat extraction.</div>
      </div>
    </div>
  </div>
</section>

<style>
  .wfbar { border: 0; font: inherit; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .kv { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0;
        border-bottom: 1px dashed var(--border); font-size: 13px; }
  .kv .k { color: var(--muted); }
  .kv .v { font-weight: 600; text-align: right; }
  .panel-title { font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
                 color: var(--muted); margin: 0 0 8px; }
</style>
