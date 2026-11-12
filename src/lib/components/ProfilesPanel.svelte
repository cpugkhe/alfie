<script lang="ts">
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { api, type Profile } from '$lib/api';
  import { app } from '$lib/state/app.svelte';

  let selected = $state(0);
  let testHost = $state('github.com');
  let testResult = $state<string | null>(null);
  let testing = $state(false);
  let nameEl = $state<HTMLInputElement>();

  const profile = $derived<Profile | undefined>(app.profiles.profiles[selected]);
  const rulesText = $derived(profile?.rules.join('\n') ?? '');

  $effect(() => {
    if (app.profilesOpen) {
      selected = Math.min(selected, Math.max(0, app.profiles.profiles.length - 1));
      testResult = null;
    }
  });

  function add() {
    app.profiles.profiles.push({
      id: crypto.randomUUID(),
      name: 'New profile',
      userName: '',
      userEmail: '',
      sshKey: '',
      rules: [],
    });
    selected = app.profiles.profiles.length - 1;
    app.saveProfiles();
    queueMicrotask(() => {
      nameEl?.focus();
      nameEl?.select();
    });
  }

  async function remove() {
    if (!profile) return;
    const p = profile;
    app.profilesOpen = false;
    const ok = await app.confirm({
      title: `Delete profile ${p.name}?`,
      body: 'Repositories using it fall back to rule matching or plain git config. The key file is not touched.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) {
      app.profiles.profiles = app.profiles.profiles.filter((x) => x.id !== p.id);
      for (const [repo, id] of Object.entries(app.profiles.bindings)) {
        if (id === p.id) delete app.profiles.bindings[repo];
      }
      app.saveProfiles();
    }
    app.profilesOpen = true;
  }

  async function browse() {
    if (!profile) return;
    const picked = await openDialog({ title: 'Choose SSH private key', defaultPath: '~/.ssh' });
    if (typeof picked === 'string') {
      profile.sshKey = picked;
      app.saveProfiles();
    }
  }

  async function test() {
    if (!profile) return;
    testing = true;
    testResult = null;
    try {
      testResult = (await api.profileTest($state.snapshot(profile), testHost)) || 'No response.';
    } catch (e) {
      testResult = String(e);
    } finally {
      testing = false;
    }
  }

  function setRules(text: string) {
    if (!profile) return;
    profile.rules = text
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    app.saveProfiles();
  }

  function onKey(e: KeyboardEvent) {
    if (!app.profilesOpen || app.dialog) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      app.profilesOpen = false;
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if app.profilesOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={() => (app.profilesOpen = false)}>
    <div class="panel" onmousedown={(e) => e.stopPropagation()}>
      <div class="side">
        <div class="label">Profiles</div>
        {#each app.profiles.profiles as p, i (p.id)}
          <button class="row" class:sel={i === selected} onclick={() => { selected = i; testResult = null; }}>
            <span class="truncate">{p.name || 'Unnamed'}</span>
            <span class="faint truncate">{p.userEmail}</span>
          </button>
        {/each}
        <button class="row add" onclick={add}>+ New profile</button>
      </div>

      <div class="form">
        {#if profile}
          <label>
            <span>Profile name</span>
            <input bind:this={nameEl} bind:value={profile.name} oninput={() => app.saveProfiles()} spellcheck="false" />
          </label>
          <div class="two">
            <label>
              <span>Git name</span>
              <input bind:value={profile.userName} oninput={() => app.saveProfiles()} placeholder="Ada Lovelace" spellcheck="false" />
            </label>
            <label>
              <span>Git email</span>
              <input bind:value={profile.userEmail} oninput={() => app.saveProfiles()} placeholder="ada@example.com" spellcheck="false" />
            </label>
          </div>
          <label>
            <span>SSH private key</span>
            <div class="inline">
              <input class="mono" bind:value={profile.sshKey} oninput={() => app.saveProfiles()} placeholder="~/.ssh/id_ed25519" spellcheck="false" />
              <button class="btn" onclick={browse}>Browse…</button>
            </div>
            <small>Only the path is stored. A passphrase must be in ssh-agent or the macOS Keychain (<code>ssh-add --apple-use-keychain</code>).</small>
          </label>
          <label>
            <span>Use automatically for remotes</span>
            <textarea
              class="mono"
              rows="3"
              value={rulesText}
              onchange={(e) => setRules(e.currentTarget.value)}
              placeholder={'github.com:my-org/*\ngitlab.com'}
              spellcheck="false"
            ></textarea>
            <small>One per line: a host, <code>host:org/*</code> or <code>host:org/repo</code>. Most specific wins.</small>
          </label>
          <label>
            <span>Test connection</span>
            <div class="inline">
              <input class="mono" bind:value={testHost} placeholder="github.com" spellcheck="false" />
              <button class="btn" disabled={testing} onclick={test}>{testing ? 'Testing…' : 'Test'}</button>
            </div>
          </label>
          {#if testResult}<pre class="result selectable">{testResult}</pre>{/if}
          <div class="actions">
            <button class="btn danger" onclick={remove}>Delete profile</button>
            <span class="spacer"></span>
            <button class="btn" onclick={() => (app.profilesOpen = false)}>Done <kbd>esc</kbd></button>
          </div>
        {:else}
          <div class="empty">
            <p>A profile is a git identity plus an SSH key.</p>
            <p class="dim">Bind one to a repository, or let remote rules pick it, to commit and push as the right account.</p>
            <button class="btn primary" onclick={add}>Create profile</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.5);
  }
  .panel {
    display: flex;
    width: min(780px, calc(100vw - 48px));
    height: min(560px, calc(100vh - 80px));
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }
  .side {
    width: 220px;
    flex: none;
    padding: 12px 6px;
    background: var(--panel);
    border-right: 1px solid var(--border-strong);
    overflow-y: auto;
  }
  .label {
    padding: 2px 8px 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .row {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--radius);
    text-align: left;
    min-width: 0;
  }
  .row .faint {
    font-size: 11px;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.sel {
    background: var(--select);
  }
  .row.add {
    color: var(--text-dim);
    margin-top: 4px;
  }
  .form {
    flex: 1;
    min-width: 0;
    padding: 16px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  label > span {
    font-size: 12px;
    color: var(--text-dim);
  }
  small {
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.5;
  }
  code {
    font: 11px var(--mono);
    color: var(--text-dim);
  }
  input,
  textarea {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    resize: none;
  }
  input:focus,
  textarea:focus {
    border-color: var(--accent);
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .inline {
    display: flex;
    gap: 8px;
  }
  .btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    color: var(--text-dim);
    white-space: nowrap;
    flex: none;
  }
  .btn:hover {
    background: var(--hover);
    color: var(--text);
  }
  .btn.danger:hover {
    color: var(--red);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 600;
  }
  .result {
    margin: 0;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    font: 11.5px/1.5 var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-dim);
  }
  .actions {
    display: flex;
    margin-top: auto;
    padding-top: 8px;
  }
  .spacer {
    flex: 1;
  }
  .empty {
    margin: auto;
    max-width: 320px;
    text-align: center;
  }
  .empty .btn {
    margin: 16px auto 0;
  }
</style>
