import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  api,
  type Prefs,
  type ProfileStore,
  type RepoLocal,
  type Sections,
  type Session,
  type SpaceData,
  type SplitDir,
} from '$lib/api';
import { clamp } from '$lib/util';
import { explain } from '$lib/explain';
import { RepoState } from './repo.svelte';
import { createConfirmation, type Confirmation, type ConfirmationOptions } from '$lib/confirmation';

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  title: string;
  /** One line on what happened. */
  why?: string;
  /** Raw output from git, when there is any. */
  detail?: string;
  /** Things to try. */
  hints: string[];
}

export interface Dialog {
  title: string;
  body?: string;
  confirmLabel: string;
  value: string;
  placeholder?: string;
  resolve: (result: string | null) => void;
}

export interface MenuItem {
  label: string;
  group?: string;
  /** Small note on the right, e.g. "current". */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}

/** A tab being dragged, and where it would land. */
export interface TabDrag {
  path: string;
  name: string;
  x: number;
  y: number;
  zone: 'right' | 'bottom' | null;
}

const MAX_RECENTS = 30;
let toastId = 0;
let spaceId = 0;

/** A named set of tabs with its own layout. */
export class Space {
  readonly id = ++spaceId;
  name = $state('');
  tabs = $state<RepoState[]>([]);
  activeIdx = $state(0);
  /** An empty "new tab" is showing in the main pane. */
  blank = $state(false);
  /** Second pane showing another tab of this space. */
  split = $state<{ path: string; dir: SplitDir } | null>(null);
  paneFocus = $state<0 | 1>(0);
  /** Tab paths, most recently used first. */
  mru = $state<string[]>([]);
  closed: string[] = [];

  constructor(name: string) {
    this.name = name;
  }
}

class App {
  spaces = $state<Space[]>([new Space('Main')]);
  spaceIdx = $state(0);
  recents = $state<string[]>([]);
  /** Which palette is open, if any. */
  palette = $state<null | 'switch' | 'commands' | 'branches' | 'profiles' | 'merge' | 'rebase' | 'base'>(null);
  profiles = $state<ProfileStore>({ profiles: [], bindings: {} });
  profilesOpen = $state(false);
  dialog = $state<Dialog | null>(null);
  confirmation = $state.raw<Confirmation | null>(null);
  spacesOpen = $state(false);
  drag = $state<TabDrag | null>(null);
  logOpen = $state(false);
  helpOpen = $state(false);
  sidebarOpen = $state(true);
  detailOpen = $state(true);
  sidebarW = $state(220);
  detailW = $state(380);
  /** Favourite branches and base branches, per repository path. */
  repoLocal = $state<Record<string, RepoLocal>>({});
  sections = $state<Sections>({
    favorite: { collapsed: false, sort: 'name' },
    local: { collapsed: false, sort: 'name' },
    remote: { collapsed: false, sort: 'name' },
    tag: { collapsed: false, sort: 'recent' },
    stash: { collapsed: false, sort: 'recent' },
  });
  toasts = $state<Toast[]>([]);
  ready = $state(false);
  zoom = $state(1);
  prefs = $state<Prefs>({ fileView: 'list' });
  /** Right-click menu, at viewport coordinates. */
  menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** Set by the page: what the Edit menu's Undo / Redo should do. */
  onMenu: (id: string) => void = () => {};

  /** One RepoState per repository, shared by every space that has it open. */
  private pool = new Map<string, RepoState>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  space = $derived(this.spaces[this.spaceIdx] ?? this.spaces[0]);
  /** Repository in the main pane. */
  primary = $derived<RepoState | undefined>(
    this.space.blank ? undefined : this.space.tabs[this.space.activeIdx],
  );
  /** Repository in the split pane, if there is one. */
  secondary = $derived<RepoState | undefined>(
    this.space.split ? this.space.tabs.find((t) => t.path === this.space.split!.path) : undefined,
  );
  /** Repository that has keyboard focus. */
  active = $derived<RepoState | undefined>(
    this.space.paneFocus === 1 && this.secondary ? this.secondary : this.primary,
  );

