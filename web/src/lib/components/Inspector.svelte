<script lang="ts">
  /**
   * The right-hand panel: what you have selected, in the vocabulary of the
   * ontology we adopted.
   *
   * ONE CARD DESCRIBES ONE NODE. The panel used to answer a click on a sample
   * with the sample's own facts, then its four fractions and their QC, then a
   * cross-system ID chain that walked from the patient down through every
   * fraction. Most of what you were reading was about something you had not
   * clicked on, and no line said where one thing stopped and the next began.
   *
   * So a single click gets one card. A double click lights the whole family and
   * gets a card for each of them, one under another, with a rule and a coloured
   * mark between them. The renaming that WP2 exists to reconstruct is still
   * here — it is read by walking the family, where each row of the chain sits on
   * the thing it names, instead of being flattened into one list.
   *
   * A click on a line gets a relation card instead. It reads in the same
   * vocabulary: what the relation says in a sentence, the two things it joins
   * (each one a click away from its own card), and how tightly it holds them,
   * which is what distance in the force view means.
   */
  import type { EdgePick } from '$lib/graph/cy';
  import {
    ACTIVITY_LABEL, COLORS, ONTOLOGY, RELATION, TYPE_LABEL, relationTier, type NodeType,
  } from '$lib/graph/v3';
  import type { GraphModel } from '$lib/graph/model';
  import type { GraphNode } from '$lib/types';

  let { node, family = null, model, steps = [], edge = null, onPick,
        connectionsOf, visibility = 0 }: {
    node: GraphNode | null;
    /** the whole lit family, when a double click put one up; null otherwise */
    family?: GraphNode[] | null;
    model: GraphModel | null;
    steps?: { node: GraphNode; when: string | null }[];
    /** the relation a click on a line picked; shown only when no node is selected */
    edge?: EdgePick | null;
    /** select one end of the relation as a node */
    onPick?: (node: GraphNode) => void;
    /** the lines a node has on screen, as [relation name, count] pairs */
    connectionsOf?: (node: GraphNode) => [string, number][];
    /** changes whenever the filters change what is on screen, so the counts
        below are worked out again */
    visibility?: number;
  } = $props();

  /** The order a family reads in: down the pipeline, rather than whatever order
      the graph happened to return them in. */
  const ORDER: NodeType[] = ['patient', 'identifier', 'sample', 'activity', 'aliquot',
                             'qc', 'deviation', 'storage', 'operator', 'platform', 'mtb'];

  const cards = $derived.by(() => {
    if (!family) return node ? [node] : [];
    const rank = (n: GraphNode) => {
      const i = ORDER.indexOf(n.type as NodeType);
      return i === -1 ? ORDER.length : i;
    };
    /* the thing you double-clicked leads, then the rest in pipeline order */
    return [...family].sort((a, b) =>
      (a.id === node?.id ? -1 : b.id === node?.id ? 1 : 0)
      || rank(a) - rank(b) || a.label.localeCompare(b.label));
  });

  /* For these types the label IS an identifier — PDL-0001, S-6,
     PMSC-2025-0001-DNA, SE2321000016-9781 — and a bare code at the top of a card
     reads as a name. The others are genuinely names ("Clinical Genomics,
     SciLifeLab", "Sectioning") and must not be tagged. */
  const ID_LABELLED = new Set(['patient', 'sample', 'aliquot', 'operator']);

  const badge = (qc?: string) =>
    qc === 'fail' ? 'fail' : qc === 'pending' ? 'pending' : 'pass';

  /** What qualifies the name, kept apart so the ID tag lands on the code alone
      and not on "· FFPE · DNA" too. */
  const qualifierOf = (n: GraphNode) =>
    (n.stype ? ` · ${n.stype}` : '')
    + (n.type === 'aliquot' && n.molLabel ? ` · ${n.molLabel}` : '');

  const statusOf = (n: GraphNode) =>
    n._stuck ? 'stalled' : n._hasFail ? 'QC failure'
      : n._pending ? 'QC pending' : 'on track';

  /** The samples a patient gave. A patient has almost no other content, and
      these are the patient's own facts rather than another node's properties. */
  const samplesOf = (n: GraphNode) =>
    !model || n.type !== 'patient' ? []
      : (model.adj[n.id] ?? []).filter((x) => x.t === 'has_sample' && x.dir === 'out')
          .map((x) => model.nodes[x.o].label);

  const patientOf = (n: GraphNode) => {
    if (!model || n.type !== 'sample') return '—';
    const found = (model.adj[n.id] ?? [])
      .filter((x) => x.t === 'has_sample' && x.dir === 'in')
      .map((x) => model.nodes[x.o].label);
    return found[0] ?? '—';
  };

  /** The names this one thing is known by. Not the family's whole chain: that is
      what walking the family is for. */
  const namesOf = (n: GraphNode) => (model ? model.identifiersOf(n) : []);

  /** The relation card's content, worked out once per picked line. */
  const relation = $derived.by(() => {
    if (!edge || !model) return null;
    const from = model.nodes[edge.a], to = model.nodes[edge.b];
    if (!from || !to) return null;
    const meaning = RELATION[edge.type];
    return {
      from, to,
      name: meaning?.name ?? edge.type,
      says: meaning ? meaning.says(from.label, to.label)
                    : `${from.label} is linked to ${to.label}.`,
      standard: meaning?.standard ?? null,
      tier: relationTier(edge.type),
      facts: factsOf(edge.type, from, to),
    };
  });

  /**
   * What the store knows about this particular relation. An edge has no fields
   * of its own, so these are read from the end that records them: an activity
   * holds its date, an aliquot holds when it was sent and when data came back.
   */
  function factsOf(type: string, from: GraphNode, to: GraphNode): [string, string][] {
    const when = (n: GraphNode) => n.date ? `${n.date}${n.time ? ` · ${n.time}` : ''}` : '—';
    switch (type) {
      case 'has_sample': return [['Collected', to.collected ?? '—']];
      case 'used': case 'generated': return [['Step carried out', when(from)]];
      case 'performed': return [['Step carried out', when(to)]];
      case 'derived_from': return [['Molecule', from.molLabel ?? from.mol ?? '—'],
                                   ['QC of the result', from.qc ?? '—']];
      case 'submitted_to': return [['Sent', from.sent_on ?? '—'],
                                   ['Data back', from.returned_on ?? '—']];
      case 'repeat_of': return [['Repeat collected', from.collected ?? '—'],
                                ['Original collected', to.collected ?? '—']];
      default: return [];
    }
  }
