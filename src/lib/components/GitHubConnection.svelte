<script lang="ts">
  import { untrack } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { api, type GitHubConnection } from '$lib/api';
  import { app } from '$lib/state/app.svelte';
  import type { RepoState } from '$lib/state/repo.svelte';

  let dialog: HTMLDialogElement;
  let trigger: HTMLButtonElement;
  let connection = $state<GitHubConnection | null>(null);
  let checking = $state(false);
  let signing = $state(false);
  let code = $state<string | null>(null);
  let error = $state<string | null>(null);
  let copied = $state(false);
  let attempt = 0;
  let checkAttempt = 0;
  let panelOpen = $state(false);
  let target = $state<RepoState | null>(null);

  const connected = $derived(connection?.kind === 'connected');
  const repo = $derived(panelOpen ? target : app.active ?? null);
  const accounts = $derived(connection && 'accounts' in connection ? connection.accounts : []);

  function focusAction() {
    queueMicrotask(() => {
      if (dialog.open) dialog.querySelector<HTMLButtonElement>('.primary:not(:disabled)')?.focus();
    });
  }

  function selectAccount(account: string | null, selectedRepo = repo) {
    if (!selectedRepo) return;
    selectedRepo.local.githubAccount = account;
    selectedRepo.pulls = {};
    app.save();
    void selectedRepo.refreshPulls(true);
  }

  async function check() {
    if (signing) return;
    const request = ++checkAttempt;
    const selectedRepo = repo;
    checking = true;
    error = null;
    try {
      const wasConnected = connected;
      const result = await api.githubStatus(selectedRepo?.local.githubAccount ?? null);
      if (request !== checkAttempt) return;
      connection = result;
      if (!wasConnected && result.kind === 'connected') void selectedRepo?.refreshPulls(true);
    } catch {
      if (request === checkAttempt) error = 'Couldn’t check GitHub. Please try again.';
    } finally {
      if (request === checkAttempt) {
        checking = false;
        if (dialog?.open && (document.activeElement === dialog || document.activeElement === dialog.querySelector('.close'))) focusAction();
      }
    }
  }

  $effect(() => {
    repo?.path;
    repo?.local.githubAccount;
    if (app.ready) untrack(() => { void check(); });
  });

  function show() {
    target = app.active ?? null;
    panelOpen = true;
    error = null;
    copied = false;
    dialog.showModal();
    void check();
  }

  function closed() {
    attempt++;
    if (signing) {
      void api.githubCancel().catch(() => app.toast('Couldn’t cancel GitHub sign-in. The code will expire automatically.', 'error'));
    }
    signing = false;
    code = null;
    panelOpen = false;
    trigger.focus();
  }

  async function signIn() {
    if (signing) return;
    dialog.focus();
    signing = true;
    code = null;
    error = null;
    copied = false;
    const request = ++attempt;
    checkAttempt++;
    checking = false;
    const selectedRepo = repo;
    try {
      const result = await api.githubLogin((value) => {
        if (request === attempt) {
          code = value;
          focusAction();
        }
      });
      if (request !== attempt) return;
      connection = result;
      if (result.kind === 'connected') {
        if (selectedRepo) selectAccount(result.login, selectedRepo);
        else connection = await api.githubStatus(null);
      }
    } catch (e) {
      if (request === attempt) error = String(e);
    } finally {
      if (request === attempt) {
        signing = false;
        focusAction();
      }
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      return true;
    } catch {
      error = 'Couldn’t copy. Select the text and copy it manually.';
      return false;
    }
  }

  async function open(url: string) {
    try {
      await openUrl(url);
    } catch {
      error = 'Couldn’t open your browser. Please try again.';
    }
  }

  async function continueInBrowser() {
    if (!code) return;
    if (copied || await copy(code)) await open('https://github.com/login/device');
  }
</script>

<svelte:window onfocus={() => { if (dialog?.open) void check(); }} />

