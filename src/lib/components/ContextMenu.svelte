<script lang="ts">
  import { app } from '$lib/state/app.svelte';

  let el = $state<HTMLDivElement>();
  let index = $state(-1);
  let pos = $state({ x: 0, y: 0 });

  // Keep the menu inside the window.
  $effect(() => {
    const m = app.menu;
    if (!m) return;
    index = -1;
    pos = { x: m.x, y: m.y };
    queueMicrotask(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      pos = {
        x: Math.max(4, Math.min(m.x, window.innerWidth - r.width - 4)),
        y: Math.max(4, Math.min(m.y, window.innerHeight - r.height - 4)),
      };
    });
  });

  const close = () => (app.menu = null);

  function choose(i: number) {
    const item = app.menu?.items[i];
    close();
    item?.run();
  }

  function onKey(e: KeyboardEvent) {
    const m = app.menu;
    if (!m) return;
    const n = m.items.length;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' || e.key === 'j') index = (index + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'k') index = (index - 1 + n) % n;
    else if (e.key === 'Enter' && index >= 0 && !m.items[index].disabled) choose(index);
    else return close();
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<svelte:window onkeydowncapture={onKey} onblur={close} onresize={close} />

{#if app.menu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={close} oncontextmenu={(e) => { e.preventDefault(); close(); }}></div>
  <div class="menu" role="menu" bind:this={el} style:left="{pos.x}px" style:top="{pos.y}px">
    {#each app.menu.items as item, i}
      <button
        role="menuitem"
        class:sel={i === index}
        class:danger={item.danger}
        disabled={item.disabled}
        onmousemove={() => (index = i)}
        onclick={() => choose(i)}
      >
        <span class="label">{item.label}</span>
        {#if item.hint}<span class="hint">{item.hint}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 89;
  }
  .menu {
    position: fixed;
    z-index: 90;
    min-width: 190px;
    padding: 4px;
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }
  button {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    height: 26px;
    padding: 0 10px;
    border-radius: 5px;
    text-align: left;
    white-space: nowrap;
  }
  button.sel {
    background: var(--select);
  }
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    font-size: 11px;
    color: var(--text-faint);
  }
  button:disabled {
    color: var(--text-dim);
  }
  button.danger {
    color: var(--red);
  }
</style>
