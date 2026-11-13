//! Commands that change the repository.

use super::diff::{self, DiffTarget};
use super::runner::{git, Git};

/// A write command, run with the repository's profile (SSH key, identity).
fn w(repo: &str) -> Git {
    // No command may open an editor: there is no terminal to show it in.
    let mut cmd = Git::new(repo).write().env("GIT_EDITOR", "true");
    for (key, value) in crate::profiles::env_for(repo) {
        cmd = cmd.env(key, value);
    }
    cmd
}

/// Clones `url` into `dest` using whichever profile's rules match the URL.
pub fn clone(url: &str, dest: &str) -> Result<(), String> {
    let parent = std::path::Path::new(dest)
        .parent()
        .ok_or("invalid destination")?;
    let mut cmd = Git::new(parent).write().args(["clone", "-q", "--", url, dest]);
    let store = crate::profiles::load();
    if let Some(profile) = crate::profiles::match_remote(&store, url) {
        if let Some(ssh) = crate::profiles::ssh_command(profile) {
            cmd = cmd.env("GIT_SSH_COMMAND", ssh);
        }
    }
    done(cmd.run())
}

fn done(res: Result<super::runner::Output, String>) -> Result<(), String> {
    res.map(|_| ())
}

fn has_head(repo: &str) -> bool {
    super::log::head_oid(repo).is_some()
}

// ---------- index ----------

pub fn stage(repo: &str, paths: &[String]) -> Result<(), String> {
    done(w(repo).args(["add", "-A", "--"]).args(paths).run())
}

pub fn unstage(repo: &str, paths: &[String]) -> Result<(), String> {
    let cmd = if has_head(repo) {
        w(repo).args(["restore", "--staged", "--"])
    } else {
        w(repo).args(["rm", "-r", "-q", "--cached", "--"])
    };
    done(cmd.args(paths).run())
}

pub fn stage_all(repo: &str) -> Result<(), String> {
    done(w(repo).args(["add", "-A"]).run())
}

pub fn unstage_all(repo: &str) -> Result<(), String> {
    if has_head(repo) {
        done(w(repo).args(["reset", "-q"]).run())
    } else {
        done(w(repo).args(["rm", "-r", "-q", "--cached", "."]).run())
    }
}

/// Throws away unstaged changes. Untracked files are deleted.
pub fn discard(repo: &str, tracked: &[String], untracked: &[String]) -> Result<(), String> {
    if !tracked.is_empty() {
        let index = Git::new(repo).args(["ls-files", "--stage", "-z", "--"]).args(tracked).run()?.stdout;
        let submodules: Vec<&str> = index.split('\0')
            .filter(|entry| entry.starts_with("160000 "))
            .filter_map(|entry| entry.split_once('\t').map(|(_, path)| path))
            .collect();
        for path in &submodules {
            let sub = std::path::Path::new(repo).join(path);
            if sub.join(".git").exists()
                && !git(&sub, &["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"])?.is_empty()
            {
                return Err(format!("{path} has local changes inside the submodule. Open that submodule as a repository and commit, stash, or discard them there first."));
            }
        }
        done(w(repo).args(["restore", "--worktree", "--"]).args(tracked).run())?;
        if !submodules.is_empty() {
            done(w(repo).args(["submodule", "update", "--checkout", "--no-fetch", "--"]).args(submodules).run())?;
        }
    }
    if !untracked.is_empty() {
        done(w(repo).args(["clean", "-f", "-q", "--"]).args(untracked).run())?;
    }
    Ok(())
}

