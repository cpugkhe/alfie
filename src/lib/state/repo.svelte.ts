import {
  api,
  type Commit,
  type CommitDetail,
  type DiffTarget,
  type FileChange,
  type FileDiff,
  type BaseInfo,
  type LogScope,
  type RepoLocal,
  type Prefs,
  type Ref,
  type RepoStatus,
  type ResolvedProfile,
  type SectionKey,
  type Sections,
  type Stash,
} from '$lib/api';
import { clamp } from '$lib/util';

/** Id of the pinned "uncommitted changes" row. */
export const WT = 'WT';
const PAGE = 2000;

export type Focus = 'sidebar' | 'graph' | 'files' | 'diff';

export type GraphItem = { type: 'wt' } | { type: 'commit'; commit: Commit };

export type SidebarItem =
  | { type: 'header'; key: SectionKey; label: string; count: number; collapsed: boolean; sort: Sections[SectionKey]['sort'] }
  | { type: 'ref'; ref: Ref; current: boolean; fav: boolean; pinned: boolean }
  | { type: 'stash'; stash: Stash };

/** One entry of the file list in the detail pane. */
export interface FileEntry {
  key: string;
  path: string;
  origPath: string | null;
  status: string;
  target: DiffTarget;
  group: 'staged' | 'unstaged' | 'commit';
}

/** One line of the changed-files pane. */
export type FileRow =
  | { type: 'group'; group: FileEntry['group']; count: number }
  | { type: 'dir'; key: string; label: string; depth: number; collapsed: boolean; entries: FileEntry[] }
  | { type: 'file'; entry: FileEntry; index: number; depth: number };

interface DirNode {
  dirs: Map<string, DirNode>;
  files: FileEntry[];
}

function filesUnder(node: DirNode, out: FileEntry[] = []): FileEntry[] {
  for (const child of node.dirs.values()) filesUnder(child, out);
  out.push(...node.files);
  return out;
}

export interface Badge {
  label: string;
  kind: 'head' | 'local' | 'remote' | 'tag';
  /** Local branch and its upstream point at the same commit. */
  synced: boolean;
  /** Branch this badge stands for; absent for tags and detached HEAD. */
  ref?: { short: string; kind: 'local' | 'remote' };
}

type RefLike = { short: string; kind: string };

/** Something `⌘Z` can take back. */
export type UndoEntry =
  | { kind: 'move'; label: string; mode: 'soft' | 'keep'; branch: string | null; before: string; after: string }
  | { kind: 'checkout'; label: string; from: RefLike; to: RefLike };

export interface OpenDiff {
  entry: FileEntry;
  data: FileDiff | null;
  error: string | null;
}

export class RepoState {
  readonly path: string;
  readonly name: string;

  status = $state<RepoStatus | null>(null);
  refs = $state<Ref[]>([]);
  stashes = $state<Stash[]>([]);
  commits = $state.raw<Commit[]>([]);
  hasMore = $state(false);
  head = $state<string | null>(null);
  scope = $state<LogScope>('all');
  limit = PAGE;

