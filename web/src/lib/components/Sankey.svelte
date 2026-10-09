<script lang="ts">
  /* Cohort flow — the sample's actual journey, end to end.
     Read left to right: one specimen stream to the extraction, then three
     parallel tracks, then back to specimens once results land.

     Three things this has to get right, all of which a single row of columns
     was getting wrong:

     1. QC is a gate, not a footnote. It is where material is genuinely lost —
        14 RNA aliquots here — so it gets a step of its own in each track.
     2. The protein branch is a different shape. Protein is digested to peptide
        and the peptide is what goes on the mass spec, so its QC comes AFTER the
        run, not before submission. Each track therefore carries its own step
        names, taken from the data rather than assumed.
     3. The three streams go to three different facilities. One "SciLifeLab"
        column would misname two of them.

     Width is a count throughout, and the unit changes twice: specimens to the
     split, aliquots across the tracks, specimens again at the tumour board portal.
     Both changes are labelled on the chart. */
  import type { Overview } from '$lib/types';

  let { flow }: { flow: Overview['flow'] } = $props();

  const W = 1210, H = 430;
  const yMid = 196;
  const BAND = 96;                       // px for the whole cohort

  /* specimen columns, then four per-track steps, then back to specimens */
  const X = { coll: 56, path: 152, pmsc: 248, prep: 344,
              s: [566, 686, 806, 926], back: 1046, mtb: 1146 };

  const TRACK: Record<string, { colour: string; fill: string }> = {
    DNA: { colour: '#457b9d', fill: 'rgba(69,123,157,.32)' },
    RNA: { colour: '#c99a3a', fill: 'rgba(201,154,58,.40)' },
    Protein: { colour: '#9c6644', fill: 'rgba(156,102,68,.34)' },
  };
  const GREEN = 'rgba(42,157,143,.24)';
  const COL = { coll: '#e76f51', path: '#264653', pmsc: '#2a9d8f',
                prep: '#2a9d8f', back: '#6a4c93', mtb: '#e9c46a' };

  const stage = (name: string) =>
    flow.specimen_stages.find((s) => s.stage === name)?.count ?? 0;

  const collected = $derived(stage('Collected'));
  const pathology = $derived(stage('Pathology'));
  const pmsc = $derived(stage('PM-SC prep'));
  const allprep = $derived(stage('AllPrep'));
  const back = $derived(flow.analysis.count);
  const mtb = $derived(flow.mtb.count);

  const scale = $derived(BAND / Math.max(1, collected));
  const h = (count: number) => count * scale;

  /* short forms so twelve step labels fit without crowding */
  const SHORT: Record<string, string> = {
    'Extracted': 'extracted', 'QC passed': 'QC pass', 'Sent': 'sent',
    'Data back': 'back', 'Digested to peptide': 'digested', 'MS QC passed': 'MS QC pass',
  };

  /* One track per stream. Height is the stream's share of the band leaving
     AllPrep — the split conserves the width, because it is the same material. */
  const tracks = $derived.by(() => {
    const names = ['DNA', 'RNA', 'Protein'];
    const first = names.map((n) => flow.streams[n]?.chain[0]?.count ?? 0);
    const total = first.reduce((a, b) => a + b, 0) || 1;
    const band = h(allprep);
    const gap = 44;
    let y = yMid - (band + gap * 2) / 2;

    return names.map((name, i) => {
      const stream = flow.streams[name];
      const height = (first[i] / total) * band;
      const top = y;
      y += height + gap;
      const failed = stream?.qc_fail ?? 0;
      const steps = (stream?.chain ?? []).map((step, j) => {
        /* a QC step is where material is refused, not merely delayed */
        const gate = step.stage.includes('QC');
        /* Same definition as the KPI tile: passed over resolved, so aliquots
           still awaiting QC do not quietly drag the rate down. The two numbers
           have to agree or the dashboard argues with itself. */
        const resolved = step.count + failed;
        return {
          stage: step.stage,
          short: SHORT[step.stage] ?? step.stage.toLowerCase(),
          count: step.count,
          x: X.s[j],
          height: (step.count / (first[i] || 1)) * height,
          gate,
          rate: gate && resolved > 0 ? Math.round((step.count / resolved) * 100) : null,
        };
      });
      return { name, ...TRACK[name], top, height,
               facility: stream?.facility ?? null,
               qcFail: stream?.qc_fail ?? 0, steps };
    });
  });

  function ribbon(x0: number, a0: number, b0: number, x1: number, a1: number, b1: number) {
    const mx = (x0 + x1) / 2;
    return `M${x0} ${a0} C${mx} ${a0} ${mx} ${a1} ${x1} ${a1} `
         + `L${x1} ${b1} C${mx} ${b1} ${mx} ${b0} ${x0} ${b0} Z`;
  }

  /* Specimens that have not moved past a step. Deliberately not called stalled:
     most are still in the queue, and only flow.stalled are past the threshold. */
  const dropoffs = $derived([
    { x0: X.path, x1: X.pmsc, from: pathology, to: pmsc },
    { x0: X.pmsc, x1: X.prep, from: pmsc, to: allprep },
  ].filter((d) => d.from > d.to));

  const specimenColumns = $derived([
    ['Collected · surgery', X.coll, collected, COL.coll],
    ['Pathology', X.path, pathology, COL.path],
    ['PM-SC prep', X.pmsc, pmsc, COL.pmsc],
    ['AllPrep', X.prep, allprep, COL.prep],
  ] as [string, number, number, string][]);
