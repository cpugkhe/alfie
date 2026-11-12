/**
 * User-level git actions: each one may ask for confirmation, runs through
 * `repo.run` (one write at a time, errors toasted, state reloaded after).
 */
import { api, type HunkAction, type Ref, type Stash } from '$lib/api';
import { app } from '$lib/state/app.svelte';
import { WT, type FileEntry, type RepoState, type UndoEntry } from '$lib/state/repo.svelte';

const p = (repo: RepoState) => repo.path;

// ---------- staging ----------

/**
 * Stages or unstages `entries` (default: marked files, else the cursor file).
 * Direction comes from `by`, the file that was clicked, else the first entry.
 */
export async function toggleStage(repo: RepoState, entries: FileEntry[] = repo.targets(), by?: FileEntry) {
  const lead = by ?? entries[0];
  if (!lead || lead.group === 'commit') return;
  const group = lead.group;
  const list = entries.filter((e) => e.group === group);
  if (group === 'staged') {
    const paths = list.flatMap((e) => (e.origPath ? [e.path, e.origPath] : [e.path]));
    await repo.run('Unstaging…', () => api.unstage(p(repo), paths));
  } else {
    await repo.run('Staging…', () => api.stage(p(repo), list.map((e) => e.path)));
  }
  repo.clearMarks();
}

export const stageAll = (repo: RepoState) => repo.run('Staging…', () => api.stageAll(p(repo)));
export const unstageAll = (repo: RepoState) => repo.run('Unstaging…', () => api.unstageAll(p(repo)));

/** Discards the marked files (or the cursor file). Only unstaged changes can be discarded. */
export async function discardFile(repo: RepoState) {
  const all = repo.targets().filter((e) => e.group !== 'commit');
  const list = all.filter((e) => e.group === 'unstaged');
  if (!list.length) {
    if (all.length) repo.notify('Unstage first, then discard.', 'error');
    return;
  }
  const untracked = list.filter((e) => e.target.kind === 'untracked').map((e) => e.path);
  const tracked = list.filter((e) => e.target.kind !== 'untracked').map((e) => e.path);
  const one = list.length === 1 ? list[0] : null;
  const parts = [
    tracked.length ? `Unstaged changes in ${tracked.length === 1 ? tracked[0] : `${tracked.length} files`} will be lost.` : '',
    untracked.length
      ? `${untracked.length === 1 ? untracked[0] : `${untracked.length} untracked files`} will be deleted from disk (git has no copy).`
      : '',
    'This cannot be undone.',
  ];
  const ok = await app.confirm({
    title: one ? `Discard ${one.path}?` : `Discard ${list.length} files?`,
    body: parts.filter(Boolean).join(' '),
    confirmLabel: one ? 'Discard' : `Discard ${list.length} files`,
    danger: true,
  });
  if (!ok) return;
  await repo.run('Discarding…', () => api.discard(p(repo), tracked, untracked));
  repo.clearMarks();
}

// ---------- undo / redo ----------

function record(repo: RepoState, entry: UndoEntry) {
  repo.undoStack.push(entry);
  repo.redoStack = [];
}

async function applyUndo(repo: RepoState, entry: UndoEntry, back: boolean): Promise<boolean> {
  if (entry.kind === 'checkout') {
    const target = back ? entry.from : entry.to;
    return !(await repo.run(`Checking out ${target.short}…`, () => api.checkout(p(repo), target.short, target.kind)));
  }
  const expect = back ? entry.after : entry.before;
  const target = back ? entry.before : entry.after;
  if (repo.head !== expect || (repo.status?.branch ?? null) !== entry.branch) {
    repo.notify(`History moved since "${entry.label}", so it cannot be ${back ? 'undone' : 'redone'} safely.`, 'error');
    repo.undoStack = [];
    repo.redoStack = [];
    return false;
  }
  return !(await repo.run(back ? 'Undoing…' : 'Redoing…', () => api.reset(p(repo), target, entry.mode)));
}

export async function undo(repo: RepoState) {
  const entry = repo.undoStack.at(-1);
  if (!entry) return repo.notify('Nothing to undo.');
  if (!(await applyUndo(repo, entry, true))) return;
  repo.undoStack.pop();
  repo.redoStack.push(entry);
  repo.notify(`Undid ${entry.label}${entry.kind === 'move' && entry.mode === 'soft' ? ' — its changes are staged' : ''}`);
  repo.jumpToHead();
}