  loaded = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);

  focus = $state<Focus>('graph');
  selectedId = $state<string>('');
  /** Bumped whenever selection should be scrolled into view. */
  reveal = $state(0);
  filter = $state('');
  filterOpen = $state(false);
  /** Bumped to move keyboard focus into the search box. */
  searchFocus = $state(0);

  detail = $state<CommitDetail | null>(null);
  fileIdx = $state(0);
  diff = $state<OpenDiff | null>(null);
  sidebarIdx = $state(1);

  /** Profile in effect (SSH key + identity), if any. */
  profile = $state<ResolvedProfile>({ profile: null, auto: false });

  /** `host:owner/repo` of origin, if any. */
  remote = $state<string | null>(null);
  undoStack = $state<UndoEntry[]>([]);
  redoStack = $state<UndoEntry[]>([]);
  /** Keys of files picked with shift/⌘ click in the changes list. */
  marks = $state<string[]>([]);
  private markEnd: number | null = null;

  /** Label of the write operation in flight, e.g. "Pushing…". */
  op = $state<string | null>(null);
  /** Shared sidebar section settings (collapsed, sort); owned by the app. */
  sections = $state<Sections>({
    favorite: { collapsed: false, sort: 'name' },
    local: { collapsed: false, sort: 'name' },
    remote: { collapsed: false, sort: 'name' },
    tag: { collapsed: false, sort: 'recent' },
    stash: { collapsed: false, sort: 'recent' },
  });
  /** Favourites and base branches of this repository; owned by the app. */
  local = $state<RepoLocal>({ favorites: [], bases: {} });
  /** The branch the current one comes from, and how far behind it we are. */
  base = $state<BaseInfo>({ name: null, target: null, behind: 0, guessed: false });
  /** Shared view settings; owned by the app. */
  prefs = $state<Prefs>({ fileView: 'list' });
  fileFilter = $state('');
  fileFilterFocus = $state(0);
  /** Collapsed folders in tree view, as `group:path`. */
  collapsedDirs = $state<string[]>([]);
  /** Set by the app so this class needs no import of it. */
  notify: (text: string, kind?: 'info' | 'error', context?: string) => void = () => {};

  commitMsg = $state('');
  amend = $state(false);
  /** Keeps the working tree row visible while writing a commit on a clean tree. */
  composing = $state(false);
  commitFocus = $state(0);

  /** Cursor in the open diff. */
  hunkIdx = $state(0);
  lineMode = $state(false);
  lineCursor = $state(0);
  lineAnchor = $state(0);

  /** Scroll offset of the graph, restored when the tab is shown again. */
  graphScroll = 0;

  private refreshing = false;
  private dirty = false;
  private detailToken = 0;
  private diffToken = 0;

  constructor(path: string, name: string) {
    this.path = path;
    this.name = name;
  }

  // ---------- derived ----------

  dirtyCount = $derived(this.status?.files.length ?? 0);

  items = $derived.by<GraphItem[]>(() => {
    const q = this.filter.trim().toLowerCase();
    let commits = this.commits;
    if (q) {
      commits = commits.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.id.startsWith(q),
      );
    }
    const out: GraphItem[] = [];
    if ((this.dirtyCount > 0 || this.composing) && !q) out.push({ type: 'wt' });
    for (const commit of commits) out.push({ type: 'commit', commit });
    return out;
  });

  selIndex = $derived.by(() => {
    const id = this.selectedId;
    return this.items.findIndex((it) => (it.type === 'wt' ? id === WT : it.commit.id === id));
  });

  badges = $derived.by(() => {
    const map = new Map<string, Badge[]>();
    const byShort = new Map(this.refs.map((r) => [r.short, r]));
    const absorbed = new Set<string>();
    const add = (target: string, badge: Badge) => {
      const list = map.get(target);
      if (list) list.push(badge);
      else map.set(target, [badge]);
    };
    const current = this.status?.branch;

    for (const r of this.refs) {
      if (r.kind !== 'local') continue;
      const up = r.upstream ? byShort.get(r.upstream) : undefined;
      const synced = !!up && up.target === r.target;
      if (synced) absorbed.add(up!.short);
      add(r.target, {
        label: r.short,
        kind: r.short === current ? 'head' : 'local',
        synced,
        ref: { short: r.short, kind: 'local' },
      });
    }
    for (const r of this.refs) {
      if (r.kind === 'remote' && !absorbed.has(r.short)) {
        add(r.target, { label: r.short, kind: 'remote', synced: false, ref: { short: r.short, kind: 'remote' } });
      } else if (r.kind === 'tag') {
        add(r.target, { label: r.short, kind: 'tag', synced: false });
      }
    }
    if (!current && this.head) {
      add(this.head, { label: 'HEAD', kind: 'head', synced: false });
    }
    const order = { head: 0, local: 1, remote: 2, tag: 3 };
    for (const list of map.values()) list.sort((a, b) => order[a.kind] - order[b.kind]);
    return map;
  });

  sidebar = $derived.by<SidebarItem[]>(() => {
    const out: SidebarItem[] = [];
    const current = this.status?.branch;
    const favs = new Set(this.local.favorites);
    const sorted = (list: Ref[], sort: 'name' | 'recent') =>
      sort === 'recent'
        ? list.sort((a, b) => b.time - a.time || a.short.localeCompare(b.short))
        : list.sort((a, b) => a.short.localeCompare(b.short));

    // Favourites first: the branches you keep coming back to.
    const fcfg = this.sections.favorite;
    const pinned = sorted(this.refs.filter((r) => favs.has(r.name)), fcfg.sort);
    out.push({ type: 'header', key: 'favorite', label: 'Favorites', count: pinned.length, collapsed: fcfg.collapsed, sort: fcfg.sort });
    if (!fcfg.collapsed) {
      for (const ref of pinned) {
        out.push({ type: 'ref', ref, current: ref.kind === 'local' && ref.short === current, fav: true, pinned: true });
      }
    }

    const section = (label: string, kind: Ref['kind']) => {
      const cfg = this.sections[kind];
      const list = this.refs.filter((r) => r.kind === kind);
      if (cfg.sort === 'recent') list.sort((a, b) => b.time - a.time || a.short.localeCompare(b.short));
      else list.sort((a, b) => a.short.localeCompare(b.short));
      out.push({ type: 'header', key: kind, label, count: list.length, collapsed: cfg.collapsed, sort: cfg.sort });
      if (cfg.collapsed) return;
      for (const ref of list) {
        out.push({ type: 'ref', ref, current: kind === 'local' && ref.short === current, fav: favs.has(ref.name), pinned: false });
      }
    };
    section('Local', 'local');
    section('Remote', 'remote');
    section('Tags', 'tag');
    const cfg = this.sections.stash;
    const stashes = [...this.stashes];
    if (cfg.sort === 'name') stashes.sort((a, b) => a.message.localeCompare(b.message));
    out.push({ type: 'header', key: 'stash', label: 'Stashes', count: stashes.length, collapsed: cfg.collapsed, sort: cfg.sort });
    if (!cfg.collapsed) for (const stash of stashes) out.push({ type: 'stash', stash });
    return out;
  });

  /** Every changed file of the selection, before search and folding. */
  private rawFiles = $derived.by<FileEntry[]>(() => {
    if (this.selectedId === WT) {
      const staged: FileEntry[] = [];
      const unstaged: FileEntry[] = [];
      for (const f of this.status?.files ?? []) {
        if (f.index !== '.' && f.index !== '?' && !f.conflicted) {
          staged.push({
            key: `s:${f.path}`,
            path: f.path,
            origPath: f.origPath,
            status: f.index,
            target: { kind: 'staged' },
            group: 'staged',
          });
        }
        if (f.worktree !== '.' || f.conflicted) {
          const untracked = f.worktree === '?';
          unstaged.push({
            key: `u:${f.path}`,
            path: f.path,
            origPath: null,
            status: f.conflicted ? '!' : untracked ? 'A' : f.worktree,
            target: { kind: untracked ? 'untracked' : 'unstaged' },
            group: 'unstaged',
          });
        }
      }
      return [...staged, ...unstaged];
    }
    const d = this.detail;
    if (!d || d.id !== this.selectedId) return [];
    return d.files.map((f: FileChange) => ({
      key: `c:${f.path}`,
      path: f.path,
      origPath: f.origPath,
      status: f.status,
      target: { kind: 'commit', sha: d.id } as DiffTarget,
      group: 'commit' as const,
    }));
  });

  /**
   * What the pane draws: group headers, folders (tree view) and files, after
   * the search filter. Files under a collapsed folder are left out.
   */
  fileRows = $derived.by<FileRow[]>(() => {
    const q = this.fileFilter.trim().toLowerCase();
    const all = q ? this.rawFiles.filter((f) => f.path.toLowerCase().includes(q)) : this.rawFiles;
    const tree = this.prefs.fileView === 'tree';
    const rows: FileRow[] = [];
    let index = 0;

    const walk = (node: DirNode, prefix: string, depth: number, group: FileEntry['group']) => {
      const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (let [label, child] of dirs) {
        let path = prefix + label;
        // Fold chains of single folders into one row: src/lib/git
        while (child.files.length === 0 && child.dirs.size === 1) {
          const [name, only] = [...child.dirs.entries()][0];
          label += '/' + name;
          path += '/' + name;
          child = only;
        }
        const key = `${group}:${path}`;
        // While searching, everything stays open so matches are visible.
        const collapsed = !q && this.collapsedDirs.includes(key);
        rows.push({ type: 'dir', key, label, depth, collapsed, entries: filesUnder(child) });
        if (!collapsed) walk(child, path + '/', depth + 1, group);
      }
      const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
      for (const entry of files) rows.push({ type: 'file', entry, index: index++, depth });
    };

    for (const group of ['staged', 'unstaged', 'commit'] as const) {
      const list = all.filter((f) => f.group === group);
      if (!list.length) continue;
      rows.push({ type: 'group', group, count: list.length });
      if (!tree) {
        for (const entry of list) rows.push({ type: 'file', entry, index: index++, depth: 0 });
        continue;
      }
      const root: DirNode = { dirs: new Map(), files: [] };
      for (const entry of list) {
        const parts = entry.path.split('/');
        let node = root;
        for (const part of parts.slice(0, -1)) {
          let next = node.dirs.get(part);
          if (!next) node.dirs.set(part, (next = { dirs: new Map(), files: [] }));
          node = next;
        }
        node.files.push(entry);
      }
      walk(root, '', 0, group);
    }
    return rows;
  });

  /** Files the keyboard moves through, in display order. */
  files = $derived.by<FileEntry[]>(() => {
    const out: FileEntry[] = [];
    for (const row of this.fileRows) if (row.type === 'file') out.push(row.entry);
    return out;
  });

  /** Changed files before filtering; the count shown in headers. */
  get fileTotal(): number {
    return this.rawFiles.length;
  }

  toggleDir(key: string) {
    const open = this.files[this.fileIdx]?.key;
    this.collapsedDirs = this.collapsedDirs.includes(key)
      ? this.collapsedDirs.filter((k) => k !== key)
      : [...this.collapsedDirs, key];
    // Keep the cursor on the same file if it is still visible.
    const at = this.files.findIndex((f) => f.key === open);
    this.fileIdx = clamp(at >= 0 ? at : this.fileIdx, 0, Math.max(0, this.files.length - 1));
  }

  toggleFileView() {
    const open = this.files[this.fileIdx]?.key;
    this.prefs.fileView = this.prefs.fileView === 'tree' ? 'list' : 'tree';
    const at = this.files.findIndex((f) => f.key === open);
    if (at >= 0) this.fileIdx = at;
  }

  // ---------- loading ----------

  /** Reloads status, refs and log. Calls while one is running are coalesced. */
  async refresh(): Promise<void> {
    if (this.refreshing) {
      this.dirty = true;
      return;
    }
    this.refreshing = true;
    this.busy = true;
    try {
      do {
        this.dirty = false;
        const [status, refs, log, profile, remote] = await Promise.all([
          api.repoStatus(this.path),
          api.repoRefs(this.path),
          api.repoLog(this.path, this.limit, this.scope),
          api.profileFor(this.path),
          api.repoRemote(this.path).catch(() => null),
        ]);
        this.profile = profile;
        this.remote = remote;
        this.base = await api
          .repoBase(this.path, (status.branch && this.local.bases[status.branch]) || null)
          .catch(() => ({ name: null, target: null, behind: 0, guessed: false }));
        this.status = status;
        this.refs = refs.refs;
        this.stashes = refs.stashes;
        this.commits = log.commits;
        this.hasMore = log.hasMore;
        this.head = log.head;
        this.error = null;
      } while (this.dirty);
      this.afterRefresh();
    } catch (e) {
      this.error = String(e);
    } finally {
      this.refreshing = false;
      this.busy = false;
      this.loaded = true;
    }
  }

  private afterRefresh() {
    // Keep the selection if it still exists, else fall back to the top row.
    if (this.selIndex < 0) {
      const first = this.items[0];
      this.selectedId = first ? (first.type === 'wt' ? WT : first.commit.id) : '';
    }
    this.fileIdx = clamp(this.fileIdx, 0, Math.max(0, this.files.length - 1));
    if (this.marks.length) {
      const keys = new Set(this.files.map((f) => f.key));
      this.marks = this.marks.filter((k) => keys.has(k));
    }
    this.sidebarIdx = this.nearestSidebarRow(this.sidebarIdx, 1);
    this.loadDetail();
    if (this.diff) {
      // Reload the open file; if it left the list (fully staged, discarded…)
      // move on to whatever now sits at the cursor.
      const at = this.files.findIndex((f) => f.key === this.diff!.entry.key);
      if (at >= 0) {
        this.fileIdx = at;
        this.openDiff(this.files[at], true);
      } else if (this.selectedId === WT) {
        this.syncDiff();
      }
    }
  }

  /**
   * Runs one write operation, then reloads. Only one runs at a time.
   * Returns the error text on failure (already shown unless `quiet`).
   */
  async run(
    label: string,
    fn: () => Promise<unknown>,
    opts: { done?: string; quiet?: boolean } = {},
  ): Promise<string | null> {
    if (this.op) {
      this.notify(`Still busy: ${this.op}`, 'error');
      return 'busy';
    }
    this.op = label;
    let error: string | null = null;
    try {
      await fn();
      if (opts.done) this.notify(opts.done);
    } catch (e) {
      error = String(e);
      if (!opts.quiet) this.notify(error, 'error', label);
    } finally {
      this.op = null;
    }
    await this.refresh();
    return error;
  }

  async loadMore() {
    if (!this.hasMore || this.busy) return;
    this.limit += PAGE;
    await this.refresh();
  }

  setScope(scope: LogScope) {
    if (this.scope === scope) return;
    this.scope = scope;
    this.refresh();
  }

  private async loadDetail() {
    const id = this.selectedId;
    const token = ++this.detailToken;
    if (!id || id === WT) {
      this.detail = null;
      return;
    }
    if (this.detail?.id === id) return;
    try {
      const detail = await api.commitDetail(this.path, id);
      if (token === this.detailToken) {
        this.detail = detail;
        this.fileIdx = 0;
        if (this.diff) this.syncDiff();
      }
    } catch (e) {
      if (token === this.detailToken) this.error = String(e);
    }
  }

  // ---------- selection ----------

  select(id: string, opts: { reveal?: boolean } = {}) {
    if (this.selectedId !== id) {
      this.selectedId = id;
      this.fileIdx = 0;
      if (id === WT && this.diff) this.syncDiff();
      this.loadDetail();
    }
    if (opts.reveal ?? true) this.reveal++;
  }

  selectIndex(i: number) {
    const item = this.items[clamp(i, 0, this.items.length - 1)];
    if (item) this.select(item.type === 'wt' ? WT : item.commit.id);
  }

  jumpToHead() {
    if (this.filter) this.filter = '';
    if (this.head) this.select(this.head);
    this.focus = 'graph';
  }

  private nearestSidebarRow(from: number, dir: 1 | -1): number {
    void dir;
    return clamp(from, 0, Math.max(0, this.sidebar.length - 1));
  }

  // ---------- keyboard navigation (acts on the focused pane) ----------

  move(delta: number) {
    switch (this.focus) {
      case 'graph':
        this.selectIndex((this.selIndex < 0 ? 0 : this.selIndex) + delta);
        break;
      case 'sidebar': {
        this.sidebarIdx = clamp(this.sidebarIdx + delta, 0, Math.max(0, this.sidebar.length - 1));
        break;
      }
      case 'files':
        this.selectFile(this.fileIdx + delta);
        break;
      case 'diff':
        if (this.lineMode) {
          const n = this.diff?.data?.hunks[this.hunkIdx]?.lines.length ?? 0;
          this.lineCursor = clamp(this.lineCursor + delta, 0, Math.max(0, n - 1));
        } else {
          this.scrollDiff?.(delta);
        }
        break;
    }
    if (this.focus === 'sidebar') this.previewSidebar();
  }

  /** Shows the commit of the highlighted branch or tag without leaving the sidebar. */
  private previewSidebar() {
    const item = this.sidebar[this.sidebarIdx];
    if (item?.type === 'ref' && this.commits.some((c) => c.id === item.ref.target)) {
      this.filter = '';
      this.select(item.ref.target);
    }
  }

  /** Section the sidebar cursor is in. */
  sidebarSection(): SectionKey | null {
    for (let i = Math.min(this.sidebarIdx, this.sidebar.length - 1); i >= 0; i--) {
      const item = this.sidebar[i];
      if (item.type === 'header') return item.key;
    }
    return null;
  }

  toggleSection(key: SectionKey) {
    this.sections[key].collapsed = !this.sections[key].collapsed;
    // Park the cursor on the header so it does not land in another section.
    const at = this.sidebar.findIndex((it) => it.type === 'header' && it.key === key);
    if (at >= 0) this.sidebarIdx = at;
  }

  cycleSort(key: SectionKey) {
    this.sections[key].sort = this.sections[key].sort === 'name' ? 'recent' : 'name';
  }

  moveHunk(delta: number) {
    const n = this.diff?.data?.hunks.length ?? 0;
    if (!n) return;
    this.lineMode = false;
    this.hunkIdx = clamp(this.hunkIdx + delta, 0, n - 1);
  }

  /** Enters or leaves line selection inside the current hunk. */
  toggleLineMode() {
    const hunk = this.diff?.data?.hunks[this.hunkIdx];
    if (!hunk) return;
    if (this.lineMode) {
      this.lineMode = false;
      return;
    }
    const first = hunk.lines.findIndex((l) => l.kind === '+' || l.kind === '-');
    this.lineCursor = this.lineAnchor = Math.max(0, first);
    this.lineMode = true;
  }

  /** Changed lines covered by the selection, as indexes into the hunk. */
  selectedLines(): number[] | null {
    if (!this.lineMode) return null;
    const hunk = this.diff?.data?.hunks[this.hunkIdx];
    if (!hunk) return null;
    const lo = Math.min(this.lineAnchor, this.lineCursor);
    const hi = Math.max(this.lineAnchor, this.lineCursor);
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) {
      const k = hunk.lines[i]?.kind;
      if (k === '+' || k === '-') out.push(i);
    }
    return out;
  }

  moveToEdge(end: boolean) {
    switch (this.focus) {
      case 'graph':
        this.selectIndex(end ? this.items.length - 1 : 0);
        break;
      case 'sidebar':
        this.sidebarIdx = this.nearestSidebarRow(end ? this.sidebar.length - 1 : 0, end ? -1 : 1);
        break;
      case 'files':
        this.selectFile(end ? this.files.length - 1 : 0);
        break;
      case 'diff':
        this.scrollDiff?.(end ? Infinity : -Infinity);
        break;
    }
  }

  /** Enter. */
  activate() {
    switch (this.focus) {
      case 'graph':
        if (this.files.length) this.focus = 'files';
        break;
      case 'sidebar': {
        const item = this.sidebar[this.sidebarIdx];
        if (item?.type === 'ref') {
          this.revealCommit(item.ref.target);
        }
        break;
      }
      case 'files': {
        const entry = this.files[this.fileIdx];
        if (entry) this.openDiff(entry);
        break;
      }
    }
  }

  /** Escape: step back out one level. */
  back() {
    if (this.lineMode) {
      this.lineMode = false;
      return;
    }
    if (this.fileFilter && this.focus === 'files') {
      this.fileFilter = '';
      return;
    }
    if (this.filterOpen || this.filter) {
      this.filter = '';
      this.filterOpen = false;
      this.reveal++;
      return;
    }
    if (this.focus === 'diff') {
      this.focus = 'files';
    } else if (this.diff) {
      this.closeDiff();
    } else if (this.focus !== 'graph') {
      this.focus = 'graph';
    }
  }

  cycleFocus(dir: 1 | -1, panes: Focus[]) {
    if (!panes.length) return;
    const i = panes.indexOf(this.focus);
    this.focus = panes[(i + dir + panes.length) % panes.length];
  }

  /** Selects a commit in the graph, clearing a filter that would hide it. */
  revealCommit(sha: string) {
    if (!this.commits.some((c) => c.id === sha)) {
      this.error = 'Commit is not in the loaded history. Scroll down to load more.';
      return;
    }
    this.filter = '';
    this.select(sha);
  }

  // ---------- files + diff ----------

  selectFile(i: number) {
    if (!this.files.length) return;
    this.fileIdx = clamp(i, 0, this.files.length - 1);
    this.clearMarks();
    if (this.diff) this.syncDiff();
  }

  clearMarks() {
    this.marks = [];
    this.markEnd = null;
  }

  /** Marks every file from the cursor to `to` (shift-click, shift+j/k). */
  markRange(to: number) {
    const end = clamp(to, 0, this.files.length - 1);
    const lo = Math.min(this.fileIdx, end);
    const hi = Math.max(this.fileIdx, end);
    this.markEnd = end;
    this.marks = this.files.slice(lo, hi + 1).map((f) => f.key);
  }

  extendMarks(delta: number) {
    this.markRange((this.markEnd ?? this.fileIdx) + delta);
  }

  toggleMark(i: number) {
    const key = this.files[i]?.key;
    if (!key) return;
    // The first ⌘-click also keeps the row the cursor was on.
    const base = this.marks.length ? this.marks : [this.files[this.fileIdx]?.key].filter(Boolean);
    this.marks = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
  }

  markAll() {
    this.marks = this.files.map((f) => f.key);
  }

  /** Files an action applies to: the marked ones, else the one under the cursor. */
  targets(): FileEntry[] {
    if (this.marks.length) return this.files.filter((f) => this.marks.includes(f.key));
    const one = this.files[this.fileIdx];
    return one ? [one] : [];
  }

  /** Set by the diff view so `j/k` can scroll it. */
  scrollDiff: ((delta: number) => void) | null = null;

  private syncDiff() {
    const entry = this.files[this.fileIdx];
    if (entry) this.openDiff(entry);
    else this.closeDiff();
  }

  async openDiff(entry: FileEntry, keep = false) {
    const token = ++this.diffToken;
    if (!keep || !this.diff) {
      this.diff = { entry, data: null, error: null };
      this.hunkIdx = 0;
    }
    this.lineMode = false;
    try {
      const data = await api.diffFile(this.path, entry.target, entry.path, entry.origPath);
      if (token === this.diffToken) {
        this.diff = { entry, data, error: null };
        this.hunkIdx = clamp(this.hunkIdx, 0, Math.max(0, data.hunks.length - 1));
      }
    } catch (e) {
      if (token === this.diffToken) this.diff = { entry, data: null, error: String(e) };
    }
  }

  closeDiff() {
    this.diffToken++;
    this.diff = null;
    if (this.focus === 'diff') this.focus = 'files';
  }
}
