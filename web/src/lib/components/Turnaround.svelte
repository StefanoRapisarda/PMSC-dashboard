<script lang="ts">
  /* Time to tumour board — how long a sample takes from surgery to the molecular
     tumour board, and where that time is spent.

     This is a headline endpoint for a feasibility study of this kind — the trial
     family reports "median time to molecular tumour board" as a result in its own
     right — so the card leads with the end-to-end figure rather than burying it
     under a list of steps.

     Time is grouped by the three phases laboratory medicine already uses for
     turnaround — pre-analytical, analytical, post-analytical. That is the
     conventional vocabulary, it maps cleanly onto these steps, and it keeps the
     distinction that matters: the analytical phase belongs to the platforms,
     the other two are handled in house.

     Two things it is careful about, because the previous version was not:
       * The three platforms run in parallel on three fractions of one specimen.
         They are ONE segment of the path, measured per specimen from first
         dispatch to last result; the individual platforms sit inside it rather
         than as peers of the sequential steps, so nothing invites adding them up.
       * A week in a freezer is not hands-on work, but it is still pre-analytical
         time handled in house — which is the distinction that leads to a
         decision, and the one "hands-on" obscured. */
  import type { Overview } from '$lib/types';

  let { turnaround }: { turnaround: Overview['turnaround'] } = $props();

  const PHASE: Record<string, string> = {
    pre_analytical: 'var(--accent)',
    analytical: '#6a4c93',
    post_analytical: '#c98a5e',
  };

  const total = $derived(
    turnaround.segments.reduce((sum, s) => sum + (s.median_days ?? 0), 0) || 1);

  /* the longest step handled in house — the one that can actually be acted on */
  const biggestInHouse = $derived.by(() => {
    const inHouse = turnaround.segments.filter((s) => s.owner === 'lab');
    return inHouse.reduce((a, b) => ((b.median_days ?? 0) > (a.median_days ?? 0) ? b : a),
                          inHouse[0]);
  });

  const days = (n: number | null) => `${n} ${n === 1 ? 'day' : 'days'}`;

  const measurable = $derived(turnaround.platforms.filter((p) => p.median_days != null));
  const unmeasurable = $derived(turnaround.platforms.filter((p) => p.median_days == null));
</script>

<div class="head">
  <div>
    <div class="big">{turnaround.end_to_end.median_days}<small>&nbsp;{
      turnaround.end_to_end.median_days === 1 ? 'day' : 'days'}</small></div>
    <div class="sub">
      median of {turnaround.end_to_end.n} samples ·
      <span title="90th percentile: nine in ten samples took this long or less.
