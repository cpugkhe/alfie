//! Optional GitHub metadata, using the user's existing `gh` login.

use super::{refs, runner::git};
use crate::profiles::normalize_remote;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Serialize)]
pub struct PullRequest {
    pub number: u64,
    pub url: String,
}

#[derive(Deserialize)]
struct Pull {
    number: u64,
    head: Head,
}

#[derive(Deserialize)]
struct Head {
    r#ref: String,
    repo: Option<HeadRepo>,
}

#[derive(Deserialize)]
struct HeadRepo {
    full_name: String,
}

fn github_repo(url: &str) -> Option<String> {
    let remote = normalize_remote(url)?;
    // shortcut: github.com only, extend the lookup when another host is supported.
    let path = remote.strip_prefix("github.com:")?;
    let parts: Vec<_> = path.split('/').collect();
    (parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && *p != "."
                && *p != ".."
                && p.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        }))
    .then(|| path.to_string())
}

/// Match the tracked remote branch, including renamed local branches and forks.
fn source<'a>(r: &'a refs::Ref, remotes: &'a BTreeMap<String, String>) -> Option<(&'a str, &'a str)> {
    let name = match r.kind.as_str() {
        "local" => match &r.upstream {
            Some(upstream) => upstream.as_str(),
            None => return remotes.get("origin").map(|repo| (repo.as_str(), r.short.as_str())),
        },
        "remote" => r.short.as_str(),
        _ => return None,
    };
    remotes
        .iter()
        .filter_map(|(remote, repo)| {
            name.strip_prefix(remote.as_str())?
                .strip_prefix('/')
                .map(|branch| (remote.len(), repo.as_str(), branch))
        })
        .max_by_key(|(len, _, _)| *len)
        .map(|(_, repo, branch)| (repo, branch))
}

fn attach(
    out: &mut HashMap<String, PullRequest>,
    refs: &[refs::Ref],
    remotes: &BTreeMap<String, String>,
    base: &str,
    pages: Vec<Vec<Pull>>,
) {
    for pr in pages.into_iter().flatten() {
        let Some(head_repo) = pr.head.repo else {
            continue;
        };
        if pr.number == 0 {
            continue;
        }
        for r in refs {
            if source(r, remotes).is_some_and(|(repo, branch)| {
                repo.eq_ignore_ascii_case(&head_repo.full_name) && branch == pr.head.r#ref
            }) {
                out.entry(r.name.clone()).or_insert_with(|| PullRequest {
                    number: pr.number,
                    url: format!("https://github.com/{base}/pull/{}", pr.number),
                });
            }
        }
    }
}

pub fn load(repo: &str, account: Option<&str>) -> Result<HashMap<String, PullRequest>, String> {
    let mut remotes = BTreeMap::new();
    for name in git(repo, &["remote"])?.lines() {
        let url = git(repo, &["remote", "get-url", "--", name])?;
        if let Some(path) = github_repo(&url) {
            remotes.insert(name.to_string(), path);
        }
    }
    let mut out = HashMap::new();
    if remotes.is_empty() {
        return Ok(out);
    }
    let refs = refs::load(repo)?.refs;
    let gh = crate::github::cli_path().ok_or("PR lookup requires GitHub CLI (gh).")?;
    let repos: std::collections::BTreeSet<_> = remotes.values().collect();
    for base in repos {
        let response = crate::github::account_command(&gh, account)?
            .current_dir(repo)
            .args([
                "api", "--hostname", "github.com", "--method", "GET",
                "--paginate", "--slurp",
                &format!("repos/{base}/pulls?state=open&per_page=100"),
            ])
            .output()
            .map_err(|e| format!("PR lookup requires GitHub CLI (gh): {e}"))?;
        if !response.status.success() {
            return Err(String::from_utf8_lossy(&response.stderr).trim().to_string());
        }
        let pages = serde_json::from_slice(&response.stdout)
            .map_err(|e| format!("Invalid GitHub PR response: {e}"))?;
        attach(&mut out, &refs, &remotes, base, pages);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_github_remotes_without_accepting_paths_or_other_hosts() {
        for url in ["git@github.com:acme/api.git", "https://github.com/acme/api.git", "ssh://git@github.com/acme/api"] {
            assert_eq!(github_repo(url).as_deref(), Some("acme/api"));
        }
        for url in ["/tmp/repo", "git@gitlab.com:acme/api.git", "https://github.com/acme/../api", "https://github.com/acme/api?x=y"] {
            assert_eq!(github_repo(url), None);
        }
    }

    #[test]
    fn attaches_paginated_pulls_by_repository_and_tracking_branch() {
        let refs = refs::parse(concat!(
            "refs/heads/renamed\x1fa\x1f\x1forigin/feature/login\x1f\n",
            "refs/heads/feature/login\x1fa\x1f\x1fupstream/feature/login\x1f\n",
            "refs/heads/unpushed\x1fa\x1f\x1f\x1f\n",
            "refs/remotes/origin/feature/login\x1fa\x1f\x1f\x1f\n",
            "refs/remotes/upstream/feature/login\x1fa\x1f\x1f\x1f\n",
            "refs/tags/feature/login\x1fa\x1f\x1f\x1f\n",
        ));
        let remotes = BTreeMap::from([("origin".into(), "me/api".into()), ("upstream".into(), "acme/api".into())]);
        let pages = serde_json::from_str(r#"[
            [{"number": 4, "head": {"ref": "feature/login", "repo": {"full_name": "ME/api"}}}],
            [{"number": 3, "head": {"ref": "feature/login", "repo": {"full_name": "other/api"}}},
             {"number": 2, "head": {"ref": "feature/login", "repo": null}},
             {"number": 1, "head": {"ref": "unpushed", "repo": {"full_name": "me/api"}}}]
        ]"#).unwrap();
        let mut out = HashMap::new();
        attach(&mut out, &refs, &remotes, "acme/api", pages);
        assert_eq!(out.len(), 3);
        assert_eq!(out["refs/heads/renamed"].url, "https://github.com/acme/api/pull/4");
        assert_eq!(out["refs/remotes/origin/feature/login"].number, 4);
        assert_eq!(out["refs/heads/unpushed"].number, 1);
    }
}
