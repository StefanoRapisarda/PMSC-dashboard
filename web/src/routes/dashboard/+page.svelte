<script lang="ts">
  /* Study dashboard — v3's layout, with every number now computed by the API
     from the database rather than derived in the page. */
  import { api } from '$lib/api';
  import Sankey from '$lib/components/Sankey.svelte';
  import SampleTypes from '$lib/components/SampleTypes.svelte';
  import Turnaround from '$lib/components/Turnaround.svelte';
  import ProgressChart from '$lib/components/ProgressChart.svelte';
  import Recruitment from '$lib/components/Recruitment.svelte';
  import Endpoints from '$lib/components/Endpoints.svelte';
  import type { Overview } from '$lib/types';

  let data = $state<Overview | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    api.overview().then((d) => (data = d)).catch((e) => (error = String(e)));
  });

  const tiles = $derived(data ? [
    { n: String(data.kpis.patients_enrolled), l: 'Patients enrolled',
      tip: 'Distinct research subjects consented and enrolled in PreDDLung.' },
    { n: String(data.kpis.specimens_collected), l: 'Samples',
      tip: 'Physical samples collected — one patient can contribute more than one.' },
    { n: String(data.kpis.aliquots), l: 'Aliquots',
      tip: 'DNA / RNA / protein / peptide fractions extracted from the samples.' },
    { n: `${data.kpis.qc_pass_rate ?? '—'}<small>%</small>`, l: 'QC pass rate',
      tip: 'Share of resolved aliquots that passed QC; pending aliquots are excluded.' },
    { n: `${data.kpis.reached_data_back_pct ?? '—'}<small>%</small>`, l: 'Reached data back',
      tip: 'Samples where at least one aliquot got results back from an analysis lab.' },
    { n: String(data.kpis.stalled), l: 'Stalled samples',
      tip: `No next step for ${data.kpis.stall_threshold_days}+ days.` },
  ] : []);

  /* passed over resolved — the same definition as the KPI tile and the cohort
     flow, so the three never disagree about what a pass rate is */
  function pct(pass: number, fail: number) {
    const total = pass + fail;
    return total ? (pass / total) * 100 : 0;
  }
</script>

<section class="view active">
  <div class="dash">
    {#if error}
      <div class="card"><h3>Could not reach the API</h3><p class="hint">{error}</p></div>
    {:else if !data}
      <div class="card"><p class="hint">Loading…</p></div>
    {:else}
      <div class="kpis">
        {#each tiles as tile}
          <div class="card kpi" data-tip={tile.tip}>
            <div class="n">{@html tile.n}</div>
            <div class="l">{tile.l}</div>
          </div>
        {/each}
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Sample types
            <span style="font-weight:400;color:var(--muted);font-size:12px">
              · what the cohort is made of, and how each type performs</span></h3>
          <!-- composition on the left, performance on the right: the two answer
               different questions about the same axis, so they belong together -->
          <div class="typesplit">
          <SampleTypes types={data.sample_types} />
          <div class="qcchart">
            {#each Object.entries(data.qc_by_sample_type) as [type, molecules]}
              {#each Object.entries(molecules) as [molecule, counts]}
                {@const rate = pct(counts.Pass, counts.Fail)}
                <div class="qcrow">
                  <span class="qcname">{type} · {molecule}</span>
                  <span class="qctrack">
                    <span class="p" style="width:{rate}%"></span>
                    <span class="f" style="width:{100 - rate}%"></span>
                  </span>
                  <!-- the rate sits in its own column so the card can be read
                       down rather than row by row: comparing sample types is the
                       question this chart exists to answer, and doing the
                       division in your head is what made that hard -->
                  <span class="qcpct">{Math.round(rate)}%</span>
                  <span class="qcnum">{counts.Pass} pass · {counts.Fail} fail</span>
                </div>
              {/each}
            {/each}
          </div>
          </div>
        </div>

        <div class="card">
          <!-- named after the endpoint the trial family actually reports, rather
               than the generic "turnaround": MEGALiT and its siblings publish
               "median time to molecular tumour board" as a feasibility result -->
          <h3>Time to tumour board
            <span style="font-weight:400;color:var(--muted);font-size:12px">
              · surgery → order in the Molecular Tumor Board Portal, by phase</span></h3>
          <Turnaround turnaround={data.turnaround} />
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>Cohort flow
          <span style="font-weight:400;color:var(--muted);font-size:12px">
            · where samples are, and where they stop</span></h3>
        <Sankey flow={data.flow} />
      </div>

      <!-- How the study is moving, and how it stands against its targets. The
           targets live in api/app/config.py and are unset until the study team
           fills them in, so the cards say "not set" rather than guess. -->
      <div class="progressrow">
        <div class="card">
          <h3>Study progress
            <span class="sub">· cumulative, by week</span></h3>
          <ProgressChart progress={data.progress} />
        </div>
        <div class="card">
          <h3>Recruitment
            <span class="sub">· patients enrolled against the target</span></h3>
          <Recruitment recruitment={data.progress.recruitment}
                       illustrative={data.progress.targets_illustrative} />
        </div>
        <div class="card">
          <h3>Feasibility endpoints
            <span class="sub">· against the study's targets</span></h3>
          <Endpoints endpoints={data.progress.endpoints}
                     illustrative={data.progress.targets_illustrative} />
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  /* three across on a wide screen, stacking as it narrows */
  .progressrow { display: grid; gap: 14px; margin-top: 14px;
                 grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @media (max-width: 1150px) { .progressrow { grid-template-columns: 1fr; } }
  .progressrow h3 .sub { font-weight: 400; color: var(--muted); font-size: 12px; }

  .typesplit { display: flex; gap: 22px; align-items: flex-start; }
  .typesplit :global(.qcchart) { flex: 1 1 auto; min-width: 0; }
  @media (max-width: 1150px) { .typesplit { flex-direction: column; } }

  /* the rate reads as the answer, the counts as the working behind it */
  :global(.qcrow) .qcpct {
    flex: 0 0 auto; width: 46px; text-align: right;
    font-weight: 800; font-variant-numeric: tabular-nums; font-size: 13px;
  }
  :global(.qcrow) :global(.qcname) { width: 118px; }
  :global(.qcrow) :global(.qcnum) { width: 112px; font-variant-numeric: tabular-nums; }
</style>
