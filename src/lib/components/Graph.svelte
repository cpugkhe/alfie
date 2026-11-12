<script lang="ts">
  import { untrack } from 'svelte';
  import { WT, type RepoState } from '$lib/state/repo.svelte';
  import type { GraphRow } from '$lib/api';
  import { relTime } from '$lib/util';
  import { checkoutRef, commitMenu } from '$lib/actions';
  import { app } from '$lib/state/app.svelte';

  let { repo }: { repo: RepoState } = $props();

  const ROW = 26;
  const LANE = 14;
  const PAD = 12;
  const MAX_LANES = 16;
  const MID = ROW / 2;
  const MAX_BADGES = 3;

  let el = $state<HTMLDivElement>();
  let searchEl = $state<HTMLInputElement>();
  let scrollTop = $state(0);
  let height = $state(600);

  const filtering = $derived(repo.filter.trim() !== '');

  const maxLane = $derived.by(() => {
    let m = 0;
    for (const c of repo.commits) {
      if (c.graph.lane > m) m = c.graph.lane;
      for (const [lane] of c.graph.bottom) if (lane > m) m = lane;
    }
    return Math.min(m, MAX_LANES - 1);
  });
  const graphW = $derived(filtering ? 0 : PAD * 2 + maxLane * LANE);

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 8));
  const end = $derived(Math.min(repo.items.length, start + Math.ceil(height / ROW) + 16));
  const visible = $derived(repo.items.slice(start, end));

  const x = (lane: number) => PAD + Math.min(lane, MAX_LANES - 1) * LANE;
  const color = (c: number) => `var(--lane-${c % 8})`;

  function paths(g: GraphRow): { d: string; color: string }[] {
    const out: { d: string; color: string }[] = [];
    const nx = x(g.lane);
    for (const [lane, c] of g.through) {
      out.push({ d: `M${x(lane)} 0V${ROW}`, color: color(c) });
    }
    for (const [lane, c] of g.top) {
      const lx = x(lane);
      out.push({
        d: lx === nx ? `M${nx} 0V${MID}` : `M${lx} 0C${lx} ${MID} ${nx} 0 ${nx} ${MID}`,
        color: color(c),
      });
    }
    for (const [lane, c] of g.bottom) {
      const lx = x(lane);
      out.push({
        d: lx === nx ? `M${nx} ${MID}V${ROW}` : `M${nx} ${MID}C${nx} ${ROW} ${lx} ${MID} ${lx} ${ROW}`,
        color: color(c),
      });
    }
    return out;
  }

  // Keep the selected row in view when it changes from the keyboard.
  $effect(() => {
    repo.reveal;
    const i = untrack(() => repo.selIndex);
    if (!el || i < 0) return;
    const top = i * ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
  });

  $effect(() => {
    if (repo.searchFocus && repo.filterOpen) searchEl?.focus();
  });

  // Restore the scroll offset when this tab is shown again.
  $effect(() => {
    if (el) el.scrollTop = untrack(() => repo.graphScroll);
  });

  function onScroll() {
    if (!el) return;
    scrollTop = el.scrollTop;
    repo.graphScroll = scrollTop;
    if (repo.hasMore && !filtering && end >= repo.items.length - 40) repo.loadMore();
  }

  function pick(id: string) {
    repo.focus = 'graph';
    repo.select(id, { reveal: false });
  }
</script>

