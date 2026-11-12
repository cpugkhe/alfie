<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import type { RepoState } from '$lib/state/repo.svelte';
  import { clamp } from '$lib/util';
  import Sidebar from './Sidebar.svelte';
  import Graph from './Graph.svelte';
  import Detail from './Detail.svelte';
  import DiffView from './DiffView.svelte';
  import Toolbar from './Toolbar.svelte';
  import ConfirmationBar from './ConfirmationBar.svelte';
  import { sequence } from '$lib/actions';

  const SEQ = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' };

  let { repo }: { repo: RepoState } = $props();

  // Narrow panes (split view, small window): keep room for the graph.
  let width = $state(1200);
  const showSidebar = $derived(app.sidebarOpen && width >= 820);
  const detailW = $derived(Math.min(app.detailW, Math.max(220, Math.round(width * 0.4))));

  $effect(() => {
    if (!showSidebar && repo.focus === 'sidebar') repo.focus = 'graph';
  });

  function resize(e: PointerEvent, side: 'sidebar' | 'detail') {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = side === 'sidebar' ? app.sidebarW : app.detailW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (side === 'sidebar') app.sidebarW = clamp(startW + dx, 140, 420);
      else app.detailW = clamp(startW - dx, 240, 720);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      app.save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }
</script>

<div class="wrap" bind:clientWidth={width}>
<Toolbar {repo} />
<ConfirmationBar {repo} />
{#if repo.status?.state}
  {@const kind = repo.status.state}
  {@const conflicts = repo.status.files.filter((f) => f.conflicted).length}
  <div class="banner">
    <span class="what">{SEQ[kind]} in progress</span>
    <span class="dim">
      {#if conflicts}
        {conflicts} conflicted {conflicts === 1 ? 'file' : 'files'} — fix them in your editor, then tick them in Uncommitted changes
      {:else}
        all conflicts resolved
      {/if}
    </span>
    <span class="grow"></span>
    <button class="go" disabled={!!conflicts || !!repo.op} onclick={() => sequence(repo, 'continue')}>Continue</button>
    {#if kind !== 'merge'}
      <button disabled={!!repo.op} onclick={() => sequence(repo, 'skip')}>Skip commit</button>
    {/if}
    <button class="stop" disabled={!!repo.op} onclick={() => sequence(repo, 'abort')}>Abort</button>
  </div>
{/if}
<div class="repo">
  {#if showSidebar}
    <div class="pane" style:width="{app.sidebarW}px">
      <Sidebar {repo} />
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="handle" onpointerdown={(e) => resize(e, 'sidebar')}></div>
  {/if}

  <div class="center">
    {#if repo.diff}
      <DiffView {repo} />
    {:else}
      <Graph {repo} />
    {/if}
  </div>

  {#if app.detailOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="handle" onpointerdown={(e) => resize(e, 'detail')}></div>
    <div class="pane" style:width="{detailW}px">
      <Detail {repo} />
    </div>
  {/if}
</div>
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 4px 10px 4px 12px;
    flex: none;
    font-size: 12px;
    background: color-mix(in srgb, var(--yellow) 12%, var(--panel));
    border-bottom: 1px solid color-mix(in srgb, var(--yellow) 35%, transparent);
  }
  .banner .what {
    color: var(--yellow);
    font-weight: 600;
    white-space: nowrap;
  }
  .banner .grow {
    flex: 1;
  }
  .banner button {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    white-space: nowrap;
    flex: none;
  }
  .banner button:hover:not(:disabled) {
    background: var(--hover);
  }
  .banner button:disabled {
    opacity: 0.45;
  }
  .banner .go {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  .banner .go:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .banner .stop:hover:not(:disabled) {
    color: var(--red);
  }
  .wrap {
    container-type: inline-size;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .repo {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .pane {
    flex: none;
    min-width: 0;
  }
  .center {
    flex: 1;
    min-width: 0;
  }
  .handle {
    width: 1px;
    flex: none;
    background: var(--border);
    position: relative;
    cursor: col-resize;
    z-index: 2;
  }
  /* Wider invisible grab area. */
  .handle::after {
    content: '';
    position: absolute;
    inset: 0 -3px;
  }
  .handle:hover,
  .handle:active {
    background: var(--accent);
  }
</style>
