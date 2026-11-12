use super::runner::git;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ref {
    /// Full name, e.g. `refs/heads/main`.
    pub name: String,
    /// Display name, e.g. `main`, `origin/main`, `v1.0`.
    pub short: String,
    /// `local`, `remote` or `tag`.
    pub kind: String,
    /// Commit the ref points at (tags are peeled).
    pub target: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Upstream is configured but no longer exists.
    pub gone: bool,
    /// Unix time of the commit (or tag) the ref points at.
    pub time: i64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub id: String,
    /// e.g. `stash@{0}`
    pub name: String,
    pub message: String,
    pub time: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RefList {
    pub refs: Vec<Ref>,
    pub stashes: Vec<Stash>,
}

pub fn load(repo: &str) -> Result<RefList, String> {
    let out = git(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(creatordate:unix)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    let refs = parse(&out);

    // `stash list` fails harmlessly when there is no stash ref.
    let stashes = git(repo, &["stash", "list", "--format=%H%x1f%gd%x1f%gs%x1f%ct"])
        .map(|out| {
            out.lines()
                .filter_map(|line| {
                    let mut f = line.split('\x1f');
                    Some(Stash {
                        id: f.next()?.to_string(),
                        name: f.next()?.to_string(),
                        message: f.next()?.to_string(),
                        time: f.next().and_then(|t| t.parse().ok()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(RefList { refs, stashes })
}

pub fn parse(out: &str) -> Vec<Ref> {
    out.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\x1f').collect();
            if f.len() < 5 {
                return None;
            }
            let name = f[0];
            let (kind, short) = if let Some(s) = name.strip_prefix("refs/heads/") {
                ("local", s)
            } else if let Some(s) = name.strip_prefix("refs/remotes/") {
                if s.ends_with("/HEAD") {
                    return None;
                }
                ("remote", s)
            } else if let Some(s) = name.strip_prefix("refs/tags/") {
                ("tag", s)
            } else {
                return None;
            };
            let target = if f[2].is_empty() { f[1] } else { f[2] };
            let (mut ahead, mut behind, mut gone) = (0, 0, false);
            for part in f[4].split(", ") {
                if let Some(n) = part.strip_prefix("ahead ") {
                    ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix("behind ") {
                    behind = n.parse().unwrap_or(0);
                } else if part == "gone" {
                    gone = true;
                }
            }
            Some(Ref {
                name: name.to_string(),
                short: short.to_string(),
                kind: kind.to_string(),
                target: target.to_string(),
                upstream: (!f[3].is_empty()).then(|| f[3].to_string()),
                ahead,
                behind,
                gone,
                time: f.get(5).and_then(|t| t.parse().ok()).unwrap_or(0),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_refs() {
        let out = concat!(
            "refs/heads/main\x1faaa\x1f\x1forigin/main\x1fahead 2, behind 1\x1f1700000000\n",
            "refs/heads/old\x1fbbb\x1f\x1forigin/old\x1fgone\n",
            "refs/remotes/origin/HEAD\x1faaa\x1f\x1f\x1f\n",
            "refs/remotes/origin/main\x1fccc\x1f\x1f\x1f\n",
            "refs/tags/v1\x1ftagobj\x1fddd\x1f\x1f\n",
        );
        let refs = parse(out);
        assert_eq!(refs.len(), 4);
        assert_eq!(refs[0].short, "main");
        assert_eq!((refs[0].ahead, refs[0].behind), (2, 1));
        assert!(refs[1].gone);
        assert_eq!(refs[0].time, 1700000000);
        assert_eq!(refs[1].time, 0);
        assert_eq!(refs[2].kind, "remote");
        assert_eq!(refs[2].short, "origin/main");
        assert_eq!(refs[3].target, "ddd");
    }
}
