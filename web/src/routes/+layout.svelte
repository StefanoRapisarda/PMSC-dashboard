<script lang="ts">
  /* The shell: banner, brand, and v3's three tabs. Nothing else lives here so
     that each view owns its own layout, exactly as the mockup did. */
  import { page } from '$app/state';
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { api } from '$lib/api';
  import type { Meta } from '$lib/types';

  let { children }: { children: Snippet } = $props();

  let meta = $state<Meta | null>(null);
  $effect(() => { api.meta().then((m) => (meta = m)).catch(() => (meta = null)); });

  const tabs = [
    { href: '/workflow', label: 'Workflow' },
    { href: '/dashboard', label: 'Study dashboard' },
    { href: '/graph', label: 'Knowledge graph' },
  ];
  const active = (href: string) => page.url.pathname.startsWith(href);
</script>

<div class="mockbanner">
  ◐ SHOWCASE · synthetic PreDDLung data served from the application database ·
  {#if meta}
    <b>{meta.counts.patients} patients · {meta.counts.specimens} samples</b>
    · as of {meta.study.as_of}
  {:else}
    connecting to the API…
  {/if}
</div>

<header class="top">
  <div class="brand">PMSC Dashboard <small>· {meta?.study.name ?? 'PreDDLung'} (showcase)</small></div>
  <nav class="tabs">
    <a href={tabs[0].href} class:active={active(tabs[0].href)}>{tabs[0].label}</a>
    <span class="tabsep"></span>
    {#each tabs.slice(1) as tab}
      <a href={tab.href} class:active={active(tab.href)}>{tab.label}</a>
    {/each}
  </nav>
</header>

{@render children()}

<style>
  /* the tabs are links now rather than buttons, so they need the same skin */
  nav.tabs a {
    border: 0; background: none; font: inherit; padding: 7px 14px; border-radius: 8px;
    color: var(--muted); font-weight: 600; cursor: pointer; text-decoration: none;
  }
  nav.tabs a.active { background: var(--accent); color: #fff; }
</style>
