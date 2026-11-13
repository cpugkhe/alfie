# Contribute to Alfie

## Report a bug or suggest a change

Search existing [issues](https://github.com/cpugkhe/alfie/issues) before opening a
new one. For bugs, include your macOS version, processor architecture, Alfie
commit or version, reproduction steps, and the expected and actual results.

Use a small test repository when possible. Remove credentials, private remote
URLs, personal paths, and confidential diffs from logs and screenshots.
Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Discuss substantial features and platform ports in an issue before implementation.
macOS on Apple Silicon is the current development target.

## Set up a development environment

Follow the [README prerequisites](README.md#1-install-the-prerequisites), fork the
repository, and clone your fork. From its root, run:

```sh
pnpm install --frozen-lockfile
git switch -c your-change
pnpm tauri dev
```

Use `pnpm dev` for a browser preview with synthetic data. Use the desktop app
and a disposable Git repository to test actual Git operations.

## Make a focused change

- Follow the surrounding Rust, TypeScript, and Svelte code.
- Reuse existing helpers and keep dependency additions to a minimum.
- Preserve keyboard navigation, accessibility, and destructive-action confirmations.
- Add a regression test for a bug or a test for new behavior.
- Update the documentation when setup, shortcuts, or user behavior changes.
- Commit lockfile changes with dependency updates. Keep `patches/` files alongside
  the `patchedDependencies` entries that reference them.
- Keep fixtures synthetic. Never commit SSH keys, tokens, session data, or private repositories.

The Rust backend lives in `src-tauri/src/`. Git operations are in
`src-tauri/src/git/`, with integration tests in `src-tauri/tests/ops.rs`.
Frontend components, actions, state, and shortcuts live in `src/lib/`.
Browser demo fixtures live in `src/lib/dev/`.

## Validate your change

Run these commands from the repository root:

```sh
pnpm test
pnpm check
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm build
```

For desktop integration or packaging changes, also build the app:

```sh
pnpm tauri build --bundles app
```

Test affected flows in the desktop app. Exercise Git writes in a disposable
repository, including failure and cancellation paths when relevant.

## Open a pull request

Target `main`. Explain the problem, the resulting behavior, and how you tested
it. Link a related issue and include screenshots for visible interface changes.
Keep unrelated refactors in separate pull requests.

By contributing, you agree to license your contribution under the project's
[MIT license](LICENSE). Submit only code and assets you have permission to share.
