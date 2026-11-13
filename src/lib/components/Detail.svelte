<script lang="ts">
  import { untrack } from 'svelte';
  import { WT, type FileEntry, type RepoState } from '$lib/state/repo.svelte';
  import { fullTime, splitPath, clamp } from '$lib/util';
  import { applyStash, commit, discardFile, stageAll, toggleAmend, toggleStage, unstageAll } from '$lib/actions';
  import { app } from '$lib/state/app.svelte';

  let { repo }: { repo: RepoState } = $props();
  let el = $state<HTMLDivElement>();

  const isWt = $derived(repo.selectedId === WT);
  const detail = $derived(repo.detail?.id === repo.selectedId ? repo.detail : null);
  const subject = $derived(repo.selectedStash?.message ?? detail?.message.split('\n')[0] ?? '');
  const body = $derived(detail?.message.split('\n').slice(1).join('\n').trim() ?? '');

  let msgEl = $state<HTMLTextAreaElement>();
  let filterEl = $state<HTMLInputElement>();
  let seenFilterFocus = untrack(() => repo.fileFilterFocus);

  $effect(() => {
    const n = repo.fileFilterFocus;
    if (n !== seenFilterFocus && filterEl) {
      seenFilterFocus = n;
      filterEl.focus();
      filterEl.select();
    }
  });

  function setView(view: 'list' | 'tree') {
    if (repo.prefs.fileView !== view) repo.toggleFileView();
    app.save();
  }
  let seenFocus = untrack(() => repo.commitFocus);
  const subjectLen = $derived(repo.commitMsg.split('\n')[0].length);
  const rows = $derived(clamp(repo.commitMsg.split('\n').length + 1, 3, 12));

  // `c` asks for the message box; wait until it is on screen.
  $effect(() => {
    const n = repo.commitFocus;
    if (n !== seenFocus && msgEl) {
      seenFocus = n;
      msgEl.focus();
    }
  });

  /**
   * Checkbox: checked means "goes into the commit". Shift extends from the
   * cursor row; a click on a marked row applies to every marked row.
   */
  function check(e: MouseEvent, i: number, f: FileEntry) {
    e.stopPropagation();
    e.preventDefault();
    let entries: FileEntry[];
    if (e.shiftKey) {
      const lo = Math.min(repo.fileIdx, i);
      const hi = Math.max(repo.fileIdx, i);
      entries = repo.files.slice(lo, hi + 1);
    } else if (repo.marks.includes(f.key)) {
      entries = repo.targets();
    } else {
      entries = [f];
    }
    toggleStage(repo, entries, f);
  }

  const markedUnstaged = $derived(
    repo.files.filter((f) => f.group === 'unstaged' && repo.marks.includes(f.key)).length,
  );

  const GROUP_LABEL = { staged: 'Staged', unstaged: 'Unstaged', commit: 'Changed files' };

  $effect(() => {
    const i = repo.fileIdx;
    if (repo.focus !== 'files') return;
    el?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function pick(e: MouseEvent, i: number, entry: FileEntry) {
    repo.focus = 'files';
    if (entry.group !== 'commit' && e.shiftKey) return repo.markRange(i);
    if (entry.group !== 'commit' && e.metaKey) return repo.toggleMark(i);
    repo.clearMarks();
    repo.fileIdx = i;
    repo.openDiff(entry);
  }

</script>

<div class="detail" class:focused={repo.focus === 'files'}>
  {#if isWt}
    <div class="head compose">
      <textarea
        bind:this={msgEl}
        bind:value={repo.commitMsg}
        {rows}
        placeholder={repo.amend ? 'Amend message' : 'Commit message'}
        spellcheck="false"
      ></textarea>
      <div class="compose-row">
        <label class="amend">
          <input type="checkbox" checked={repo.amend} onchange={() => toggleAmend(repo)} />
          Amend
        </label>
        <span class="len" class:over={subjectLen > 50} title="Subject line length (aim for 50 or less)">
          {subjectLen || ''}
        </span>
        <button class="commit" disabled={!!repo.op} onclick={() => commit(repo)}>
          {repo.amend ? 'Amend' : 'Commit'} <kbd>⌘↵</kbd>
        </button>
      </div>
    </div>
  {:else if detail}
    <div class="head">
      {#if repo.selectedStash}
        {@const stash = repo.selectedStash}
        <div class="compose-row">
          <span class="faint grow">{stash.name} · Preview</span>
          <button class="mini" disabled={!!repo.op} onclick={() => applyStash(repo, stash)}>Apply</button>
          <button class="mini" disabled={!!repo.op} onclick={() => applyStash(repo, stash, true)}>Pop</button>
        </div>
      {/if}
      <div class="title selectable">{subject}</div>
      {#if body}<pre class="body selectable">{body}</pre>{/if}
      <div class="meta">
        <span class="faint">Author</span>
        <span class="truncate selectable" title={detail.email}>{detail.author}</span>
        <span class="faint">Date</span>
        <span>{fullTime(detail.time)}</span>
        <span class="faint">{repo.selectedStash ? 'Stash' : 'Commit'}</span>
        <span class="mono selectable">{detail.id.slice(0, 12)}</span>
        {#if detail.parents.length && !repo.selectedStash}
          <span class="faint">{detail.parents.length > 1 ? 'Parents' : 'Parent'}</span>
          <span class="parents">
            {#each detail.parents as p}
              <button class="mono link" onclick={() => repo.revealCommit(p)}>{p.slice(0, 7)}</button>
            {/each}
          </span>
        {/if}
      </div>
    </div>
  {:else if repo.selectedId}
    <div class="head"><div class="faint">Loading…</div></div>
  {/if}

  {#if repo.fileTotal > 0}
    <div class="filebar">
      <input
        bind:this={filterEl}
        bind:value={repo.fileFilter}
        placeholder="Search files"
        spellcheck="false"
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            filterEl?.blur();
            repo.focus = 'files';
            repo.fileIdx = 0;
          }
        }}
      />
      {#if repo.fileFilter}
        <button class="mini" title="Clear search (esc)" onclick={() => (repo.fileFilter = '')}>×</button>
      {/if}
      <div class="seg" title="List or tree view (T)">
        <button class:on={repo.prefs.fileView === 'list'} onclick={() => setView('list')} aria-label="List view">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 2.5h10M1 6h10M1 9.5h10" /></svg>
        </button>
        <button class:on={repo.prefs.fileView === 'tree'} onclick={() => setView('tree')} aria-label="Tree view">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 2.5h6M4 6h7M4 9.5h7M2 2.5v7" /></svg>
        </button>
      </div>
    </div>
  {/if}
  <div class="files" bind:this={el}>
    {#each repo.fileRows as row (row.type === 'file' ? row.entry.key : row.type === 'dir' ? row.key : row.group)}
      {#if row.type === 'group'}
        <div class="group">
          {#if row.group !== 'commit'}
            <input
              type="checkbox"
              checked={row.group === 'staged'}
              title={row.group === 'staged' ? 'Deselect all (unstage everything)' : 'Select all (stage everything)'}
              onclick={(e) => {
                e.preventDefault();
                if (row.group === 'staged') unstageAll(repo);
                else stageAll(repo);
              }}
            />
          {/if}
          <span>{GROUP_LABEL[row.group]}</span>
          <span class="n">{row.count}</span>
          <span class="grow"></span>
          {#if row.group === 'staged'}
            <button class="mini" onclick={() => unstageAll(repo)}>Deselect all</button>
          {:else if row.group === 'unstaged'}
            <button class="mini" onclick={() => stageAll(repo)}>Select all</button>
          {/if}
        </div>
      {:else if row.type === 'dir'}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="file dir" style:padding-left="{10 + row.depth * 14}px" title={row.label} onclick={() => repo.toggleDir(row.key)}>
          <span class="chev" class:collapsed={row.collapsed}>▾</span>
          {#if row.entries[0]?.group !== 'commit'}
            <input
              type="checkbox"
              checked={row.entries[0]?.group === 'staged'}
              title="Whole folder"
              onclick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                toggleStage(repo, row.entries, row.entries[0]);
              }}
            />
          {/if}
          <span class="name truncate">{row.label}</span>
          <span class="n">{row.entries.length}</span>
        </div>
      {:else}
        {@const f = row.entry}
        {@const i = row.index}
        {@const p = splitPath(f.path)}
        {@const tree = repo.prefs.fileView === 'tree'}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="file"
          class:sel={i === repo.fileIdx}
          class:open={repo.diff?.entry.key === f.key}
          class:marked={repo.marks.includes(f.key)}
          data-idx={i}
          style:padding-left="{10 + row.depth * 14 + (tree ? 16 : 0)}px"
          title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
          onclick={(e) => pick(e, i, f)}
        >
          {#if f.group !== 'commit'}
            <input
              type="checkbox"
              checked={f.group === 'staged'}
              title={f.group === 'staged' ? 'In the commit — click to leave out' : 'Click to include in the commit'}
              onclick={(e) => check(e, i, f)}
            />
          {/if}
          <span class="st st-{f.status === '!' ? 'U' : f.status}">{f.status}</span>
          <span class="name truncate">{p.name}</span>
          {#if !tree}<span class="dir-path truncate">{p.dir}</span>{/if}
        </div>
      {/if}
    {/each}
    {#if repo.fileTotal > 0 && repo.files.length === 0 && repo.fileFilter}
      <div class="none faint">No files match “{repo.fileFilter}”.</div>
    {/if}
    {#if isWt && repo.fileTotal === 0}
      <div class="none faint">Working tree clean</div>
    {:else if detail && repo.selectedStash && repo.fileTotal === 0}
      <div class="none faint">No files in this stash</div>
    {/if}
  </div>
  {#if isWt && repo.marks.length}
    <div class="selbar">
      <span>{repo.marks.length} selected</span>
      <span class="grow"></span>
      <button class="mini" onclick={() => toggleStage(repo)}>Stage / unstage</button>
      <button class="mini danger" disabled={!markedUnstaged} title={markedUnstaged ? '' : 'Only unstaged changes can be discarded'} onclick={() => discardFile(repo)}>
        Discard{markedUnstaged ? ` ${markedUnstaged}` : ''}…
      </button>
      <button class="mini" onclick={() => repo.clearMarks()}>Clear</button>
    </div>
  {/if}
  {#if isWt && repo.files.length && repo.focus === 'files' && !app.dialog && !repo.marks.length}
    <div class="hints faint">
      <span><kbd>space</kbd> select for commit</span>
      <span><kbd>⇧J</kbd><kbd>⇧K</kbd> multi-select</span>
      <span><kbd>A</kbd> all</span>
      <span><kbd>↵</kbd> diff</span>
      <span><kbd>⌫</kbd> discard</span>
      <span><kbd>T</kbd> tree</span>
      <span><kbd>/</kbd> search</span>
      <span><kbd>c</kbd> message</span>
    </div>
  {/if}
</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--bg);
  }
  .head {
    padding: 14px 14px 12px;
    border-bottom: 1px solid var(--border);
    flex: none;
    max-height: 50%;
    overflow-y: auto;
  }
  .compose {
    padding: 10px;
    overflow: visible;
    max-height: none;
  }
  textarea {
    display: block;
    width: 100%;
    resize: none;
    padding: 8px 10px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    line-height: 1.5;
  }
  textarea:focus {
    border-color: var(--accent);
  }
  .compose-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .amend {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .len {
    flex: 1;
    text-align: right;
    font-size: 11px;
    color: var(--text-faint);
  }
  .len.over {
    color: var(--yellow);
  }
  .commit {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  .commit:hover {
    background: var(--accent-hover);
  }
  .commit:disabled {
    opacity: 0.5;
  }
  .commit kbd {
    background: rgba(0, 0, 0, 0.18);
    border-color: transparent;
    color: inherit;
  }
  input[type='checkbox'] {
    width: 13px;
    height: 13px;
    margin: 0;
    flex: none;
    accent-color: var(--accent);
  }
  .grow {
    flex: 1;
  }
  .mini {
    height: 20px;
    padding: 0 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-dim);
  }
  .mini:hover:not(:disabled) {
    background: var(--border-strong);
    color: var(--text);
  }
  .mini:disabled {
    opacity: 0.4;
  }
  .mini.danger:hover:not(:disabled) {
    color: var(--red);
  }
  .file.marked {
    background: var(--accent-dim);
  }
  .filebar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 0;
    flex: none;
  }
  .filebar input {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .filebar input:focus {
    border-color: var(--accent);
  }
  .seg {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
    flex: none;
  }
  .seg button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 22px;
    color: var(--text-faint);
  }
  .seg button.on {
    background: var(--select);
    color: var(--text);
  }
  .seg svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
  }
  .file.dir {
    color: var(--text-dim);
    gap: 6px;
  }
  .file.dir .name {
    flex: 1;
    max-width: none;
  }
  .file.dir .n {
    font-size: 11px;
    color: var(--text-faint);
  }
  .chev {
    width: 10px;
    flex: none;
    font-size: 9px;
    text-align: center;
    color: var(--text-faint);
    transition: transform 0.12s ease;
  }
  .chev.collapsed {
    transform: rotate(-90deg);
  }
  .selbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px 6px 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--accent);
    flex: none;
  }
  .stage {
    width: 20px;
    height: 20px;
    flex: none;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 15px;
    line-height: 18px;
    visibility: hidden;
  }
  .file:hover .stage {
    visibility: visible;
  }
  .stage:hover {
    background: var(--border-strong);
    color: var(--text);
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    flex: none;
  }
  .title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    margin-bottom: 6px;
    overflow-wrap: anywhere;
  }
  .body {
    margin: 0 0 10px;
    font: 12px/1.5 var(--font);
    color: var(--text-dim);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .meta {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 3px 8px;
    font-size: 12px;
    margin-top: 8px;
  }
  .parents {
    display: flex;
    gap: 8px;
  }
  .link {
    color: var(--accent);
  }
  .link:hover {
    text-decoration: underline;
  }
  .files {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 12px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 12px 4px 12px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .n {
    font-weight: 400;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 24px;
    padding: 0 12px 0 10px;
    border-left: 2px solid transparent;
  }
  .file:hover {
    background: var(--hover);
  }
  .file.open {
    background: var(--hover);
  }
  .focused .file.sel {
    background: var(--select);
    border-left-color: var(--accent);
  }
  .st {
    width: 12px;
    flex: none;
    text-align: center;
    font: 600 11px var(--mono);
    color: var(--text-dim);
  }
  .st-M {
    color: var(--yellow);
  }
  .st-A {
    color: var(--green);
  }
  .st-D {
    color: var(--red);
  }
  .st-R,
  .st-C {
    color: var(--purple);
  }
  .st-U {
    color: var(--red);
  }
  .name {
    flex: none;
    max-width: 70%;
  }
  .dir-path {
    flex: 1;
    min-width: 0;
    color: var(--text-faint);
    font-size: 12px;
  }
  .none {
    padding: 16px 14px;
  }
</style>
