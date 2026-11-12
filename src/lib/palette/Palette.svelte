<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { commands } from '$lib/keys/commands';
  import { formatKeys } from '$lib/keys/keymap';
  import { fuzzy, tildify } from '$lib/util';
  import { checkoutRef, mergeRef, newBranch, rebaseOnto } from '$lib/actions';

  interface Item {
    id: string;
    title: string;
    detail?: string;
    keys?: string;
    group: string;
    /** `background` is true for ⌘Enter. */
    run: (background: boolean) => void;
  }

  let query = $state('');
  let index = $state(0);
  let inputEl = $state<HTMLInputElement>();
  let listEl = $state<HTMLDivElement>();

  const mode = $derived(app.palette);

  function switchItems(q: string): Item[] {
    const out: Item[] = [];
    const looksLikeUrl = /^(git@|ssh:\/\/|https?:\/\/)\S+$/.test(q) || /^[\w.-]+@[\w.-]+:\S+$/.test(q);
    if (looksLikeUrl) {
      return [
        {
          id: 'clone',
          title: `Clone ${q}`,
          detail: 'choose a folder next',
          group: 'Actions',
          run: () => app.cloneRepo(q),
        },
      ];
    }
    const looksLikePath = q.startsWith('/') || q.startsWith('~/');
    if (looksLikePath) {
      out.push({
        id: 'open-path',
        title: `Open ${q}`,
        group: 'Actions',
        run: (bg) => app.openRepo(q, { background: bg }),
      });
    }

    // Previous tab first, so ⌘K ↵ flips between the last two repositories.
    const order = [...app.mru];
    if (order.length > 1) [order[0], order[1]] = [order[1], order[0]];
    for (const path of order) {
      const i = app.tabs.findIndex((t) => t.path === path);
      const tab = app.tabs[i];
      if (!tab) continue;
      out.push({
        id: `tab:${path}`,
        title: tab.name,
        detail: tab.status?.branch ? `${tab.status.branch} · ${tildify(path)}` : tildify(path),
        keys: i < 9 ? `mod+${i + 1}` : undefined,
        group: 'Open tabs',
        run: () => app.goto(i),
      });
    }

    app.spaces.forEach((space, i) => {
      if (i === app.spaceIdx) return;
      out.push({
        id: `space:${space.id}`,
        title: space.name,
        detail: `${space.tabs.length} ${space.tabs.length === 1 ? 'tab' : 'tabs'}`,
        keys: i < 9 ? `ctrl+${i + 1}` : undefined,
        group: 'Spaces',
        run: () => app.switchSpace(i),
      });
    });

    // Branches only once something is typed, so the default list stays short.
    if (q && !looksLikePath) {
      const focused = app.active;
      const repos = focused ? [focused, ...app.tabs.filter((t) => t !== focused)] : app.tabs;
      for (const repo of repos) {
        for (const ref of repo.refs) {
          if (ref.kind === 'tag') continue;
          if (ref.kind === 'local' && ref.short === repo.status?.branch) continue;
          if (ref.kind === 'remote' && repo.refs.some((r) => r.kind === 'local' && r.upstream === ref.short)) continue;
          out.push({
            id: `branch:${repo.path}:${ref.name}`,
            title: ref.short,
            detail: `check out in ${repo.name}`,
            group: 'Branches',
            run: () => {
              const i = app.tabs.indexOf(repo);
              if (i >= 0 && repo !== app.active) app.goto(i);
              checkoutRef(repo, ref);
            },
          });
        }
      }
    }

    for (const path of app.recents) {
      if (app.tabs.some((t) => t.path === path)) continue;
      out.push({
        id: `recent:${path}`,
        title: path.slice(path.lastIndexOf('/') + 1),
        detail: tildify(path),
        group: 'Recent',
        run: (bg) => app.openRepo(path, { background: bg }),
      });
    }

    if (q && !looksLikePath && !app.spaces.some((s) => s.name.toLowerCase() === q.toLowerCase())) {
      out.push({
        id: 'create-space',
        title: `New space ${q}`,
        group: 'Actions',
        run: () => app.newSpace(q),
      });
    }
    out.push({
      id: 'open-folder',
      title: 'Open folder…',
      keys: 'mod+o',
      group: 'Actions',
      run: () => app.openFolder(),
    });
    return out;
  }

  function branchItems(q: string): Item[] {
    const repo = app.active;
    if (!repo) return [];
    const out: Item[] = [];
    const current = repo.status?.branch;
    for (const kind of ['local', 'remote'] as const) {
      for (const ref of repo.refs) {
        if (ref.kind !== kind || (kind === 'local' && ref.short === current)) continue;
        // A remote branch that already has a local twin adds nothing.
        if (kind === 'remote' && repo.refs.some((r) => r.kind === 'local' && r.upstream === ref.short)) continue;
        const track = [ref.ahead && `↑${ref.ahead}`, ref.behind && `↓${ref.behind}`].filter(Boolean).join(' ');
        out.push({
          id: ref.name,
          title: ref.short,
          detail: track || undefined,
          group: kind === 'local' ? 'Local branches' : 'Remote branches',
          run: () => checkoutRef(repo, ref),
        });
      }
    }
    if (q && !/\s/.test(q) && !repo.refs.some((r) => r.kind === 'local' && r.short === q)) {
      out.push({
        id: 'create-branch',
        title: `Create branch ${q}`,
        detail: 'from HEAD',
        group: 'Actions',
        run: () => newBranch(repo, null, q),
      });
    }
    return out;
  }

  /** Branches and tags to merge in, or to rebase onto. */
  function targetItems(kind: 'merge' | 'rebase'): Item[] {
    const repo = app.active;
    if (!repo) return [];
    const current = repo.status?.branch;
    return repo.refs
      .filter((r) => !(r.kind === 'local' && r.short === current) && (kind === 'merge' || r.kind !== 'tag'))
      .map((ref) => ({
        id: ref.name,
        title: ref.short,
        group: ref.kind === 'local' ? 'Local branches' : ref.kind === 'remote' ? 'Remote branches' : 'Tags',
        run: () => (kind === 'merge' ? mergeRef(repo, ref.short) : rebaseOnto(repo, ref.short)),
      }));
  }

  function profileItems(): Item[] {
    const repo = app.active;
    if (!repo) return [];
    const bound = app.profiles.bindings[repo.path];
    const out: Item[] = app.profiles.profiles.map((p) => ({
      id: p.id,
      title: p.name,
      detail: [p.userEmail, bound === p.id ? 'in use' : ''].filter(Boolean).join(' · '),
      group: `Profile for ${repo.name}`,
      run: () => app.bindProfile(repo, p.id),
    }));
    out.push(
      {
        id: 'profile-auto',
        title: 'Automatic',
        detail: 'pick by remote rules' + (bound === undefined ? ' · in use' : ''),
        group: `Profile for ${repo.name}`,
        run: () => app.bindProfile(repo, null),
      },
      {
        id: 'profile-none',
        title: 'No profile',
        detail: 'plain git config and ssh defaults' + (bound === '' ? ' · in use' : ''),
        group: `Profile for ${repo.name}`,
        run: () => app.bindProfile(repo, ''),
      },
      {
        id: 'profile-manage',
        title: 'Manage profiles…',
        keys: 'mod+,',
        group: 'Actions',
        run: () => (app.profilesOpen = true),
      },
    );
    return out;
  }

  function commandItems(): Item[] {
    const hasRepo = !!app.active;
    return commands
      .filter((c) => !c.hidden && (c.scope === 'global' || hasRepo) && (!c.when || c.when()))
      .map((c) => ({
        id: c.id,
        title: c.title,
        keys: c.keys?.[0],
        group: 'Commands',
        run: () => c.run(),
      }));
  }

  const items = $derived.by<Item[]>(() => {
    if (!mode) return [];
    const q = query.trim();
    const all =
      mode === 'switch'
        ? switchItems(q)
        : mode === 'branches'
          ? branchItems(q)
          : mode === 'profiles'
            ? profileItems()
            : mode === 'merge' || mode === 'rebase'
              ? targetItems(mode)
            : commandItems();
    if (!q) return all;
    const scored: { item: Item; score: number; pos: number }[] = [];
    all.forEach((item, pos) => {
      if (item.id === 'clone') {
        scored.push({ item, score: Infinity, pos });
        return;
      }
      if (item.id === 'open-path' || item.id === 'create-branch' || item.id === 'create-space') {
        scored.push({ item, score: item.id === 'open-path' ? Infinity : -1e6, pos });
        return;
      }
      const a = fuzzy(q, item.title);
      const b = item.detail ? fuzzy(q, item.detail) : null;
      const score = Math.max(a ?? -Infinity, b === null ? -Infinity : b - 200);
      if (score > -Infinity) scored.push({ item, score, pos });
    });
    // Best match first; ties keep the natural order (tabs, spaces, branches, recents).
    scored.sort((x, y) => y.score - x.score || x.pos - y.pos);
    return scored.map((s) => s.item);
  });

  $effect(() => {
    if (mode) {
      query = '';
      index = 0;
      inputEl?.focus();
    }
  });

  $effect(() => {
    query;
    index = 0;
  });

  $effect(() => {
    listEl?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  });

  function choose(item: Item | undefined, background: boolean) {
    if (!item) return;
    // Background opens keep the palette up so several repos can be queued.
    if (!background) app.palette = null;
    item.run(background);
  }

  function onKey(e: KeyboardEvent) {
    const n = items.length;
    const ctrl = e.ctrlKey && !e.metaKey;
    if (e.key === 'ArrowDown' || (ctrl && (e.key === 'n' || e.key === 'j'))) {
      e.preventDefault();
      if (n) index = (index + 1) % n;
    } else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'p' || e.key === 'k'))) {
      e.preventDefault();
      if (n) index = (index - 1 + n) % n;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[index], e.metaKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      app.palette = null;
    }
  }
