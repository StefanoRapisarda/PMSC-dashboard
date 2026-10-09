<script lang="ts">
  /* Enrolment against the study's target. Until the target is set in
     api/app/config.py, the bar has nothing to measure against, so it says so
     rather than drawing a fraction of an invented number. */
  import type { Progress } from '$lib/types';
  import StatusChip from './StatusChip.svelte';
  import FacSimile from './FacSimile.svelte';

  let { recruitment, illustrative = false }:
    { recruitment: Progress['recruitment']; illustrative?: boolean } = $props();
  /* stamp only what actually comes from a target */
  const stamp = $derived(illustrative && recruitment.target !== null);

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];
  const longDate = (iso: string | null) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  };

  const share = $derived(recruitment.target
    ? Math.min(100, (recruitment.enrolled / recruitment.target) * 100) : null);
  const perWeek = $derived(recruitment.per_week.toFixed(1));
</script>

<div class="head">
  <div class="big">{recruitment.enrolled}<span>
    {recruitment.target ? `of ${recruitment.target} patients` : 'patients enrolled'}</span>{#if
    stamp}<FacSimile />{/if}</div>
  <StatusChip status={recruitment.status} />
</div>

<div class="bar" class:unset={share === null}
     role="progressbar" aria-valuemin="0" aria-valuemax={recruitment.target ?? undefined}
     aria-valuenow={recruitment.enrolled}
     aria-label="Patients enrolled against the target">
  {#if share !== null}<span class="fill" style="width:{share}%"></span>{/if}
</div>
{#if share !== null}
  <p class="pct">{Math.round(share)}% of the target{#if stamp}<FacSimile />{/if}</p>
{:else}
  <p class="pct">The study's enrolment target has not been set yet, so there is
    nothing to measure progress against.</p>
{/if}

<div class="facts">
  <div><span>First patient enrolled</span><b>{longDate(recruitment.first_enrolled)}</b></div>
  <div><span>Recent pace</span>
    <b>{perWeek} patients a week</b></div>
  <div><span>Recruitment planned to close</span>
    <b>{#if illustrative && recruitment.recruitment_end}<FacSimile />{/if}{recruitment.recruitment_end
        ? longDate(recruitment.recruitment_end) : 'not set'}</b></div>
  <div><span>Target reached, at the recent pace</span>
    <b>{#if stamp && recruitment.projected_completion}<FacSimile />{/if}{recruitment.projected_completion ? longDate(recruitment.projected_completion)
        : recruitment.status === 'complete' ? 'already reached' : 'needs a target'}</b></div>
</div>

<p class="hint">The recent pace is the average over the last {recruitment.pace_window_weeks}
  weeks. Once a target and a closing date are set, the card says whether recruitment is
  on track. It is on track at the enrolment expected by now or above, at risk between 80%
  and 99% of it, and behind below 80%.</p>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px;
          margin-top: 8px; }
  .big { font-size: 28px; font-weight: 800; letter-spacing: -.02em; line-height: 1;
         font-variant-numeric: tabular-nums; }
  .big span { font-size: 12.5px; font-weight: 600; color: var(--muted); margin-left: 6px;
              letter-spacing: 0; }
  .bar { margin-top: 12px; height: 12px; border-radius: 6px; background: #eef1f4;
         overflow: hidden; }
  .bar.unset { background: repeating-linear-gradient(45deg, #fbfcfd 0 7px, #f1f4f7 7px 14px);
               border: 1px dashed var(--border); }
  .fill { display: block; height: 100%; background: #2563eb; border-radius: 6px; }
  .pct { margin: 6px 0 0; font-size: 12px; color: var(--muted); line-height: 1.45; }
  .facts { margin-top: 12px; }
  .facts div { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0;
               border-bottom: 1px dashed var(--border); font-size: 12.5px; }
  .facts span { color: var(--muted); }
  .facts b { text-align: right; font-variant-numeric: tabular-nums; }
</style>