export async function redo(repo: RepoState) {
  const entry = repo.redoStack.at(-1);
  if (!entry) return repo.notify('Nothing to redo.');
  if (!(await applyUndo(repo, entry, false))) return;
  repo.redoStack.pop();
  repo.undoStack.push(entry);
  repo.notify(`Redid ${entry.label}`);
  repo.jumpToHead();
}

const whereNow = (repo: RepoState) =>
  repo.status?.branch
    ? { short: repo.status.branch, kind: 'local' }
    : { short: repo.head ?? 'HEAD', kind: 'commit' };

/** Stage, unstage or discard the current hunk, or the selected lines of it. */
export async function hunkAction(repo: RepoState, action: HunkAction) {
  const open = repo.diff;
  if (!open?.data || !open.data.hunks.length) return;
  const kind = open.entry.target.kind;
  if (kind === 'commit') return;
  if (kind === 'untracked') {
    repo.notify('Untracked file: stage the whole file first (space).', 'error');
    return;
  }
  const wanted = kind === 'staged' ? 'unstage' : action === 'unstage' ? null : action;
  if (!wanted || (kind === 'staged' && action === 'discard')) {
    repo.notify(kind === 'staged' ? 'Unstage first, then discard.' : 'Nothing staged here.', 'error');
    return;
  }

  const lines = repo.selectedLines();
  if (lines && lines.length === 0) {
    repo.notify('No changed lines in the selection.', 'error');
    return;
  }
  if (wanted === 'discard') {
    const what = lines ? `${lines.length} selected ${lines.length === 1 ? 'line' : 'lines'}` : 'this hunk';
    const ok = await app.confirm({
      title: `Discard ${what}?`,
      body: `The change will be removed from ${open.entry.path} on disk. This cannot be undone.`,
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
  }
  const hunk = repo.hunkIdx;
  await repo.run('Applying…', () => api.applyHunk(p(repo), open.entry.path, hunk, lines, wanted));
}

// ---------- commit ----------

export function focusCommit(repo: RepoState) {
  repo.composing = true;
  app.detailOpen = true;
  repo.closeDiff();
  repo.select(WT);
  repo.focus = 'files';
  repo.commitFocus++;
}

export async function toggleAmend(repo: RepoState) {
  repo.amend = !repo.amend;
  if (repo.amend && !repo.commitMsg.trim()) {
    try {
      repo.commitMsg = await api.lastMessage(p(repo));
    } catch {
      /* no commits yet */
    }
  }
  if (repo.amend) focusCommit(repo);
}

export async function commit(repo: RepoState, thenPush = false) {
  const message = repo.commitMsg.trim();
  if (!message) {
    repo.notify('Write a commit message first.', 'error');
    focusCommit(repo);
    return;
  }
  const files = repo.status?.files ?? [];
  const staged = files.some((f) => f.index !== '.' && f.index !== '?' && !f.conflicted);
  let stageFirst = false;
  if (!staged && !repo.amend) {
    if (!files.length) {
      repo.notify('Nothing to commit.', 'error');
      return;
    }
    stageFirst = await app.confirm({
      title: 'Nothing is staged',
      body: `Stage all ${files.length} changed ${files.length === 1 ? 'file' : 'files'} and commit them?`,
      confirmLabel: 'Stage all and commit',
    });
    if (!stageFirst) return;
  }
  const amend = repo.amend;
  const before = repo.head;
  const branch = repo.status?.branch ?? null;
  const err = await repo.run(amend ? 'Amending…' : 'Committing…', async () => {
    if (stageFirst) await api.stageAll(p(repo));
    await api.commit(p(repo), message, amend);
  });
  if (err) return;
  if (before && repo.head && before !== repo.head) {
    record(repo, {
      kind: 'move',
      mode: 'soft',
      label: `${amend ? 'amend' : 'commit'} "${message.split('\n')[0]}"`,
      branch,
      before,
      after: repo.head,
    });
  }
  repo.commitMsg = '';
  repo.amend = false;
  repo.composing = false;
  repo.closeDiff();
  if (repo.head) repo.select(repo.head);
  repo.focus = 'graph';
  if (thenPush) await push(repo);
}

// ---------- branches ----------

export async function checkoutRef(repo: RepoState, ref: Pick<Ref, 'short' | 'kind'>) {
  const go = () => api.checkout(p(repo), ref.short, ref.kind);
  const from = whereNow(repo);
  const landed = () => {
    record(repo, { kind: 'checkout', label: `checkout ${ref.short}`, from, to: whereNow(repo) });
    repo.jumpToHead();
  };
  const err = await repo.run(`Checking out ${ref.short}…`, go, { quiet: true });
  if (!err) return landed();
  if (!/would be overwritten|commit your changes or stash/i.test(err)) {
    repo.notify(err, 'error');
    return;
  }
  const ok = await app.confirm({
    title: 'Local changes are in the way',
    body: `Switching to ${ref.short} would overwrite uncommitted changes. Stash them and switch? They stay in the stash list until you apply them.`,
    confirmLabel: 'Stash and switch',
  });
  if (!ok) return;
  const failed = await repo.run(
    `Checking out ${ref.short}…`,
    async () => {
      await api.stashPush(p(repo), `Before switching to ${ref.short}`, true);
      await go();
    },
    { done: 'Changes stashed' },
  );
  if (!failed) landed();
}

export async function newBranch(repo: RepoState, start: string | null = null, name?: string) {
  const picked =
    name ??
    (await app.prompt({
      title: 'New branch',
      body: start ? `Starts at ${start.length === 40 ? start.slice(0, 7) : start}` : 'Starts at HEAD',
      placeholder: 'branch-name',
      confirmLabel: 'Create and check out',
    }));
  const clean = picked?.trim();
  if (!clean) return;
  const from = whereNow(repo);
  const failed = await repo.run('Creating branch…', () => api.createBranch(p(repo), clean, start, true));
  if (failed) return;
  // Remember where it came from, for "Update from base".
  const origin = start && start.length !== 40 ? start : !start && from.kind === 'local' ? from.short : null;
  if (origin && origin !== clean) {
    repo.local.bases[clean] = origin;
    app.save();
    repo.refresh();
  }
  record(repo, { kind: 'checkout', label: `new branch ${clean}`, from, to: { short: clean, kind: 'local' } });
  repo.jumpToHead();
}

export async function renameBranch(repo: RepoState, ref: Ref) {
  if (ref.kind !== 'local') return;
  const name = await app.prompt({ title: `Rename ${ref.short}`, value: ref.short, confirmLabel: 'Rename' });
  const clean = name?.trim();
  if (!clean || clean === ref.short) return;
  await repo.run('Renaming…', () => api.renameBranch(p(repo), ref.short, clean));
}

export async function deleteBranch(repo: RepoState, ref: Ref) {
  if (ref.kind !== 'local') {
    repo.notify('Only local branches can be deleted here.', 'error');
    return;
  }
  if (ref.short === repo.status?.branch) {
    repo.notify('Cannot delete the branch you are on.', 'error');
    return;
  }
  const ok = await app.confirm({
    title: `Delete branch ${ref.short}?`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const err = await repo.run('Deleting…', () => api.deleteBranch(p(repo), ref.short, false), {
    quiet: true,
  });
  if (!err) return;
  if (!/not fully merged/i.test(err)) {
    repo.notify(err, 'error');
    return;
  }
  const force = await app.confirm({
    title: `${ref.short} is not fully merged`,
    body: 'Commits that exist only on this branch will become unreachable. Delete it anyway?',
    confirmLabel: 'Delete anyway',
    danger: true,
  });
  if (force) await repo.run('Deleting…', () => api.deleteBranch(p(repo), ref.short, true));
}

// ---------- stash ----------

export async function stashChanges(repo: RepoState) {
  if (!repo.dirtyCount) {
    repo.notify('Nothing to stash.', 'error');
    return;
  }
  const message = await app.prompt({
    title: 'Stash changes',
    body: 'Includes untracked files.',
    placeholder: 'Message (optional)',
    confirmLabel: 'Stash',
  });
  if (message === null) return;
  await repo.run('Stashing…', () => api.stashPush(p(repo), message, true), { done: 'Stashed' });
}

export const applyStash = (repo: RepoState, stash: Stash, pop = false) =>
  repo.run(pop ? 'Popping stash…' : 'Applying stash…', () =>
    api.stashAction(p(repo), stash.name, pop ? 'pop' : 'apply'),
  );

export async function renameStash(repo: RepoState, stash: Stash) {
  // "On main: message" / "WIP on main: abc123 subject" → keep the prefix git wrote.
  const m = stash.message.match(/^((?:WIP on|On) [^:]+: )(.*)$/s);
  const prefix = m && m[1].startsWith('On ') ? m[1] : '';
  const message = await app.prompt({
    title: 'Edit stash message',
    value: prefix ? m![2] : stash.message,
    confirmLabel: 'Save',
  });
  const clean = message?.trim();
  if (!clean) return;
  await repo.run('Renaming stash…', () => api.stashRename(p(repo), stash.name, stash.id, prefix + clean));
}

export function stashMenu(repo: RepoState, stash: Stash) {
  return [
    { label: 'Apply', run: () => void applyStash(repo, stash) },
    { label: 'Pop (apply and remove)', run: () => void applyStash(repo, stash, true) },
    { label: 'Edit stash message…', run: () => void renameStash(repo, stash) },
    { label: 'Delete…', danger: true, run: () => void dropStash(repo, stash) },
  ];
}

export function refMenu(repo: RepoState, ref: Ref, current: boolean) {
  const items: { label: string; danger?: boolean; run: () => void }[] = [];
  if (ref.kind !== 'tag' && !current) items.push({ label: `Check out ${ref.short}`, run: () => void checkoutRef(repo, ref) });
  if (ref.kind === 'tag') items.push({ label: 'Check out (detached)', run: () => void checkoutRef(repo, ref) });
  if (ref.kind !== 'tag') {
    items.push({
      label: repo.local.favorites.includes(ref.name) ? 'Remove from favorites' : 'Add to favorites',
      run: () => toggleFavorite(repo, ref),
    });
    if (ref.kind === 'remote' || ref.upstream) {
      items.push({ label: 'Update to latest', run: () => void updateBranch(repo, ref) });
    }
  }
  const here = repo.status?.branch;
  if (!current && here) {
    items.push({ label: `Merge ${ref.short} into ${here}`, run: () => void mergeRef(repo, ref.short) });
    if (ref.kind !== 'tag') {
      items.push({ label: `Rebase ${here} onto ${ref.short}…`, run: () => void rebaseOnto(repo, ref.short) });
    }
  }
  items.push({ label: 'New branch from here…', run: () => void newBranch(repo, ref.short) });
  if (ref.kind === 'tag') {
    items.push({ label: 'Push tag', run: () => void pushTag(repo, ref.short) });
    items.push({ label: 'Delete tag (local)…', danger: true, run: () => void deleteTag(repo, ref.short) });
    items.push({ label: 'Delete tag on remote…', danger: true, run: () => void deleteRemoteTag(repo, ref.short) });
  }
  if (ref.kind === 'local') {
    items.push({ label: 'Rename…', run: () => void renameBranch(repo, ref) });
    if (!current) items.push({ label: 'Delete…', danger: true, run: () => void deleteBranch(repo, ref) });
  }
  return items;
}

export async function dropStash(repo: RepoState, stash: Stash) {
  const ok = await app.confirm({
    title: 'Drop this stash?',
    body: `"${stash.message}" will be deleted. This cannot be undone.`,
    confirmLabel: 'Drop',
    danger: true,
  });
  if (ok) await repo.run('Dropping stash…', () => api.stashAction(p(repo), stash.name, 'drop'));
}

// ---------- favourites, keeping branches current ----------

export function toggleFavorite(repo: RepoState, ref: Ref) {
  if (ref.kind === 'tag') return;
  const cursor = repo.sidebar[repo.sidebarIdx];
  const onPinned = cursor?.type === 'ref' && cursor.pinned;
  const list = repo.local.favorites;
  const at = list.indexOf(ref.name);
  if (at >= 0) list.splice(at, 1);
  else list.push(ref.name);
  app.save();
  repo.notify(at >= 0 ? `Removed ${ref.short} from favorites` : `Added ${ref.short} to favorites`);

  // The list just grew or shrank above the cursor: stay on the same branch.
  const same = repo.sidebar.findIndex((it) => it.type === 'ref' && it.ref.name === ref.name && it.pinned === onPinned);
  repo.sidebarIdx = same >= 0 ? same : Math.min(repo.sidebarIdx, Math.max(0, repo.sidebar.length - 1));
}

/** Moves a branch up to its upstream. Works without checking it out. */
export async function updateBranch(repo: RepoState, ref: Ref) {
  if (ref.kind === 'tag') return;
  if (ref.kind === 'local' && !ref.upstream) {
    return repo.notify(`${ref.short} has no upstream, so there is nothing to update it from.`, 'error');
  }
  const current = ref.kind === 'local' && ref.short === repo.status?.branch;
  const before = repo.head;
  const err = await repo.run(`Updating ${ref.short}…`, () => api.updateBranch(p(repo), ref.short), { quiet: true });
  if (err) {
    if (/non-fast-forward|rejected|not possible to fast-forward|diverg/i.test(err)) {
      repo.notify(`${ref.short} has commits its upstream lacks. Check it out, then pull or rebase.`, 'error');
    } else {
      repo.notify(err, 'error', `Updating ${ref.short}…`);
    }
    return;
  }
  if (current && before && repo.head && before !== repo.head) {
    record(repo, { kind: 'move', mode: 'keep', label: `update ${ref.short}`, branch: ref.short, before, after: repo.head });
  }
  repo.notify(`${ref.short} is up to date`);
}

/** Merges the newest base branch (where this branch came from) into the current one. */
export async function updateFromBase(repo: RepoState) {
  const branch = repo.status?.branch;
  if (!branch) return repo.notify('Check out a branch first.', 'error');
  const base = repo.base.name;
  if (!base) {
    app.palette = 'base';
    return;
  }
  await moveBranch(repo, `Updating ${branch} from ${base}…`, `update from ${base}`, () =>
    api.updateFromBase(p(repo), base),
  );
}

export function setBase(repo: RepoState, base: string) {
  const branch = repo.status?.branch;
  if (!branch) return;
  repo.local.bases[branch] = base;
  app.save();
  repo.refresh();
}

// ---------- history edits ----------

/**
 * Runs something that moves the current branch, and makes it undoable. When
 * git stops on conflicts, explains what to do next instead of just failing.
 */
async function moveBranch(repo: RepoState, busy: string, label: string, fn: () => Promise<unknown>) {
  const before = repo.head;
  const branch = repo.status?.branch ?? null;
  const err = await repo.run(busy, fn, { quiet: true });
  if (err) {
    if (repo.status?.state) {
      const n = repo.status.files.filter((f) => f.conflicted).length;
      repo.notify(
        `${label} stopped: ${n} conflicted ${n === 1 ? 'file' : 'files'}. Fix them, tick them as resolved, then Continue — or Abort.`,
        'error',
      );
      repo.select(WT);
      repo.focus = 'files';
    } else {
      repo.notify(err, 'error', busy);
    }
    return;
  }
  if (before && repo.head && before !== repo.head && branch === (repo.status?.branch ?? null)) {
    record(repo, { kind: 'move', mode: 'keep', label, branch, before, after: repo.head });
  }
  repo.jumpToHead();
}

export const mergeRef = (repo: RepoState, name: string) =>
  moveBranch(repo, `Merging ${name}…`, `merge ${name}`, () => api.merge(p(repo), name));

export async function rebaseOnto(repo: RepoState, name: string) {
  const branch = repo.status?.branch;
  if (!branch) return repo.notify('Check out a branch before rebasing.', 'error');
  const pushed = !!repo.status?.upstream;
  const ok = await app.confirm({
    title: `Rebase ${branch} onto ${name}?`,
    body:
      `Commits on ${branch} that are not in ${name} are re-created on top of it.` +
      (pushed ? ' This branch has an upstream: afterwards it will need a force push.' : ''),
    confirmLabel: 'Rebase',
  });
  if (ok) await moveBranch(repo, `Rebasing onto ${name}…`, `rebase onto ${name}`, () => api.rebase(p(repo), name));
}

const short = (sha: string) => sha.slice(0, 7);

export const cherryPick = (repo: RepoState, sha: string) =>
  moveBranch(repo, 'Cherry-picking…', `cherry-pick ${short(sha)}`, () => api.pick(p(repo), sha, false));

export const revertCommit = (repo: RepoState, sha: string) =>
  moveBranch(repo, 'Reverting…', `revert ${short(sha)}`, () => api.pick(p(repo), sha, true));

export async function resetTo(repo: RepoState, sha: string, mode: 'soft' | 'mixed' | 'hard') {
  const branch = repo.status?.branch;
  if (!branch) return repo.notify('Check out a branch before resetting.', 'error');
  if (mode === 'hard') {
    const n = repo.dirtyCount;
    const ok = await app.confirm({
      title: `Hard reset ${branch} to ${short(sha)}?`,
      body:
        (n ? `Uncommitted changes in ${n} ${n === 1 ? 'file' : 'files'} will be lost for good. ` : '') +
        `Commits after ${short(sha)} leave the branch (Undo can bring those back, not the uncommitted changes).`,
      confirmLabel: 'Hard reset',
      danger: true,
    });
    if (!ok) return;
  }
  const before = repo.head;
  const err = await repo.run('Resetting…', () => api.reset(p(repo), sha, mode));
  if (err) return;
  if (before && repo.head && before !== repo.head) {
    // Soft and mixed keep the work, so their undo may too; hard left nothing to keep.
    record(repo, { kind: 'move', mode: mode === 'hard' ? 'keep' : 'soft', label: `${mode} reset to ${short(sha)}`, branch, before, after: repo.head });
  }
  repo.jumpToHead();
}

export async function sequence(repo: RepoState, action: 'continue' | 'skip' | 'abort') {
  const kind = repo.status?.state;
  if (!kind) return;
  if (action === 'continue' && repo.status?.files.some((f) => f.conflicted)) {
    return repo.notify('Some files still have conflicts. Fix and tick them first.', 'error');
  }
  if (action === 'abort') {
    const ok = await app.confirm({
      title: `Abort the ${kind}?`,
      body: 'The branch goes back to where it was before it started. Conflict fixes made so far are dropped.',
      confirmLabel: `Abort ${kind}`,
      danger: true,
    });
    if (!ok) return;
  }
  const err = await repo.run(`${action === 'abort' ? 'Aborting' : action === 'skip' ? 'Skipping' : 'Continuing'} ${kind}…`, () =>
    api.sequence(p(repo), kind, action),
  );
  if (!err && !repo.status?.state) repo.jumpToHead();
}

// ---------- tags ----------

export async function createTag(repo: RepoState, target: string) {
  const name = (await app.prompt({ title: 'New tag', body: `At ${target.length === 40 ? short(target) : target}`, placeholder: 'v1.0.0', confirmLabel: 'Next' }))?.trim();
  if (!name) return;
  const message = await app.prompt({
    title: `Tag ${name}`,
    body: 'Add a message for an annotated tag, or leave empty for a lightweight one.',
    placeholder: 'Message (optional)',
    confirmLabel: 'Create tag',
  });
  if (message === null) return;
  await repo.run('Tagging…', () => api.createTag(p(repo), name, target, message.trim() || null), { done: `Tagged ${name}` });
}

export async function deleteTag(repo: RepoState, name: string) {
  const ok = await app.confirm({
    title: `Delete tag ${name}?`,
    body: 'Removes the local tag only. A copy already pushed stays on the remote.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (ok) await repo.run('Deleting tag…', () => api.deleteTag(p(repo), name));
}

export async function deleteRemoteTag(repo: RepoState, name: string) {
  const ok = await app.confirm({
    title: `Delete tag ${name} on the remote?`,
    body: 'Removes it for everyone who fetches from the remote. Your local tag stays. Releases built from this tag may break.',
    confirmLabel: 'Delete on remote',
    danger: true,
  });
  if (ok) {
    await repo.run(`Deleting remote tag ${name}…`, () => api.deleteRemoteTag(p(repo), name), {
      done: `Tag ${name} removed from remote`,
    });
  }
}

export const pushTag = (repo: RepoState, name: string) =>
  repo.run(`Pushing tag ${name}…`, () => api.pushTag(p(repo), name), { done: `Pushed tag ${name}` });

/** Every branch and tag sitting on one commit: pick one to switch to it. */
export function refsOnCommitMenu(repo: RepoState, badges: { label: string; kind: string; ref?: { short: string; kind: 'local' | 'remote' } }[]) {
  return badges.map((b) => ({
    label: b.label,
    hint: b.kind === 'head' ? 'current' : b.kind === 'remote' ? 'remote · check out' : b.kind === 'tag' ? 'tag · detached' : 'check out',
    disabled: b.kind === 'head',
    run: () => void checkoutRef(repo, b.ref ?? { short: b.label, kind: 'tag' }),
  }));
}

export function commitMenu(repo: RepoState, sha: string) {
  const branch = repo.status?.branch;
  const isHead = sha === repo.head;
  const items: { label: string; danger?: boolean; run: () => void }[] = [
    { label: 'New branch here…', run: () => void newBranch(repo, sha) },
    { label: 'Create tag here…', run: () => void createTag(repo, sha) },
    { label: 'Check out this commit (detached)', run: () => void checkoutRef(repo, { short: sha, kind: 'tag' }) },
  ];
  if (!isHead) items.push({ label: `Cherry-pick onto ${branch ?? 'HEAD'}`, run: () => void cherryPick(repo, sha) });
  items.push({ label: 'Revert this commit', run: () => void revertCommit(repo, sha) });
  if (branch && !isHead) {
    items.push(
      { label: `Reset ${branch} to here — soft (keep changes staged)`, run: () => void resetTo(repo, sha, 'soft') },
      { label: `Reset ${branch} to here — mixed (keep changes unstaged)`, run: () => void resetTo(repo, sha, 'mixed') },
      { label: `Reset ${branch} to here — hard (discard changes)…`, danger: true, run: () => void resetTo(repo, sha, 'hard') },
    );
  }
  items.push({
    label: 'Copy commit SHA',
    run: () => void navigator.clipboard.writeText(sha).then(() => repo.notify('SHA copied')),
  });
  return items;
}

// ---------- remotes ----------

export const fetch = (repo: RepoState) =>
  repo.run('Fetching…', () => api.fetch(p(repo)), { done: 'Fetched' });
export async function pull(repo: RepoState) {
  const before = repo.head;
  const branch = repo.status?.branch ?? null;
  const err = await repo.run('Pulling…', () => api.pull(p(repo)), { done: 'Pulled' });
  if (!err && before && repo.head && before !== repo.head) {
    record(repo, { kind: 'move', mode: 'keep', label: 'pull', branch, before, after: repo.head });
  }
}
export const push = (repo: RepoState) =>
  repo.run('Pushing…', () => api.push(p(repo), false), { done: 'Pushed' });

export async function forcePush(repo: RepoState) {
  const ok = await app.confirm({
    title: `Force push ${repo.status?.branch ?? 'HEAD'}?`,
    body: 'Uses --force-with-lease: the remote branch is replaced only if nobody pushed to it since your last fetch.',
    confirmLabel: 'Force push',
    danger: true,
  });
  if (ok) await repo.run('Force pushing…', () => api.push(p(repo), true), { done: 'Pushed' });
}

// ---------- sidebar ----------

/** Enter in the sidebar: check out a branch, show a tag, apply a stash. */
export function activateSidebar(repo: RepoState) {
  const item = repo.sidebar[repo.sidebarIdx];
  if (!item) return;
  if (item.type === 'header') {
    repo.toggleSection(item.key);
    app.save();
    return;
  }
  if (item.type === 'stash') return applyStash(repo, item.stash);
  if (item.ref.kind === 'tag') return repo.revealCommit(item.ref.target);
  if (item.current) return repo.revealCommit(item.ref.target);
  return checkoutRef(repo, item.ref);
}

export function deleteSidebarItem(repo: RepoState) {
  const item = repo.sidebar[repo.sidebarIdx];
  if (item?.type === 'ref') return deleteBranch(repo, item.ref);
  if (item?.type === 'stash') return dropStash(repo, item.stash);
}
