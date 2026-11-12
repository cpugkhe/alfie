<script lang="ts">
  import { untrack } from 'svelte';
  import { WT, type RepoState } from '$lib/state/repo.svelte';
  import type { GraphRow } from '$lib/api';
  import { clamp, relTime } from '$lib/util';
  import { COLUMN_SPACING, GRAPH_COLUMNS, MAX_COLUMN_WIDTH, graphColumnMin, graphColumnWidths, type GraphColumn } from '$lib/graph-columns';
  import { checkoutRef, commitMenu, refMenu, refsOnCommitMenu } from '$lib/actions';
  import { app } from '$lib/state/app.svelte';

  let { repo }: { repo: RepoState } = $props();

  const ROW = 26;
  const LANE = 14;
  const PAD = 12;
  const MAX_LANES = 16;
  const MID = ROW / 2;
  // The branch column is narrow: one label, the rest behind a "+N".
  const MAX_BADGES = 1;

  let el = $state<HTMLDivElement>();
  let searchEl = $state<HTMLInputElement>();
  let scrollTop = $state(0);
  let height = $state(600);
  let viewportWidth = $state(800);
  let drag = $state<{ column: GraphColumn; pointer: number; x: number; width: number; scale: number; saved: number | undefined } | null>(null);

  const filtering = $derived(repo.filter.trim() !== '');

  const maxLane = $derived.by(() => {
    let m = 0;
    for (const c of repo.commits) {
      if (c.graph.lane > m) m = c.graph.lane;
      for (const [lane] of c.graph.bottom) if (lane > m) m = lane;
    }
    return Math.min(m, MAX_LANES - 1);
  });
  const naturalGraphW = $derived(filtering ? 0 : PAD * 2 + maxLane * LANE);
  const widths = $derived(graphColumnWidths(viewportWidth, naturalGraphW, repo.prefs.graphColumns ?? {}));
  const graphW = $derived(filtering ? 0 : widths.graph);
  const columns = $derived(GRAPH_COLUMNS.filter((c) => c.key !== 'graph' || !filtering));
  const template = $derived(columns.map((c) => `${widths[c.key]}px`).join(' '));
  const tableWidth = $derived(columns.reduce((sum, c) => sum + widths[c.key], COLUMN_SPACING - (filtering ? 8 : 0)));

  function setWidth(column: GraphColumn, width: number) {
    repo.prefs.graphColumns = { ...repo.prefs.graphColumns, [column]: clamp(width, graphColumnMin(column, naturalGraphW), MAX_COLUMN_WIDTH) };
  }

  function resetWidth(column: GraphColumn) {
    const saved = { ...repo.prefs.graphColumns };
    delete saved[column];
    repo.prefs.graphColumns = saved;
    app.save();
  }

  function startResize(e: PointerEvent, column: GraphColumn) {
    if (e.button !== 0 || !e.isPrimary || drag || !(e.currentTarget instanceof HTMLElement)) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const scale = e.currentTarget.getBoundingClientRect().width / e.currentTarget.offsetWidth;
    drag = { column, pointer: e.pointerId, x: e.clientX, width: widths[column], scale, saved: repo.prefs.graphColumns?.[column] };
  }

  function moveResize(e: PointerEvent) {
    if (!drag || drag.pointer !== e.pointerId) return;
    setWidth(drag.column, drag.width + (e.clientX - drag.x) / drag.scale);
  }

  function endResize(e: PointerEvent) {
    if (!drag || drag.pointer !== e.pointerId) return;
    drag = null;
    app.save();
  }

  function resizeKey(e: KeyboardEvent, column: GraphColumn) {
    if (e.key === 'Tab') { e.stopPropagation(); return; }
    if (e.key === 'Escape' && drag) {
      if (drag.saved === undefined) resetWidth(drag.column);
      else setWidth(drag.column, drag.saved);
      drag = null;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      setWidth(column, widths[column] + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 50 : 10));
    } else if (e.key === 'Home') setWidth(column, graphColumnMin(column, naturalGraphW));
    else if (e.key === 'End') setWidth(column, MAX_COLUMN_WIDTH);
    else if (e.key === 'Enter') resetWidth(column);
    else return;
    e.preventDefault();
    e.stopPropagation();
    app.save();
  }

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
    else if (top + ROW > el.scrollTop + el.clientHeight - 24) el.scrollTop = top + ROW - el.clientHeight + 24;
  });

  $effect(() => {
    if (repo.searchFocus && repo.filterOpen) searchEl?.focus();
  });

  // Restore the scroll offset when this tab is shown again.
  $effect(() => {
    if (el) {
      el.scrollTop = untrack(() => repo.graphScroll);
      el.scrollLeft = untrack(() => repo.graphScrollLeft);
    }
  });

  function onScroll() {
    if (!el) return;
    scrollTop = el.scrollTop;
    repo.graphScroll = scrollTop;
    repo.graphScrollLeft = el.scrollLeft;
    if (repo.hasMore && !filtering && end >= repo.items.length - 40) repo.loadMore();
  }

  function pick(id: string) {
    repo.focus = 'graph';
    repo.select(id, { reveal: false });
  }
