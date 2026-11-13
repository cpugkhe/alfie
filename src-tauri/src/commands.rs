//! Tauri command surface. Everything here runs off the main thread.

use crate::git::{diff, log, ops, refs, runner, status};
use crate::session;
use crate::watcher::Watchers;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
}

#[tauri::command(async)]
pub fn session_load(app: AppHandle) -> Value {
    session::load(&app)
}

#[tauri::command(async)]
pub fn session_save(app: AppHandle, session: Value) -> Result<(), String> {
    session::save(&app, &session)
}

/// Resolves any path inside a work tree to the repository root.
#[tauri::command(async)]
pub fn repo_open(path: String) -> Result<RepoInfo, String> {
    let path = match path.strip_prefix("~/") {
        Some(rest) => match std::env::var("HOME") {
            Ok(home) => format!("{home}/{rest}"),
            Err(_) => path,
        },
        None => path,
    };
    if !Path::new(&path).is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    let root = runner::git(&path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("{path} is not a git repository"))?
        .trim()
        .to_string();
    let name = Path::new(&root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.clone());
    Ok(RepoInfo { path: root, name })
}

#[tauri::command(async)]
pub fn repo_status(repo: String) -> Result<status::RepoStatus, String> {
    status::load(&repo)
}

#[tauri::command(async)]
pub fn repo_refs(repo: String) -> Result<refs::RefList, String> {
    refs::load(&repo)
}

#[tauri::command(async)]
pub fn repo_log(repo: String, limit: usize, scope: String, branch: Option<String>) -> Result<log::LogPage, String> {
    log::load_branch(&repo, limit, &scope, branch.as_deref())
}

#[tauri::command(async)]
pub fn commit_detail(repo: String, sha: String) -> Result<log::CommitDetail, String> {
    log::detail(&repo, &sha)
}

#[tauri::command(async)]
pub fn stash_detail(repo: String, sha: String) -> Result<log::CommitDetail, String> {
    log::stash_detail(&repo, &sha)
}

#[tauri::command(async)]
pub fn diff_file(
    repo: String,
    target: diff::DiffTarget,
    path: String,
    orig_path: Option<String>,
) -> Result<diff::FileDiff, String> {
    diff::load(&repo, &target, &path, orig_path.as_deref())
}

#[tauri::command(async)]
pub fn watch_repo(app: AppHandle, watchers: State<Watchers>, repo: String) -> Result<(), String> {
    watchers.watch(app, repo)
}

#[tauri::command(async)]
pub fn unwatch_repo(watchers: State<Watchers>, repo: String) {
    watchers.unwatch(&repo);
}

#[tauri::command(async)]
pub fn git_log(writes_only: bool) -> Vec<runner::LogEntry> {
    runner::log_entries(writes_only)
}

// ---------- changes ----------

#[tauri::command(async)]
pub fn stage(repo: String, paths: Vec<String>) -> Result<(), String> {
    ops::stage(&repo, &paths)
}

#[tauri::command(async)]
pub fn unstage(repo: String, paths: Vec<String>) -> Result<(), String> {
    ops::unstage(&repo, &paths)
}

#[tauri::command(async)]
pub fn stage_all(repo: String) -> Result<(), String> {
    ops::stage_all(&repo)
}

#[tauri::command(async)]
pub fn unstage_all(repo: String) -> Result<(), String> {
    ops::unstage_all(&repo)
}

#[tauri::command(async)]
pub fn discard(repo: String, tracked: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    ops::discard(&repo, &tracked, &untracked)
}

#[tauri::command(async)]
pub fn apply_hunk(
    repo: String,
    path: String,
    hunk: usize,
    lines: Option<Vec<usize>>,
    action: String,
) -> Result<(), String> {
    ops::apply_hunk(&repo, &path, hunk, lines.as_deref(), &action)
}

#[tauri::command(async)]
pub fn commit(repo: String, message: String, amend: bool) -> Result<(), String> {
    ops::commit(&repo, &message, amend)
}

#[tauri::command(async)]
pub fn last_message(repo: String) -> Result<String, String> {
    ops::last_message(&repo)
}

// ---------- branches, stash, remotes ----------

#[tauri::command(async)]
pub fn checkout(repo: String, target: String, kind: String) -> Result<(), String> {
    ops::checkout(&repo, &target, &kind)
}

#[tauri::command(async)]
pub fn checkout_remote(repo: String, name: String, expected: Option<String>) -> Result<Option<String>, String> {
    ops::checkout_remote(&repo, &name, expected.as_deref())
}

#[tauri::command(async)]
pub fn push_branch(repo: String, name: String) -> Result<(), String> {
    ops::push_branch(&repo, &name)
}