</script>

<div style="width:100%;overflow-x:auto">
  <svg viewBox="0 0 {W} {H}" style="width:100%;min-width:940px;height:auto;display:block">
    <!-- ===================== one specimen stream ===================== -->
    <path d={ribbon(X.coll, yMid - h(collected) / 2, yMid + h(collected) / 2,
                    X.path, yMid - h(pathology) / 2, yMid + h(pathology) / 2)} fill={GREEN} />
    <path d={ribbon(X.path, yMid - h(pmsc) / 2, yMid + h(pmsc) / 2,
                    X.pmsc, yMid - h(pmsc) / 2, yMid + h(pmsc) / 2)} fill={GREEN} />
    <path d={ribbon(X.pmsc, yMid - h(allprep) / 2, yMid + h(allprep) / 2,
                    X.prep, yMid - h(allprep) / 2, yMid + h(allprep) / 2)} fill={GREEN} />

    {#each dropoffs as drop, i}
      {@const thickness = h(drop.from - drop.to)}
      {@const bx = drop.x0 + (drop.x1 - drop.x0) * 0.6}
      {@const by = H - 52 - i * 26}
      <path d="M{drop.x0} {yMid + h(drop.to) / 2}
               C{(drop.x0 + bx) / 2} {yMid + h(drop.to) / 2} {bx - 14} {by - thickness}
               {bx} {by - thickness} L{bx} {by}
               C{bx - 14} {by} {(drop.x0 + bx) / 2} {yMid + h(drop.from) / 2}
               {drop.x0} {yMid + h(drop.from) / 2} Z" fill="rgba(231,111,81,.26)" />
      <text x={bx + 6} y={by - thickness / 2 + 3} font-size="9.5" fill="#b3401f">
        {drop.from - drop.to} not yet past this step
      </text>
    {/each}

    <!-- ===================== three parallel tracks ===================== -->
    {#each tracks as track, i}
      {@const band = h(allprep)}
      {@const above = tracks.slice(0, i).reduce((sum, t) => sum + t.height, 0)}
      {@const sa = yMid - band / 2 + above}

      <!-- AllPrep fans out into this track -->
      <path d={ribbon(X.prep, sa, sa + track.height,
                      X.s[0], track.top, track.top + track.steps[0].height)}
            fill={track.fill} />

      <!-- and the track tapers through its own steps -->
      {#each track.steps.slice(0, -1) as step, j}
        {@const next = track.steps[j + 1]}
        {@const c = track.top + track.height / 2}
        <path d={ribbon(step.x, c - next.height / 2, c + next.height / 2,
                        next.x, c - next.height / 2, c + next.height / 2)}
              fill={track.fill} />
        {#if step.count > next.count}
          {@const lost = step.count - next.count}
          <!-- At a QC gate the drop is not all failures: some aliquots simply
               have not been QC'd yet. Calling the whole drop a failure is the
               same mistake as calling a queue a stall, so the two are split. -->
          {@const failed = next.gate ? Math.min(lost, track.qcFail) : 0}
          {@const waiting = lost - failed}
          <text x={(step.x + next.x) / 2} y={track.top + track.height + 15}
                text-anchor="middle" font-size="8.5" font-weight={failed ? '700' : '400'}
                fill={failed ? '#b3401f' : '#8a929c'}>
            {#if failed}−{failed} failed QC{:else}−{lost}{/if}
          </text>
          {#if failed && waiting > 0}
            <text x={(step.x + next.x) / 2} y={track.top + track.height + 26}
                  text-anchor="middle" font-size="8" fill="#8a929c">
              {waiting} not yet QC'd
            </text>
          {/if}
        {/if}
      {/each}

      {#each track.steps as step}
        {@const c = track.top + track.height / 2}
        <rect x={step.x - 3} y={c - step.height / 2} width="6"
              height={Math.max(2, step.height)} rx="2" fill={track.colour} />
        <text x={step.x} y={c - step.height / 2 - 15} text-anchor="middle"
              font-size="10" font-weight="800" fill={track.colour}>{step.count}</text>
        <text x={step.x} y={c - step.height / 2 - 4} text-anchor="middle"
              font-size="8.5" fill="#8a929c">
          {step.short}{#if step.rate != null}<tspan font-weight="700"
            fill={track.colour}>{'\u00A0· '}{step.rate}%</tspan>{/if}
        </text>
      {/each}

      <text x={X.s[0] - 16} y={track.top + track.height / 2 - 1} text-anchor="end"
            font-size="10.5" font-weight="700" fill={track.colour}>{track.name}</text>
      {#if track.facility}
        <text x={X.s[0] - 16} y={track.top + track.height / 2 + 11} text-anchor="end"
              font-size="8.5" fill="#8a929c">→ {track.facility.split(',')[0]}</text>
      {/if}

      <!-- results merge back into specimens -->
      {@const last = track.steps[track.steps.length - 1]}
      {@const c = track.top + track.height / 2}
      {@const backBand = h(back)}
      {@const share = tracks.slice(0, i).reduce((sum, t) => sum + t.height / band * backBand, 0)}
      <path d={ribbon(last.x, c - last.height / 2, c + last.height / 2,
                      X.back, yMid - backBand / 2 + share,
                      yMid - backBand / 2 + share + track.height / band * backBand)}
            fill={track.fill} />
    {/each}

    <path d={ribbon(X.back, yMid - h(back) / 2, yMid + h(back) / 2,
                    X.mtb, yMid - h(mtb) / 2, yMid + h(mtb) / 2)} fill={GREEN} />

    <!-- ===================== column headings ===================== -->
    {#each specimenColumns as [label, x, count, colour]}
      <rect x={x - 4} y={yMid - h(count) / 2} width="8"
            height={Math.max(2, h(count))} rx="2" fill={colour} />
      <text x={x} y="24" text-anchor="middle" font-size="10.5" font-weight="700"
            fill="#3a4048">{label}</text>
      <text x={x} y="38" text-anchor="middle" font-size="10.5" font-weight="800"
            fill={colour}>{count}</text>
    {/each}

    {#each [['Data back', X.back, back, COL.back], ['MTB Portal', X.mtb, mtb, COL.mtb]] as [label, x, count, colour]}
      <rect x={(x as number) - 4} y={yMid - h(count as number) / 2} width="8"
            height={Math.max(2, h(count as number))} rx="2" fill={colour as string} />
      <text x={x as number} y="24" text-anchor="middle" font-size="10.5" font-weight="700"
            fill="#3a4048">{label}</text>
      <text x={x as number} y="38" text-anchor="middle" font-size="10.5" font-weight="800"
            fill={colour as string}>{count}</text>
    {/each}

    <text x={(X.s[0] + X.s[3]) / 2} y="24" text-anchor="middle" font-size="10.5"
          font-weight="700" fill="#3a4048">Three fractions, analysed in parallel</text>
    <text x={(X.s[0] + X.s[3]) / 2} y="38" text-anchor="middle" font-size="9"
          fill="#8a929c">counted as aliquots — one sample yields up to three</text>

    <line x1={(X.prep + X.s[0]) / 2} y1="48" x2={(X.prep + X.s[0]) / 2} y2={H - 60}
          stroke="#d9dee3" stroke-dasharray="3 4" />
    <line x1={(X.s[3] + X.back) / 2} y1="48" x2={(X.s[3] + X.back) / 2} y2={H - 60}
          stroke="#d9dee3" stroke-dasharray="3 4" />

    <text x={X.coll} y={H - 14} font-size="9.5" fill="#8a929c">
      Width is a count, and every track narrows by exactly what it loses. Red figures are
      material refused at a QC gate; grey are steps not yet taken.
    </text>
  </svg>
</div>

<p class="hint" style="margin-top:6px">
  DNA and RNA are QC'd <b>before</b> they are sent. Protein is different: it is digested
  to peptide, the peptide goes on the mass spec, and its QC comes <b>after</b> that run —
  so its track has a different shape, and the steps are named from the data rather than
  assumed. The percentage at each gate is passed over resolved — the same definition as
  the QC pass rate tile, so aliquots still awaiting QC do not drag it down.
  <b>{flow.stalled}</b> samples are flagged stalled, meaning no recorded step for
  {flow.stall_threshold_days}+ days.
</p>
