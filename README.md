# Alfie

A minimal, keyboard-first git GUI for macOS. Rust core (Tauri 2) with a Svelte 5 interface.
Named after a tri-colour mini Aussie.

## Run

```sh
pnpm install
pnpm tauri dev      # development
pnpm tauri build    # produces Alfie.app
```

Needs Rust (rustup), Node, pnpm and `git` on the PATH.

## Test

```sh
cd src-tauri && cargo test   # unit tests + real-git integration tests
pnpm check                   # type-check the interface
```

## Layout

- `src-tauri/src/git/` — everything that runs `git` (log, graph lanes, status, diff, write operations)
- `src-tauri/src/profiles.rs` — profiles: SSH key + identity per repository
- `src/lib/keys/` — the keymap; one table drives shortcuts, the command palette and the `?` overlay
- `src/lib/actions.ts` — user-level git actions (confirmations, undo records)
- `src/lib/dev/` — browser preview against a recorded fixture (`pnpm dev`, no Tauri)

Press `?` in the app for the shortcut list, `⌘⇧P` for every command.
