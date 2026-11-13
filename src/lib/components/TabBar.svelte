<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { formatKeys } from '$lib/keys/keymap';

  let barEl = $state<HTMLDivElement>();
  const operation = $derived(app.active?.op ?? null);
  /** A drag just ended; swallow the click that follows it. */
  let justDragged = false;

  const DRAG_START = 6;

  /**
   * Pointer-based drag (not HTML5 drag and drop, which the webview's own file
   * drop handling can swallow). Along the bar it reorders tabs; over the
   * content it offers to open the tab in a pane on the right or at the bottom.
   */
  function onPointerDown(e: PointerEvent, path: string, name: string) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.close')) return;
    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START) return;
        dragging = true;
        el.setPointerCapture(ev.pointerId);
      }
      const bar = barEl?.getBoundingClientRect();
      const area = document.querySelector('.panes')?.getBoundingClientRect();
      let zone: 'right' | 'bottom' | null = null;

      if (bar && ev.clientY <= bar.bottom + 4) {
        // Reorder: find the tab under the pointer.
        const tabs = [...(barEl?.querySelectorAll<HTMLElement>('.tab[data-path]') ?? [])];
        const from = app.tabs.findIndex((t) => t.path === path);
        const to = tabs.findIndex((t) => {
          const r = t.getBoundingClientRect();
          return ev.clientX >= r.left && ev.clientX < r.right;
        });
        if (to >= 0 && to !== from) app.moveTab(from, to);
      } else if (area) {
        const fx = (ev.clientX - area.left) / area.width;
        const fy = (ev.clientY - area.top) / area.height;
        // Whichever edge the pointer is closer to wins.
        if (fx > 0.5 || fy > 0.5) zone = fx - 0.5 >= fy - 0.5 ? 'right' : 'bottom';
      }
      app.drag = { path, name, x: ev.clientX, y: ev.clientY, zone };
    };

    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const drag = app.drag;
      app.drag = null;
      if (!dragging) return;
      justDragged = true;
      setTimeout(() => (justDragged = false), 0);
      if (drag?.zone) app.splitWith(path, drag.zone === 'right' ? 'row' : 'column');
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
</script>

<div class="bar" data-tauri-drag-region bind:this={barEl}>
  <div class="tabs">
    {#each app.tabs as tab, i (tab.path)}
      {@const shown = tab === app.primary || tab === app.secondary}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="tab"
        class:active={tab === app.active}
        class:shown
        class:dragging={app.drag?.path === tab.path}
        data-path={tab.path}
        title={tab.path}
        onpointerdown={(e) => onPointerDown(e, tab.path, tab.name)}
        onclick={() => !justDragged && app.goto(i)}
        onauxclick={(e) => e.button === 1 && app.closeTab(i)}
      >
        <span class="name truncate">{tab.name}</span>
        {#if tab.status?.branch}
          <span class="branch truncate">{tab.status.branch}</span>
        {/if}
        {#if tab.dirtyCount > 0}
          <span class="dot" title="{tab.dirtyCount} changed files"></span>
        {/if}
        <button
          class="close"
          aria-label="Close tab"
          onclick={(e) => {
            e.stopPropagation();
            app.closeTab(i);
          }}>×</button
        >
      </div>
    {/each}
    {#if app.space.blank}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="tab shown" class:active={app.space.paneFocus === 0} onclick={() => app.focusPane(0)}>
        <span class="name">New tab</span>
        <button class="close" aria-label="Close tab" onclick={() => (app.space.blank = false)}>×</button>
      </div>
    {/if}
    <button class="add" title="New tab ({formatKeys('mod+t')})" onclick={() => app.newTab()}>+</button>
  </div>
  <div
    class="progress"
    class:running={!!operation}
    role="progressbar"
    aria-label={operation ? `${operation} Wait for this Git operation to finish before starting another.` : 'Git operation'}
    aria-hidden={!operation}
  ></div>
</div>

<style>
  .bar {
    position: relative;
    height: var(--tabbar);
    flex: none;
    display: flex;
    align-items: flex-end;
    /* Room for the macOS window buttons. */
    padding-left: 82px;
    padding-right: 10px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .progress {
    position: absolute;
    z-index: 1;
    inset: auto 0 -1px;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
    background: var(--accent-dim);
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .progress.running {
    opacity: 1;
    transition-duration: 0ms;
  }
  .progress::after {
    content: '';
    display: block;
    width: 40%;
    height: 100%;
    background: linear-gradient(90deg, transparent, var(--accent) 45%, var(--accent-hover) 75%, transparent);
    animation: progress 1.2s linear infinite;
    animation-play-state: paused;
  }
  .progress.running::after {
    animation-play-state: running;
  }
  @keyframes progress {
    from { transform: translateX(-100%); }
    to { transform: translateX(250%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .progress::after {
      width: 100%;
      background: var(--accent);
      animation: none;
    }
  }
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
    height: 30px;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    max-width: 240px;
    min-width: 0;
    padding: 0 6px 0 12px;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: var(--radius) var(--radius) 0 0;
    color: var(--text-dim);
    touch-action: none;
  }
  .tab:hover {
    background: var(--hover);
  }
  /* Visible in a pane, but not the one with focus. */
  .tab.shown {
    background: var(--panel);
    border-color: var(--border);
    margin-bottom: -1px;
    height: 31px;
  }
  .tab.active {
    color: var(--text);
    box-shadow: inset 0 2px 0 -1px var(--accent);
  }
  .tab.dragging {
    opacity: 0.5;
  }
  .name {
    font-weight: 500;
  }
  .branch {
    color: var(--text-faint);
    font-size: 12px;
    flex-shrink: 2;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--yellow);
    flex: none;
  }
  .close {
    width: 18px;
    height: 18px;
    line-height: 16px;
    border-radius: 4px;
    color: var(--text-faint);
    visibility: hidden;
    flex: none;
  }
  .tab:hover .close,
  .tab.active .close {
    visibility: visible;
  }
  .close:hover {
    background: var(--border-strong);
    color: var(--text);
  }
  .add {
    width: 26px;
    height: 26px;
    margin: 0 0 2px 2px;
    border-radius: var(--radius);
    color: var(--text-dim);
    font-size: 16px;
    flex: none;
  }
  .add:hover {
    background: var(--hover);
    color: var(--text);
  }
</style>
