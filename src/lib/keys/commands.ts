import * as act from '$lib/actions';
import { app } from '$lib/state/app.svelte';
import { WT, type Focus, type RepoState } from '$lib/state/repo.svelte';
import type { Command, Scope } from './keymap';

const repo = () => app.active;
const hasRepo = () => !!app.active;

/** Panes that can take focus right now, left to right. */
function panes(): Focus[] {
  const r = repo();
  if (!r) return [];
  const out: Focus[] = [];
  // The sidebar hides itself in narrow panes; skip it when it is not on screen.
  if (app.sidebarOpen && document.querySelector('.pane.focused .sidebar, .pane:not(.split) .sidebar')) out.push('sidebar');
  out.push(r.diff ? 'diff' : 'graph');
  if (app.detailOpen) out.push('files');
  return out;
}

function focusPane(dir: 1 | -1) {
  const r = repo();
  if (!r) return;
  // Graph and diff share the centre slot.
  const list = panes();
  if (!list.includes(r.focus)) r.focus = r.diff ? 'diff' : 'graph';
  r.cycleFocus(dir, list);
}

const PAGE_ROWS = 15;

function isTextField() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Edit menu → Undo / Redo: text fields keep their own undo. */
export function menuAction(id: string) {
  if (isTextField()) {
    document.execCommand(id);
    return;
  }
  const r = app.active;
  if (!r || app.dialog || app.confirmation) return;
  if (id === 'undo') act.undo(r);
  else if (id === 'redo') act.redo(r);
}

/** Runs `fn` with the active repository, if there is one. */
const withRepo = (fn: (r: RepoState) => unknown) => () => {
  const r = repo();
  if (r) fn(r);
};
const inChanges = () => repo()?.selectedId === WT;
const sidebarRef = () => {
  const r = repo();
  const item = r?.sidebar[r.sidebarIdx];
  return item?.type === 'ref' ? item.ref : null;
};

