<script lang="ts">
  /* Study dashboard — v3's layout, with every number now computed by the API
     from the database rather than derived in the page. */
  import { api } from '$lib/api';
  import Sankey from '$lib/components/Sankey.svelte';
  import SampleTypes from '$lib/components/SampleTypes.svelte';
  import Turnaround from '$lib/components/Turnaround.svelte';
  import type { Overview } from '$lib/types';

  let data = $state<Overview | null>(null);
  let error = $state<string | null>(null);

  /**
   * The panels at the foot of the dashboard, held open rather than filled in.
   *
   * Each carries a name and one line saying what it is for. That is enough for a
   * colleague to say "yes, that one, and it should show X" — which is the point
   * of showing the space at all. What actually goes in them is the study team's
   * decision, so nothing here guesses at it.
   */
  const RESERVED = [
    { title: 'Needs attention',
      what: 'Samples that have stopped moving, and what each of them is waiting on.' },
    { title: 'Cohort recruitment',
      what: 'How enrolment is tracking against the target, over time and by site.' },
    { title: 'Turnaround by site',
      what: 'How long each contributing site takes, compared with the others.' },
  ];

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
      tip: 'Samples where at least one aliquot got results back from a platform.' },
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
              · surgery → molecular tumour board, by phase</span></h3>
          <Turnaround turnaround={data.turnaround} />
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <h3>Cohort flow
          <span style="font-weight:400;color:var(--muted);font-size:12px">
            · where samples are, and where they stop</span></h3>
        <Sankey flow={data.flow} />
      </div>

      <!--
        Space held open, not filled in.

        This row used to be a single list of samples with no next step. It is now
        three empty panels, because what belongs in this part of the dashboard is
        a decision for the study team rather than a guess by whoever built it. An
        empty panel with a name on it asks that question of a reader far more
        directly than a filled one does, and it shows how much room there is to
        answer it in.
      -->
      <div class="reserved">
        {#each RESERVED as panel}
          <div class="card slot">
            <h3>{panel.title}</h3>
            <p class="what">{panel.what}</p>
            <div class="placeholder">
              <span class="mark" aria-hidden="true"></span>
              <span>Reserved for your choice of content</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  /* three across on a wide screen, stacking as it narrows */
  .reserved { display: grid; gap: 14px; margin-top: 14px;
              grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @media (max-width: 1150px) { .reserved { grid-template-columns: 1fr; } }
  .slot { display: flex; flex-direction: column; }
  .slot .what { margin: 4px 0 0; font-size: 12.5px; color: var(--muted);
                line-height: 1.45; }
  /* A dashed outline reads as "nothing is missing here, this is deliberate",
     where a blank area reads as a page that failed to load. */
  .placeholder { margin-top: 12px; flex: 1 1 auto; min-height: 116px;
                 display: flex; flex-direction: column; align-items: center;
                 justify-content: center; gap: 9px; text-align: center;
                 border: 1px dashed var(--border); border-radius: 10px;
                 background: repeating-linear-gradient(45deg,
                   #fbfcfd 0 9px, #f5f7f9 9px 18px);
                 color: var(--muted); font-size: 12px; font-weight: 600; }
  .placeholder .mark { width: 22px; height: 22px; border-radius: 6px;
                       border: 1px dashed var(--border); background: #fff; }

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