<div class="graph" class:focused={repo.focus === 'graph'}>
  {#if repo.filterOpen || filtering}
    <div class="search">
      <span class="faint">Search</span>
      <input
        bind:this={searchEl}
        bind:value={repo.filter}
        placeholder="subject, author or SHA"
        spellcheck="false"
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            searchEl?.blur();
            repo.focus = 'graph';
            if (repo.selIndex < 0) repo.selectIndex(0);
          }
        }}
      />
      <span class="faint">{repo.items.length} of {repo.commits.length}</span>
    </div>
  {/if}

  <div class="scroll" bind:this={el} bind:clientHeight={height} onscroll={onScroll}>
    <div class="spacer" style:height="{repo.items.length * ROW}px">
      <div class="window" style:transform="translateY({start * ROW}px)">
        {#each visible as item (item.type === 'wt' ? WT : item.commit.id)}
          {#if item.type === 'wt'}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="row wt" class:sel={repo.selectedId === WT} onclick={() => pick(WT)}>
              {#if graphW}
                <svg width={graphW} height={ROW}>
                  <circle cx={x(0)} cy={MID} r="4" class="wt-node" />
                </svg>
              {/if}
              <span class="subject truncate">Uncommitted changes</span>
              <span class="count">{repo.dirtyCount}</span>
            </div>
          {:else}
            {@const c = item.commit}
            {@const badges = repo.badges.get(c.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="row commit"
              class:sel={repo.selectedId === c.id}
              style:--lane={color(c.graph.color)}
              style:--nx="{graphW ? x(c.graph.lane) - 2 : 0}px"
              onclick={() => pick(c.id)}
              oncontextmenu={(e) => {
                pick(c.id);
                app.openMenu(e, commitMenu(repo, c.id));
              }}
            >
              <span class="lead">
              {#if graphW}
                <svg width={graphW} height={ROW}>
                  {#each paths(c.graph) as p}
                    <path d={p.d} stroke={p.color} />
                  {/each}
                  {#if c.parents.length > 1}
                    <circle cx={x(c.graph.lane)} cy={MID} r="3" class="merge" stroke={color(c.graph.color)} />
                  {:else}
                    <circle cx={x(c.graph.lane)} cy={MID} r="3.5" fill={color(c.graph.color)} />
                  {/if}
                  {#if c.id === repo.head}
                    <circle cx={x(c.graph.lane)} cy={MID} r="6" class="head-ring" stroke={color(c.graph.color)} />
                  {/if}
                </svg>
              {/if}
              {#if badges}
                <span class="badges">
                  {#each badges.slice(0, MAX_BADGES) as b}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span
                      class="badge {b.kind}"
                      class:branch={!!b.ref}
                      title={b.ref
                        ? `${b.label}${b.synced ? ' (in sync with upstream)' : ''} — double-click to check out`
                        : b.label}
                      ondblclick={(e) => {
                        if (!b.ref || b.kind === 'head') return;
                        e.stopPropagation();
                        checkoutRef(repo, b.ref);
                      }}
                    >
                      <span class="truncate">{b.label}</span>{#if b.synced}<span class="sync">⇄</span>{/if}
                    </span>
                  {/each}
                  {#if badges.length > MAX_BADGES}
                    <span class="badge tag" title={badges.slice(MAX_BADGES).map((b) => b.label).join(', ')}
                      >+{badges.length - MAX_BADGES}</span
                    >
                  {/if}
                </span>
              {/if}
              </span>
              <span class="subject truncate" class:is-merge={c.parents.length > 1}>{c.subject}</span>
              <span class="author truncate">{c.author}</span>
              <span class="sha mono">{c.id.slice(0, 7)}</span>
              <span class="time">{relTime(c.time)}</span>
            </div>
          {/if}
        {/each}
      </div>
    </div>

    {#if repo.loaded && repo.items.length === 0}
      <div class="empty">
        {filtering ? 'No commits match.' : 'No commits yet.'}
      </div>
    {/if}
  </div>
</div>

<style>
  .graph {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
    background: var(--panel);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    flex: none;
  }
  .search input {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }
  .spacer {
    position: relative;
  }
  .window {
    position: absolute;
    inset: 0 0 auto 0;
  }
  .row {
    display: flex;
    align-items: center;
    height: 26px;
    padding-right: 12px;
    gap: 8px;
    border-left: 2px solid transparent;
  }
  /* Each commit carries a band in its branch colour, starting at its node. */
  .lead {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    max-width: 55%;
    min-width: 0;
    height: 20px;
    padding-right: 6px;
    border-radius: 0 5px 5px 0;
    background-image: linear-gradient(
      90deg,
      transparent var(--nx),
      color-mix(in srgb, var(--lane) 20%, transparent) var(--nx),
      color-mix(in srgb, var(--lane) 9%, transparent) 100%
    );
  }
  .lead svg {
    margin-block: -3px;
  }
  .row:hover {
    background-color: var(--hover);
  }
  .row.sel {
    background-color: var(--hover);
  }
  .focused .row.sel {
    background-color: var(--select);
    border-left-color: var(--accent);
  }
  svg {
    flex: none;
    display: block;
    margin-left: -2px;
  }
  path {
    fill: none;
    stroke-width: 1.6;
  }
  .merge {
    fill: var(--panel);
    stroke-width: 1.6;
  }
  .head-ring {
    fill: none;
    stroke-width: 1.2;
    opacity: 0.55;
  }
  .wt-node {
    fill: none;
    stroke: var(--yellow);
    stroke-width: 1.6;
    stroke-dasharray: 2.5 2;
  }
  .row:not(:has(svg)) {
    padding-left: 12px;
  }
  .row:not(:has(svg)) .lead:empty {
    display: none;
  }
  .subject {
    flex: 1;
    min-width: 60px;
  }
  .subject.is-merge {
    color: var(--text-dim);
  }
  .wt .subject {
    color: var(--yellow);
  }
  .count {
    font-size: 11px;
    color: var(--yellow);
    background: color-mix(in srgb, var(--yellow) 14%, transparent);
    border-radius: 8px;
    padding: 1px 7px;
  }
  .author {
    width: 120px;
    flex: none;
    color: var(--text-dim);
    font-size: 12px;
    text-align: right;
  }
  .sha {
    flex: none;
    color: var(--text-faint);
    font-size: 11px;
  }
  .time {
    width: 34px;
    flex: none;
    color: var(--text-faint);
    font-size: 12px;
    text-align: right;
  }
  .badges {
    display: flex;
    gap: 4px;
    flex: 0 1 auto;
    min-width: 0;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 180px;
    min-width: 0;
    height: 18px;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 16px;
    border: 1px solid var(--border-strong);
    color: var(--text);
    background: var(--raised);
  }
  /* Branch labels share the colour of the line they sit on. */
  .badge.local,
  .badge.head,
  .badge.remote {
    color: var(--lane);
    border-color: color-mix(in srgb, var(--lane) 45%, transparent);
    background: color-mix(in srgb, var(--lane) 12%, transparent);
  }
  .badge.head {
    color: var(--bg);
    background: var(--lane);
    border-color: var(--lane);
    font-weight: 600;
  }
  .badge.remote {
    background: transparent;
    border-style: dashed;
  }
  .badge.branch:not(.head):hover {
    background: color-mix(in srgb, var(--lane) 28%, transparent);
  }
  .badge.tag {
    background: transparent;
    border-color: transparent;
    color: var(--text-dim);
    padding: 0 2px;
  }
  .badge.tag:not(:has(.truncate))::before {
    content: none;
  }
  .sync {
    opacity: 0.6;
    font-size: 10px;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }
  .graph {
    container-type: inline-size;
  }
  @container (max-width: 640px) {
    .sha {
      display: none;
    }
  }
  @container (max-width: 480px) {
    .author {
      display: none;
    }
  }
</style>