export const commands: Command[] = [
  // ---------- global ----------
  {
    id: 'palette.switch',
    title: 'Switch repository…',
    keys: ['mod+k'],
    scope: 'global',
    overlay: true,
    run: () => (app.palette = app.palette === 'switch' ? null : 'switch'),
  },
  {
    id: 'palette.commands',
    title: 'Command palette…',
    keys: ['mod+shift+p'],
    scope: 'global',
    overlay: true,
    hidden: true,
    run: () => (app.palette = app.palette === 'commands' ? null : 'commands'),
  },
  {
    id: 'repo.openFolder',
    title: 'Open repository folder…',
    keys: ['mod+o'],
    scope: 'global',
    run: () => app.openFolder(),
  },
  {
    id: 'tab.new',
    title: 'New tab',
    keys: ['mod+t'],
    scope: 'global',
    run: () => app.newTab(),
  },
  {
    id: 'tab.prev',
    title: 'Previous tab',
    keys: ['mod+shift+['],
    scope: 'global',
    run: () => app.cycle(-1),
  },
  {
    id: 'tab.next',
    title: 'Next tab',
    keys: ['mod+shift+]'],
    scope: 'global',
    run: () => app.cycle(1),
  },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `tab.goto${i + 1}`,
    title: `Go to tab ${i + 1}`,
    keys: [`mod+${i + 1}`],
    scope: 'global',
    hidden: true,
    run: () => app.goto(i),
  })),
  {
    id: 'tab.close',
    title: 'Close tab',
    keys: ['mod+w'],
    scope: 'global',
    when: () => hasRepo() || app.space.blank,
    run: () => app.closeActive(),
  },
  {
    id: 'tab.reopen',
    title: 'Reopen closed tab',
    keys: ['mod+shift+t'],
    scope: 'global',
    run: () => app.reopenTab(),
  },
  {
    id: 'profiles.manage',
    title: 'Profiles…',
    keys: ['mod+,'],
    scope: 'global',
    run: () => (app.profilesOpen = true),
  },
  {
    id: 'profiles.switch',
    title: 'Switch profile for this repository…',
    keys: ['mod+shift+u'],
    scope: 'repo',
    overlay: true,
    run: () => (app.palette = app.palette === 'profiles' ? null : 'profiles'),
  },

  // ---------- panes ----------
  {
    id: 'pane.splitRight',
    title: 'Split: open previous tab on the right',
    keys: ['mod+\\'],
    scope: 'global',
    run: () => app.splitActive('row'),
  },
  {
    id: 'pane.splitDown',
    title: 'Split: open previous tab below',
    keys: ['mod+shift+\\'],
    scope: 'global',
    run: () => app.splitActive('column'),
  },
  {
    id: 'pane.other',
    title: 'Focus other pane',
    keys: ['mod+alt+right', 'mod+alt+left', 'mod+alt+down', 'mod+alt+up'],
    scope: 'global',
    when: () => !!app.secondary,
    run: () => app.focusPane(app.space.paneFocus === 0 ? 1 : 0),
  },
  {
    id: 'pane.close',
    title: 'Close split pane',
    scope: 'global',
    when: () => !!app.secondary,
    run: () => app.closeSplit(),
  },

  // ---------- spaces ----------
  {
    id: 'space.switcher',
    title: 'Spaces…',
    keys: ['ctrl+s'],
    scope: 'global',
    run: () => (app.spacesOpen = true),
  },
  {
    id: 'space.next',
    title: 'Next space',
    keys: ['mod+alt+]'],
    scope: 'global',
    run: () => app.cycleSpace(1),
  },
  {
    id: 'space.prev',
    title: 'Previous space',
    keys: ['mod+alt+['],
    scope: 'global',
    run: () => app.cycleSpace(-1),
  },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `space.goto${i + 1}`,
    title: `Go to space ${i + 1}`,
    keys: [`ctrl+${i + 1}`],
    scope: 'global',
    hidden: true,
    run: () => app.switchSpace(i),
  })),
  {
    id: 'space.new',
    title: 'New space…',
    scope: 'global',
    run: () => app.newSpace(),
  },
  {
    id: 'space.rename',
    title: 'Rename current space…',
    scope: 'global',
    run: () => app.renameSpace(),
  },
  {
    id: 'space.delete',
    title: 'Delete current space…',
    scope: 'global',
    run: () => app.deleteSpace(),
  },
  {
    id: 'space.moveLeft',
    title: 'Move space earlier',
    scope: 'global',
    when: () => app.spaceIdx > 0,
    run: () => app.moveSpace(app.spaceIdx, app.spaceIdx - 1),
  },
  {
    id: 'space.moveRight',
    title: 'Move space later',
    scope: 'global',
    when: () => app.spaceIdx < app.spaces.length - 1,
    run: () => app.moveSpace(app.spaceIdx, app.spaceIdx + 1),
  },

  {
    id: 'zoom.in',
    title: 'Zoom in',
    keys: ['mod+=', 'mod+shift+='],
    scope: 'global',
    overlay: true,
    run: () => app.setZoom(app.zoom + 0.1),
  },
  {
    id: 'zoom.out',
    title: 'Zoom out',
    keys: ['mod+-'],
    scope: 'global',
    overlay: true,
    run: () => app.setZoom(app.zoom - 0.1),
  },
  {
    id: 'zoom.reset',
    title: 'Reset zoom',
    keys: ['mod+0'],
    scope: 'global',
    overlay: true,
    run: () => app.setZoom(1),
  },
  {
    id: 'log.toggle',
    title: 'Toggle git command log',
    keys: ['mod+j'],
    scope: 'global',
    run: () => (app.logOpen = !app.logOpen),
  },
  {
    id: 'help.toggle',
    title: 'Keyboard shortcuts',
    keys: ['shift+/'],
    scope: 'global',
    overlay: true,
    run: () => (app.helpOpen = !app.helpOpen),
  },

  {
    id: 'overlay.close',
    title: 'Close overlay',
    keys: ['esc'],
    scope: 'global',
    overlay: true,
    hidden: true,
    when: () => app.helpOpen || app.palette !== null,
    run: () => {
      app.helpOpen = false;
      app.palette = null;
    },
  },

  // ---------- repo ----------
  {
    id: 'view.sidebar',
    title: 'Toggle sidebar',
    keys: ['mod+shift+b'],
    scope: 'repo',
    run: () => {
      app.sidebarOpen = !app.sidebarOpen;
      const r = repo();
      if (r && !app.sidebarOpen && r.focus === 'sidebar') r.focus = 'graph';
    },
  },
  {
    id: 'view.detail',
    title: 'Toggle detail panel',
    keys: ['mod+shift+d'],
    scope: 'repo',
    run: () => {
      app.detailOpen = !app.detailOpen;
      const r = repo();
      if (r && !app.detailOpen && r.focus === 'files') r.focus = r.diff ? 'diff' : 'graph';
    },
  },
  {
    id: 'focus.next',
    title: 'Focus next pane',
    keys: ['tab', 'mod+right'],
    scope: 'repo',
    run: () => focusPane(1),
  },
  {
    id: 'focus.prev',
    title: 'Focus previous pane',
    keys: ['shift+tab', 'mod+left'],
    scope: 'repo',
    run: () => focusPane(-1),
  },
  {
    id: 'repo.refresh',
    title: 'Refresh',
    keys: ['mod+r'],
    scope: 'repo',
    run: () => repo()?.refresh(),
  },
  {
    id: 'graph.search',
    title: 'Search commits',
    keys: ['mod+f', '/'],
    scope: 'repo',
    run: () => {
      const r = repo();
      if (!r) return;
      r.closeDiff();
      r.focus = 'graph';
      r.filterOpen = true;
      r.searchFocus++;
    },
  },
  {
    id: 'graph.head',
    title: 'Jump to HEAD',
    keys: ['mod+g'],
    scope: 'repo',
    run: () => repo()?.jumpToHead(),
  },
  {
    id: 'graph.scopeAll',
    title: 'Graph: show all branches',
    scope: 'repo',
    run: () => repo()?.setScope('all'),
  },
  {
    id: 'graph.scopeLocal',
    title: 'Graph: hide remote-only branches',
    scope: 'repo',
    run: () => repo()?.setScope('local'),
  },
  {
    id: 'graph.scopeCurrent',
    title: 'Graph: current branch only',
    scope: 'repo',
    run: () => repo()?.setScope('current'),
  },

  // ---------- branches, remotes, stash ----------
  {
    id: 'branch.switch',
    title: 'Switch branch…',
    keys: ['mod+b'],
    scope: 'repo',
    overlay: true,
    run: () => (app.palette = app.palette === 'branches' ? null : 'branches'),
  },
  {
    id: 'branch.new',
    title: 'New branch from HEAD…',
    keys: ['mod+shift+n'],
    scope: 'repo',
    run: withRepo((r) => act.newBranch(r)),
  },
  {
    id: 'branch.newHere',
    title: 'New branch at selected commit…',
    scope: 'repo',
    when: () => !!repo()?.selectedId && repo()?.selectedId !== WT && !repo()?.selectedStash,
    run: withRepo((r) => act.newBranch(r, r.selectedId)),
  },
  {
    id: 'commit.checkout',
    title: 'Check out selected commit (detached)',
    scope: 'repo',
    when: () => !!repo()?.selectedId && repo()?.selectedId !== WT && !repo()?.selectedStash,
    run: withRepo((r) => act.checkoutRef(r, { short: r.selectedId, kind: 'tag' })),
  },
  {
    id: 'branch.updateFromBase',
    title: 'Update current branch from its base branch',
    keys: ['mod+u'],
    scope: 'repo',
    run: withRepo(act.updateFromBase),
  },
  {
    id: 'branch.setBase',
    title: 'Choose base branch for the current branch…',
    scope: 'repo',
    overlay: true,
    run: () => (app.palette = app.palette === 'base' ? null : 'base'),
  },
  {
    id: 'branch.merge',
    title: 'Merge a branch into the current one…',
    keys: ['mod+shift+g'],
    scope: 'repo',
    overlay: true,
    run: () => (app.palette = app.palette === 'merge' ? null : 'merge'),
  },
  {
    id: 'branch.rebase',
    title: 'Rebase current branch onto…',
    keys: ['mod+shift+e'],
    scope: 'repo',
    overlay: true,
    run: () => (app.palette = app.palette === 'rebase' ? null : 'rebase'),
  },
  ...(
    [
      ['commit.cherryPick', 'Cherry-pick selected commit', (r: RepoState) => act.cherryPick(r, r.selectedId)],
      ['commit.revert', 'Revert selected commit', (r: RepoState) => act.revertCommit(r, r.selectedId)],
      ['commit.tag', 'Create tag at selected commit…', (r: RepoState) => act.createTag(r, r.selectedId)],
      ['commit.resetSoft', 'Reset branch to selected commit — soft', (r: RepoState) => act.resetTo(r, r.selectedId, 'soft')],
      ['commit.resetMixed', 'Reset branch to selected commit — mixed', (r: RepoState) => act.resetTo(r, r.selectedId, 'mixed')],
      ['commit.resetHard', 'Reset branch to selected commit — hard…', (r: RepoState) => act.resetTo(r, r.selectedId, 'hard')],
    ] as const
  ).map(([id, title, fn]): Command => ({
    id,
    title,
    scope: 'repo',
    when: () => !!repo()?.selectedId && repo()?.selectedId !== WT && !repo()?.selectedStash,
    run: withRepo(fn),
  })),
  ...(['continue', 'skip', 'abort'] as const).map((action): Command => ({
    id: `sequence.${action}`,
    title: `${action[0].toUpperCase()}${action.slice(1)} merge / rebase / cherry-pick in progress`,
    scope: 'repo',
    when: () => !!repo()?.status?.state && !(action === 'skip' && repo()?.status?.state === 'merge'),
    run: withRepo((r) => act.sequence(r, action)),
  })),
  {
    id: 'remote.fetch',
    title: 'Fetch all remotes',
    keys: ['mod+shift+f'],
    scope: 'repo',
    run: withRepo(act.fetch),
  },
  {
    id: 'remote.pull',
    title: 'Pull',
    keys: ['mod+shift+l'],
    scope: 'repo',
    run: withRepo(act.pull),
  },
  {
    id: 'remote.push',
    title: 'Push',
    keys: ['mod+shift+k'],
    scope: 'repo',
    run: withRepo(act.push),
  },
  {
    id: 'remote.forcePush',
    title: 'Force push (with lease)…',
    scope: 'repo',
    run: withRepo(act.forcePush),
  },
  {
    id: 'stash.push',
    title: 'Stash changes…',
    keys: ['mod+shift+s'],
    scope: 'repo',
    run: withRepo(act.stashChanges),
  },

  {
    id: 'edit.undo',
    title: 'Undo last git action',
    keys: ['mod+z'],
    scope: 'repo',
    when: () => !isTextField(),
    run: withRepo(act.undo),
  },
  {
    id: 'edit.redo',
    title: 'Redo',
    keys: ['mod+shift+z'],
    scope: 'repo',
    when: () => !isTextField(),
    run: withRepo(act.redo),
  },

  // ---------- commit ----------
  {
    id: 'commit.focus',
    title: 'Write commit message',
    keys: ['c'],
    scope: 'repo',
    run: withRepo(act.focusCommit),
  },
  {
    id: 'commit.run',
    title: 'Commit',
    keys: ['mod+enter'],
    scope: 'repo',
    run: withRepo((r) => act.commit(r)),
  },
  {
    id: 'commit.runPush',
    title: 'Commit and push',
    keys: ['mod+shift+enter'],
    scope: 'repo',
    run: withRepo((r) => act.commit(r, true)),
  },
  {
    id: 'commit.amend',
    title: 'Toggle amend last commit',
    keys: ['mod+shift+m'],
    scope: 'repo',
    run: withRepo(act.toggleAmend),
  },
  {
    id: 'stage.all',
    title: 'Stage all changes',
    keys: ['mod+shift+a'],
    scope: 'repo',
    run: withRepo(act.stageAll),
  },
  {
    id: 'stage.none',
    title: 'Unstage all',
    scope: 'repo',
    run: withRepo(act.unstageAll),
  },

  // ---------- changed files ----------
  {
    id: 'file.stage',
    title: 'Stage / unstage file',
    keys: ['space', 's'],
    scope: 'files',
    hidden: true,
    when: inChanges,
    run: withRepo(act.toggleStage),
  },
  {
    id: 'file.markDown',
    title: 'Extend selection down',
    keys: ['shift+j', 'shift+down'],
    scope: 'files',
    hidden: true,
    when: inChanges,
    run: withRepo((r) => r.extendMarks(1)),
  },
  {
    id: 'file.markUp',
    title: 'Extend selection up',
    keys: ['shift+k', 'shift+up'],
    scope: 'files',
    hidden: true,
    when: inChanges,
    run: withRepo((r) => r.extendMarks(-1)),
  },
  {
    id: 'file.markAll',
    title: 'Select all files',
    keys: ['a'],
    scope: 'files',
    hidden: true,
    when: inChanges,
    run: withRepo((r) => (r.marks.length === r.files.length ? r.clearMarks() : r.markAll())),
  },
  {
    id: 'file.view',
    title: 'Changed files: toggle list / tree view',
    keys: ['t'],
    scope: 'files',
    run: withRepo((r) => {
      r.toggleFileView();
      app.save();
    }),
  },
  {
    id: 'file.search',
    title: 'Search changed files',
    keys: ['/', 'mod+f'],
    scope: 'files',
    run: withRepo((r) => r.fileFilterFocus++),
  },
  {
    id: 'file.discard',
    title: 'Discard file changes…',
    keys: ['backspace'],
    scope: 'files',
    hidden: true,
    when: inChanges,
    run: withRepo(act.discardFile),
  },

  // ---------- diff ----------
  {
    id: 'hunk.next',
    title: 'Next hunk',
    keys: ['n'],
    scope: 'diff',
    hidden: true,
    run: withRepo((r) => r.moveHunk(1)),
  },
  {
    id: 'hunk.prev',
    title: 'Previous hunk',
    keys: ['p'],
    scope: 'diff',
    hidden: true,
    run: withRepo((r) => r.moveHunk(-1)),
  },
  {
    id: 'hunk.stage',
    title: 'Stage / unstage hunk or selected lines',
    keys: ['s', 'space'],
    scope: 'diff',
    hidden: true,
    run: withRepo((r) => act.hunkAction(r, 'stage')),
  },
  {
    id: 'hunk.unstage',
    title: 'Unstage hunk or selected lines',
    keys: ['u'],
    scope: 'diff',
    hidden: true,
    run: withRepo((r) => act.hunkAction(r, 'unstage')),
  },
  {
    id: 'hunk.discard',
    title: 'Discard hunk or selected lines…',
    keys: ['x'],
    scope: 'diff',
    hidden: true,
    run: withRepo((r) => act.hunkAction(r, 'discard')),
  },
  {
    id: 'hunk.lines',
    title: 'Select lines (then j/k to extend)',
    keys: ['v'],
    scope: 'diff',
    hidden: true,
    run: withRepo((r) => r.toggleLineMode()),
  },

  // ---------- sidebar ----------
  {
    id: 'side.toggle',
    title: 'Collapse / expand section',
    keys: ['space'],
    scope: 'sidebar',
    hidden: true,
    run: withRepo((r) => {
      const key = r.sidebarSection();
      if (key) {
        r.toggleSection(key);
        app.save();
      }
    }),
  },
  {
    id: 'side.sort',
    title: 'Change section sort (name / recent)',
    keys: ['o'],
    scope: 'sidebar',
    hidden: true,
    run: withRepo((r) => {
      const key = r.sidebarSection();
      if (key) {
        r.cycleSort(key);
        app.save();
      }
    }),
  },
  {
    id: 'side.delete',
    title: 'Delete branch / drop stash…',
    keys: ['backspace'],
    scope: 'sidebar',
    hidden: true,
    run: withRepo(act.deleteSidebarItem),
  },
  {
    id: 'side.pop',
    title: 'Pop stash',
    keys: ['p'],
    scope: 'sidebar',
    hidden: true,
    when: () => repo()?.sidebar[repo()!.sidebarIdx]?.type === 'stash',
    run: withRepo((r) => {
      const item = r.sidebar[r.sidebarIdx];
      if (item?.type === 'stash') act.applyStash(r, item.stash, true);
    }),
  },
  {
    id: 'side.editStash',
    title: 'Edit stash message',
    keys: ['e'],
    scope: 'sidebar',
    hidden: true,
    when: () => repo()?.sidebar[repo()!.sidebarIdx]?.type === 'stash',
    run: withRepo((r) => {
      const item = r.sidebar[r.sidebarIdx];
      if (item?.type === 'stash') act.renameStash(r, item.stash);
    }),
  },
  {
    id: 'side.favorite',
    title: 'Add / remove favorite',
    keys: ['alt+f'],
    scope: 'sidebar',
    hidden: true,
    when: () => !!sidebarRef() && sidebarRef()?.kind !== 'tag',
    run: withRepo((r) => {
      const ref = sidebarRef();
      if (ref) act.toggleFavorite(r, ref);
    }),
  },
  {
    id: 'side.update',
    title: 'Update branch to latest',
    keys: ['u'],
    scope: 'sidebar',
    hidden: true,
    when: () => !!sidebarRef() && sidebarRef()?.kind !== 'tag',
    run: withRepo((r) => {
      const ref = sidebarRef();
      if (ref) act.updateBranch(r, ref);
    }),
  },
  {
    id: 'side.merge',
    title: 'Merge selected branch into current',
    keys: ['m'],
    scope: 'sidebar',
    hidden: true,
    when: () => !!sidebarRef(),
    run: withRepo((r) => {
      const ref = sidebarRef();
      if (ref) act.mergeRef(r, ref.short);
    }),
  },
  {
    id: 'side.rename',
    title: 'Rename branch…',
    keys: ['r'],
    scope: 'sidebar',
    hidden: true,
    when: () => sidebarRef()?.kind === 'local',
    run: withRepo((r) => {
      const ref = sidebarRef();
      if (ref) act.renameBranch(r, ref);
    }),
  },
  {
    id: 'side.branch',
    title: 'New branch from selected…',
    keys: ['n'],
    scope: 'sidebar',
    hidden: true,
    when: () => !!sidebarRef(),
    run: withRepo((r) => {
      const ref = sidebarRef();
      if (ref) act.newBranch(r, ref.short);
    }),
  },

  // ---------- lists (focused pane) ----------
  {
    id: 'list.down',
    title: 'Move down',
    keys: ['j', 'down'],
    scope: 'list',
    hidden: true,
    run: () => repo()?.move(1),
  },
  {
    id: 'list.up',
    title: 'Move up',
    keys: ['k', 'up'],
    scope: 'list',
    hidden: true,
    run: () => repo()?.move(-1),
  },
  {
    id: 'list.pageDown',
    title: 'Page down',
    keys: ['ctrl+d', 'pagedown'],
    scope: 'list',
    hidden: true,
    run: () => repo()?.move(PAGE_ROWS),
  },
  {
    id: 'list.pageUp',
    title: 'Page up',
    keys: ['ctrl+u', 'pageup'],
    scope: 'list',
    hidden: true,
    run: () => repo()?.move(-PAGE_ROWS),
  },
  {
    id: 'list.top',
    title: 'Go to top',
    keys: ['g g', 'home'],
    scope: 'list',
    hidden: true,
    run: () => repo()?.moveToEdge(false),
  },
  {
    id: 'list.bottom',
    title: 'Go to bottom',
    keys: ['shift+g', 'end'],
    scope: 'list',
    hidden: true,
    run: () => repo()?.moveToEdge(true),
  },
  {
    id: 'list.open',
    title: 'Open',
    keys: ['enter', 'l'],
    scope: 'list',
    hidden: true,
    run: withRepo((r) => (r.focus === 'sidebar' ? act.activateSidebar(r) : r.activate())),
  },
  {
    id: 'list.back',
    title: 'Back',
    keys: ['esc', 'h'],
    scope: 'list',
    hidden: true,
    run: () => repo()?.back(),
  },
];

/** Active scopes, most specific first. */
export function activeScopes(): Scope[] {
  const r = repo();
  if (!r) return ['global'];
  return [r.focus, 'list', 'repo', 'global'];
}

export const SCOPE_LABELS: Record<Scope, string> = {
  global: 'Anywhere',
  repo: 'Repository',
  list: 'Lists',
  sidebar: 'Sidebar',
  graph: 'Graph',
  files: 'Changed files',
  diff: 'Diff',
};
