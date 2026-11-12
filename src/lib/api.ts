import { invoke } from '@tauri-apps/api/core';

export type Seg = [lane: number, color: number];

export interface GraphRow {
  lane: number;
  color: number;
  top: Seg[];
  through: Seg[];
  bottom: Seg[];
}

export interface Commit {
  id: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  graph: GraphRow;
}

export interface LogPage {
  commits: Commit[];
  hasMore: boolean;
  head: string | null;
}

export interface FileChange {
  status: string;
  path: string;
  origPath: string | null;
}

export interface CommitDetail {
  id: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  message: string;
  files: FileChange[];
}

export interface FileStatus {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  conflicted: boolean;
}

export interface RepoStatus {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileStatus[];
  state: SequenceKind | null;
}

export type SequenceKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export interface Ref {
  name: string;
  short: string;
  kind: 'local' | 'remote' | 'tag';
  target: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  time: number;
}

export interface Stash {
  id: string;
  name: string;
  message: string;
  time: number;
}

export interface RefList {
  refs: Ref[];
  stashes: Stash[];
}

export type DiffTarget =
  | { kind: 'commit'; sha: string }
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'untracked' };

export interface DiffLine {
  kind: ' ' | '+' | '-' | '\\';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  header: string;
  hunks: Hunk[];
  binary: boolean;
  truncated: boolean;
  added: number;
  removed: number;
}

export interface RepoInfo {
  path: string;
  name: string;
}

export interface GitLogEntry {
  id: number;
  repo: string;
  command: string;
  ok: boolean;
  ms: number;
  stderr: string;
  write: boolean;
  at: number;
}

export interface Profile {
  id: string;
  name: string;
  userName: string;
  userEmail: string;
  sshKey: string;
  rules: string[];
}

export interface ProfileStore {
  profiles: Profile[];
  /** Repository path → profile id; an empty id means "no profile". */
  bindings: Record<string, string>;
}

export interface ResolvedProfile {
  profile: Profile | null;
  /** Picked by a remote rule rather than by hand. */
  auto: boolean;
}

export type HunkAction = 'stage' | 'unstage' | 'discard';

export type LogScope = 'all' | 'local' | 'current';

export type SplitDir = 'row' | 'column';
export type SectionKey = 'favorite' | 'local' | 'remote' | 'tag' | 'stash';

/** Per-repository choices kept by the app (not in git config). */
export interface RepoLocal {
  /** Full ref names pinned to the top of the sidebar. */
  favorites: string[];
  /** Branch → the branch it was started from. */
  bases: Record<string, string>;
}

export interface BaseInfo {
  name: string | null;
  /** What gets merged: the base's upstream when it has one. */
  target: string | null;
  /** Commits on the base that the current branch lacks. */
  behind: number;
  guessed: boolean;
}
export type SectionSort = 'name' | 'recent';
export type Sections = Record<SectionKey, { collapsed: boolean; sort: SectionSort }>;

/** View settings shared by every repository. */
export interface Prefs {
  fileView: 'list' | 'tree';
}

export interface SpaceData {
  name: string;
  tabs: string[];
  active: number;
  split: { path: string; dir: SplitDir } | null;
}

export interface Session {
  spaces: SpaceData[];
  space: number;
  recents: string[];
  sidebarW: number;
  detailW: number;
  sections: Sections;
  zoom?: number;
  prefs?: Prefs;
  repos?: Record<string, RepoLocal>;
  /** Pre-spaces format, read once for migration. */
  tabs?: string[];
  active?: number;
}

