<script lang="ts" module>
  /** The small drawings a key item can carry. Each one copies how the chart itself draws the thing. */
  export type Glyph = 'stop' | 'ring' | 'time' | 'fork' | 'click'
                    | 'lane' | 'bar' | 'pin' | 'card' | 'column' | 'away' | 'shared';
  export interface KeyItem { glyph: Glyph; text: string; }
</script>

<script lang="ts">
  /* A one-line key that replaces a paragraph of explanation. Each item is a small
     drawing of a chart element beside one short sentence about it, in the way a
     metro map prints its "how to read" corner. */
  let { items }: { items: KeyItem[] } = $props();
</script>

<div class="howto" role="note" aria-label="How to read this chart">
  <span class="ht">How to read</span>
  {#each items as item}
    <span class="item">
      <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
        {#if item.glyph === 'stop'}
          <line x1="2" y1="10" x2="32" y2="10" class="ln" />
          <circle cx="17" cy="10" r="4.5" class="st" />
        {:else if item.glyph === 'ring'}
          <line x1="2" y1="10" x2="32" y2="10" class="ln" />
          <circle cx="17" cy="10" r="7" class="st big" />
        {:else if item.glyph === 'time'}
          <line x1="0" y1="10" x2="34" y2="10" class="ln" />
          <rect x="6" y="4" width="22" height="12" rx="6" class="pill" />
          <text x="17" y="13">1h</text>
        {:else if item.glyph === 'fork'}
          <path d="M2 10 H10 L18 3 H32 M10 10 H32 M10 10 L18 17 H32" class="ln thin" />
        {:else if item.glyph === 'shared'}
          <line x1="2" y1="4" x2="32" y2="4" class="ln thin" />
          <line x1="2" y1="16" x2="32" y2="16" class="ln thin" />
          <rect x="12" y="-1" width="10" height="22" rx="5" class="st" />
        {:else if item.glyph === 'click'}
          <circle cx="13" cy="9" r="5" class="st" />
          <path d="M17 9 L17 19 L19.5 16.5 L22 20 L23.5 19 L21 15.5 L24.5 15.5 Z" class="ptr" />
        {:else if item.glyph === 'lane'}
          <line x1="0" y1="3" x2="34" y2="3" class="rule" />
          <line x1="0" y1="17" x2="34" y2="17" class="rule" />
          <rect x="4" y="6" width="12" height="8" rx="2" class="fill" />
          <rect x="19" y="6" width="11" height="8" rx="2" class="fill soft" />
        {:else if item.glyph === 'bar'}
          <rect x="1" y="5" width="8" height="10" rx="2" class="fill" />
          <rect x="12" y="5" width="21" height="10" rx="2" class="fill" />
        {:else if item.glyph === 'pin'}
          <line x1="12" y1="2" x2="12" y2="18" class="stem" />
          <circle cx="12" cy="10" r="4.5" class="dot" />
        {:else if item.glyph === 'card'}
          <line x1="6" y1="2" x2="6" y2="18" class="rule dash" />
          <rect x="6" y="4" width="24" height="12" rx="2" class="cardg" />
        {:else if item.glyph === 'column'}
          <rect x="6" y="1" width="22" height="8" rx="2" class="cardg" />
          <rect x="6" y="11" width="22" height="8" rx="2" class="cardg" />
        {:else if item.glyph === 'away'}
          <line x1="3" y1="10" x2="27" y2="10" class="awayl" />
          <circle cx="28" cy="10" r="3.5" class="dot" />
        {/if}
      </svg>
      {item.text}
    </span>
  {/each}
</div>

<style>
  .howto { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 22px;
           margin: 10px 0 12px; font-size: 12.5px; color: var(--ink); }
  .ht { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
        color: var(--muted); font-weight: 700; }
  .item { display: inline-flex; align-items: center; gap: 7px; }
  svg { flex: none; }
  .ln { stroke: var(--accent); stroke-width: 4; stroke-linecap: round; fill: none; }
  .ln.thin { stroke-width: 3; stroke-linejoin: round; }
  .st { fill: #fff; stroke: #22303b; stroke-width: 2; }
  .st.big { stroke-width: 2.5; }
  .pill { fill: #fff; stroke: var(--accent); stroke-width: 1.2; }
  text { font-size: 8px; font-weight: 700; fill: var(--muted); text-anchor: middle; }
  .ptr { fill: #22303b; stroke: #fff; stroke-width: .8; }
  .rule { stroke: var(--border); stroke-width: 1.2; }
  .rule.dash { stroke: #b9c3cc; stroke-dasharray: 2 2; }
  .fill { fill: var(--accent); }
  .fill.soft { opacity: .55; }
  .stem { stroke: var(--accent); stroke-width: 2; opacity: .55; }
  .dot { fill: var(--accent); stroke: #fff; stroke-width: 1.5; }
  .cardg { fill: #fff; stroke: #8ea0ba; stroke-width: 1.2; }
  .awayl { stroke: #8ea0ba; stroke-width: 2; stroke-dasharray: 3 2; }
</style>
