//! Profiles: a git identity plus an SSH key, bound per repository.
//!
//! A profile is applied through environment variables on each git command.
//! Nothing is written to the repository's or the user's git config, and the
//! key file is only referenced by path, never copied.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub user_name: String,
    pub user_email: String,
    /// Path to the private key; empty to use ssh's own defaults.
    pub ssh_key: String,
    /// Remote patterns this profile applies to automatically, e.g.
    /// `github.com:acme/*` or just `gitlab.com`.
    pub rules: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Store {
    pub profiles: Vec<Profile>,
    /// Explicit choice per repository path. An empty id means "no profile".
    pub bindings: HashMap<String, String>,
}

struct State {
    store: Store,
    file: Option<PathBuf>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(State {
            store: Store::default(),
            file: None,
        })
    })
}

pub fn init(dir: PathBuf) {
    let file = dir.join("profiles.json");
    let store = fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mut st = state().lock().unwrap();
    st.store = store;
    st.file = Some(file);
}

pub fn load() -> Store {
    state().lock().unwrap().store.clone()
}

pub fn save(store: Store) -> Result<(), String> {
    let mut st = state().lock().unwrap();
    if let Some(file) = &st.file {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = file.with_extension("json.tmp");
        let data = serde_json::to_vec_pretty(&store).map_err(|e| e.to_string())?;
        fs::write(&tmp, data).map_err(|e| e.to_string())?;
        fs::rename(&tmp, file).map_err(|e| e.to_string())?;
    }
    st.store = store;
    Ok(())
}

/// `git@github.com:acme/api.git`, `ssh://git@host:22/acme/api`,
/// `https://github.com/acme/api.git` → `github.com:acme/api`
pub fn normalize_remote(url: &str) -> Option<String> {
    let url = url.trim();
    let (host, path) = if let Some(rest) = url.split_once("://").map(|(_, r)| r) {
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        let host = host.split_once(':').map_or(host, |(h, _)| h);
        (host, path)
    } else {
        let (authority, path) = url.split_once(':')?;
        if authority.contains('/') {
            return None; // a local path
        }
        (authority.rsplit_once('@').map_or(authority, |(_, h)| h), path)
    };
    if host.is_empty() {
        return None;
    }
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    Some(format!("{}:{}", host.to_lowercase(), path))
}

/// Rule forms: `host`, `host:org/*`, `host:org/repo`. Case-insensitive.
pub fn rule_matches(rule: &str, remote: &str) -> bool {
    let rule = rule.trim().to_lowercase();
    let remote = remote.to_lowercase();
    if rule.is_empty() {
        return false;
    }
    let (host, _) = remote.split_once(':').unwrap_or((&remote, ""));
    if !rule.contains(':') {
        return rule == host;
    }
    match rule.strip_suffix('*') {
        Some(prefix) => remote.starts_with(prefix),
        None => rule == remote,
    }
}

pub fn match_remote<'a>(store: &'a Store, url: &str) -> Option<&'a Profile> {
    let remote = normalize_remote(url)?;
    // The most specific (longest) matching rule wins.
    store
        .profiles
        .iter()
        .filter_map(|p| {
            p.rules
                .iter()
                .filter(|r| rule_matches(r, &remote))
                .map(|r| r.trim().len())
                .max()
                .map(|len| (len, p))
        })
        .max_by_key(|(len, _)| *len)
        .map(|(_, p)| p)
}

fn origin_url(repo: &str) -> Option<String> {
    let out = Command::new("git")
        .current_dir(repo)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub profile: Option<Profile>,
    /// Chosen by a rule rather than picked by hand.
    pub auto: bool,
}

/// The profile in effect for a repository: explicit binding, else rule match.
pub fn resolve(repo: &str) -> Resolved {
    let store = load();
    if let Some(id) = store.bindings.get(repo) {
        return Resolved {
            profile: store.profiles.iter().find(|p| &p.id == id).cloned(),
            auto: false,
        };
    }
    let profile = origin_url(repo).and_then(|url| match_remote(&store, &url).cloned());
    Resolved {
        auto: profile.is_some(),
        profile,
    }
}

