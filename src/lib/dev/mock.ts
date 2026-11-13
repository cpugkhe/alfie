/**
 * Dev only: lets the UI run in a plain browser (`pnpm dev`, no Tauri) against
 * a recorded fixture. Regenerate the fixture with
 *   cargo run --example dump -- <repo> > src/lib/dev/fixture.json
 *
 * `#keys=mod+k,j,enter` in the URL replays key presses after load.
 */
import fixture from './fixture.json';
import type { GitHubConnection } from '$lib/api';

const REPO = '/demo/acme-api';

const CODES: Record<string, string> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '/': 'Slash',
  comma: 'Comma', // the key list itself is comma separated
  '\\': 'Backslash',
  enter: 'Enter',
  esc: 'Escape',
  tab: 'Tab',
  up: 'ArrowUp',
  down: 'ArrowDown',
  space: 'Space',
};

function press(combo: string) {
  // `click:<css selector>` clicks an element instead of pressing a key.
  if (combo.startsWith('click:')) {
    const el = document.querySelector<HTMLElement>(decodeURIComponent(combo.slice(6)));
    el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el?.click();
    return;
  }
  const parts = combo.split('+');
  const key = parts.pop()!;
  const code = CODES[key] ?? (/^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);
  const target = document.activeElement ?? window;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      key: key === 'enter' ? 'Enter' : key === 'esc' ? 'Escape' : key,
      metaKey: parts.includes('mod'),
      shiftKey: parts.includes('shift'),
      ctrlKey: parts.includes('ctrl'),
      altKey: parts.includes('alt'),
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function install() {
  const f = fixture as any;
  const confirmationDemo = location.hash.includes('demoConfirmation');
  const originDemo = location.hash.includes('demoOrigin');
  const demoLocal = f.refs.refs.find((r: any) => r.short === 'hotfix/crash');
  const demoCurrent = f.refs.refs.find((r: any) => r.kind === 'local' && r.short === f.status.branch);
  const githubAccounts = [{ login: 'demo', active: true }, { login: 'work-demo', active: false }];
  let githubConnection: GitHubConnection = location.hash.includes('githubMissing')
    ? { kind: 'missingCli' }
    : location.hash.includes('githubSignedOut') ? { kind: 'signedOut', accounts: [] }
    : location.hash.includes('githubError') ? { kind: 'error', message: 'Couldn’t reach GitHub. Check your connection and try again.', accounts: githubAccounts }
    : { kind: 'connected', login: 'demo', accounts: githubAccounts };
  let finishLogin: ((value: unknown) => void) | null = null;
  let loginTimer: ReturnType<typeof setTimeout> | undefined;
  const handlers: Record<string, (args: any) => unknown> = {
    github_status: ({ account }) => githubConnection.kind === 'connected'
      ? githubAccounts.some((saved) => saved.login === (account ?? 'demo'))
        ? { kind: 'connected', login: account ?? 'demo', accounts: githubAccounts }
        : { kind: 'signedOut', accounts: githubAccounts }
      : githubConnection,
    github_login: ({ onCode }) => new Promise((resolve) => {
      finishLogin = resolve;
      onCode.onmessage('ABCD-1234');
      loginTimer = setTimeout(() => {
        if (!githubAccounts.some((saved) => saved.login === 'new-demo')) githubAccounts.push({ login: 'new-demo', active: false });
        githubConnection = { kind: 'connected', login: 'new-demo', accounts: githubAccounts };
        finishLogin = null;
        resolve(githubConnection);
      }, 15_000);
    }),
    github_cancel: () => {
      clearTimeout(loginTimer);
      finishLogin?.({ kind: 'signedOut', accounts: githubAccounts });
      finishLogin = null;
    },
    session_load: () => ({
      spaces: [
        { name: 'Work', tabs: [REPO, '/demo/web-client', '/demo/infra'], active: 0, split: null },
        { name: 'Side projects', tabs: ['/demo/design-tokens'], active: 0, split: null },
      ],
      space: 0,
      repos: { [REPO]: { favorites: ['refs/heads/main', 'refs/heads/feature/login'], bases: {} } },
      recents: [REPO, '/demo/web-client', '/demo/infra', '/demo/design-tokens', '/demo/billing-worker'],
    }),
    session_save: () => null,
    repo_open: ({ path }) => ({ path, name: path.slice(path.lastIndexOf('/') + 1) }),
    repo_status: () => f.status,
    repo_pulls: () => githubConnection.kind === 'connected' ? ({
      [`refs/heads/${f.status.branch}`]: { number: 42, url: 'https://github.com/acme/acme-api/pull/42' },
      'refs/heads/feature/login': { number: 38, url: 'https://github.com/acme/acme-api/pull/38' },
    }) : {},
    'plugin:opener|open_url': ({ url }) => { window.open(url, '_blank', 'noopener,noreferrer'); },
    // Give a few branches an upstream so status chips can be previewed.
    repo_refs: () => ({
      ...f.refs,
      refs: f.refs.refs.map((r: any) =>
        originDemo && r === demoCurrent
          ? { ...r, upstream: `origin/${r.short}` }
          : r.short === 'main'
          ? { ...r, upstream: 'origin/main' }
          : r.short === 'feature/login'
            ? { ...r, upstream: 'origin/feature/login', behind: 2 }
            : r.short === 'hotfix/crash'
              ? { ...r, upstream: 'origin/hotfix/crash', ahead: 1 }
              : r,
      ).concat(confirmationDemo && demoLocal ? [{
        ...demoLocal,
        kind: 'remote', name: 'refs/remotes/origin/hotfix/crash', short: 'origin/hotfix/crash',
        target: f.log.commits.find((c: any) => c.id === demoLocal.target)?.parents[0] ?? demoLocal.target,
        upstream: null, ahead: 0, behind: 0,
      }] : []).concat(originDemo && demoCurrent ? [{
        ...demoCurrent,
        kind: 'remote', name: `refs/remotes/origin/${demoCurrent.short}`, short: `origin/${demoCurrent.short}`,
        upstream: null, ahead: 0, behind: 0,
      }] : []),
    }),
    repo_log: ({ branch, scope, limit }) => {
      if (!branch && scope !== 'current') return f.log;
      const tip = branch ? f.refs.refs.find((r: any) => r.name === branch)?.target : f.log.head;
      const ancestors = new Set<string>();
      const pending = [tip];
      while (pending.length) {
        const id = pending.pop();
        if (!id || ancestors.has(id)) continue;
        ancestors.add(id);
        pending.push(...(f.log.commits.find((c: any) => c.id === id)?.parents ?? []));
      }
      const commits = f.log.commits.filter((c: any) => ancestors.has(c.id));
      return { ...f.log, commits: commits.slice(0, limit), hasMore: commits.length > limit };
    },
    commit_detail: ({ sha }) => f.details[sha],
    stash_detail: ({ sha }) => ({ ...f.details[f.log.commits[0].id], id: sha, message: f.refs.stashes.find((s: any) => s.id === sha)?.message ?? 'Saved changes' }),
    diff_file: ({ target, path }) =>
      f.diffs[target.kind === 'stash' ? `commit:${f.log.commits[0].id}:${path}` : target.kind === 'commit' ? `commit:${target.sha}:${path}` : `${target.kind}:${path}`],
    watch_repo: () => null,
    unwatch_repo: () => null,
    git_log: () => [],
    reset: () => null,
    update_branch: () => null,
    update_from_base: () => null,
    repo_base: () => ({ name: 'main', target: 'origin/main', behind: 3, guessed: true }),
    ...Object.fromEntries(
      ['merge', 'rebase', 'pick', 'sequence', 'create_tag', 'delete_tag', 'push_tag', 'delete_remote_tag'].map((c) => [c, () => null]),
    ),
    stash_rename: () => null,
    repo_remote: ({ repo }) => `github.com:acme/${repo.slice(repo.lastIndexOf('/') + 1)}`,
    profiles_load: () => ({
      profiles: [
        { id: 'w', name: 'Work', userName: 'Demo Dev', userEmail: 'demo@acme.io', sshKey: '~/.ssh/id_work', rules: ['github.com:acme/*'] },
        { id: 'p', name: 'Personal', userName: 'Demo Dev', userEmail: 'demo@example.com', sshKey: '~/.ssh/id_ed25519', rules: ['github.com'] },
      ],
      bindings: {},
    }),
    profiles_save: () => null,
    profile_for: ({ repo }) => ({
      profile: { id: 'w', name: repo.includes('design') ? 'Personal' : 'Work', userName: '', userEmail: '', sshKey: '', rules: [] },
      auto: true,
    }),
    profile_test: () => "Hi demo! You've successfully authenticated, but GitHub does not provide shell access.",
    clone_repo: () => null,
    last_message: () => f.log.commits[0]?.subject ?? '',
    ...Object.fromEntries(
      [
        'stage', 'unstage', 'stage_all', 'unstage_all', 'discard', 'apply_hunk', 'commit', 'checkout',
        'create_branch', 'delete_branch', 'rename_branch', 'stash_push', 'stash_action', 'fetch', 'pull', 'push',
        'checkout_remote', 'push_branch', 'delete_remote_branch',
      ].map((cmd) => [cmd, () => null]),
    ),
    ...(confirmationDemo ? {
      checkout_remote: ({ expected }: { expected: string | null }) => {
        if (expected !== demoLocal?.target) throw new Error('Reset was attempted without approval.');
        return null;
      },
    } : {}),
    'plugin:event|listen': () => 1,
  };

  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: any) => {
      const handler = handlers[cmd];
      if (!handler) throw new Error(`mock: no handler for ${cmd}`);
      return structuredClone(await handler(args ?? {}));
    },
    transformCallback: () => 0,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };

  // Not URLSearchParams: it would turn the `+` of `mod+k` into a space.
  // `#demoError` shows sample error toasts, to check how they look.
  if (location.hash.includes('demoError')) {
    setTimeout(async () => {
      const { app } = await import('$lib/state/app.svelte');
      app.toast('Pushed');
      app.toast(
        "To github.com:acme/api.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'github.com:acme/api.git'\nhint: Updates were rejected because the remote contains work that you do not have locally.",
        'error',
        'Pushing…',
      );
    }, 500);
  }

  const keys = /keys=([^&]*)/.exec(location.hash)?.[1];
  if (keys) {
    let delay = 400;
    for (const combo of keys.split(',')) {
      setTimeout(() => press(combo), delay);
      delay += 120;
    }
  }
}