#[tauri::command(async)]
pub fn delete_remote_branch(repo: String, name: String) -> Result<(), String> {
    ops::delete_remote_branch(&repo, &name)
}

#[tauri::command(async)]
pub fn create_branch(
    repo: String,
    name: String,
    start: Option<String>,
    checkout: bool,
) -> Result<(), String> {
    ops::create_branch(&repo, &name, start.as_deref(), checkout)
}

#[tauri::command(async)]
pub fn delete_branch(repo: String, name: String, force: bool) -> Result<(), String> {
    ops::delete_branch(&repo, &name, force)
}

#[tauri::command(async)]
pub fn rename_branch(repo: String, old: String, new: String) -> Result<(), String> {
    ops::rename_branch(&repo, &old, &new)
}

#[tauri::command(async)]
pub fn stash_push(repo: String, message: Option<String>, untracked: bool) -> Result<(), String> {
    ops::stash_push(&repo, message.as_deref(), untracked)
}

#[tauri::command(async)]
pub fn stash_action(repo: String, name: String, action: String) -> Result<(), String> {
    ops::stash(&repo, &name, &action)
}

#[tauri::command(async)]
pub fn fetch(repo: String) -> Result<(), String> {
    ops::fetch(&repo)
}

#[tauri::command(async)]
pub fn pull(repo: String) -> Result<(), String> {
    ops::pull(&repo)
}

#[tauri::command(async)]
pub fn push(repo: String, force: bool) -> Result<(), String> {
    ops::push(&repo, force)
}

// ---------- profiles ----------

#[tauri::command(async)]
pub fn profiles_load() -> crate::profiles::Store {
    crate::profiles::load()
}

#[tauri::command(async)]
pub fn profiles_save(store: crate::profiles::Store) -> Result<(), String> {
    crate::profiles::save(store)
}

#[tauri::command(async)]
pub fn profile_for(repo: String) -> crate::profiles::Resolved {
    crate::profiles::resolve(&repo)
}

#[tauri::command(async)]
pub fn profile_test(profile: crate::profiles::Profile, host: String) -> Result<String, String> {
    crate::profiles::test_connection(&profile, &host)
}

#[tauri::command(async)]
pub fn clone_repo(url: String, dest: String) -> Result<(), String> {
    ops::clone(&url, &dest)
}

#[tauri::command(async)]
pub fn reset(repo: String, target: String, mode: String) -> Result<(), String> {
    ops::reset(&repo, &target, &mode)
}

/// `host:owner/repo` of the origin remote, if there is one.
#[tauri::command(async)]
pub fn repo_remote(repo: String) -> Option<String> {
    runner::git(&repo, &["remote", "get-url", "origin"])
        .ok()
        .and_then(|url| crate::profiles::normalize_remote(&url))
}

#[tauri::command(async)]
pub fn stash_rename(repo: String, name: String, sha: String, message: String) -> Result<(), String> {
    ops::stash_rename(&repo, &name, &sha, &message)
}

// ---------- history edits, tags ----------

#[tauri::command(async)]
pub fn merge(repo: String, target: String) -> Result<(), String> {
    ops::merge(&repo, &target)
}

#[tauri::command(async)]
pub fn rebase(repo: String, onto: String) -> Result<(), String> {
    ops::rebase(&repo, &onto)
}

#[tauri::command(async)]
pub fn pick(repo: String, sha: String, revert: bool) -> Result<(), String> {
    ops::pick(&repo, &sha, revert)
}

#[tauri::command(async)]
pub fn sequence(repo: String, kind: String, action: String) -> Result<(), String> {
    ops::sequence(&repo, &kind, &action)
}

#[tauri::command(async)]
pub fn create_tag(repo: String, name: String, target: String, message: Option<String>) -> Result<(), String> {
    ops::create_tag(&repo, &name, &target, message.as_deref())
}

#[tauri::command(async)]
pub fn delete_tag(repo: String, name: String) -> Result<(), String> {
    ops::delete_tag(&repo, &name)
}

#[tauri::command(async)]
pub fn push_tag(repo: String, name: String) -> Result<(), String> {
    ops::push_tag(&repo, &name)
}

#[tauri::command(async)]
pub fn delete_remote_tag(repo: String, name: String) -> Result<(), String> {
    ops::delete_remote_tag(&repo, &name)
}

// ---------- keeping branches current ----------

#[tauri::command(async)]
pub fn update_branch(repo: String, name: String) -> Result<(), String> {
    ops::update_branch(&repo, &name)
}

#[tauri::command(async)]
pub fn repo_base(repo: String, base: Option<String>) -> ops::BaseInfo {
    ops::base_info(&repo, base.as_deref())
}

#[tauri::command(async)]
pub fn update_from_base(repo: String, base: String) -> Result<(), String> {
    ops::update_from_base(&repo, &base)
}
