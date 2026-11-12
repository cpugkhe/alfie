<script lang="ts">
  import type { RepoState, SidebarItem } from '$lib/state/repo.svelte';
  import { activateSidebar, newBranch, refMenu, stashMenu } from '$lib/actions';
  import { app } from '$lib/state/app.svelte';
  import type { SectionKey } from '$lib/api';

  let { repo }: { repo: RepoState } = $props();
  let el = $state<HTMLDivElement>();

  $effect(() => {
    const i = repo.sidebarIdx;
    if (repo.focus !== 'sidebar') return;
    el?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  /** Click selects and shows the commit; double click acts like Enter. */
  function pick(i: number) {
    repo.focus = 'sidebar';
    repo.sidebarIdx = i;
    const item = repo.sidebar[i];
    if (item.type === 'ref') repo.revealCommit(item.ref.target);
  }

  type Header = Extract<SidebarItem, { type: 'header' }>;
  /** The flat keyboard list, regrouped so each section can scroll by itself. */
  const groups = $derived.by(() => {
    const out: { header: Header; at: number; rows: { item: SidebarItem; i: number }[] }[] = [];
    repo.sidebar.forEach((item, i) => {
      if (item.type === 'header') out.push({ header: item, at: i, rows: [] });
      else out.at(-1)?.rows.push({ item, i });
    });
    return out;
  });

  function toggle(key: SectionKey) {
    repo.focus = 'sidebar';
    repo.toggleSection(key);
    app.save();
  }

  function sort(e: MouseEvent, key: SectionKey) {
    e.stopPropagation();
    repo.cycleSort(key);
    app.save();
  }
</script>

<div class="sidebar" class:focused={repo.focus === 'sidebar'} bind:this={el}>
  {#each groups as g (g.header.key)}
    {@const item = g.header}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="header" class:sel={g.at === repo.sidebarIdx} data-idx={g.at} onclick={() => toggle(item.key)}>
      <span class="chev" class:collapsed={item.collapsed}>▾</span>
      <span class="label">{item.label}</span>
      <span class="n">{item.count}</span>
      <span class="spacer"></span>
      {#if item.key === 'local'}
        <button
          class="sort"
          title="New branch from HEAD (⌘⇧N)"
          onclick={(e) => {
            e.stopPropagation();
            newBranch(repo);
          }}>+ New</button
        >
      {/if}
      <button
        class="sort"
        title="Sorted by {item.sort === 'name' ? 'name' : 'most recent commit'} — click or press O to change"
        onclick={(e) => sort(e, item.key)}>{item.sort === 'name' ? 'A–Z' : 'Recent'}</button
      >
    </div>
    {#if g.rows.length}
      <!-- At most ten rows tall; longer sections scroll on their own. -->
      <div class="rows">
        {#each g.rows as row (row.i)}
          {#if row.item.type === 'ref'}
            {@const ref = row.item.ref}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="item"
              class:sel={row.i === repo.sidebarIdx}
              class:current={row.item.current}
              data-idx={row.i}
              title={ref.short}
              onclick={() => pick(row.i)}
              ondblclick={() => activateSidebar(repo)}
              oncontextmenu={(e) => {
                pick(row.i);
                if (row.item.type === 'ref') app.openMenu(e, refMenu(repo, row.item.ref, row.item.current));
              }}
            >
              <span class="mark">{row.item.current ? '●' : ''}</span>
              <span class="label truncate">{ref.short}</span>
              {#if ref.gone}
                <span class="track gone" title="Upstream branch is gone">gone</span>
              {:else if ref.ahead || ref.behind}
                <span class="track">
                  {#if ref.ahead}↑{ref.ahead}{/if}
                  {#if ref.behind}↓{ref.behind}{/if}
                </span>
              {/if}
            </div>
          {:else if row.item.type === 'stash'}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="item"
              class:sel={row.i === repo.sidebarIdx}
              data-idx={row.i}
              title={row.item.stash.message}
              onclick={() => pick(row.i)}
              ondblclick={() => activateSidebar(repo)}
              oncontextmenu={(e) => {
                pick(row.i);
                if (row.item.type === 'stash') app.openMenu(e, stashMenu(repo, row.item.stash));
              }}
            >
              <span class="mark"></span>
              <span class="label truncate">{row.item.stash.message}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .sidebar {
    height: 100%;
    overflow-y: auto;
    background: var(--bg);
    padding: 4px 0 12px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    margin-top: 6px;
    padding: 0 8px 0 6px;
    border-left: 2px solid transparent;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .header:hover {
    color: var(--text-dim);
  }
  .chev {
    width: 12px;
    text-align: center;
    font-size: 10px;
    transition: transform 0.12s ease;
  }
  .chev.collapsed {
    transform: rotate(-90deg);
  }
  .n {
    font-weight: 400;
  }
  .spacer {
    flex: 1;
  }
  .sort {
    font-size: 10px;
    letter-spacing: 0.02em;
    text-transform: none;
    font-weight: 400;
    color: var(--text-faint);
    padding: 1px 5px;
    border-radius: 4px;
    visibility: hidden;
  }
  .header:hover .sort,
  .focused .header.sel .sort {
    visibility: visible;
  }
  .sort:hover {
    background: var(--border-strong);
    color: var(--text);
  }
  .rows {
    /* ten 24px rows */
    max-height: 240px;
    overflow-y: auto;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 10px 0 6px;
    border-left: 2px solid transparent;
    color: var(--text-dim);
  }
  .item:hover {
    background: var(--hover);
  }
  .item.current {
    color: var(--text);
    font-weight: 500;
  }
  .focused .sel {
    background: var(--select);
    border-left-color: var(--accent);
    color: var(--text);
  }
  .mark {
    width: 12px;
    flex: none;
    font-size: 8px;
    color: var(--accent);
    text-align: center;
  }
  .item .label {
    flex: 1;
    min-width: 0;
  }
  .track {
    flex: none;
    font-size: 11px;
    color: var(--text-faint);
  }
  .track.gone {
    color: var(--red);
  }
</style>