  get tabs(): RepoState[] {
    return this.space.tabs;
  }
  get activeIdx(): number {
    return this.space.activeIdx;
  }
  get mru(): string[] {
    return this.space.mru;
  }

  // ---------- confirmations and prompts ----------

  /** Asks before something destructive. Resolves true when confirmed. */
  confirm(opts: ConfirmationOptions, repo = this.active): Promise<boolean> {
    this.answerConfirmation(this.confirmation, false);
    this.closeDialog(null);
    this.palette = null;
    this.menu = null;
    this.spacesOpen = false;
    this.profilesOpen = false;
    this.helpOpen = false;
    const request = createConfirmation(opts, repo?.path ?? null);
    this.confirmation = request;
    return request.result;
  }

  answerConfirmation(request: Confirmation | null, confirmed: boolean) {
    if (!request || this.confirmation !== request) return;
    this.confirmation = null;
    request.resolve(confirmed);
  }

  /** Asks for one line of text. Resolves null when cancelled. */
  prompt(opts: {
    title: string;
    body?: string;
    placeholder?: string;
    value?: string;
    confirmLabel?: string;
  }): Promise<string | null> {
    this.answerConfirmation(this.confirmation, false);
    return new Promise((resolve) => {
      this.closeDialog(null);
      this.dialog = { value: '', confirmLabel: 'OK', ...opts, resolve };
    });
  }

  closeDialog(result: string | null) {
    const d = this.dialog;
    this.dialog = null;
    d?.resolve(result);
  }

  // ---------- startup ----------

  private repoFor(path: string, name: string): RepoState {
    let tab = this.pool.get(path);
    if (!tab) {
      tab = new RepoState(path, name);
      tab.notify = (text, kind, context) => this.toast(text, kind, context);
      tab.canWrite = () => this.confirmation === null;
      tab.sections = this.sections;
      tab.prefs = this.prefs;
      if (!this.repoLocal[path]) this.repoLocal[path] = { favorites: [], bases: {}, githubAccount: null };
      tab.local = this.repoLocal[path];
      this.pool.set(path, tab);
      api.watchRepo(path).catch(() => {});
    }
    return tab;
  }

  /** Drops repositories no space shows any more. */
  private releaseUnused() {
    for (const path of this.pool.keys()) {
      if (!this.spaces.some((s) => s.tabs.some((t) => t.path === path))) {
        this.pool.delete(path);
        api.unwatchRepo(path).catch(() => {});
      }
    }
  }

  async init() {
    let session: Partial<Session> | null = null;
    try {
      session = await api.sessionLoad();
    } catch {
      /* first launch */
    }
    try {
      this.profiles = await api.profilesLoad();
    } catch {
      /* none yet */
    }
    this.recents = session?.recents ?? [];
    this.sidebarW = session?.sidebarW ?? 220;
    this.detailW = session?.detailW ?? 380;
    if (session?.zoom && session.zoom !== 1) this.setZoom(session.zoom);
    if (session?.prefs) Object.assign(this.prefs, session.prefs);
    for (const [path, local] of Object.entries(session?.repos ?? {})) {
      this.repoLocal[path] = { favorites: local.favorites ?? [], bases: local.bases ?? {}, githubAccount: local.githubAccount ?? null };
    }
    if (session?.sections) {
      for (const key of Object.keys(this.sections) as (keyof Sections)[]) {
        Object.assign(this.sections[key], session.sections[key] ?? {});
      }
    }

    const saved: SpaceData[] = session?.spaces?.length
      ? session.spaces
      : [{ name: 'Main', tabs: session?.tabs ?? [], active: session?.active ?? 0, split: null }];

    const paths = [...new Set(saved.flatMap((s) => s.tabs))];
    const infos = new Map<string, { path: string; name: string }>();
    await Promise.all(
      paths.map(async (p) => {
        try {
          infos.set(p, await api.repoOpen(p));
        } catch {
          /* folder is gone or no longer a repository */
        }
      }),
    );

    this.spaces = saved.map((data) => {
      const space = new Space(data.name || 'Space');
      for (const p of data.tabs) {
        const info = infos.get(p);
        if (info && !space.tabs.some((t) => t.path === info.path)) {
          space.tabs.push(this.repoFor(info.path, info.name));
        }
      }
      space.activeIdx = clamp(data.active ?? 0, 0, Math.max(0, space.tabs.length - 1));
      space.mru = space.tabs.map((t) => t.path);
      if (data.split && space.tabs.length > 1 && space.tabs.some((t) => t.path === data.split!.path)) {
        space.split = data.split;
      }
      return space;
    });
    this.spaceIdx = clamp(session?.space ?? 0, 0, this.spaces.length - 1);
    this.touch();
    this.ready = true;

    await listen<string>('repo-changed', (e) => {
      const tab = this.pool.get(e.payload);
      if (!tab) return;
      // Hidden repositories reload when they are next shown.
      if (tab === this.primary || tab === this.secondary) tab.refresh();
      else tab.loaded = false;
    });
    await listen<string>('menu', (e) => this.onMenu(e.payload));
    window.addEventListener('focus', () => {
      this.primary?.refresh();
      this.secondary?.refresh();
    });
  }

