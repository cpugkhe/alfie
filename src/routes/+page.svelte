<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import { app } from '$lib/state/app.svelte';
  import { installKeymap } from '$lib/keys/keymap';
  import { activeScopes, commands, menuAction } from '$lib/keys/commands';
  import TabBar from '$lib/components/TabBar.svelte';
  import RepoView from '$lib/components/RepoView.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import Welcome from '$lib/components/Welcome.svelte';
  import Overlays from '$lib/components/Overlays.svelte';
  import Palette from '$lib/palette/Palette.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import SpaceSwitcher from '$lib/components/SpaceSwitcher.svelte';
  import ProfilesPanel from '$lib/components/ProfilesPanel.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';

  onMount(() => {
    const start = async () => {
      // Plain browser without Tauri: run against the recorded fixture.
      if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
        (await import('$lib/dev/mock')).install();
      }
      await app.init();
    };
    app.onMenu = menuAction;

    // WebKit keeps a text field focused when you click on non-selectable UI
    // (most of this app). Single-key shortcuts would then be typed into that
    // field instead of acting on what was just clicked, so let go of it.
    const releaseTextFocus = (e: MouseEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (!typing) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable], label')) return;
      active.blur();
    };
    window.addEventListener('mousedown', releaseTextFocus, true);
    start();
    const removeKeymap = installKeymap({
      commands: () => commands,
      scopes: activeScopes,
      overlayOpen: () => app.palette !== null || app.helpOpen,
      blocked: () => app.dialog !== null || app.spacesOpen || app.profilesOpen,
    });
    return () => {
      removeKeymap();
      window.removeEventListener('mousedown', releaseTextFocus, true);
    };
  });

  const split = $derived(app.secondary ? app.space.split : null);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="app" oncontextmenu={(e) => e.preventDefault()}>
  <TabBar />
  <div class="panes" class:column={split?.dir === 'column'}>
    <div
      class="pane"
      class:split={!!split}
      class:focused={!!split && app.space.paneFocus === 0}
      onmousedowncapture={() => app.focusPane(0)}
    >
      {#if split && app.primary}
        <div class="pane-head"><span class="truncate">{app.primary.name}</span></div>
      {/if}
      {#if app.primary}
        {#key app.primary.path}
          <RepoView repo={app.primary} />
        {/key}
      {:else if app.ready}
        <Welcome />
      {:else}
        <div class="blank"></div>
      {/if}
    </div>

    {#if split && app.secondary}
      <div class="divider"></div>
      <div
        class="pane split"
        class:focused={app.space.paneFocus === 1}
        onmousedowncapture={() => app.focusPane(1)}
      >
        <div class="pane-head">
          <span class="truncate">{app.secondary.name}</span>
          <span class="spacer"></span>
          <button title="Close pane (⌘W)" onclick={() => app.closeSplit()}>×</button>
        </div>
        {#key app.secondary.path}
          <RepoView repo={app.secondary} />
        {/key}
      </div>
    {/if}

    {#if app.drag}
      <div class="drop" class:right={app.drag.zone === 'right'} class:bottom={app.drag.zone === 'bottom'}>
        {#if app.drag.zone}
          <span>Open {app.drag.name} {app.drag.zone === 'right' ? 'on the right' : 'below'}</span>
        {/if}
      </div>
    {/if}
  </div>
  <Overlays />
  <StatusBar />
</div>

{#if app.drag}
  <div class="ghost" style:left="{app.drag.x + 12}px" style:top="{app.drag.y + 10}px">{app.drag.name}</div>
{/if}
<ContextMenu />
<SpaceSwitcher />
<ProfilesPanel />
<Palette />
<Dialog />

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
  }
  .panes.column {
    flex-direction: column;
  }
  .pane {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* In a split, the pane without keyboard focus steps back a little. */
  .pane.split:not(.focused) {
    opacity: 0.62;
  }
  .pane-head {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 6px 0 12px;
    flex: none;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    box-shadow: inset 0 2px 0 -1px transparent;
  }
  .focused > .pane-head {
    color: var(--text);
    box-shadow: inset 0 2px 0 -1px var(--accent);
  }
  .pane-head .spacer {
    flex: 1;
  }
  .pane-head button {
    width: 18px;
    height: 18px;
    line-height: 16px;
    border-radius: 4px;
    color: var(--text-faint);
    font-size: 13px;
  }
  .pane-head button:hover {
    background: var(--border-strong);
    color: var(--text);
  }
  .divider {
    flex: none;
    width: 1px;
    background: var(--border-strong);
  }
  .column > .divider {
    width: auto;
    height: 1px;
  }
  .blank {
    flex: 1;
    background: var(--panel);
  }
  .drop {
    position: absolute;
    z-index: 30;
    display: grid;
    place-items: center;
    pointer-events: none;
    border-radius: 8px;
    color: var(--accent);
    font-weight: 600;
    transition: inset 0.08s ease;
  }
  .drop.right {
    inset: 6px 6px 6px 50%;
    background: var(--accent-dim);
    border: 1px dashed var(--accent);
  }
  .drop.bottom {
    inset: 50% 6px 6px 6px;
    background: var(--accent-dim);
    border: 1px dashed var(--accent);
  }
  .ghost {
    position: fixed;
    z-index: 80;
    pointer-events: none;
    padding: 4px 10px;
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    font-weight: 500;
  }
</style>