</script>

{#if mode}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={() => (app.palette = null)}>
    <div class="palette" onmousedown={(e) => e.stopPropagation()}>
      <input
        bind:this={inputEl}
        bind:value={query}
        placeholder={mode === 'switch'
          ? 'Jump to a repository, branch or space; paste a path or clone URL…'
          : mode === 'branches'
            ? `Switch branch (on ${app.active?.status?.branch ?? 'detached HEAD'}), or type a new name…`
            : mode === 'profiles'
              ? 'Choose a profile…'
              : mode === 'merge'
                ? `Merge into ${app.active?.status?.branch ?? 'HEAD'}…`
                : mode === 'rebase'
                  ? `Rebase ${app.active?.status?.branch ?? 'HEAD'} onto…`
              : 'Run a command…'}
        spellcheck="false"
        autocomplete="off"
        onkeydown={onKey}
      />
      <div class="list" bind:this={listEl}>
        {#each items as item, i (item.id)}
          {#if i === 0 || items[i - 1].group !== item.group}
            <div class="group">{item.group}</div>
          {/if}
          <div
            class="item"
            class:sel={i === index}
            data-idx={i}
            onmousemove={() => (index = i)}
            onclick={(e) => choose(item, e.metaKey)}
          >
            <span class="title truncate">{item.title}</span>
            {#if item.detail}<span class="detail truncate">{item.detail}</span>{/if}
            <span class="spacer"></span>
            {#if item.keys}<kbd>{formatKeys(item.keys)}</kbd>{/if}
          </div>
        {/each}
        {#if items.length === 0}
          <div class="none">Nothing matches.</div>
        {/if}
      </div>
      {#if mode === 'switch'}
        <div class="foot">
          <span><kbd>↵</kbd> open</span>
          <span><kbd>⌘↵</kbd> open in background</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: rgba(0, 0, 0, 0.45);
  }
  .palette {
    width: min(620px, calc(100vw - 48px));
    max-height: 62vh;
    display: flex;
    flex-direction: column;
    background: var(--raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }
  input {
    height: 46px;
    padding: 0 16px;
    font-size: 15px;
    border-bottom: 1px solid var(--border-strong);
    flex: none;
  }
  .list {
    overflow-y: auto;
    padding: 4px 6px 6px;
  }
  .group {
    padding: 8px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--radius);
  }
  .item.sel {
    background: var(--select);
  }
  .title {
    flex: none;
    max-width: 60%;
  }
  .detail {
    color: var(--text-faint);
    font-size: 12px;
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .none {
    padding: 18px 10px;
    color: var(--text-faint);
  }
  .foot {
    display: flex;
    gap: 16px;
    padding: 8px 14px;
    border-top: 1px solid var(--border-strong);
    font-size: 11px;
    color: var(--text-faint);
    flex: none;
  }
</style>