The median says what is typical; this says how bad the slow tail gets.">9 in 10 within
        <b>{days(turnaround.end_to_end.p90_days)}</b> <span class="term">(p90)</span></span>
    </div>
  </div>
  <div class="split">
    {#each turnaround.phases as phase}
      <span>
        <i style="background:{PHASE[phase.key]}"></i>
        {phase.label}<span class="where">· {phase.where}</span>
        <b>{days(phase.days)}</b>
      </span>
    {/each}
  </div>
</div>

<p class="finding">
  Longest step handled in house: <b>{biggestInHouse.label}</b> —
  {days(biggestInHouse.median_days)} typically, and 9 in 10 within
  {days(biggestInHouse.p90_days)}.
</p>

<!-- the path itself: width is time, so the bottleneck is visible rather than arithmetic -->
<div class="strip" role="img"
     aria-label="Time from surgery to tumour board, split by who controls each step">
  {#each turnaround.segments as segment}
    {@const share = ((segment.median_days ?? 0) / total) * 100}
    {#if share > 0}
      <span class="seg" class:parallel={segment.parallel}
            style="width:{share}%; background:{PHASE[segment.phase]}"
            title="{segment.label} · median {segment.median_days} d · p90 {segment.p90_days} · n={segment.n}">
        {#if share > 11}<b>{days(segment.median_days)}</b>{/if}
      </span>
    {/if}
  {/each}
</div>

<div class="rows">
  {#each turnaround.segments as segment}
    {@const share = ((segment.median_days ?? 0) / total) * 100}
    <div class="row" class:flag={segment === biggestInHouse}>
      <span class="name">
        {segment.label}
        {#if segment.parallel}<span class="tag">parallel</span>{/if}

      </span>
      <span class="track">
        {#if (segment.median_days ?? 0) > 0}
          <span class="fill" style="width:{share}%; background:{PHASE[segment.phase]}"></span>
        {:else}
          <span class="sameday">same day</span>
        {/if}
      </span>
      <span class="days">{segment.median_days}<span class="unit">&nbsp;{
        segment.median_days === 1 ? 'day' : 'days'}</span></span>
      <span class="meta"
            title="90th percentile: nine in ten took {segment.p90_days} days or less. Measured on {segment.n} samples.">
        p90 {segment.p90_days} · n={segment.n}</span>
    </div>

    {#if segment.parallel}
      <div class="inside">
        {#each measurable as platform}
          <span>{platform.name.split(',')[0]} <b>{days(platform.median_days)}</b></span>
        {/each}
        {#each unmeasurable as platform}
          <span class="muted">{platform.name.split(',')[0]} — {platform.note}</span>
        {/each}
      </div>
    {/if}
  {/each}
</div>

<p class="hint" style="margin-top:10px">
  {turnaround.note} The three platforms work at the same time, so their segment is measured
  per sample from the first dispatch to the last result — the actual critical path, not
  three waits added together.
</p>

<style>
  .head { display: flex; align-items: flex-end; justify-content: space-between;
          gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .big { font-size: 30px; font-weight: 800; letter-spacing: -.02em; line-height: 1; }
  .big small { font-size: 15px; font-weight: 700; color: var(--muted); margin-left: 2px; }
  .sub { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .split { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px;
           color: var(--muted); }
  .split .where { margin: 0 6px 0 4px; color: #9aa2ab; font-size: 11.5px; }
  .split span { display: flex; align-items: center; gap: 6px; }
  .split b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .split i { width: 10px; height: 10px; border-radius: 3px; }

  .strip { display: flex; height: 26px; border-radius: 6px; overflow: hidden;
           background: #eef1f4; margin-bottom: 14px; }
  .seg { display: flex; align-items: center; justify-content: center; color: #fff;
         font-size: 11px; }
  .seg + .seg { border-left: 1px solid rgba(255, 255, 255, .55); }
  /* the parallel block is drawn as three lanes, so it does not read as one queue */
  .seg.parallel { background-image: repeating-linear-gradient(
      0deg, rgba(255,255,255,.22) 0 1px, transparent 1px 8px); }

  .rows { display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 3px 0; }
  .name { flex: 0 0 auto; width: 178px; color: var(--ink); }
  .track { flex: 1 1 auto; min-width: 0; height: 12px; background: #f2f4f6;
           border-radius: 3px; position: relative; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
  .sameday { position: absolute; left: 4px; top: -3px; font-size: 10.5px; color: var(--muted); }
  .days { flex: 0 0 auto; width: 74px; text-align: right; font-weight: 700;
          font-variant-numeric: tabular-nums; }
  .days .unit { font-weight: 400; color: var(--muted); font-size: 11.5px; }
  .meta { flex: 0 0 auto; width: 96px; text-align: right; color: var(--muted);
          font-size: 11.5px; font-variant-numeric: tabular-nums; cursor: help; }
  .sub .term { color: #9aa2ab; font-size: 11px; }
  .sub b { color: var(--ink); }

  .tag { font-size: 10px; font-weight: 700; text-transform: uppercase;
         letter-spacing: .04em; color: #6a4c93; background: #efeaf6;
         border-radius: 8px; padding: 1px 6px; margin-left: 5px; }
  .row.flag .name { font-weight: 700; }
  .finding { margin: 0 0 12px; font-size: 12.5px; color: #b3401f;
             background: #fdece7; border-radius: 8px; padding: 7px 11px; }

  .inside { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 11.5px;
            color: var(--muted); padding: 2px 0 6px 188px; }
  .inside .muted { color: #9aa2ab; }
</style>