fn expand_home(path: &str) -> String {
    match (path.strip_prefix("~/"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}/{rest}"),
        _ => path.to_string(),
    }
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// ssh invocation for a profile. BatchMode keeps ssh from blocking on a
/// prompt nobody can see: passphrases must come from the agent or Keychain,
/// and unknown host keys are refused rather than silently accepted.
pub fn ssh_command(profile: &Profile) -> Option<String> {
    let key = profile.ssh_key.trim();
    if key.is_empty() {
        return None;
    }
    let mut cmd = format!(
        "ssh -i {} -o IdentitiesOnly=yes -o BatchMode=yes",
        shell_quote(&expand_home(key))
    );
    if cfg!(target_os = "macos") {
        // IgnoreUnknown keeps a non-Apple ssh from failing on the next two.
        cmd.push_str(" -o IgnoreUnknown=UseKeychain -o UseKeychain=yes -o AddKeysToAgent=yes");
    }
    Some(cmd)
}

pub fn env_of(profile: &Profile) -> Vec<(String, String)> {
    let mut env = Vec::new();
    if let Some(cmd) = ssh_command(profile) {
        env.push(("GIT_SSH_COMMAND".to_string(), cmd));
    }
    if !profile.user_name.trim().is_empty() {
        env.push(("GIT_AUTHOR_NAME".into(), profile.user_name.clone()));
        env.push(("GIT_COMMITTER_NAME".into(), profile.user_name.clone()));
    }
    if !profile.user_email.trim().is_empty() {
        env.push(("GIT_AUTHOR_EMAIL".into(), profile.user_email.clone()));
        env.push(("GIT_COMMITTER_EMAIL".into(), profile.user_email.clone()));
    }
    env
}

/// Environment for write commands in `repo`.
pub fn env_for(repo: &str) -> Vec<(String, String)> {
    resolve(repo).profile.map(|p| env_of(&p)).unwrap_or_default()
}

/// Runs `ssh -T git@host` with the profile's key and returns what the server said.
pub fn test_connection(profile: &Profile, host: &str) -> Result<String, String> {
    let host = host.trim();
    if host.is_empty() || host.starts_with('-') || host.contains(char::is_whitespace) {
        return Err("Enter a host such as github.com".into());
    }
    let mut cmd = Command::new("ssh");
    cmd.args(["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]);
    let key = profile.ssh_key.trim();
    if !key.is_empty() {
        cmd.args(["-i", &expand_home(key), "-o", "IdentitiesOnly=yes"]);
        if cfg!(target_os = "macos") {
            cmd.args(["-o", "IgnoreUnknown=UseKeychain", "-o", "UseKeychain=yes"]);
        }
    }
    let target = if host.contains('@') { host.to_string() } else { format!("git@{host}") };
    let out = cmd.arg(target).output().map_err(|e| format!("could not run ssh: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, rules: &[&str]) -> Profile {
        Profile {
            id: id.into(),
            name: id.into(),
            rules: rules.iter().map(|r| r.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn normalizes_remote_urls() {
        let want = Some("github.com:acme/api".to_string());
        assert_eq!(normalize_remote("git@github.com:acme/api.git"), want);
        assert_eq!(normalize_remote("ssh://git@GitHub.com:22/acme/api.git"), want);
        assert_eq!(normalize_remote("https://github.com/acme/api"), want);
        assert_eq!(normalize_remote("/local/path/repo.git"), None);
        assert_eq!(normalize_remote("../relative"), None);
    }

    #[test]
    fn rules_match_host_org_and_repo() {
        let r = "github.com:acme/api";
        assert!(rule_matches("github.com", r));
        assert!(rule_matches("github.com:acme/*", r));
        assert!(rule_matches("GitHub.com:Acme/API", r));
        assert!(!rule_matches("github.com:other/*", r));
        assert!(!rule_matches("gitlab.com", r));
        assert!(!rule_matches("", r));
    }

    #[test]
    fn most_specific_rule_wins() {
        let store = Store {
            profiles: vec![
                profile("personal", &["github.com"]),
                profile("work", &["github.com:acme/*"]),
            ],
            bindings: HashMap::new(),
        };
        assert_eq!(match_remote(&store, "git@github.com:acme/api.git").unwrap().id, "work");
        assert_eq!(match_remote(&store, "git@github.com:me/dotfiles.git").unwrap().id, "personal");
        assert!(match_remote(&store, "git@bitbucket.org:x/y.git").is_none());
    }

    #[test]
    fn env_carries_key_and_identity() {
        let p = Profile {
            user_name: "Ada".into(),
            user_email: "ada@acme.io".into(),
            ssh_key: "/keys/it's mine".into(),
            ..Default::default()
        };
        let env: HashMap<_, _> = env_of(&p).into_iter().collect();
        let ssh = &env["GIT_SSH_COMMAND"];
        assert!(ssh.starts_with(r"ssh -i '/keys/it'\''s mine' -o IdentitiesOnly=yes -o BatchMode=yes"));
        assert_eq!(env["GIT_AUTHOR_EMAIL"], "ada@acme.io");
        assert_eq!(env["GIT_COMMITTER_NAME"], "Ada");
        // No key, no identity: nothing is overridden.
        assert!(env_of(&Profile::default()).is_empty());
    }
}
