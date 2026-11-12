<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { api, type GitLogEntry } from '$lib/api';
  import { commands, SCOPE_LABELS } from '$lib/keys/commands';
  import { formatKeys, type Scope } from '$lib/keys/keymap';

  // ---------- git command log ----------
  let entries = $state<GitLogEntry[]>([]);
  let writesOnly = $state(false);
  let logEl = $state<HTMLDivElement>();

  async function loadLog() {
    entries = await api.gitLog(writesOnly);
    queueMicrotask(() => {
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });
  }

  $effect(() => {
    if (!app.logOpen) return;
    // Reload whenever the active repository finishes a refresh.
    app.active?.busy;
    writesOnly;
    loadLog();
  });

  // ---------- shortcut overlay ----------
  const SCOPE_ORDER: Scope[] = ['global', 'repo', 'list', 'files', 'diff', 'sidebar', 'graph'];
  const groups = $derived(
    SCOPE_ORDER.map((scope) => ({
      scope,
      items: commands.filter(
        (c) => c.scope === scope && c.keys?.length && !c.id.startsWith('tab.goto') && !c.id.startsWith('space.goto') && c.id !== 'overlay.close',
      ),
    })).filter((g) => g.items.length),
  );
</script>

{#if app.logOpen}
  <div class="log">
    <div class="log-bar">
      <span class="label">Git commands</span>
      <label><input type="checkbox" bind:checked={writesOnly} /> changes only</label>
      <span class="spacer"></span>
      <button onclick={() => (app.logOpen = false)}><kbd>⌘J</kbd> close</button>
    </div>
    <div class="log-list mono selectable" bind:this={logEl}>
      {#each entries as e (e.id)}
        <div class="entry" class:fail={!e.ok} class:read={!e.write}>
          <span class="ms">{e.ms}ms</span>
          <span class="cmd">{e.command}</span>
          {#if e.stderr}<div class="stderr">{e.stderr}</div>{/if}
        </div>
      {/each}
      {#if entries.length === 0}
        <div class="faint">Nothing yet.</div>
      {/if}
    </div>
  </div>
{/if}

{#if app.helpOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={() => (app.helpOpen = false)}>
    <div class="help" onmousedown={(e) => e.stopPropagation()}>
      <div class="help-head">
        <span>Keyboard shortcuts</span>
        <kbd>esc</kbd>
      </div>
      <div class="cols">
        {#each groups as g}
          <div class="col">
            <div class="label">{SCOPE_LABELS[g.scope]}</div>
            {#each g.items as c}
              <div class="short">
                <span class="truncate">{c.title}</span>
                <span class="keys">
                  {#each c.keys ?? [] as k}<kbd>{formatKeys(k)}</kbd>{/each}
                </span>
              </div>
            {/each}
            {#if g.scope === 'global'}
              <div class="short">
                <span>Go to tab 1–9</span>
                <span class="keys"><kbd>⌘1</kbd>…<kbd>⌘9</kbd></span>
              </div>
              <div class="short">
                <span>Go to space 1–9</span>
                <span class="keys"><kbd>⌃1</kbd>…<kbd>⌃9</kbd></span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if app.toasts.length}
  <div class="toasts">
    {#each app.toasts as t (t.id)}
      <div class="toast" class:error={t.kind === 'error'} role={t.kind === 'error' ? 'alert' : 'status'}>
        <div class="t-head">
          <span class="t-icon">{t.kind === 'error' ? '!' : '✓'}</span>
          <span class="t-title selectable">{t.title}</span>
          <button class="t-x" aria-label="Dismiss" onclick={() => app.dismiss(t.id)}>×</button>
        </div>
        {#if t.why}<div class="t-why selectable">{t.why}</div>{/if}
        {#if t.hints.length}
          <div class="t-label">Try this</div>
          <ul class="selectable">
            {#each t.hints as hint}<li>{hint}</li>{/each}
          </ul>
        {/if}
        {#if t.detail}
          <div class="t-label">
            Git said
            <button class="t-copy" onclick={() => navigator.clipboard.writeText(t.detail ?? '')}>Copy</button>
          </div>
          <pre class="selectable">{t.detail}</pre>
        {/if}
      </div>
    {/each}
    {#if app.toasts.filter((t) => t.kind === 'error').length > 1}
      <button class="t-all" onclick={() => app.dismissAll()}>Dismiss all</button>
    {/if}
  </div>
{/if}

<style>
  .log {
    height: 200px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .log-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 28px;
    padding: 0 12px;
    font-size: 12px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .log-bar label {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .log-bar button {
    color: var(--text-faint);
  }
  .label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .spacer {
    flex: 1;
  }
  .log-list {
    flex: 1;
    overflow: auto;
    padding: 6px 12px;
    font-size: 11.5px;
    line-height: 18px;
  }
  .entry {
    white-space: pre;
  }
  .entry.read {
    color: var(--text-faint);
  }
  .entry.fail .cmd {
    color: var(--red);
  }
  .ms {
    display: inline-block;
    width: 52px;
    color: var(--text-faint);
  }
  .stderr {
    padding-left: 52px;
    color: var(--red);
    white-space: pre-wrap;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .help {
    width: min(1120px, calc(100vw - 48px));
    max-height: 80vh;
    overflow-y: auto;
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    padding: 16px 20px 20px;
  }
  .help-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .cols {
    columns: 3;
    column-gap: 32px;
  }
  .col {
    break-inside: avoid;
    margin-bottom: 16px;
  }
  .col .label {
    margin-bottom: 6px;
  }
  .short {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    height: 24px;
    color: var(--text-dim);
  }
  .keys {
    display: flex;
    gap: 4px;
    flex: none;
    align-items: center;
  }

  .toasts {
    position: fixed;
    right: 14px;
    bottom: 38px;
    z-index: 65;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
  }
  .toast {
    width: max-content;
    max-width: 380px;
    padding: 9px 10px 9px 12px;
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--green);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }
  .toast.error {
    width: 460px;
    max-width: calc(100vw - 28px);
    padding: 12px 12px 12px 14px;
    border-color: color-mix(in srgb, var(--red) 55%, transparent);
    border-left: 4px solid var(--red);
    background: color-mix(in srgb, var(--red) 7%, var(--raised));
  }
  .t-head {
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }
  .t-icon {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 800;
    color: var(--bg);
    background: var(--green);
  }
  .error .t-icon {
    background: var(--red);
  }
  .t-title {
    flex: 1;
    min-width: 0;
    line-height: 18px;
    overflow-wrap: anywhere;
  }
  .error .t-title {
    font-size: 14px;
    font-weight: 600;
  }
  .t-x {
    width: 20px;
    height: 20px;
    margin: -1px -2px 0 0;
    flex: none;
    border-radius: 4px;
    color: var(--text-faint);
    font-size: 15px;
    line-height: 18px;
  }
  .t-x:hover {
    background: var(--border-strong);
    color: var(--text);
  }
  .t-why {
    margin: 6px 0 0 27px;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .t-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 10px 0 4px 27px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  ul {
    margin: 0 0 0 27px;
    padding-left: 16px;
    line-height: 1.55;
  }
  li + li {
    margin-top: 3px;
  }
  pre {
    margin: 0 0 0 27px;
    padding: 7px 9px;
    max-height: 132px;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font: 11.5px/1.5 var(--mono);
    color: var(--text-dim);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .t-copy,
  .t-all {
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-dim);
  }
  .t-copy:hover,
  .t-all:hover {
    background: var(--border-strong);
    color: var(--text);
  }
  .t-all {
    background: var(--raised);
    border: 1px solid var(--border-strong);
  }
</style>
