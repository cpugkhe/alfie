<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import type { PullRequest } from '$lib/api';
  import { app } from '$lib/state/app.svelte';

  let { pull }: { pull: PullRequest } = $props();

  async function open(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await openUrl(pull.url);
    } catch (error) {
      app.toast(String(error), 'error', 'Opening pull request');
    }
  }
</script>

<a
  href={pull.url}
  title="Open pull request #{pull.number} in browser"
  aria-label="Open pull request #{pull.number} in browser"
  onclick={open}
  ondblclick={(e) => e.stopPropagation()}
  onkeydown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
>
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <circle cx="4" cy="3" r="1.75" />
    <circle cx="4" cy="13" r="1.75" />
    <circle cx="12" cy="13" r="1.75" />
    <path d="M4 5v6M12 11V6a3 3 0 0 0-3-3H8m2-2L8 3l2 2" />
  </svg>
  PR #{pull.number}
</a>

<style>
  a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    height: 20px;
    padding: 0 6px;
    border-radius: 4px;
    color: var(--green);
    background: color-mix(in srgb, var(--green) 12%, transparent);
    font-size: 11px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }
  a:hover {
    background: color-mix(in srgb, var(--green) 24%, transparent);
  }
  a:focus-visible {
    outline: 1px solid var(--green);
    outline-offset: 2px;
  }
</style>