  // ---------- tabs ----------

  /** Records the focused tab as most recently used and loads what is visible. */
  private touch() {
    const tab = this.active;
    if (tab) this.space.mru = [tab.path, ...this.space.mru.filter((p) => p !== tab.path)];
    for (const t of [this.primary, this.secondary]) {
      if (t && !t.loaded) t.refresh();
    }
  }

  /** Shows tab `i` in the focused pane. */
  goto(i: number) {
    const s = this.space;
    const tab = s.tabs[i];
    if (!tab) return;
    if (s.split && s.paneFocus === 1) {
      if (tab.path === this.primary?.path) {
        // Already in the other pane: swap the two.
        s.activeIdx = s.tabs.findIndex((t) => t.path === s.split!.path);
      }
      s.split = { ...s.split, path: tab.path };
    } else {
      if (s.split && tab.path === s.split.path) {
        if (this.primary) s.split = { ...s.split, path: this.primary.path };
        else s.split = null;
      }
      s.activeIdx = i;
      s.blank = false;
    }
    this.touch();
    this.save();
  }

  cycle(dir: 1 | -1) {
    const n = this.tabs.length;
    if (!n) return;
    const cur = this.active ? this.tabs.indexOf(this.active) : dir > 0 ? -1 : 0;
    if (n > 1 || this.space.blank) this.goto((cur + dir + n) % n);
  }

  /** ⌘T: an empty tab to pick a repository in. */
  newTab() {
    this.space.paneFocus = 0;
    this.space.blank = true;
  }

  async openRepo(path: string, opts: { background?: boolean } = {}) {
    let info;
    try {
      info = await api.repoOpen(path);
    } catch (e) {
      this.toast(String(e), 'error');
      return;
    }
    this.recents = [info.path, ...this.recents.filter((p) => p !== info.path)].slice(0, MAX_RECENTS);

    const s = this.space;
    let i = s.tabs.findIndex((t) => t.path === info.path);
    if (i < 0) {
      s.tabs.push(this.repoFor(info.path, info.name));
      i = s.tabs.length - 1;
      s.mru = [...s.mru, info.path];
    }
    if (opts.background) {
      s.tabs[i].refresh();
      this.save();
    } else {
      this.goto(i);
    }
  }

  async openFolder() {
    const picked = await openDialog({ directory: true, title: 'Open repository' });
    if (typeof picked === 'string') await this.openRepo(picked);
  }

  /** ⌘W: closes the split pane, the empty tab, or the current tab. */
  closeActive() {
    const s = this.space;
    if (s.split && s.paneFocus === 1) return this.closeSplit();
    if (s.blank) {
      s.blank = false;
      return;
    }
    this.closeTab(s.activeIdx);
  }

