<script lang="ts">
  import type { RepoState } from '$lib/state/repo.svelte';
  import { hunkAction } from '$lib/actions';

  let { repo }: { repo: RepoState } = $props();
  let el = $state<HTMLDivElement>();

  const LINE = 20;
  const open = $derived(repo.diff);
  const data = $derived(open?.data ?? null);
  const kind = $derived(open?.entry.target.kind);
  /** Hunks can be staged or unstaged from here. */
  const stageable = $derived(kind === 'staged' || kind === 'unstaged');
  const active = $derived(repo.focus === 'diff' && stageable);
  const selLo = $derived(Math.min(repo.lineAnchor, repo.lineCursor));
  const selHi = $derived(Math.max(repo.lineAnchor, repo.lineCursor));

  $effect(() => {
    repo.scrollDiff = (delta) => {
      if (!el) return;
      if (delta === Infinity) el.scrollTop = el.scrollHeight;
      else if (delta === -Infinity) el.scrollTop = 0;
      else el.scrollBy(0, delta * LINE * 3);
    };
    return () => (repo.scrollDiff = null);
  });

  // New file: start from the top.
  $effect(() => {
    open?.entry.key;
    if (el) el.scrollTop = 0;
  });

  // Keep the hunk / line cursor on screen.
  $effect(() => {
    const h = repo.hunkIdx;
    if (!active || !el || !data) return;
    const target = repo.lineMode
      ? el.querySelector(`[data-line="${h}:${repo.lineCursor}"]`)
      : el.querySelector(`[data-hunk="${h}"]`);
    target?.scrollIntoView({ block: 'nearest' });
  });

  function act(i: number, action: 'stage' | 'discard') {
    repo.focus = 'diff';
    repo.lineMode = false;
    repo.hunkIdx = i;
    hunkAction(repo, action);
  }

  const TARGET_LABEL = { commit: '', staged: 'staged', unstaged: 'unstaged', untracked: 'untracked' };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="diff" class:focused={repo.focus === 'diff'} onclick={() => (repo.focus = 'diff')}>
  {#if open}
    <div class="bar">
      <span class="path truncate selectable">
        {#if open.entry.origPath}<span class="faint">{open.entry.origPath} → </span>{/if}{open.entry.path}
      </span>
      {#if kind && TARGET_LABEL[kind]}
        <span class="tag">{TARGET_LABEL[kind]}</span>
      {/if}
      {#if data}
        <span class="add">+{data.added}</span>
        <span class="del">−{data.removed}</span>
      {/if}
      <span class="spacer"></span>
      {#if active && data?.hunks.length}
        <span class="hints faint">
          {#if repo.lineMode}
            <span><kbd>J</kbd><kbd>K</kbd> extend</span>
            <span><kbd>S</kbd> {kind === 'staged' ? 'unstage' : 'stage'} lines</span>
            {#if kind === 'unstaged'}<span><kbd>X</kbd> discard lines</span>{/if}
          {:else}
            <span><kbd>N</kbd><kbd>P</kbd> hunk</span>
            <span><kbd>S</kbd> {kind === 'staged' ? 'unstage' : 'stage'}</span>
            <span><kbd>V</kbd> lines</span>
            {#if kind === 'unstaged'}<span><kbd>X</kbd> discard</span>{/if}
          {/if}
        </span>
      {:else if stageable && data?.hunks.length}
        <span class="hints faint"><span><kbd>⇥</kbd> focus diff to stage hunks</span></span>
      {/if}
      <button class="x" onclick={(e) => { e.stopPropagation(); repo.closeDiff(); }}>
        <kbd>esc</kbd> close
      </button>
    </div>
  {/if}

  <div class="scroll" bind:this={el}>
    {#if open?.error}
      <div class="note err selectable">{open.error}</div>
    {:else if !data}
      <div class="note">Loading…</div>
    {:else if data.binary}
      <div class="note">Binary file</div>
    {:else if data.hunks.length === 0}
      <div class="note">No text changes{open?.entry.status === 'R' ? ' (renamed)' : ''}</div>
    {:else}
      <div class="lines selectable">
        {#each data.hunks as hunk, i}
          <div class="hunk" class:cur={active && i === repo.hunkIdx} data-hunk={i} onclick={() => (repo.hunkIdx = i)}>
            <span class="hunk-text">{hunk.header}</span>
            {#if stageable}
              <span class="hunk-actions">
                <button onclick={(e) => { e.stopPropagation(); act(i, 'stage'); }}>
                  {kind === 'staged' ? 'Unstage hunk' : 'Stage hunk'}
                </button>
                {#if kind === 'unstaged'}
                  <button class="danger" onclick={(e) => { e.stopPropagation(); act(i, 'discard'); }}>Discard</button>
                {/if}
              </span>
            {/if}
          </div>
          {#each hunk.lines as line, j}
            {#if line.kind === '\\'}
              <div class="line meta"><span class="no"></span><span class="no"></span><span class="text">{line.text}</span></div>
            {:else}
              {@const picked = active && repo.lineMode && i === repo.hunkIdx && j >= selLo && j <= selHi}
              <div
                class="line"
                class:added={line.kind === '+'}
                class:removed={line.kind === '-'}
                class:picked
                class:cursor={picked && j === repo.lineCursor}
                data-line="{i}:{j}"
              >
                <span class="no">{line.oldNo ?? ''}</span>
                <span class="no">{line.newNo ?? ''}</span>
                <span class="sign">{line.kind}</span>
                <span class="text">{line.text}</span>
              </div>
            {/if}
          {/each}
        {/each}
        {#if data.truncated}
          <div class="note">Diff too long, rest not shown.</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .diff {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--panel);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .focused .bar {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .path {
    font-weight: 500;
    min-width: 0;
  }
  .tag {
    font-size: 11px;
    color: var(--text-dim);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 0 6px;
    flex: none;
  }
  .add {
    color: var(--green);
    font-size: 12px;
  }
  .del {
    color: var(--red);
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .hints {
    display: flex;
    gap: 12px;
    font-size: 11px;
    flex: none;
    white-space: nowrap;
  }
  .hints kbd + kbd {
    margin-left: 2px;
  }
  .x {
    color: var(--text-faint);
    font-size: 12px;
    flex: none;
  }
  .x:hover {
    color: var(--text);
  }
  .scroll {
    flex: 1;
    overflow: auto;
  }
  .lines {
    display: inline-block;
    min-width: 100%;
    font: 12px/20px var(--mono);
    padding-bottom: 40px;
  }
  .hunk {
    display: flex;
    align-items: center;
    padding: 0 12px;
    color: var(--text-faint);
    background: var(--raised);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-left: 2px solid transparent;
    margin-top: 8px;
    white-space: pre;
    position: sticky;
    left: 0;
    user-select: none;
    -webkit-user-select: none;
    cursor: default;
  }
  .hunk:first-child {
    margin-top: 0;
    border-top: 0;
  }
  .hunk.cur {
    border-left-color: var(--accent);
    color: var(--text);
    background: var(--select);
  }
  .hunk-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hunk-actions {
    display: flex;
    gap: 4px;
    visibility: hidden;
    font-family: var(--font);
  }
  .hunk:hover .hunk-actions {
    visibility: visible;
  }
  .hunk-actions button {
    height: 18px;
    padding: 0 8px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .hunk-actions button:hover {
    background: var(--border-strong);
    color: var(--text);
  }
  .hunk-actions .danger:hover {
    color: var(--red);
  }
  .line {
    display: flex;
    white-space: pre;
    tab-size: 4;
  }
  .no {
    width: 46px;
    flex: none;
    padding-right: 8px;
    text-align: right;
    color: var(--text-faint);
    user-select: none;
    -webkit-user-select: none;
  }
  .sign {
    width: 18px;
    flex: none;
    text-align: center;
    color: var(--text-faint);
    user-select: none;
    -webkit-user-select: none;
  }
  .text {
    padding-right: 24px;
  }
  .added {
    background: var(--diff-add);
  }
  .added .sign {
    color: var(--green);
  }
  .removed {
    background: var(--diff-del);
  }
  .removed .sign {
    color: var(--red);
  }
  .picked {
    box-shadow: inset 2px 0 0 var(--accent);
    background: var(--accent-dim);
  }
  .picked.added {
    background: color-mix(in srgb, var(--green) 28%, transparent);
  }
  .picked.removed {
    background: color-mix(in srgb, var(--red) 32%, transparent);
  }
  .cursor .no {
    color: var(--text);
  }
  .meta .text {
    color: var(--text-faint);
    font-style: italic;
    padding-left: 18px;
  }
  .note {
    padding: 24px;
    color: var(--text-faint);
    font: 13px var(--font);
  }
  .note.err {
    color: var(--red);
    white-space: pre-wrap;
  }
</style>
