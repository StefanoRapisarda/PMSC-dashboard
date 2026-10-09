<script lang="ts">
  /* The feasibility endpoints a precision-oncology pilot is usually judged on:
     how many samples yield results, how many patients reach the tumour board,
     and how many get there in time. Each is a share, set against its target
     where the study team has set one. */
  import type { Progress } from '$lib/types';
  import StatusChip from './StatusChip.svelte';
  import FacSimile from './FacSimile.svelte';

  let { endpoints, illustrative = false }:
    { endpoints: Progress['endpoints']; illustrative?: boolean } = $props();
</script>

{#each endpoints as e}
  <div class="row">
    <div class="top">
      <span class="label">{e.label}{#if illustrative && e.key === 'within_window'
        && e.note === null}<FacSimile />{/if}</span>
      <StatusChip status={e.status} />
    </div>
    <div class="line">
      <span class="pct">{e.pct === null ? '—' : `${Math.round(e.pct)}%`}</span>
      <div class="bar" class:unset={e.pct === null}>
        {#if e.pct !== null}<span class="fill" style="width:{e.pct}%"></span>{/if}
        {#if e.target_pct !== null}
          <span class="target" style="left:{e.target_pct}%"
                title="Target: {e.target_pct}%"></span>
        {/if}
      </div>
    </div>
    <p class="sub">
      {#if e.note}{e.note}
      {:else}{e.numerator} of {e.denominator} {e.unit}{e.target_pct !== null
        ? `, against a target of ${e.target_pct}%` : ''}.{#if illustrative && e.target_pct !== null
        }<FacSimile />{/if}{/if}
    </p>
  </div>
{/each}

<p class="hint">These are the endpoints comparable precision-oncology feasibility
  studies report. Each turns green, amber or red once the study team sets its target.</p>

<style>
  .row { padding: 9px 0; border-bottom: 1px dashed var(--border); }
  .row:first-child { padding-top: 8px; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .label { font-size: 12.5px; font-weight: 600; }
  .line { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .pct { width: 42px; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .bar { position: relative; flex: 1 1 auto; height: 10px; border-radius: 5px;
         background: #eef1f4; }
  .bar.unset { background: repeating-linear-gradient(45deg, #fbfcfd 0 7px, #f1f4f7 7px 14px);
               border: 1px dashed var(--border); }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; background: #6a4c93;
          border-radius: 5px; }
  /* the target as a tick across the bar, so the gap to it can be read */
  .target { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px;
            background: var(--ink); border-radius: 1px; }
  .sub { margin: 4px 0 0 52px; font-size: 11.5px; color: var(--muted); }
</style>
