<script lang="ts">
  /* How the study has moved over time: four cumulative lines, one per milestone,
     counted at the end of each week. The gap between two lines is how far one
     stage lags behind the one before it.

     Weekly rather than daily, because about a hundred patients over twenty months
     is a few a week, and a daily chart would be mostly zeros. Cumulative rather
     than per week, because the question is how far the study has got, and a
     running total answers it directly. */
  import type { Progress } from '$lib/types';

  let { progress }: { progress: Progress } = $props();

  /* Validated with the dataviz palette checker against the white card: lightness,
     chroma, colour-blind separation and contrast all pass. Orange and purple are
     the colours the cohort flow already uses for collection and data back. */
  const SERIES = [
    { key: 'enrolled', label: 'Patients enrolled', colour: '#2563eb' },
    { key: 'collected', label: 'Samples collected', colour: '#e76f51' },
    { key: 'data_back', label: 'Samples with results back', colour: '#6a4c93' },
    { key: 'portal', label: 'Samples ordered in the MTB Portal', colour: '#2a9d8f' },
  ] as const;

  const W = 440, H = 230, L = 34, R = 44, T = 10, B = 26;
  const plotW = W - L - R, plotH = H - T - B;

  const n = $derived(progress.weeks.length);
  const top = $derived(Math.max(1, ...SERIES.map((s) => Math.max(...progress.series[s.key]))));
  /* a round top for the axis, so the gridlines land on readable numbers */
  const yMax = $derived(Math.ceil(top / 50) * 50);
  const x = (i: number) => L + (n > 1 ? (i / (n - 1)) * plotW : 0);
  const y = (v: number) => T + plotH - (v / yMax) * plotH;

  const path = (values: number[]) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const yTicks = $derived([0, yMax / 2, yMax]);

  /* one label per quarter, named by month and year */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const xTicks = $derived(progress.weeks.flatMap((w, i) => {
    const month = Number(w.slice(5, 7)) - 1;
    const before = i ? Number(progress.weeks[i - 1].slice(5, 7)) - 1 : -1;
    return month !== before && month % 3 === 0
      ? [{ x: x(i), label: `${MONTHS[month]} ${w.slice(2, 4)}` }] : [];
  }));

  /* The end labels, pushed apart where two lines finish close together. The
     last two finish four apart here, which on this scale is under a pixel. */
  const endLabels = $derived.by(() => {
    const items = SERIES.map((s) => {
      const v = progress.series[s.key][n - 1];
      return { ...s, v, y: y(v) };
    }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
    }
    return items;
  });

  /* the hover readout: the week under the pointer and every series at that week */
  let hover = $state<number | null>(null);
  function onMove(event: PointerEvent) {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - L) / plotW) * (n - 1));
    hover = i >= 0 && i < n ? i : null;
  }
  const weekLabel = (iso: string) => {
    const [yy, mm, dd] = iso.split('-');
    return `week of ${Number(dd)} ${MONTHS[Number(mm) - 1]} ${yy}`;
  };
</script>

<div class="legend">
  {#each SERIES as s}
    <span><i style="background:{s.colour}"></i>{s.label}</span>
  {/each}
</div>

<div class="wrap">
  <svg viewBox="0 0 {W} {H}" role="img"
       aria-label="Cumulative patients and samples reaching each milestone, by week"
       onpointermove={onMove} onpointerleave={() => (hover = null)}>
    {#each yTicks as t}
      <line class="grid" x1={L} x2={L + plotW} y1={y(t)} y2={y(t)} />
      <text class="axis" x={L - 6} y={y(t) + 3.5} text-anchor="end">{t}</text>
    {/each}
    {#each xTicks as t}
      <text class="axis" x={t.x} y={H - 8} text-anchor="middle">{t.label}</text>
    {/each}

    {#each SERIES as s}
      <path d={path(progress.series[s.key])} fill="none" stroke={s.colour}
            stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    {/each}

    {#each endLabels as e}
      <text class="end" x={L + plotW + 5} y={e.y + 3.5}>{e.v}</text>
    {/each}

    {#if hover !== null}
      <line class="cross" x1={x(hover)} x2={x(hover)} y1={T} y2={T + plotH} />
      {#each SERIES as s}
        <circle cx={x(hover)} cy={y(progress.series[s.key][hover])} r="3.5"
                fill={s.colour} stroke="#fff" stroke-width="1.5" />
      {/each}
    {/if}
  </svg>

  {#if hover !== null}
    <div class="readout" style="left:{(x(hover) / W) * 100}%"
         class:flip={x(hover) > W * 0.55}>
      <b>{weekLabel(progress.weeks[hover])}</b>
      {#each SERIES as s}
        <span><i style="background:{s.colour}"></i>{s.label}
          <em>{progress.series[s.key][hover]}</em></span>
      {/each}
    </div>
  {/if}
</div>

<p class="hint">Each line counts how many have reached that point by the end of each week.
  The first line counts patients, and the other three count samples, because one patient
  can give more than one sample. Hover over the chart to read the values for any week.</p>

<style>
  .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 6px 0 4px;
            font-size: 11.5px; color: var(--ink); }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend i, .readout i { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
  .wrap { position: relative; }
  svg { width: 100%; height: auto; display: block; touch-action: none; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .axis { font-size: 10px; fill: var(--muted); font-variant-numeric: tabular-nums; }
  .end { font-size: 10.5px; font-weight: 700; fill: var(--ink);
         font-variant-numeric: tabular-nums; }
  .cross { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
  /* not called .tip: the graph view owns a global .tip with light text for its
     dark canvas, which made this readout unreadable on the white card */
  .readout { position: absolute; color: var(--ink); top: 4px; transform: translateX(8px); z-index: 5;
         background: #fff; border: 1px solid var(--border); border-radius: 8px;
         box-shadow: 0 6px 18px rgba(20, 30, 40, .12); padding: 7px 9px;
         font-size: 11.5px; display: flex; flex-direction: column; gap: 3px;
         pointer-events: none; white-space: nowrap; }
  .readout.flip { transform: translateX(calc(-100% - 8px)); }
  .readout span { display: flex; align-items: center; gap: 6px; }
  .readout em { margin-left: auto; padding-left: 10px; font-style: normal; font-weight: 700;
            font-variant-numeric: tabular-nums; }
</style>
