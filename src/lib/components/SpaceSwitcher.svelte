<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { clamp } from '$lib/util';

  let index = $state(0);
  let listEl = $state<HTMLDivElement>();
  /** Index of the space being dragged in the list. */
  let dragFrom = $state<number | null>(null);

  $effect(() => {
    if (app.spacesOpen) index = app.spaceIdx;
  });

  const close = () => (app.spacesOpen = false);

  function pick(i: number) {
    close();
    app.switchSpace(i);
  }

  function move(from: number, dir: 1 | -1) {
    const to = from + dir;
    if (to < 0 || to >= app.spaces.length) return;
    app.moveSpace(from, to);
    index = to;
  }

  /** The popup owns the keyboard while it is open. */
  function onKey(e: KeyboardEvent) {
    if (!app.spacesOpen || app.dialog) return;
    const n = app.spaces.length;
    const reorder = e.altKey || e.shiftKey;
    let handled = true;
    switch (e.code) {
      case 'ArrowDown':
      case 'KeyJ':
        if (reorder) move(index, 1);
        else index = (index + 1) % n;
        break;
      case 'ArrowUp':
      case 'KeyK':
        if (reorder) move(index, -1);
        else index = (index - 1 + n) % n;
        break;
      case 'Enter':
        pick(index);
        break;
      case 'KeyN':
        close();
        app.newSpace();
        break;
      case 'KeyR':
        close();
        app.renameSpace(index);
        break;
      case 'Backspace':
        close();
        app.deleteSpace(index);
        break;
      case 'Escape':
        close();
        break;
      default:
        if (e.code.startsWith('Digit') && !e.metaKey) {
          const i = Number(e.code.slice(5)) - 1;
          if (i >= 0 && i < n) pick(i);
        } else {
          handled = false;
        }
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function startDrag(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const startY = e.clientY;
    let from = i;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startY) < 5) return;
      if (!moved) el.setPointerCapture(ev.pointerId);
      moved = true;
      dragFrom = from;
      const rows = [...(listEl?.querySelectorAll<HTMLElement>('.space') ?? [])];
      const over = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return ev.clientY >= b.top && ev.clientY < b.bottom;
      });
      if (over >= 0 && over !== from) {
        app.moveSpace(from, over);
        from = over;
        dragFrom = over;
        index = over;
      }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      dragFrom = null;
      if (!moved) pick(clamp(from, 0, app.spaces.length - 1));
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if app.spacesOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={close}></div>
  <div class="popup">
    <div class="label">Spaces</div>
    <div class="list" bind:this={listEl}>
      {#each app.spaces as space, i (space.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="space"
          class:sel={i === index}
          class:dragging={dragFrom === i}
          onpointerdown={(e) => startDrag(e, i)}
          onmousemove={() => dragFrom === null && (index = i)}
        >
          <span class="mark">{i === app.spaceIdx ? '●' : ''}</span>
          <span class="name truncate">{space.name}</span>
          <span class="count">{space.tabs.length}</span>
          {#if i < 9}<kbd>⌃{i + 1}</kbd>{/if}
        </div>
      {/each}
    </div>
    <div class="foot">
      <span><kbd>N</kbd> new</span>
      <span><kbd>R</kbd> rename</span>
      <span><kbd>⌫</kbd> delete</span>
      <span><kbd>⇧J</kbd><kbd>⇧K</kbd> or drag to reorder</span>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 44;
  }
  .popup {
    position: fixed;
    left: 8px;
    bottom: 32px;
    z-index: 45;
    width: 300px;
    padding: 6px;
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.55);
  }
  .label {
    padding: 6px 8px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .list {
    max-height: 50vh;
    overflow-y: auto;
  }
  .space {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px 0 4px;
    border-radius: var(--radius);
    touch-action: none;
  }
  .space.sel {
    background: var(--select);
  }
  .space.dragging {
    opacity: 0.6;
    outline: 1px dashed var(--accent);
  }
  .mark {
    width: 12px;
    flex: none;
    font-size: 8px;
    color: var(--accent);
    text-align: center;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .count {
    font-size: 11px;
    color: var(--text-faint);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin-top: 6px;
    padding: 8px 8px 4px;
    border-top: 1px solid var(--border-strong);
    font-size: 11px;
    color: var(--text-faint);
  }
  .foot kbd + kbd {
    margin-left: 2px;
  }
</style>
