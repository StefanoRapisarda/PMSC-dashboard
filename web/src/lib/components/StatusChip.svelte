<script lang="ts">
  /* A judgement against a target, as a word with a coloured mark, never colour
     alone. These colours are reserved for status and are not used for any
     series anywhere on the dashboard. */
  import type { Status } from '$lib/types';

  let { status }: { status: Status } = $props();

  const LOOK: Record<string, { label: string; colour: string; mark: string }> = {
    green: { label: 'On track', colour: '#2f9e44', mark: '✓' },
    complete: { label: 'Target reached', colour: '#2f9e44', mark: '✓' },
    amber: { label: 'At risk', colour: '#b7791f', mark: '!' },
    red: { label: 'Behind', colour: '#c92a2a', mark: '✕' },
  };
</script>

{#if status && LOOK[status]}
  {@const look = LOOK[status]}
  <span class="chip" style="--c:{look.colour}">
    <span class="mark" aria-hidden="true">{look.mark}</span>{look.label}
  </span>
{:else}
  <span class="chip unset">Target not set</span>
{/if}

<style>
  .chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
          font-weight: 700; color: var(--c); border: 1px solid var(--c);
          border-radius: 999px; padding: 1px 8px 1px 3px; white-space: nowrap; }
  .mark { width: 14px; height: 14px; border-radius: 50%; background: var(--c);
          color: #fff; display: inline-flex; align-items: center; justify-content: center;
          font-size: 9px; }
  .unset { color: var(--muted); border: 1px dashed var(--border); padding: 1px 8px; }
</style>
