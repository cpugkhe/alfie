<script lang="ts">
  import { app } from '$lib/state/app.svelte';

  const repo = $derived(app.active);
  const SCOPE_LABEL = { all: '', local: 'local branches', current: 'current branch only' };
</script>

<div class="status">
  <button
    class="space"
    class:open={app.spacesOpen}
    title="Switch space (⌃S)"
    onclick={() => (app.spacesOpen = !app.spacesOpen)}
  >
    <span class="glyph"></span>
    <span class="truncate">{app.space.name}</span>
    {#if app.spaces.length > 1}
      <span class="faint">{app.spaceIdx + 1}/{app.spaces.length}</span>
    {/if}
  </button>
  {#if repo}
    <span class="branch truncate">
      {repo.status?.branch ?? (repo.head ? `detached at ${repo.head.slice(0, 7)}` : 'no commits')}
    </span>
    {#if repo.status?.upstream}
      <span class="dim" title="Ahead / behind {repo.status.upstream}">
        ↑{repo.status.ahead} ↓{repo.status.behind}
      </span>
    {:else if repo.status?.branch}
      <span class="faint">no upstream</span>
    {/if}
    <button
      class="profile"
      class:none={!repo.profile.profile}
      title="Profile for this repository (⌘⇧U to switch)"
      onclick={() => (app.palette = 'profiles')}
    >
      {repo.profile.profile?.name ?? 'no profile'}{#if repo.profile.auto}<span class="faint"> auto</span>{/if}
    </button>
    {#if SCOPE_LABEL[repo.scope]}
      <span class="pill">{SCOPE_LABEL[repo.scope]}</span>
    {/if}
    {#if repo.op}
      <span class="op">{repo.op}</span>
    {/if}
    {#if repo.error}
      <span class="err truncate" title={repo.error}>{repo.error}</span>
    {:else if repo.busy && !repo.loaded}
      <span class="faint">Loading…</span>
    {/if}
  {/if}
  <span class="spacer"></span>
  <span class="zoom" title="Zoom (⌘+ / ⌘− / ⌘0)">
    <button onclick={() => app.setZoom(app.zoom - 0.1)} aria-label="Zoom out">−</button>
    <button class="pct" onclick={() => app.setZoom(1)}>{Math.round(app.zoom * 100)}%</button>
    <button onclick={() => app.setZoom(app.zoom + 0.1)} aria-label="Zoom in">+</button>
  </span>
  <span class="hints faint">
    <span><kbd>⌘K</kbd> switch</span>
    <span><kbd>⌘⇧P</kbd> commands</span>
    <span><kbd>?</kbd> keys</span>
  </span>
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 26px;
    padding: 0 12px 0 0;
    border-top: 1px solid var(--border);
    background: var(--bg);
    font-size: 12px;
    flex: none;
  }
  .space {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 100%;
    max-width: 200px;
    padding: 0 12px;
    border-right: 1px solid var(--border);
    color: var(--text);
    font-weight: 500;
    flex: none;
  }
  .space:hover,
  .space.open {
    background: var(--hover);
  }
  .space .faint {
    font-weight: 400;
    font-size: 11px;
  }
  .glyph {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    border: 1.5px solid var(--accent);
    flex: none;
  }
  .branch {
    font-weight: 500;
    max-width: 320px;
  }
  .profile {
    height: 18px;
    padding: 0 7px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    font-size: 11px;
    color: var(--text);
    flex: none;
  }
  .profile .faint {
    margin-left: 5px;
  }
  .profile.none {
    color: var(--text-faint);
    border-style: dashed;
  }
  .profile:hover {
    background: var(--hover);
  }
  .pill {
    color: var(--yellow);
  }
  .op {
    color: var(--accent);
  }
  .err {
    color: var(--red);
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .zoom {
    display: flex;
    align-items: center;
    flex: none;
    color: var(--text-dim);
  }
  .zoom button {
    min-width: 18px;
    height: 18px;
    border-radius: 4px;
    font-size: 12px;
  }
  .zoom .pct {
    font-size: 11px;
    padding: 0 4px;
  }
  .zoom button:hover {
    background: var(--hover);
    color: var(--text);
  }
  .hints {
    display: flex;
    gap: 14px;
    flex: none;
    font-size: 11px;
  }
  kbd {
    font-size: 10px;
    padding: 1px 4px;
  }
</style>
