<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { tildify } from '$lib/util';
</script>

<div class="welcome">
  <div class="box">
    <h1>Alfie</h1>
    <p class="dim">No repository open.</p>
    <div class="actions">
      <button onclick={() => app.openFolder()}><kbd>⌘O</kbd> Open folder</button>
      <button onclick={() => (app.palette = 'switch')}><kbd>⌘K</kbd> Jump to repository</button>
    </div>
    {#if app.recents.length}
      <div class="label">Recent</div>
      {#each app.recents.slice(0, 8) as path}
        <button class="recent" onclick={() => app.openRepo(path)}>
          <span>{path.slice(path.lastIndexOf('/') + 1)}</span>
          <span class="faint truncate">{tildify(path)}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .welcome {
    flex: 1;
    display: grid;
    place-items: center;
    background: var(--panel);
  }
  .box {
    width: 380px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  p {
    margin: 0 0 20px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .actions button,
  .recent {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    margin-left: -8px;
    border-radius: var(--radius);
    text-align: left;
  }
  .actions button:hover,
  .recent:hover {
    background: var(--hover);
  }
  .actions kbd {
    min-width: 34px;
    text-align: center;
  }
  .label {
    margin: 24px 0 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .recent span:first-child {
    flex: none;
  }
  .recent .faint {
    font-size: 12px;
    min-width: 0;
  }
</style>
