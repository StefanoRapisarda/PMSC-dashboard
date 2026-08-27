<script lang="ts">
  /* What the cohort is made of, by sample type.

     A donut is a weak chart for comparing magnitudes, but this is a
     part-of-a-whole question with four categories, which is the one job it does
     well. Counts sit on the legend so nothing has to be judged by angle.

     It carries the aliquot count as well as the specimen count, because the two
     can disagree sharply: a type can be a large part of the cohort and
     contribute almost no downstream material. The legend shows both and leaves
     the reading to the reader.

     Drawn as dashed strokes on a circular path rather than as wedge geometry:
     that gives an even ring, rounded ends and clean gaps between slices for
     free, and it animates by moving a dash offset. */
  import type { Overview } from '$lib/types';

  let { types }: { types: Overview['sample_types'] } = $props();

  const COLOURS: Record<string, string> = {
    FFPE: '#457b9d', Tissue: '#2a9d8f', Biopsy: '#e9c46a',
    Blood: '#e76f51', unknown: '#94a7bd',
  };
  const colour = (type: string) => COLOURS[type] ?? '#94a7bd';

  /** a lighter tint of the same hue, for the gradient that gives the ring depth */
  function lighten(hex: string, amount = 0.32) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
  }

  const SIZE = 210, C = SIZE / 2, R = 78, W = 26, GAP = 5;
  const CIRC = 2 * Math.PI * R;
  /* a circle written as a path, so the slices are dashes along it */
  const RING = `M ${C} ${C - R} a ${R} ${R} 0 1 1 0 ${2 * R} a ${R} ${R} 0 1 1 0 ${-2 * R}`;

  const total = $derived(types.reduce((sum, t) => sum + t.specimens, 0));

  let hovered = $state<string | null>(null);
  let drawn = $state(false);
  $effect(() => { const id = setTimeout(() => (drawn = true), 60); return () => clearTimeout(id); });

  const slices = $derived.by(() => {
    let offset = 0;
    return types.map((t) => {
      const full = (t.specimens / (total || 1)) * CIRC;
      /* leave a gap, but never let it eat a small slice entirely */
      const length = Math.max(full * 0.35, full - GAP);
      const slice = { ...t, colour: colour(t.type), light: lighten(colour(t.type)),
                      length, offset: -offset };
      offset += full;
      return slice;
    });
  });

  const focus = $derived(hovered ? types.find((t) => t.type === hovered) ?? null : null);

</script>

<div class="wrap">
  <svg viewBox="0 0 {SIZE} {SIZE}" class="donut" role="img"
       aria-label="Samples by type">
    <defs>
      {#each slices as slice}
        <linearGradient id="g-{slice.type}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={slice.light} />
          <stop offset="100%" stop-color={slice.colour} />
        </linearGradient>
      {/each}
      <filter id="ringshadow" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#16233b" flood-opacity="0.16" />
      </filter>
    </defs>

    <!-- the track the slices sit on, so a partial ring still reads as a whole -->
    <path d={RING} fill="none" stroke="#eef1f4" stroke-width={W} />

    <g filter="url(#ringshadow)">
      {#each slices as slice}
        <path class="slice" d={RING} fill="none" stroke="url(#g-{slice.type})"
              stroke-width={hovered === slice.type ? W + 7 : W}
              stroke-linecap="round"
              stroke-dasharray="{drawn ? slice.length : 0} {CIRC}"
              stroke-dashoffset={slice.offset}
              opacity={hovered && hovered !== slice.type ? 0.28 : 1}
              role="presentation"
              onmouseenter={() => (hovered = slice.type)}
              onmouseleave={() => (hovered = null)}>
          <title>{slice.type}: {slice.specimens} samples ({slice.specimen_share}%)</title>
        </path>
      {/each}
    </g>

    {#if focus}
      <text x={C} y={C - 6} text-anchor="middle" class="total"
            style="fill:{colour(focus.type)}">{focus.specimens}</text>
      <text x={C} y={C + 12} text-anchor="middle" class="totlab">{focus.type}</text>
      <text x={C} y={C + 27} text-anchor="middle" class="totsub">
        {Math.round(focus.specimen_share)}% of the cohort</text>
    {:else}
      <text x={C} y={C - 2} text-anchor="middle" class="total">{total}</text>
      <text x={C} y={C + 16} text-anchor="middle" class="totlab">samples</text>
    {/if}
  </svg>

  <div class="legend">
    {#each types as type}
      <button class="row" class:on={hovered === type.type}
              onmouseenter={() => (hovered = type.type)}
              onmouseleave={() => (hovered = null)}>
        <i style="background:{colour(type.type)}"></i>
        <span class="name">{type.type}</span>
        <span class="n">{type.specimens}</span>
        <span class="pc">{Math.round(type.specimen_share)}%</span>
        <span class="ali">{type.aliquots} aliquots</span>
      </button>
    {/each}
  </div>

</div>

<style>
  .wrap { flex: 0 0 auto; width: 262px; }
  .donut { width: 100%; max-width: 226px; height: auto; display: block; margin: 2px auto 12px; }
  .donut .slice { cursor: pointer;
    transition: stroke-dasharray .9s cubic-bezier(.22,.61,.36,1),
                stroke-width .18s ease, opacity .18s ease; }
  .total { font-size: 30px; font-weight: 800; fill: var(--ink);
           font-variant-numeric: tabular-nums; }
  .totlab { font-size: 11px; fill: var(--muted); }
  .totsub { font-size: 9.5px; fill: #9aa2ab; }

  .legend { display: flex; flex-direction: column; gap: 1px; }
  .row { display: flex; align-items: center; gap: 7px; font-size: 12.5px;
         border: 0; background: none; font: inherit; font-size: 12.5px;
         padding: 4px 6px; border-radius: 7px; cursor: pointer; width: 100%;
         color: var(--ink); transition: background .15s ease; }
  .row:hover, .row.on { background: #f2f5f7; }
  .row i { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
  .name { flex: 1 1 auto; text-align: left; }
  .n { font-weight: 700; font-variant-numeric: tabular-nums; }
  .pc { width: 34px; text-align: right; color: var(--muted);
        font-variant-numeric: tabular-nums; }
  .ali { width: 80px; text-align: right; color: #9aa2ab; font-size: 11px;
         font-variant-numeric: tabular-nums; white-space: nowrap; }

  @media (prefers-reduced-motion: reduce) {
    .donut .slice { transition-duration: 0s; }
  }
</style>