/// Stages, unstages or discards one hunk, or only the given lines of it.
/// `action` is `stage`, `unstage` or `discard`.
pub fn apply_hunk(
    repo: &str,
    path: &str,
    hunk: usize,
    lines: Option<&[usize]>,
    action: &str,
) -> Result<(), String> {
    if super::status::load(repo)?.files.iter().any(|file| file.path == path && file.submodule) {
        return Err("Submodule changes must be staged or discarded as a whole from the file list.".into());
    }
    let (target, args): (DiffTarget, &[&str]) = match action {
        "stage" => (DiffTarget::Unstaged, &["--cached"]),
        "unstage" => (DiffTarget::Staged, &["--cached", "--reverse"]),
        "discard" => (DiffTarget::Unstaged, &["--reverse"]),
        other => return Err(format!("unknown action {other}")),
    };
    // Always rebuild from a fresh diff so stale line numbers cannot be applied.
    let file = diff::load(repo, &target, path, None)?;
    let patch = diff::build_patch(&file, hunk, lines, action != "stage")?;
    done(
        w(repo)
            .args(["apply", "--whitespace=nowarn"])
            .args(args.iter().copied())
            .arg("-")
            .stdin(patch)
            .run(),
    )
}

// ---------- commits ----------

pub fn commit(repo: &str, message: &str, amend: bool) -> Result<(), String> {
    let mut cmd = w(repo).args(["commit", "-q", "-F", "-"]);
    if amend {
        cmd = cmd.arg("--amend");
    }
    done(cmd.stdin(message).run())
}

pub fn last_message(repo: &str) -> Result<String, String> {
    git(repo, &["log", "-1", "--format=%B"]).map(|s| s.trim_end().to_string())
}

/// Moves the current branch to `target`. `mode`: soft, mixed, hard or keep.
pub fn reset(repo: &str, target: &str, mode: &str) -> Result<(), String> {
    if !matches!(mode, "soft" | "mixed" | "hard" | "keep") {
        return Err(format!("unknown reset mode {mode}"));
    }
    done(
        w(repo)
            .args(["reset", "-q", &format!("--{mode}"), target, "--"])
            .run(),
    )
}

// ---------- history ----------

pub fn merge(repo: &str, target: &str) -> Result<(), String> {
    done(w(repo).args(["merge", "--no-ff", "--no-edit", "-q", target, "--"]).run())
}

/// Replays the current branch on top of `onto`.
pub fn rebase(repo: &str, onto: &str) -> Result<(), String> {
    done(w(repo).args(["rebase", "-q", onto, "--"]).run())
}

fn is_merge_commit(repo: &str, sha: &str) -> bool {
    git(repo, &["rev-parse", "--verify", "-q", &format!("{sha}^2")]).is_ok()
}

/// `revert` false: cherry-pick `sha` onto HEAD; true: commit its inverse.
/// Merge commits are taken relative to their first parent.
pub fn pick(repo: &str, sha: &str, revert: bool) -> Result<(), String> {
    let mut cmd = w(repo).arg(if revert { "revert" } else { "cherry-pick" });
    if revert {
        cmd = cmd.arg("--no-edit");
    }
    if is_merge_commit(repo, sha) {
        cmd = cmd.args(["-m", "1"]);
    }
    done(cmd.arg(sha).run())
}

/// Continue, skip or abort a stopped merge / rebase / cherry-pick / revert.
pub fn sequence(repo: &str, kind: &str, action: &str) -> Result<(), String> {
    if !matches!(kind, "merge" | "rebase" | "cherry-pick" | "revert") {
        return Err(format!("unknown operation {kind}"));
    }
    if !matches!(action, "continue" | "skip" | "abort") || (kind == "merge" && action == "skip") {
        return Err(format!("cannot {action} a {kind}"));
    }
    done(w(repo).args([kind.to_string(), format!("--{action}")]).run())
}

// ---------- keeping branches current ----------

fn ref_exists(repo: &str, full: &str) -> bool {
    git(repo, &["rev-parse", "--verify", "-q", full]).is_ok()
}