export const api = {
  sessionLoad: () => invoke<Partial<Session> | null>('session_load'),
  sessionSave: (session: Session) => invoke<void>('session_save', { session }),
  repoOpen: (path: string) => invoke<RepoInfo>('repo_open', { path }),
  repoStatus: (repo: string) => invoke<RepoStatus>('repo_status', { repo }),
  repoRefs: (repo: string) => invoke<RefList>('repo_refs', { repo }),
  repoLog: (repo: string, limit: number, scope: LogScope, branch: string | null = null) =>
    invoke<LogPage>('repo_log', { repo, limit, scope, branch }),
  commitDetail: (repo: string, sha: string) =>
    invoke<CommitDetail>('commit_detail', { repo, sha }),
  diffFile: (repo: string, target: DiffTarget, path: string, origPath: string | null) =>
    invoke<FileDiff>('diff_file', { repo, target, path, origPath }),
  watchRepo: (repo: string) => invoke<void>('watch_repo', { repo }),
  unwatchRepo: (repo: string) => invoke<void>('unwatch_repo', { repo }),
  gitLog: (writesOnly: boolean) => invoke<GitLogEntry[]>('git_log', { writesOnly }),

  stage: (repo: string, paths: string[]) => invoke<void>('stage', { repo, paths }),
  unstage: (repo: string, paths: string[]) => invoke<void>('unstage', { repo, paths }),
  stageAll: (repo: string) => invoke<void>('stage_all', { repo }),
  unstageAll: (repo: string) => invoke<void>('unstage_all', { repo }),
  discard: (repo: string, tracked: string[], untracked: string[]) =>
    invoke<void>('discard', { repo, tracked, untracked }),
  applyHunk: (repo: string, path: string, hunk: number, lines: number[] | null, action: HunkAction) =>
    invoke<void>('apply_hunk', { repo, path, hunk, lines, action }),
  commit: (repo: string, message: string, amend: boolean) =>
    invoke<void>('commit', { repo, message, amend }),
  lastMessage: (repo: string) => invoke<string>('last_message', { repo }),

  checkout: (repo: string, target: string, kind: string) =>
    invoke<void>('checkout', { repo, target, kind }),
  checkoutRemote: (repo: string, name: string, expected: string | null = null) =>
    invoke<string | null>('checkout_remote', { repo, name, expected }),
  pushBranch: (repo: string, name: string) => invoke<void>('push_branch', { repo, name }),
  deleteRemoteBranch: (repo: string, name: string) => invoke<void>('delete_remote_branch', { repo, name }),
  createBranch: (repo: string, name: string, start: string | null, checkout: boolean) =>
    invoke<void>('create_branch', { repo, name, start, checkout }),
  deleteBranch: (repo: string, name: string, force: boolean) =>
    invoke<void>('delete_branch', { repo, name, force }),
  renameBranch: (repo: string, oldName: string, newName: string) =>
    invoke<void>('rename_branch', { repo, old: oldName, new: newName }),
  stashPush: (repo: string, message: string | null, untracked: boolean) =>
    invoke<void>('stash_push', { repo, message, untracked }),
  stashAction: (repo: string, name: string, action: 'apply' | 'pop' | 'drop') =>
    invoke<void>('stash_action', { repo, name, action }),
  fetch: (repo: string) => invoke<void>('fetch', { repo }),
  pull: (repo: string) => invoke<void>('pull', { repo }),
  push: (repo: string, force: boolean) => invoke<void>('push', { repo, force }),

  profilesLoad: () => invoke<ProfileStore>('profiles_load'),
  profilesSave: (store: ProfileStore) => invoke<void>('profiles_save', { store }),
  profileFor: (repo: string) => invoke<ResolvedProfile>('profile_for', { repo }),
  profileTest: (profile: Profile, host: string) => invoke<string>('profile_test', { profile, host }),
  cloneRepo: (url: string, dest: string) => invoke<void>('clone_repo', { url, dest }),
  reset: (repo: string, target: string, mode: 'soft' | 'mixed' | 'hard' | 'keep') =>
    invoke<void>('reset', { repo, target, mode }),
  merge: (repo: string, target: string) => invoke<void>('merge', { repo, target }),
  rebase: (repo: string, onto: string) => invoke<void>('rebase', { repo, onto }),
  pick: (repo: string, sha: string, revert: boolean) => invoke<void>('pick', { repo, sha, revert }),
  sequence: (repo: string, kind: SequenceKind, action: 'continue' | 'skip' | 'abort') =>
    invoke<void>('sequence', { repo, kind, action }),
  createTag: (repo: string, name: string, target: string, message: string | null) =>
    invoke<void>('create_tag', { repo, name, target, message }),
  deleteTag: (repo: string, name: string) => invoke<void>('delete_tag', { repo, name }),
  pushTag: (repo: string, name: string) => invoke<void>('push_tag', { repo, name }),
  deleteRemoteTag: (repo: string, name: string) => invoke<void>('delete_remote_tag', { repo, name }),
  updateBranch: (repo: string, name: string) => invoke<void>('update_branch', { repo, name }),
  repoBase: (repo: string, base: string | null) => invoke<BaseInfo>('repo_base', { repo, base }),
  updateFromBase: (repo: string, base: string) => invoke<void>('update_from_base', { repo, base }),
  stashRename: (repo: string, name: string, sha: string, message: string) =>
    invoke<void>('stash_rename', { repo, name, sha, message }),
  repoRemote: (repo: string) => invoke<string | null>('repo_remote', { repo }),
};
