/**
 * Dev only: lets the UI run in a plain browser (`pnpm dev`, no Tauri) against
 * a recorded fixture. Regenerate the fixture with
 *   cargo run --example dump -- <repo> > src/lib/dev/fixture.json
 *
 * `#keys=mod+k,j,enter` in the URL replays key presses after load.
 */
import fixture from './fixture.json';

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
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function install() {
  const f = fixture as any;
  const handlers: Record<string, (args: any) => unknown> = {
    session_load: () => ({
      spaces: [
        { name: 'Work', tabs: [REPO, '/demo/web-client', '/demo/infra'], active: 0, split: null },
        { name: 'Side projects', tabs: ['/demo/design-tokens'], active: 0, split: null },
      ],
      space: 0,
      recents: [REPO, '/demo/web-client', '/demo/infra', '/demo/design-tokens', '/demo/billing-worker'],
    }),
    session_save: () => null,
    repo_open: ({ path }) => ({ path, name: path.slice(path.lastIndexOf('/') + 1) }),
    repo_status: () => f.status,
    repo_refs: () => f.refs,
    repo_log: () => f.log,
    commit_detail: ({ sha }) => f.details[sha],
    diff_file: ({ target, path }) =>
      f.diffs[target.kind === 'commit' ? `commit:${target.sha}:${path}` : `${target.kind}:${path}`],
    watch_repo: () => null,
    unwatch_repo: () => null,
    git_log: () => [],
    reset: () => null,
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
      ].map((cmd) => [cmd, () => null]),
    ),
    'plugin:event|listen': () => 1,
  };

  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: any) => {
      const handler = handlers[cmd];
      if (!handler) throw new Error(`mock: no handler for ${cmd}`);
      return structuredClone(handler(args ?? {}));
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
