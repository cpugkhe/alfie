<script lang="ts">
  import type { RepoState } from '$lib/state/repo.svelte';
  import { app } from '$lib/state/app.svelte';
  import { fetch, pull, push, redo, undo } from '$lib/actions';

  let { repo }: { repo: RepoState } = $props();

  let avatarFailed = $state(false);

  /** `github.com:owner/repo` → host, owner, repo */
  const remote = $derived.by(() => {
    const m = repo.remote?.match(/^([^:]+):(.+)$/);
    if (!m) return null;
    const parts = m[2].split('/');
    return { host: m[1], owner: parts[0], path: m[2] };
  });
  // Only GitHub serves an avatar by owner name without an API token.
  const avatar = $derived(
    remote?.host === 'github.com' && !avatarFailed
      ? `https://github.com/${encodeURIComponent(remote.owner)}.png?size=64`
      : null,
  );
  $effect(() => {
    repo.remote;
    avatarFailed = false;
  });

  const branch = $derived(repo.status?.branch ?? null);
  const undoTop = $derived(repo.undoStack.at(-1));
  const redoTop = $derived(repo.redoStack.at(-1));
  const busy = $derived(!!repo.op);
</script>

<div class="toolbar">
  <span class="origin" title={remote ? `origin: ${remote.host}/${remote.path}` : 'No origin remote'}>
    {#if avatar}
      <img src={avatar} alt="" onerror={() => (avatarFailed = true)} />
    {:else}
      <span class="letter" class:none={!remote}>{(remote?.owner ?? repo.name).slice(0, 1).toUpperCase()}</span>
    {/if}
    <span class="where truncate">
      {#if remote}<span class="faint">{remote.owner}/</span>{/if}{repo.name}
    </span>
  </span>

  <button class="branch" title="Current branch — click to switch (⌘B)" onclick={() => (app.palette = 'branches')}>
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 3.5a1.5 1.5 0 1 1-2 1.41V11.1a1.5 1.5 0 1 1-1 0V4.9A1.5 1.5 0 0 1 5 3.5Zm6 0a1.5 1.5 0 0 1 .5 2.91V7.5A2.5 2.5 0 0 1 9 10H6.5v1.09a1.5 1.5 0 1 1-1 0V9h3.5A1.5 1.5 0 0 0 10.5 7.5V6.41A1.5 1.5 0 0 1 11 3.5Z"
        fill="currentColor"
        transform="translate(1 0)"
      />
    </svg>
    <span class="truncate">{branch ?? (repo.head ? `detached ${repo.head.slice(0, 7)}` : 'no commits')}</span>
    {#if repo.status?.upstream && (repo.status.ahead || repo.status.behind)}
      <span class="track">
        {#if repo.status.ahead}↑{repo.status.ahead}{/if}
        {#if repo.status.behind}↓{repo.status.behind}{/if}
      </span>
    {/if}
  </button>

  <span class="sep"></span>

  <button class="tool" disabled={!undoTop || busy} title={undoTop ? `Undo ${undoTop.label} (⌘Z)` : 'Nothing to undo'} onclick={() => undo(repo)}>
    <span class="ico">↶</span> Undo
  </button>
  <button class="tool" disabled={!redoTop || busy} title={redoTop ? `Redo ${redoTop.label} (⌘⇧Z)` : 'Nothing to redo'} onclick={() => redo(repo)}>
    <span class="ico">↷</span> Redo
  </button>

  <span class="sep"></span>

  <button class="tool" disabled={busy} title="Fetch all remotes (⌘⇧F)" onclick={() => fetch(repo)}>
    <span class="ico">⟳</span> Fetch
  </button>
  <button class="tool" disabled={busy} title="Pull (⌘⇧L)" onclick={() => pull(repo)}>
    <span class="ico">↓</span> Pull{#if repo.status?.behind}<span class="n">{repo.status.behind}</span>{/if}
  </button>
  <button class="tool" disabled={busy} title="Push (⌘⇧K)" onclick={() => push(repo)}>
    <span class="ico">↑</span> Push{#if repo.status?.ahead}<span class="n">{repo.status.ahead}</span>{/if}
  </button>

  <span class="spacer"></span>
  {#if repo.op}<span class="op truncate">{repo.op}</span>{/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 36px;
    padding: 0 10px;
    flex: none;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    container-type: inline-size;
    min-width: 0;
  }
  .origin {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 0 1 auto;
    margin-right: 6px;
  }
  img,
  .letter {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    flex: none;
  }
  img {
    background: var(--raised);
  }
  .letter {
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--bg);
    background: var(--accent);
  }
  .letter.none {
    background: var(--border-strong);
    color: var(--text-dim);
  }
  .where {
    font-weight: 500;
  }
  .branch {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    max-width: 280px;
    min-width: 0;
    padding: 0 9px;
    border-radius: 12px;
    color: var(--lane-0);
    background: color-mix(in srgb, var(--lane-0) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--lane-0) 40%, transparent);
    font-weight: 600;
    flex: 0 1 auto;
  }
  .branch:hover {
    background: color-mix(in srgb, var(--lane-0) 24%, transparent);
  }
  .branch svg {
    flex: none;
  }
  .track {
    font-weight: 500;
    font-size: 11px;
    opacity: 0.85;
    flex: none;
  }
  .sep {
    width: 1px;
    height: 16px;
    margin: 0 6px;
    background: var(--border-strong);
    flex: none;
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 8px;
    border-radius: var(--radius);
    color: var(--text-dim);
    font-size: 12px;
    flex: none;
  }
  .tool:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }
  .tool:disabled {
    opacity: 0.38;
  }
  .ico {
    font-size: 14px;
    line-height: 1;
  }
  .n {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 10px;
    line-height: 15px;
    text-align: center;
    color: var(--bg);
    background: var(--accent);
    font-weight: 700;
  }
  .spacer {
    flex: 1;
  }
  .op {
    color: var(--accent);
    font-size: 12px;
  }
  @container (max-width: 620px) {
    .where,
    .sep {
      display: none;
    }
    .tool {
      padding: 0 5px;
    }
  }
</style>