</script>

<div class="graph" class:focused={repo.focus === 'graph'} class:resizing={!!drag}>
  {#if repo.historyRef || repo.scope !== 'all'}
    <div class="history">
      <span class="truncate">{repo.historyRef ? repo.historyRef.replace(/^refs\/(heads|remotes)\//, '') : repo.scope === 'current' ? 'Current branch' : 'Local branches'} history</span>
      <button onclick={() => repo.setScope('all')}>Show all branches</button>
    </div>
  {/if}
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

  <div class="scroll" bind:this={el} bind:clientHeight={height} bind:clientWidth={viewportWidth} onscroll={onScroll}>
    <div class="table" style:--columns={template} style:width="max(100%, {tableWidth}px)">
      <div class="cols">
        {#each columns as column (column.key)}
          <div class="col" class:align-end={column.key === 'author' || column.key === 'time'} class:active={drag?.column === column.key}>
            <span class="truncate">{column.label}</span>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (Focusable separators implement the ARIA splitter keyboard pattern.) -->
            <div
              class="resize"
              role="separator"
              tabindex="0"
              aria-label="Resize {column.label} column"
              aria-orientation="vertical"
              aria-valuemin={graphColumnMin(column.key, naturalGraphW)}
              aria-valuemax={MAX_COLUMN_WIDTH}
              aria-valuenow={widths[column.key]}
              aria-valuetext="{Math.round(widths[column.key])} pixels"
              title="Drag to resize · Double-click or press Enter to reset · Arrow keys to adjust"
              onpointerdown={(e) => startResize(e, column.key)}
              onpointermove={moveResize}
              onpointerup={endResize}
              onpointercancel={endResize}
              onlostpointercapture={endResize}
              onkeydown={(e) => resizeKey(e, column.key)}
              ondblclick={() => resetWidth(column.key)}
            ></div>
          </div>
        {/each}
      </div>
    <div class="spacer" style:height="{repo.items.length * ROW}px">
      <div class="window" style:transform="translateY({start * ROW}px)">
        {#each visible as item (item.type === 'wt' ? WT : item.commit.id)}
          {#if item.type === 'wt'}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="row wt" class:sel={repo.selectedId === WT} onclick={() => pick(WT)}>
              <span class="refs"></span>
              {#if graphW}
                <svg width={graphW} height={ROW}>
                  <circle cx={x(0)} cy={MID} r="4" class="wt-node" />
                </svg>
              {/if}
              <span class="subject wt-message"><span class="truncate">Uncommitted changes</span><span class="count">{repo.dirtyCount}</span></span>
            </div>
          {:else}
            {@const c = item.commit}
            {@const badges = repo.badges.get(c.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="row commit"
              class:sel={repo.selectedId === c.id}
              style:--lane={color(c.graph.color)}
              style:--nx="{graphW ? x(c.graph.lane) : 0}px"
              onclick={() => pick(c.id)}
              oncontextmenu={(e) => {
                pick(c.id);
                app.openMenu(e, commitMenu(repo, c.id));
              }}
            >
              <span class="refs">
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
                      oncontextmenu={(e) => {
                        const ref = repo.refs.find((r) => b.ref ? r.short === b.ref.short && r.kind === b.ref.kind : r.kind === 'tag' && r.short === b.label);
                        if (!ref) return;
                        e.stopPropagation();
                        pick(c.id);
                        app.openMenu(e, refMenu(repo, ref, b.kind === 'head'));
                      }}
                      ondblclick={(e) => {
                        if (!b.ref || b.kind === 'head') return;
                        e.stopPropagation();
                        checkoutRef(repo, b.ref);
                      }}
                    >
                      <span class="truncate">{b.label}</span>
                      {#if b.origin}
                        <span class="origin-avatar" title="origin: {repo.origin?.owner ?? 'remote'}{b.synced ? ' — in sync' : ''}">
                          {#if repo.avatar}
                            <img src={repo.avatar} alt="{repo.origin?.owner ?? 'Repository owner'} profile" referrerpolicy="no-referrer" onerror={() => (repo.avatar = null)} />
                          {:else}
                            <span aria-label="Origin repository owner">{(repo.origin?.owner ?? 'origin').slice(0, 1).toUpperCase()}</span>
                          {/if}
                        </span>
                      {:else if b.synced}<span class="sync">⇄</span>{/if}
                    </span>
                  {/each}
                  {#if badges.length > MAX_BADGES}
                    <button
                      class="more"
                      title="{badges.slice(MAX_BADGES).map((b) => b.label).join(', ')} — click to see all and switch"
                      onclick={(e) => {
                        pick(c.id);
                        app.openMenu(e, refsOnCommitMenu(repo, badges));
                      }}>+{badges.length - MAX_BADGES}</button
                    >
                  {/if}
                </span>
                <span class="wire"></span>
              {/if}
              </span>
              <span class="lead" style:width="{graphW}px">
              {#if graphW}
                <svg width={graphW} height={ROW}>
                  {#if badges}
                    <path d="M0 {MID}H{x(c.graph.lane)}" stroke={color(c.graph.color)} class="wire-in" />
                  {/if}
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
    </div>

    {#if repo.loaded && repo.items.length === 0}
      <div class="empty">
        {filtering ? 'No commits match.' : 'No commits yet.'}
      </div>
    {/if}
  </div>
</div>

<style>
  .history {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
    flex: none;
    min-height: 34px;
  }
  .history > span { min-width: 0; }
  .history button:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }
  .history button {
    color: var(--text-dim);
    height: 24px;
    padding: 0 8px;
    border-radius: var(--radius);
    flex: none;
  }
  @media (hover: hover) {
    .history button:hover { background: var(--hover); color: var(--text); }
  }
  @media (prefers-reduced-motion: no-preference) {
    .history button { transition: scale 150ms ease-out; }
    .history button:active { scale: 0.96; }
  }
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
    min-height: 0;
    overflow: auto;
    position: relative;
    scrollbar-gutter: stable;
    overscroll-behavior: contain;
  }
  .table { min-height: 100%; }
  .cols,
  .row {
    display: grid;
    grid-template-columns: var(--columns);
    column-gap: 8px;
  }
  .spacer {
    position: relative;
  }
  .window {
    position: absolute;
    inset: 0 0 auto 0;
  }
  .row {
    align-items: center;
    height: 26px;
    padding-right: 12px;
    border-left: 2px solid transparent;
  }
  /* Each commit carries a band in its branch colour, starting at its node. */
  /* First column: branch and tag labels, wired to their commit. */
  .refs {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 100%;
    padding-left: 8px;
    /* cancel the row gap so the wire runs straight into the graph */
    margin-right: -8px;
  }
  .wire {
    flex: 1;
    min-width: 6px;
    height: 0;
    border-top: 1.2px solid var(--lane);
    opacity: 0.55;
  }
  .wire-in {
    stroke-width: 1.2;
    opacity: 0.55;
  }
  /* Graph column: a band in the branch colour from the node to the column's end. */
  .lead {
    flex: none;
    height: 20px;
    border-radius: 0 4px 4px 0;
    background-image: linear-gradient(
      90deg,
      transparent var(--nx),
      color-mix(in srgb, var(--lane) 22%, transparent) var(--nx),
      color-mix(in srgb, var(--lane) 12%, transparent) 100%
    );
  }
  .cols {
    align-items: center;
    height: 24px;
    padding: 0 12px 0 2px;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .col {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    height: 100%;
    padding: 0 6px 0 0;
  }
  .col:first-child { padding-left: 8px; }
  .col.align-end { justify-content: flex-end; }
  .resize {
    position: absolute;
    inset: 0 -5px 0 auto;
    width: 10px;
    cursor: col-resize;
    touch-action: none;
    outline: none;
  }
  .resize::after {
    content: '';
    position: absolute;
    top: 5px;
    bottom: 5px;
    left: 4px;
    width: 1px;
    background: var(--border-strong);
  }
  .col.active .resize::after,
  .resize:focus-visible::after {
    background: var(--accent);
    width: 2px;
  }
  .resize:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
  .resizing,
  .resizing .row { cursor: col-resize; }
  @media (hover: hover) and (pointer: fine) {
    .resize:hover::after { background: var(--accent); width: 2px; }
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
  .row:not(:has(svg)) .wire {
    display: none;
  }
  .row:not(:has(svg)) .refs {
    margin-right: 0;
  }
  .subject {
    min-width: 0;
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
    flex: none;
  }
  .wt-message { display: flex; align-items: center; gap: 8px; }
  .author {
    color: var(--text-dim);
    font-size: 12px;
    text-align: right;
  }
  .sha {
    color: var(--text-faint);
    font-size: 11px;
    overflow: hidden;
    white-space: nowrap;
  }
  .time {
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
    max-width: 100%;
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
  .more {
    flex: none;
    height: 18px;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--lane);
    border: 1px solid color-mix(in srgb, var(--lane) 35%, transparent);
  }
  .more:hover {
    background: color-mix(in srgb, var(--lane) 22%, transparent);
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
  .origin-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex: none;
    overflow: hidden;
    border-radius: 3px;
    background: var(--raised);
    color: var(--text-dim);
    font-size: 9px;
    line-height: 1;
    outline: 1px solid oklch(1 0 0 / 0.1);
    outline-offset: -1px;
  }
  .origin-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .empty {
    position: absolute;
    inset: 24px 0 0;
    display: grid;
    place-items: center;
    color: var(--text-faint);
    pointer-events: none;
  }
</style>