  closeTab(i: number) {
    const s = this.space;
    const tab = s.tabs[i];
    if (!tab) return;
    const wasPrimary = tab === this.primary;
    s.closed.push(tab.path);
    if (s.split?.path === tab.path) {
      s.split = null;
      s.paneFocus = 0;
    }
    s.tabs.splice(i, 1);
    s.mru = s.mru.filter((p) => p !== tab.path);

    if (wasPrimary) {
      // Go back to the tab used before this one (not the one in the split pane).
      const prevPath = s.mru.find((p) => p !== s.split?.path);
      const prev = s.tabs.findIndex((t) => t.path === prevPath);
      s.activeIdx = prev >= 0 ? prev : clamp(i, 0, Math.max(0, s.tabs.length - 1));
      if (s.split && s.tabs[s.activeIdx]?.path === s.split.path) s.split = null;
    } else if (i < s.activeIdx) {
      s.activeIdx--;
    }
    this.releaseUnused();
    this.touch();
    this.save();
  }

  reopenTab() {
    const path = this.space.closed.pop();
    if (path) this.openRepo(path);
  }

  moveTab(from: number, to: number) {
    const s = this.space;
    if (from === to || !s.tabs[from] || to < 0 || to >= s.tabs.length) return;
    const primaryPath = this.primary?.path;
    const [tab] = s.tabs.splice(from, 1);
    s.tabs.splice(to, 0, tab);
    if (primaryPath) s.activeIdx = Math.max(0, s.tabs.findIndex((t) => t.path === primaryPath));
    this.save();
  }

  // ---------- split panes ----------

  /** Opens the tab at `path` in a second pane beside (`row`) or below (`column`) the main one. */
  splitWith(path: string, dir: SplitDir) {
    const s = this.space;
    if (!s.tabs.some((t) => t.path === path)) return;
    if (s.blank || this.primary?.path === path) {
      // The dragged tab is the one on screen: something else takes the main pane.
      const other = s.mru.find((p) => p !== path) ?? s.tabs.find((t) => t.path !== path)?.path;
      const idx = s.tabs.findIndex((t) => t.path === other);
      if (idx < 0) {
        this.toast('Open a second repository to split the view.', 'error');
        return;
      }
      s.activeIdx = idx;
      s.blank = false;
    }
    s.split = { path, dir };
    s.paneFocus = 1;
    this.touch();
    this.save();
  }

  /** Keyboard split: the previously used tab goes into the new pane. */
  splitActive(dir: SplitDir) {
    const s = this.space;
    if (s.split) {
      s.split = { ...s.split, dir };
      this.save();
      return;
    }
    const other = s.mru.find((p) => p !== this.primary?.path);
    if (!other) {
      this.toast('Open a second repository to split the view.', 'error');
      return;
    }
    this.splitWith(other, dir);
  }

  closeSplit() {
    this.space.split = null;
    this.space.paneFocus = 0;
    this.touch();
    this.save();
  }

  focusPane(pane: 0 | 1) {
    if (pane === 1 && !this.secondary) return;
    if (this.space.paneFocus === pane) return;
    this.space.paneFocus = pane;
    this.touch();
  }

  // ---------- spaces ----------

  switchSpace(i: number) {
    if (i < 0 || i >= this.spaces.length || i === this.spaceIdx) return;
    this.spaceIdx = i;
    this.touch();
    this.save();
  }

  cycleSpace(dir: 1 | -1) {
    const n = this.spaces.length;
    if (n > 1) this.switchSpace((this.spaceIdx + dir + n) % n);
  }

  async newSpace(name?: string) {
    const picked =
      name ?? (await this.prompt({ title: 'New space', placeholder: 'Name', confirmLabel: 'Create' }));
    const clean = picked?.trim();
    if (!clean) return;
    this.spaces.push(new Space(clean));
    this.switchSpace(this.spaces.length - 1);
    this.save();
  }

  async renameSpace(i = this.spaceIdx) {
    const space = this.spaces[i];
    if (!space) return;
    const name = await this.prompt({ title: 'Rename space', value: space.name, confirmLabel: 'Rename' });
    if (name?.trim()) {
      space.name = name.trim();
      this.save();
    }
  }