fn current_branch(repo: &str) -> Option<String> {
    git(repo, &["symbolic-ref", "--short", "-q", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `origin/main` → (`origin`, `main`), checked against the real remote names
/// so a branch called `feature/x` on remote `up/stream` splits correctly.
fn split_remote(repo: &str, short: &str) -> Option<(String, String)> {
    let remotes = git(repo, &["remote"]).ok()?;
    remotes
        .lines()
        .filter(|r| short.starts_with(&format!("{r}/")))
        .max_by_key(|r| r.len())
        .map(|r| (r.to_string(), short[r.len() + 1..].to_string()))
}

fn upstream_of(repo: &str, branch: &str) -> Option<String> {
    git(repo, &["rev-parse", "--abbrev-ref", &format!("{branch}@{{u}}")])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Brings a branch up to date with its upstream, fast-forward only, without
/// needing to check it out. `name` is a local branch or a remote one
/// (`origin/x`), which is simply fetched.
pub fn update_branch(repo: &str, name: &str) -> Result<(), String> {
    if !ref_exists(repo, &format!("refs/heads/{name}")) {
        let (remote, branch) = split_remote(repo, name).ok_or("No such branch")?;
        return done(w(repo).args(["fetch", "-q", &remote, &branch]).run());
    }
    let upstream = upstream_of(repo, name).ok_or_else(|| format!("{name} has no upstream to update from"))?;
    let (remote, branch) = split_remote(repo, &upstream).ok_or("Upstream is not on a remote")?;
    if current_branch(repo).as_deref() == Some(name) {
        return done(w(repo).args(["pull", "--ff-only", "-q", &remote, &branch]).run());
    }
    // Updating a branch that is not checked out: fetch straight into it.
    // Git refuses unless it is a fast-forward, so local commits are safe.
    done(
        w(repo)
            .args(["fetch".to_string(), "-q".to_string(), remote, format!("{branch}:{name}")])
            .run(),
    )
}

#[derive(serde::Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BaseInfo {
    /// Branch the current one is considered to come from, e.g. `main`.
    pub name: Option<String>,
    /// What actually gets merged: the base's upstream when it has one.
    pub target: Option<String>,
    /// Commits on the target that the current branch does not have.
    pub behind: u32,
    /// True when `name` was guessed rather than given.
    pub guessed: bool,
}

/// The repository's main line: what `origin/HEAD` points at, else a
/// conventional name that exists.
fn default_branch(repo: &str) -> Option<String> {
    if let Ok(head) = git(repo, &["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]) {
        let short = head.trim();
        if let Some((_, branch)) = split_remote(repo, short) {
            if ref_exists(repo, &format!("refs/heads/{branch}")) {
                return Some(branch);
            }
            return Some(short.to_string());
        }
    }
    ["main", "master", "develop", "trunk"]
        .into_iter()
        .find(|b| ref_exists(repo, &format!("refs/heads/{b}")))
        .map(str::to_string)
}

fn base_target(repo: &str, base: &str) -> Option<String> {
    if ref_exists(repo, &format!("refs/heads/{base}")) {
        Some(upstream_of(repo, base).filter(|u| ref_exists(repo, &format!("refs/remotes/{u}"))).unwrap_or_else(|| base.to_string()))
    } else if ref_exists(repo, &format!("refs/remotes/{base}")) {
        Some(base.to_string())
    } else {
        None
    }
}

/// Where the current branch stands against its base. `base` None: guess.
pub fn base_info(repo: &str, base: Option<&str>) -> BaseInfo {
    let current = current_branch(repo);
    let (name, guessed) = match base.filter(|b| base_target(repo, b).is_some()) {
        Some(b) => (Some(b.to_string()), false),
        None => (default_branch(repo), true),
    };
    // A branch is never its own base.
    let name = name.filter(|n| Some(n) != current.as_ref());
    let Some(name) = name else { return BaseInfo::default() };
    let target = base_target(repo, &name);
    let behind = target
        .as_ref()
        .and_then(|t| git(repo, &["rev-list", "--count", &format!("HEAD..{t}")]).ok())
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0);
    BaseInfo { name: Some(name), target, behind, guessed }
}

/// Fetches the newest `base`, then merges it into the current branch.
pub fn update_from_base(repo: &str, base: &str) -> Result<(), String> {
    let target = base_target(repo, base).ok_or_else(|| format!("Base branch {base} no longer exists"))?;
    if let Some((remote, branch)) = split_remote(repo, &target) {
        let local_base = ref_exists(repo, &format!("refs/heads/{base}")) && current_branch(repo).as_deref() != Some(base);
        // Also move the local base forward when that is a plain fast-forward;
        // if it is not, a normal fetch still refreshes the remote branch.
        let ff = local_base
            && w(repo)
                .args(["fetch".to_string(), "-q".to_string(), remote.clone(), format!("{branch}:{base}")])
                .run()
                .is_ok();
        if !ff {
            done(w(repo).args(["fetch", "-q", &remote, &branch]).run())?;
        }
    }
    merge(repo, &target)
}

// ---------- tags ----------

/// Lightweight tag, or annotated when `message` is given.
pub fn create_tag(repo: &str, name: &str, target: &str, message: Option<&str>) -> Result<(), String> {
    let cmd = match message.map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) => w(repo).args(["tag", "-a", "-m", m, "--", name, target]),
        None => w(repo).args(["tag", "--", name, target]),
    };
    done(cmd.run())
}

pub fn delete_tag(repo: &str, name: &str) -> Result<(), String> {
    done(w(repo).args(["tag", "-d", "--", name]).run())
}

fn default_remote(repo: &str) -> Result<String, String> {
    let remotes = git(repo, &["remote"])?;
    remotes
        .lines()
        .find(|r| *r == "origin")
        .or_else(|| remotes.lines().next())
        .map(str::to_string)
        .ok_or_else(|| "This repository has no remote".to_string())
}

pub fn push_tag(repo: &str, name: &str) -> Result<(), String> {
    done(
        w(repo)
            .args(["push".to_string(), "-q".to_string(), "origin".to_string(), format!("refs/tags/{name}:refs/tags/{name}")])
            .run(),
    )
}

/// Removes the tag from the default remote; the local tag is left alone.
pub fn delete_remote_tag(repo: &str, name: &str) -> Result<(), String> {
    let remote = default_remote(repo)?;
    // Git reports success when asked to delete a ref that is not there, so
    // look first and say so plainly instead.
    let found = w(repo)
        .args(["ls-remote".to_string(), "--tags".to_string(), remote.clone(), format!("refs/tags/{name}")])
        .run()?;
    if found.stdout.trim().is_empty() {
        return Err(format!("Tag {name} is not on {remote}"));
    }
    done(
        w(repo)
            .args(["push".to_string(), "-q".to_string(), remote, format!(":refs/tags/{name}")])
            .run(),
    )
}

// ---------- branches ----------

pub fn push_branch(repo: &str, name: &str) -> Result<(), String> {
    git(repo, &["check-ref-format", "--branch", name])?;
    done(w(repo).args(["push", "-q", "-u", "origin", &format!("refs/heads/{name}:refs/heads/{name}")]).run())
}

pub fn delete_remote_branch(repo: &str, name: &str) -> Result<(), String> {
    let (remote, branch) = split_remote(repo, name).ok_or("No such remote branch")?;
    git(repo, &["check-ref-format", &format!("refs/heads/{branch}")])?;
    done(w(repo).args(["push", "-q", "--delete", "--", &remote, &format!("refs/heads/{branch}")]).run())?;
    done(w(repo).args(["fetch", "-q", "--prune", "--", &remote]).run())
}

fn auto_stash<T>(repo: &str, destination: &str, switch: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let status = super::status::load(repo)?;
    if status.branch.as_deref() == Some(destination) {
        return switch();
    }
    if status.state.is_some() || status.files.iter().any(|f| f.conflicted) {
        return Err("Finish or abort the current operation before switching branches.".into());
    }
    // A parent stash cannot save worktree changes inside a submodule.
    let parent_changes = |status: &super::status::RepoStatus| {
        status.files.iter().any(|f| !f.submodule || f.index != ".")
    };
    if !parent_changes(&status) {
        return switch();
    }
    let source = status.branch.as_deref().unwrap_or("detached HEAD");
    let message = format!("Alfie auto-stash: {source} → {destination}");
    let before = git(repo, &["rev-parse", "--verify", "-q", "refs/stash"]).ok();
    stash_push(repo, Some(&message), true)?;
    let saved = git(repo, &["rev-parse", "--verify", "-q", "refs/stash"]).ok();
    let stash = saved.filter(|id| Some(id) != before.as_ref());
    let result = super::status::load(repo).and_then(|status| {
        if !parent_changes(&status) {
            switch()
        } else {
            Err("Some project changes could not be stashed.".into())
        }
    });
    result.map_err(|error| match stash {
        Some(id) => format!("{error}\nYour changes are saved in stash {}. Preview or apply it from Stashes.", id.trim()),
        None => error,
    })
}

/// Returns the local tip needing reset approval, without switching branches.
/// Approval is tied to that tip; `reset --keep` protects uncommitted work.
pub fn checkout_remote(repo: &str, name: &str, expected: Option<&str>) -> Result<Option<String>, String> {
    let (remote, branch) = split_remote(repo, name).ok_or("No such remote branch")?;
    git(repo, &["check-ref-format", "--branch", &branch])?;
    let remote_ref = format!("refs/remotes/{name}");
    done(w(repo).args(["fetch", "-q", "--", &remote, &format!("+refs/heads/{branch}:{remote_ref}")]).run())?;
    let target = git(repo, &["rev-parse", "--verify", &remote_ref])?.trim().to_string();
    if !local_exists(repo, &branch) {
        auto_stash(repo, &branch, || done(w(repo).args(["checkout", "-q", "-b", &branch, "--track", &remote_ref, "--"]).run()))?;
        return Ok(None);
    }
    let local_ref = format!("refs/heads/{branch}");
    let before = git(repo, &["rev-parse", "--verify", &local_ref])?.trim().to_string();
    let ahead = git(repo, &["rev-list", "--count", &format!("{target}..{before}")])?;
    if ahead.trim() != "0" && expected != Some(before.as_str()) {
        return Ok(Some(before));
    }
    auto_stash(repo, &branch, || {
        done(w(repo).args(["checkout", "-q", &branch, "--"]).run())?;
        if ahead.trim() == "0" {
            done(w(repo).args(["merge", "--ff-only", "-q", &target, "--"]).run())?;
        } else {
            reset(repo, &target, "keep")?;
        }
        done(w(repo).args(["branch", "--set-upstream-to", &remote_ref, "--", &branch]).run())?;
        Ok(())
    })?;
    Ok(None)
}

fn local_exists(repo: &str, name: &str) -> bool {
    git(
        repo,
        &["rev-parse", "--verify", "-q", &format!("refs/heads/{name}")],
    )
    .is_ok()
}

/// `kind`: `local`, `remote` (checks out a tracking branch) or anything else
/// for a detached checkout of a tag or commit.
pub fn checkout(repo: &str, target: &str, kind: &str) -> Result<(), String> {
    if target.starts_with('-') {
        return Err("Invalid checkout target".into());
    }
    git(repo, &["rev-parse", "--verify", "--end-of-options", &format!("{target}^{{commit}}")])?;
    let cmd = match kind {
        "local" => w(repo).args(["checkout", "-q", target, "--"]),
        "remote" => {
            let local = target.split_once('/').map(|(_, b)| b).unwrap_or(target);
            if local_exists(repo, local) {
                w(repo).args(["checkout", "-q", local, "--"])
            } else {
                w(repo).args(["checkout", "-q", "--track", target, "--"])
            }
        }
        _ => w(repo).args(["checkout", "-q", "--detach", target, "--"]),
    };
    let destination = match kind {
        "local" => target.to_string(),
        "remote" => target.split_once('/').map(|(_, branch)| branch).unwrap_or(target).to_string(),
        _ => format!("{target} (detached)"),
    };
    auto_stash(repo, &destination, || done(cmd.run()))
}

pub fn create_branch(
    repo: &str,
    name: &str,
    start: Option<&str>,
    checkout: bool,
) -> Result<(), String> {
    git(repo, &["check-ref-format", "--branch", name])?;
    let mut cmd = if checkout {
        w(repo).args(["checkout", "-q", "-b", name])
    } else {
        w(repo).args(["branch", name])
    };
    if let Some(start) = start {
        cmd = cmd.arg(start);
    }
    done(cmd.run())
}

pub fn delete_branch(repo: &str, name: &str, force: bool) -> Result<(), String> {
    done(
        w(repo)
            .args(["branch", if force { "-D" } else { "-d" }, name])
            .run(),
    )
}

pub fn rename_branch(repo: &str, old: &str, new: &str) -> Result<(), String> {
    git(repo, &["check-ref-format", "--branch", new])?;
    done(w(repo).args(["branch", "-m", "--", old, new]).run())
}

// ---------- stash ----------

pub fn stash_push(repo: &str, message: Option<&str>, untracked: bool) -> Result<(), String> {
    let mut cmd = w(repo).args(["stash", "push", "-q"]);
    if untracked {
        cmd = cmd.arg("-u");
    }
    if let Some(m) = message.filter(|m| !m.trim().is_empty()) {
        cmd = cmd.args(["-m", m]);
    }
    done(cmd.run())
}

/// `action`: `apply`, `pop` or `drop`.
pub fn stash(repo: &str, name: &str, action: &str) -> Result<(), String> {
    if !matches!(action, "apply" | "pop" | "drop") {
        return Err(format!("unknown stash action {action}"));
    }
    done(w(repo).args(["stash", action, "-q", name]).run())
}

/// Changes a stash's message. Git has no rename, so the same stash commit is
/// stored again under the new message and the old entry dropped. `sha` guards
/// against the list having shifted since the UI read it.
pub fn stash_rename(repo: &str, name: &str, sha: &str, message: &str) -> Result<(), String> {
    let index: usize = name
        .strip_prefix("stash@{")
        .and_then(|s| s.strip_suffix('}'))
        .and_then(|n| n.parse().ok())
        .ok_or("not a stash name")?;
    let message = message.trim();
    if message.is_empty() {
        return Err("Message cannot be empty".into());
    }
    let current = git(repo, &["rev-parse", "--verify", "-q", name])?;
    if current.trim() != sha {
        return Err("The stash list changed; try again".into());
    }
    done(w(repo).args(["stash", "store", "-m", message, sha]).run())?;
    // The new entry is stash@{0}; the old one moved down by one.
    done(
        w(repo)
            .args(["stash", "drop", "-q", &format!("stash@{{{}}}", index + 1)])
            .run(),
    )
}

// ---------- remotes ----------

pub fn fetch(repo: &str) -> Result<(), String> {
    done(w(repo).args(["fetch", "--all", "--prune", "-q"]).run())
}

pub fn pull(repo: &str) -> Result<(), String> {
    done(w(repo).args(["pull", "--no-edit", "-q"]).run())
}

pub fn push(repo: &str, force: bool) -> Result<(), String> {
    let has_upstream = git(repo, &["rev-parse", "--abbrev-ref", "@{u}"]).is_ok();
    let mut cmd = w(repo).args(["push", "-q"]);
    if force {
        cmd = cmd.arg("--force-with-lease");
    }
    if !has_upstream {
        let branch = git(repo, &["symbolic-ref", "--short", "HEAD"])
            .map_err(|_| "HEAD is detached; check out a branch before pushing".to_string())?;
        let remotes = git(repo, &["remote"])?;
        let remote = remotes
            .lines()
            .find(|r| *r == "origin")
            .or_else(|| remotes.lines().next())
            .ok_or("This repository has no remote")?
            .to_string();
        cmd = cmd.args(["-u".to_string(), remote, branch.trim().to_string()]);
    }
    done(cmd.run())
}
