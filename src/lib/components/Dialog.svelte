<script lang="ts">
  import { app } from '$lib/state/app.svelte';

  let inputEl = $state<HTMLInputElement>();
  let okEl = $state<HTMLButtonElement>();
  let value = $state('');

  const d = $derived(app.dialog);

  $effect(() => {
    if (!d) return;
    value = d.value;
    // Focus after the element exists; select prefilled text for quick replace.
    queueMicrotask(() => {
      if (d.kind === 'prompt') {
        inputEl?.focus();
        inputEl?.select();
      } else {
        okEl?.focus();
      }
    });
  });

  const submit = () => app.closeDialog(d?.kind === 'prompt' ? value : '');
  const cancel = () => app.closeDialog(null);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }
</script>

{#if d}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={cancel} onkeydown={onKey}>
    <div class="dialog" role="dialog" aria-modal="true" tabindex="-1" onmousedown={(e) => e.stopPropagation()}>
      <div class="title">{d.title}</div>
      {#if d.body}<div class="body">{d.body}</div>{/if}
      {#if d.kind === 'prompt'}
        <input bind:this={inputEl} bind:value placeholder={d.placeholder} spellcheck="false" autocomplete="off" />
      {/if}
      <div class="buttons">
        <button onclick={cancel}>Cancel <kbd>esc</kbd></button>
        <button bind:this={okEl} class="ok" class:danger={d.danger} onclick={submit}>
          {d.confirmLabel} <kbd>↵</kbd>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 18vh;
    background: rgba(0, 0, 0, 0.5);
  }
  .dialog {
    width: min(440px, calc(100vw - 48px));
    padding: 18px 20px 16px;
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    outline: 0;
  }
  .title {
    font-size: 14px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .body {
    margin-top: 6px;
    color: var(--text-dim);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  input {
    width: 100%;
    height: 32px;
    margin-top: 12px;
    padding: 0 10px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  input:focus {
    border-color: var(--accent);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    color: var(--text-dim);
    outline: 0;
  }
  button:hover {
    background: var(--hover);
  }
  .ok {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }
  .ok:hover {
    background: var(--accent-hover);
  }
  .ok.danger {
    background: var(--red);
    border-color: var(--red);
  }
  .ok.danger:hover {
    background: var(--red-hover);
  }
  .ok:focus-visible {
    box-shadow: 0 0 0 2px var(--raised), 0 0 0 4px currentColor;
  }
  .ok kbd {
    background: rgba(0, 0, 0, 0.18);
    border-color: transparent;
    color: inherit;
  }
</style>