<button
  bind:this={trigger}
  class="trigger"
  class:connected
  title={connection?.kind === 'connected' ? `GitHub account for ${repo?.name ?? 'Alfie'}: @${connection.login}` : 'Connect GitHub to see pull requests'}
  aria-haspopup="dialog"
  onclick={show}
>
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.49c-2.23.48-2.7-1.08-2.7-1.08-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.22.82 1.22.82.71 1.22 1.87.87 2.33.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.74.54 1.49v2.32c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
  </svg>
  {connected ? 'GitHub' : 'Connect GitHub'}
  {#if connected}<span class="check" aria-hidden="true">✓</span>{/if}
</button>

<dialog bind:this={dialog} tabindex="-1" onclose={closed} onkeydown={(e) => e.stopPropagation()} aria-labelledby="github-title">
  <div class="content">
    <button class="close" aria-label="Close GitHub connection" onclick={() => dialog.close()}>×</button>
    <div class="symbol" class:done={connected} aria-hidden="true">{connected ? '✓' : '↗'}</div>
    <h2 id="github-title">{connected ? 'GitHub connected' : 'Connect GitHub'}</h2>
    <p class="intro">{repo ? `Choose the account used for ${repo.name}’s pull requests.` : 'Connect an account to see pull requests beside your branches.'}</p>

    <div class="step" aria-live="polite" aria-busy={checking || (signing && !code)}>
      {#if signing}
        {#if code}
          <p>Enter this one-time code on GitHub.</p>
          <div class="code selectable">{code}</div>
          <p class="caption">Waiting for you to finish in your browser…</p>
        {:else}
          <p class="pending">Getting your sign-in code…</p>
        {/if}
      {:else if connection?.kind === 'missingCli'}
        <h3>First, install GitHub CLI</h3>
        <p>Run this in Terminal, then check again.</p>
        <div class="command">
          <code class="selectable">brew install gh</code>
          <button class="copy" aria-label="Copy install command" onclick={() => copy('brew install gh')}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <button class="text-link" onclick={() => open('https://cli.github.com/')}>Other install options ↗</button>
      {:else if connection?.kind === 'connected'}
        <div class="account"><span class="account-dot"></span><strong>@{connection.login}</strong><span>Connected</span></div>
        <p class="caption">{repo?.local.githubAccount ? 'Saved for this repository.' : 'Using GitHub CLI’s default account.'}</p>
      {:else if connection?.kind === 'signedOut'}
        <p>{repo?.local.githubAccount ? `@${repo.local.githubAccount} is no longer signed in. Add the account again or choose another.` : 'Continue in your browser to connect your account.'}</p>
        <p class="caption">You’ll get a one-time code to enter on GitHub.</p>
      {:else if connection?.kind === 'error'}
        <p role="alert">{connection.message}</p>
      {:else}
        <p class="pending">Checking your connection…</p>
      {/if}
      {#if !signing && connection && connection.kind !== 'missingCli' && repo && (accounts.length || repo.local.githubAccount)}
        <label class="account-picker">
          <span>Account for this repository</span>
          <select value={repo.local.githubAccount ?? ''} disabled={checking} onchange={(e) => selectAccount(e.currentTarget.value || null)}>
            <option value="">GitHub CLI default</option>
            {#if repo.local.githubAccount && !accounts.some((account) => account.login === repo.local.githubAccount)}
              <option value={repo.local.githubAccount}>@{repo.local.githubAccount} (sign in again)</option>
            {/if}
            {#each accounts as account (account.login)}
              <option value={account.login}>@{account.login}{account.active ? ' · CLI default' : ''}</option>
            {/each}
          </select>
        </label>
        <p class="caption">Other repositories keep their own account.</p>
      {/if}
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="actions">
      {#if signing}
        <button class="button" onclick={() => dialog.close()}>Cancel</button>
        {#if code}
          <button class="button primary" onclick={continueInBrowser}>{copied ? 'Open GitHub ↗' : 'Copy code & open GitHub ↗'}</button>
        {:else}
          <button class="button primary" disabled>Starting…</button>
        {/if}
      {:else if connected}
        <button class="button" disabled={checking} onclick={signIn}>Add account</button>
        <button class="button primary" onclick={() => dialog.close()}>Done</button>
      {:else if connection?.kind === 'signedOut'}
        <span class="caption">One-time setup</span>
        <button class="button primary" disabled={checking} onclick={signIn}>Sign in with GitHub ↗</button>
      {:else}
        <button class="button" onclick={() => dialog.close()}>Later</button>
        <button class="button primary" disabled={checking} onclick={check}>{checking ? 'Checking…' : 'Check again'}</button>
      {/if}
    </div>
    {#if !signing && connected}
      <button class="text-link manual" disabled={checking} onclick={check}>{checking ? 'Checking…' : 'Check connection'}</button>
    {/if}
    {#if signing && code}
      <button class="text-link manual" onclick={() => open('https://github.com/login/device')}>Open GitHub without copying ↗</button>
    {/if}
  </div>
</dialog>

<style>
  .trigger { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 22px; padding: 0 7px; border-radius: 4px; color: var(--text-dim); font-size: 11px; }
  .trigger:hover { color: var(--text); background: var(--hover); }
  .check { color: var(--green); font-size: 10px; }
  dialog { width: min(380px, calc(100vw - 40px)); max-height: calc(100vh - 48px); padding: 0; border: 1px solid var(--border-strong); border-radius: 12px; color: var(--text); background: var(--raised); box-shadow: 0 24px 64px rgb(0 0 0 / 40%); }
  dialog::backdrop { background: rgb(0 0 0 / 48%); }
  .content { position: relative; padding: 24px; }
  .close { position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; border-radius: 6px; color: var(--text-dim); font-size: 20px; }
  .close:hover { background: var(--hover); color: var(--text); }
  .symbol { display: grid; place-items: center; width: 36px; height: 36px; margin-bottom: 16px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--panel); color: var(--accent); font-size: 20px; }
  .symbol.done { color: var(--green); }
  h2 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
  h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
  p { margin: 0; line-height: 1.6; color: var(--text-dim); }
  .intro { margin-top: 6px; font-size: 12px; text-wrap: balance; }
  .step { min-height: 110px; margin: 22px 0; padding: 16px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .caption { margin-top: 6px; color: var(--text-dim); font-size: 11px; line-height: 1.6; }
  .command { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg); }
  code { font: 12px var(--mono); }
  .copy { padding: 4px; font-size: 11px; color: var(--accent); }
  .text-link { color: var(--accent); font-size: 11px; margin-top: 10px; text-align: left; }
  .text-link:hover { text-decoration: underline; }
  .code { margin-top: 12px; padding: 14px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg); text-align: center; font: 24px var(--mono); letter-spacing: 0.12em; font-variant-numeric: tabular-nums; }
  .account { display: flex; align-items: center; gap: 8px; padding-top: 6px; }
  .account strong { font-weight: 500; }
  .account > span:last-child { margin-left: auto; color: var(--green); font-size: 11px; }
  .account-dot { width: 7px; height: 7px; flex: none; background: var(--green); border-radius: 50%; }
  .account-picker { display: grid; gap: 6px; margin-top: 18px; color: var(--text-dim); font-size: 11px; }
  select { width: 100%; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: 6px; color: var(--text); background: var(--bg); font: 12px var(--font); }
  select:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .actions .caption { margin: 0; }
  .button { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 6px; font-size: 12px; font-weight: 500; white-space: nowrap; }
  .button:hover:not(:disabled) { background: var(--hover); }
  .primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .primary:hover:not(:disabled) { background: var(--accent-hover); }
  button:disabled { opacity: 0.5; }
  button { cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  button:active:not(:disabled) { transform: scale(0.97); }
  .error { margin: -8px 0 16px; color: var(--red); font-size: 12px; overflow-wrap: anywhere; }
  .manual { display: block; margin: 12px auto 0; text-align: center; }
  @media (prefers-reduced-motion: no-preference) {
    button { transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
  }
</style>