</script>

{#if steps.length}
  <p class="panel-title">The path, in order</p>
  <ol class="path">
    {#each steps as step}
      <li>
        <span class="what">{step.node.label}</span>
        <span class="when">{step.when ?? ''}</span>
      </li>
    {/each}
  </ol>
{/if}

{#if !cards.length && relation}
  <section class="card first">
    <p class="panel-title">
      Relation
      {#if relation.standard}<span class="anchor">· {relation.standard}</span>{/if}
    </p>
    <div class="title">{relation.name}</div>
    <p class="says">{relation.says}</p>

    <p class="sub">From</p>
    <button class="end" style="--c:{COLORS[relation.from.type as NodeType] ?? '#8ea0ba'}"
            onclick={() => onPick?.(relation.from)}>
      <span class="dot"></span>
      <span class="endname">{relation.from.label}</span>
      <span class="endtype">{TYPE_LABEL[relation.from.type as NodeType] ?? relation.from.type}</span>
    </button>
    <p class="sub">To</p>
    <button class="end" style="--c:{COLORS[relation.to.type as NodeType] ?? '#8ea0ba'}"
            onclick={() => onPick?.(relation.to)}>
      <span class="dot"></span>
      <span class="endname">{relation.to.label}</span>
      <span class="endtype">{TYPE_LABEL[relation.to.type as NodeType] ?? relation.to.type}</span>
    </button>

    {#if edge?.via}
      <p class="sub">Steps it stands in for</p>
      <p class="hint">{edge.via}</p>
    {/if}

    {#if relation.facts.length}
      <p class="sub">Recorded</p>
      {#each relation.facts as [key, value]}
        <div class="kv"><span class="k">{key}</span><span class="v">{value}</span></div>
      {/each}
    {/if}

    <div class="kv"><span class="k">Stored as</span><span class="v mono">{edge?.type}</span></div>

    {#if relation.tier}
      <p class="sub">Distance in the force view</p>
      <div class="kv"><span class="k">Tier</span><span class="v">{relation.tier.tier}</span></div>
      <p class="hint">{relation.tier.meaning}</p>
    {/if}
  </section>
  <p class="hint foot">
    <b>Click</b> either end to read that thing's own card.
  </p>
{:else if !cards.length}
  <p class="panel-title">Selected · —</p>
  <div class="title">Nothing selected</div>
  <p class="hint">
    <b>Click</b> a node to inspect it. <b>Double-click</b> to light its whole
    family, and this panel then describes every one of them in turn. <b>Click</b>
    a line to read the relation it stands for.
  </p>
{:else}
  {#if family}
    <p class="panel-title">
      This family
      <span class="anchor">· {cards.length} things, one card each</span>
    </p>
  {/if}

  {#each cards as item, i (item.id)}
    <section class="card" class:first={i === 0}
             style="--c:{COLORS[item.type as NodeType] ?? '#8ea0ba'}">
      <p class="panel-title">
        {#if family}<span class="dot"></span>{/if}
        {TYPE_LABEL[item.type as NodeType] ?? item.type}
        {#if ONTOLOGY[item.type as NodeType]}
          <span class="anchor">· {ONTOLOGY[item.type as NodeType]}</span>
        {/if}
      </p>
      <div class="title">
        {#if ID_LABELLED.has(item.type)}<span class="idtag">ID</span>{/if}<span
          class="name">{item.label}</span><span class="qual">{qualifierOf(item)}</span>
      </div>

      {#if item.type === 'patient'}
        <div class="kv"><span class="k">Sex</span>
          <span class="v">{item.sex === 'F' ? 'Female' : 'Male'}</span></div>
        <div class="kv"><span class="k">Age at enrolment</span><span class="v">{item.age}</span></div>
        <div class="kv"><span class="k">Consent</span>
          <span class="v">{item.consent ? 'yes' : 'no'}</span></div>
        <div class="kv"><span class="k">Samples</span>
          <span class="v">{samplesOf(item).join(', ') || '—'}</span></div>
      {:else if item.type === 'sample'}
        <div class="kv"><span class="k">Patient</span><span class="v">{patientOf(item)}</span></div>
        <div class="kv"><span class="k">Preservation</span><span class="v">{item.stype}</span></div>
        <div class="kv"><span class="k">Collected</span>
          <span class="v">{item.collected ?? '—'}</span></div>
        <div class="kv"><span class="k">Status</span>
          <span class="v">
            <span class="badge {item._stuck || item._hasFail ? 'fail' : 'pass'}"
              >{statusOf(item)}</span>
            {#if item.stalled_days}<span class="hint"> {item.stalled_days} d</span>{/if}
          </span></div>
        <div class="kv"><span class="k">Storage box</span><span class="v">{item.box ?? '—'}</span></div>
        {#if item.deviations?.length}
          <p class="sub">Deviations recorded at pathology</p>
          {#each item.deviations as deviation, d}
            <div class="kv">
              <span class="k">{deviation}{#if item.deviation_notes?.[d]}<br />
                <span class="role">{item.deviation_notes[d]}</span>{/if}</span>
              <span class="v">⚠ recorded</span>
            </div>
          {/each}
        {/if}
      {:else if item.type === 'aliquot'}
        <div class="kv"><span class="k">Molecule</span>
          <span class="v">{item.molLabel ?? item.mol}</span></div>
        <div class="kv"><span class="k">QC</span>
          <span class="v"><span class="badge {badge(item.qc)}">{item.qc}</span></span></div>
        <div class="kv"><span class="k">Total</span>
          <span class="v">{item.total != null ? `${Math.round(item.total)} ng` : '—'}</span></div>
        <div class="kv"><span class="k">Elution</span>
          <span class="v">{item.elution ?? '—'} µl{item.buffer ? ` · ${item.buffer}` : ''}</span></div>
        <div class="kv"><span class="k">Sent</span><span class="v">{item.sent_on ?? '—'}</span></div>
        <div class="kv"><span class="k">Data back</span>
          <span class="v">{item.returned_on ?? '—'}</span></div>
      {:else if item.type === 'identifier'}
        <div class="kv"><span class="k">Issuing system</span><span class="v">{item.system}</span></div>
        <div class="kv"><span class="k">ID it issues</span>
          <span class="v mono">{item.value}</span></div>
      {:else if item.type === 'deviation'}
        <div class="kv"><span class="k">Class</span><span class="v">{item.devtype}</span></div>
        {#if item.note}<p class="hint">{item.note}</p>{/if}
      {:else if item.type === 'storage'}
        <div class="kv"><span class="k">Kind</span><span class="v">{item.kind}</span></div>
      {:else if item.type === 'activity'}
        <div class="kv"><span class="k">Step</span>
          <span class="v">{ACTIVITY_LABEL[item.kind ?? ''] ?? item.kind}</span></div>
        <div class="kv"><span class="k">Date</span>
          <span class="v">{item.date ?? '—'}{item.time ? ` · ${item.time}` : ''}</span></div>
      {:else}
        <div class="kv"><span class="k">Type</span><span class="v">{item.type}</span></div>
      {/if}

      {#if connectionsOf}
        <!-- `visibility` is read here so the counts follow the filters -->
        {@const links = visibility >= 0 ? connectionsOf(item) : []}
        {@const total = links.reduce((sum, [, n]) => sum + n, 0)}
        <p class="sub">Connections on screen</p>
        <div class="kv"><span class="k">Total</span><span class="v">{total}</span></div>
        {#each links as [name, n]}
          <div class="kv"><span class="k">{name}</span><span class="v">{n}</span></div>
        {/each}
        {#if total === 0}
          <p class="hint">The current filters hide everything this is connected to.</p>
        {/if}
      {/if}

      {#if namesOf(item).length}
        <p class="sub">Known as</p>
        {#each namesOf(item) as identifier}
          <div class="kv">
            <span class="k">{identifier.system}</span>
            <span class="v mono">{identifier.value}</span>
          </div>
        {/each}
      {/if}
    </section>
  {/each}

  {#if family}
    <p class="hint foot">
      Each thing here is named by its own system, which is the renaming WP2
      exists to reconstruct. Reading down the cards walks that chain.
    </p>
  {:else}
    <p class="hint foot">
      <b>Double-click</b> this node to light its whole family and describe every
      one of them here.
    </p>
  {/if}
{/if}

<style>
  .card { padding-bottom: 2px; }
  /* a rule and a coloured mark, so one thing plainly stops and the next starts */
  .card:not(.first) { border-top: 1px solid var(--border); margin-top: 14px;
                      padding-top: 12px; }
  .card .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
               background: var(--c); margin-right: 5px; vertical-align: 1px; }
  .title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
  .title .qual { color: var(--muted); font-weight: 600; }
  /* three characters that turn a code into a labelled code */
  .idtag { display: inline-block; margin-right: 6px; padding: 1px 5px;
           border: 1px solid var(--border); border-radius: 5px; background: #f4f6f8;
           color: var(--muted); font-size: 10px; font-weight: 700;
           letter-spacing: .06em; vertical-align: 2px; }
  .anchor { font-weight: 400; color: var(--muted); text-transform: none;
            letter-spacing: 0; }
  .sub { margin: 11px 0 3px; font-size: 10px; font-weight: 700; letter-spacing: .05em;
         text-transform: uppercase; color: var(--muted); }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .role { color: #9aa2ab; font-size: 10.5px; }
  .foot { margin-top: 14px; }
  .path { list-style: none; margin: 0 0 14px; padding: 0 0 0 12px;
          border-left: 2px solid var(--border); }
  .path li { display: flex; justify-content: space-between; gap: 8px;
             font-size: 12.5px; padding: 3px 0; }
  .path .what { color: var(--ink); }
  .path .when { color: var(--muted); font-size: 11px; white-space: nowrap; }
  .says { margin: 0 0 4px; font-size: 13px; line-height: 1.45; color: var(--ink); }
  /* each end of a relation is a way into that thing's own card */
  .end { display: flex; align-items: center; gap: 8px; width: 100%; margin: 2px 0;
         padding: 6px 8px; border: 1px solid var(--border); border-radius: 7px;
         background: transparent; font: inherit; text-align: left; cursor: pointer; }
  .end:hover { border-color: var(--c); }
  .end .dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%;
              background: var(--c); }
  /* names here are long codes and lab names, and a cut-off code is no use */
  .end .endname { font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
  .end .endtype { margin-left: auto; color: var(--muted); font-size: 11px;
                  white-space: nowrap; }
  .badge.pending { background: #eef1f4; color: #5b6570; }
</style>
