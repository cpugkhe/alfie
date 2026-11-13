# Security and privacy

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/cpugkhe/alfie/security/advisories/new)
to report a security issue. Include reproduction steps, the affected version,
and the likely impact. Do not disclose credentials or private repository content
in a public issue.

## Repository trust

Use a current Git installation. Open only repositories whose local Git
configuration and hooks you trust. Alfie invokes your system Git, which can run
configured hooks and helpers.

Profiles store a private key's path and Git identity in the app configuration
directory. They do not copy the key. Session data includes local repository paths.
Do not share these configuration files without reviewing their contents.

## Network requests

Alfie loads repository owner avatars automatically from GitHub, GitLab, or
Bitbucket. These requests reveal the owner name and, for GitLab, the repository
path to that service. GitLab and Bitbucket API requests omit credentials.
Avatar images omit the referrer. Unknown hosts use initials instead.

Git synchronization contacts your configured remotes using your Git credentials.

When GitHub CLI is installed and authenticated, Alfie also reads open pull
requests for configured github.com remotes using the CLI's existing credentials.
Alfie does not store a separate GitHub token. Clicking a PR link opens GitHub in
your default browser.

The **Connect GitHub** flow runs GitHub CLI's browser sign-in. Alfie displays only
the temporary device code; GitHub CLI handles authorization and credential
storage. Closing the connection panel cancels a pending sign-in.

Repository account choices store usernames only. For a selected account, Alfie
reads its token through GitHub CLI and passes it only to the relevant child
process. Tokens are not sent to the frontend, saved in Alfie's session, or added
to its command log. Account selection does not switch the CLI's shared default.
Adding an account temporarily activates it in GitHub CLI; Alfie restores the
previous default afterward unless another process has changed it in the meantime.

## Known dependency limitations

The project patches `deepmerge@4.3.1` to reject `__proto__` keys in both merge
inputs, addressing GHSA-gcqx-w48m-w2h4. The patch is tracked in `patches/` and
applied by pnpm. Version-based scanners may still report the original version.
Replace the patch with a compatible upstream fix when available.

The cross-platform Rust lockfile contains these upstream advisories outside the
macOS dependency graph:

- `glib`: RUSTSEC-2024-0429, an unsafe iterator implementation.
- `proc-macro-error`: RUSTSEC-2024-0370, unmaintained.
- `zvariant`, `zbus_names`, and `zvariant_derive`: RUSTSEC-2026-0370,
  RUSTSEC-2026-0371, and RUSTSEC-2026-0372, unmaintained standalone crates.

These remain unresolved upstream limitations. Windows and Linux releases are
not currently supported. Reassess the dependency graph before adding a platform.
