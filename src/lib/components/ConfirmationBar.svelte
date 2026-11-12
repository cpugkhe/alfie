<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import type { RepoState } from '$lib/state/repo.svelte';

  let { repo }: { repo?: RepoState } = $props();
  let cancelEl = $state<HTMLButtonElement>();
  let barEl = $state<HTMLElement>();
  const request = $derived(app.confirmation?.repo === (repo?.path ?? null) ? app.confirmation : null);

  $effect(() => {
    if (!request || !barEl) return;
    const previous = document.activeElement;
    const bar = barEl;
    cancelEl?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && (bar.contains(document.activeElement) || document.activeElement === document.body)) {
        previous.focus({ preventScroll: true });
      }
    };
  });

  function onKey(e: KeyboardEvent) {
    if (!request || app.dialog || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    app.answerConfirmation(request, false);
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if request}
  {#key request}
    <section class="confirmation" class:danger={request.danger} aria-label="Confirmation" bind:this={barEl}>
      <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 4h.01" />
      </svg>
      <div class="copy" role="status" aria-live="polite" aria-atomic="true">
        <div class="title">{request.title}</div>
        {#if request.body}<div class="body">{request.body}</div>{/if}
      </div>
      <div class="actions">
        <button bind:this={cancelEl} onclick={() => app.answerConfirmation(request, false)}>Cancel <kbd>esc</kbd></button>
        <button class="confirm" onclick={() => app.answerConfirmation(request, true)}>{request.confirmLabel}</button>
      </div>
    </section>
  {/key}
{/if}

<style>
  .confirmation {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    min-width: 0;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--accent) 7%, var(--panel));
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    opacity: 1;
    transform: translateY(0);
    transition: opacity 160ms cubic-bezier(0.23, 1, 0.32, 1), transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .danger {
    background: color-mix(in srgb, var(--yellow) 7%, var(--panel));
    border-bottom-color: color-mix(in srgb, var(--yellow) 28%, var(--border));
  }
  .icon { flex: none; color: var(--accent); align-self: flex-start; margin-top: 1px; }
  .danger .icon { color: var(--yellow); }
  .copy { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .title { color: var(--text); font-size: 12px; font-weight: 600; line-height: 1.5; }
  .body { margin-top: 2px; color: var(--text-dim); font-size: 12px; line-height: 1.5; }
  .actions { display: flex; flex: none; align-items: center; gap: 8px; }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .confirm { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
  .danger .confirm { background: var(--red); border-color: var(--red); color: var(--text); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  kbd { font-size: 10px; padding: 1px 4px; }
  @starting-style { .confirmation { opacity: 0; transform: translateY(-4px); } }
  @media (hover: hover) and (pointer: fine) {
    button:hover { background: var(--hover); color: var(--text); }
    .confirm:hover { background: var(--accent-hover); color: var(--bg); }
    .danger .confirm:hover { background: var(--red-hover); color: var(--text); }
  }
  @media (prefers-reduced-motion: no-preference) {
    button { transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    button:active { transform: scale(0.97); }
  }
  @media (prefers-reduced-motion: reduce) {
    .confirmation { transform: none; transition: opacity 80ms linear; }
    @starting-style { .confirmation { transform: none; } }
  }
  @container (max-width: 620px) {
    .confirmation { flex-wrap: wrap; }
    .copy { flex-basis: calc(100% - 26px); }
    .actions { margin-left: 26px; }
  }
</style>
