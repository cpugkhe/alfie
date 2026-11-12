/**
 * Central keymap. One table of commands drives the key handler, the command
 * palette and the shortcut overlay, so they cannot drift apart.
 *
 * Key syntax: `mod+shift+k` (mod = ⌘), single keys `j`, sequences `g g`.
 */

export type Scope =
  | 'global'
  | 'repo'
  | 'list'
  | 'sidebar'
  | 'graph'
  | 'files'
  | 'diff';

export interface Command {
  id: string;
  title: string;
  keys?: string[];
  scope: Scope;
  /** Still works while a palette is open. */
  overlay?: boolean;
  /** Hide from the command palette (pure navigation keys). */
  hidden?: boolean;
  when?: () => boolean;
  run: () => void;
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'space',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'esc',
  Backspace: 'backspace',
  Delete: 'delete',
  Tab: 'tab',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Home: 'home',
  End: 'end',
};

/** Physical-key based, so `⌘⇧[` is `mod+shift+[` rather than `mod+shift+{`. */
export function comboOf(e: KeyboardEvent): string | null {
  let key: string | undefined;
  if (e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase();
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else key = CODE_KEYS[e.code];
  if (!key) return null;
  let combo = '';
  if (e.metaKey) combo += 'mod+';
  if (e.ctrlKey) combo += 'ctrl+';
  if (e.altKey) combo += 'alt+';
  if (e.shiftKey) combo += 'shift+';
  return combo + key;
}

const SYMBOLS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
  enter: '↵',
  esc: 'esc',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
  space: 'space',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

export function formatKeys(keys: string): string {
  if (keys === 'shift+/') return '?';
  return keys
    .split(' ')
    .map((combo) =>
      combo
        .split('+')
        .map((part) => SYMBOLS[part] ?? (part.length === 1 ? part.toUpperCase() : part))
        .join(''),
    )
    .join(' ');
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export interface KeymapHost {
  commands: () => Command[];
  /** Scopes active right now, most specific first. */
  scopes: () => Scope[];
  overlayOpen: () => boolean;
  /** A dialog owns the keyboard; ignore everything. */
  blocked?: () => boolean;
}

const SEQUENCE_TIMEOUT = 700;

export function installKeymap(host: KeymapHost): () => void {
  let pending = '';
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPending = () => {
    pending = '';
    clearTimeout(pendingTimer);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || host.blocked?.()) return;
    const combo = comboOf(e);
    if (!combo) return;

    const typing = isTyping(e.target);
    const hasMod = e.metaKey || e.ctrlKey;
    if (typing && !hasMod) {
      // Plain keys belong to the text field; Escape leaves it.
      if (combo === 'esc') (e.target as HTMLElement).blur();
      return;
    }

    const overlay = host.overlayOpen();
    const scopes = host.scopes();
    const full = pending ? `${pending} ${combo}` : combo;
    const usable = host
      .commands()
      .filter((c) => c.keys && scopes.includes(c.scope) && (!overlay || c.overlay));

    let best: Command | undefined;
    let bestRank = Infinity;
    let prefix = false;
    for (const c of usable) {
      for (const k of c.keys!) {
        if (k === full) {
          if (c.when && !c.when()) continue;
          const rank = scopes.indexOf(c.scope);
          if (rank < bestRank) {
            best = c;
            bestRank = rank;
          }
        } else if (k.startsWith(full + ' ')) {
          prefix = true;
        }
      }
    }

    if (best) {
      e.preventDefault();
      clearPending();
      best.run();
    } else if (prefix) {
      e.preventDefault();
      pending = full;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(clearPending, SEQUENCE_TIMEOUT);
    } else if (pending) {
      clearPending();
    }
  };

  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    clearPending();
  };
}