  async deleteSpace(i = this.spaceIdx) {
    const space = this.spaces[i];
    if (!space) return;
    if (this.spaces.length === 1) {
      this.toast('This is the only space.', 'error');
      return;
    }
    if (space.tabs.length) {
      const ok = await this.confirm({
        title: `Delete space ${space.name}?`,
        body: `Its ${space.tabs.length} ${space.tabs.length === 1 ? 'tab closes' : 'tabs close'}. Repositories on disk are not touched.`,
        confirmLabel: 'Delete space',
        danger: true,
      });
      if (!ok) return;
    }
    const current = this.space;
    this.spaces.splice(i, 1);
    const at = this.spaces.indexOf(current);
    this.spaceIdx = at >= 0 ? at : clamp(i, 0, this.spaces.length - 1);
    this.releaseUnused();
    this.touch();
    this.save();
  }

  moveSpace(from: number, to: number) {
    if (from === to || !this.spaces[from] || to < 0 || to >= this.spaces.length) return;
    const current = this.space;
    const [space] = this.spaces.splice(from, 1);
    this.spaces.splice(to, 0, space);
    this.spaceIdx = this.spaces.indexOf(current);
    this.save();
  }

  // ---------- profiles ----------

  private profileTimer: ReturnType<typeof setTimeout> | undefined;

  /** Persists profiles, then re-resolves which one each visible repository uses. */
  saveProfiles() {
    clearTimeout(this.profileTimer);
    this.profileTimer = setTimeout(async () => {
      try {
        await api.profilesSave($state.snapshot(this.profiles));
        this.primary?.refresh();
        this.secondary?.refresh();
      } catch (e) {
        this.toast(`Could not save profiles: ${e}`, 'error');
      }
    }, 250);
  }

  /** `id`: a profile, '' for none, or null to go back to rule matching. */
  bindProfile(repo: RepoState, id: string | null) {
    if (id === null) delete this.profiles.bindings[repo.path];
    else this.profiles.bindings[repo.path] = id;
    this.saveProfiles();
  }

  async cloneRepo(url: string) {
    const parent = await openDialog({ directory: true, title: 'Clone into folder' });
    if (typeof parent !== 'string') return;
    const name = url.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() || 'repo';
    const dest = `${parent}/${name}`;
    this.toast(`Cloning ${name}…`);
    try {
      await api.cloneRepo(url, dest);
      await this.openRepo(dest);
    } catch (e) {
      this.toast(String(e), 'error');
    }
  }

  // ---------- session ----------

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      api
        .sessionSave({
          spaces: this.spaces.map((s) => ({
            name: s.name,
            tabs: s.tabs.map((t) => t.path),
            active: s.activeIdx,
            split: s.split,
          })),
          space: this.spaceIdx,
          recents: this.recents,
          sidebarW: this.sidebarW,
          detailW: this.detailW,
          sections: this.sections,
          zoom: this.zoom,
          prefs: this.prefs,
          repos: this.repoLocal,
        })
        .catch((e) => this.toast(`Could not save session: ${e}`, 'error'));
    }, 200);
  }

  openMenu(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    this.menu = { x: e.clientX, y: e.clientY, items };
  }

  // ---------- zoom ----------

  async setZoom(value: number) {
    const z = Math.round(clamp(value, 0.7, 1.6) * 10) / 10;
    this.zoom = z;
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(z);
    } catch {
      // Plain browser preview.
      (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
    }
    this.save();
  }

  // ---------- toasts ----------

  /**
   * `context` is the action that failed (e.g. "Pushing…"). Errors are
   * explained, keep git's own output, and stay until dismissed.
   */
  toast(text: string, kind: Toast['kind'] = 'info', context?: string) {
    const id = ++toastId;
    if (kind === 'info') {
      this.toasts.push({ id, kind, title: text, hints: [] });
      setTimeout(() => this.dismiss(id), 3500);
      return;
    }
    const info = explain(text, context);
    // Short messages written by the app itself need no second copy as "detail".
    const own = !context && info.hints.length === 0 && !text.includes('\n') && text.length < 140;
    this.toasts.push(
      own
        ? { id, kind, title: text, hints: [] }
        : { id, kind, title: info.title, why: info.why, detail: text, hints: info.hints },
    );
    // Keep the pile small: the oldest errors make room.
    if (this.toasts.length > 4) this.toasts = this.toasts.slice(-4);
    if (own) setTimeout(() => this.dismiss(id), 7000);
  }

  dismissAll() {
    this.toasts = [];
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const app = new App();
