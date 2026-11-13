use super::runner::git;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub orig_path: Option<String>,
    /// Staged state: one of `.MADRCU?`
    pub index: String,
    /// Working tree state: one of `.MADRCU?`
    pub worktree: String,
    pub conflicted: bool,
    pub submodule: bool,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    /// Branch name, or None when HEAD is detached.
    pub branch: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<FileStatus>,
    /// Stopped operation waiting for the user: `merge`, `rebase`,
    /// `cherry-pick` or `revert`.
    pub state: Option<String>,
}

pub fn load(repo: &str) -> Result<RepoStatus, String> {
    let out = git(
        repo,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    )?;
    let mut status = parse(&out);
    status.state = in_progress(repo);
    Ok(status)
}

fn in_progress(repo: &str) -> Option<String> {
    let dir = git(repo, &["rev-parse", "--absolute-git-dir"]).ok()?;
    let dir = std::path::Path::new(dir.trim());
    let has = |name: &str| dir.join(name).exists();
    let state = if has("rebase-merge") || has("rebase-apply") {
        "rebase"
    } else if has("MERGE_HEAD") {
        "merge"
    } else if has("CHERRY_PICK_HEAD") {
        "cherry-pick"
    } else if has("REVERT_HEAD") {
        "revert"
    } else {
        return None;
    };
    Some(state.to_string())
}

pub fn parse(out: &str) -> RepoStatus {
    let mut st = RepoStatus::default();
    let mut tokens = out.split('\0');
    while let Some(tok) = tokens.next() {
        if tok.is_empty() {
            continue;
        }
        if let Some(header) = tok.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => st.oid = Some(value.to_string()),
                "branch.head" if value != "(detached)" => st.branch = Some(value.to_string()),
                "branch.upstream" => st.upstream = Some(value.to_string()),
                "branch.ab" => {
                    for part in value.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            st.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            st.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let kind = tok.as_bytes()[0];
        match kind {
            b'1' => {
                // 1 XY sub mH mI mW hH hI path
                let f: Vec<&str> = tok.splitn(9, ' ').collect();
                if f.len() == 9 {
                    st.files.push(entry(f[1], f[2], f[8], None, false));
                }
            }
            b'2' => {
                // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
                let f: Vec<&str> = tok.splitn(10, ' ').collect();
                let orig = tokens.next();
                if f.len() == 10 {
                    st.files
                        .push(entry(f[1], f[2], f[9], orig.map(str::to_string), false));
                }
            }
            b'u' => {
                // u XY sub m1 m2 m3 mW h1 h2 h3 path
                let f: Vec<&str> = tok.splitn(11, ' ').collect();
                if f.len() == 11 {
                    st.files.push(entry(f[1], f[2], f[10], None, true));
                }
            }
            b'?' => {
                if let Some(path) = tok.strip_prefix("? ") {
                    st.files.push(FileStatus {
                        path: path.to_string(),
                        orig_path: None,
                        index: ".".into(),
                        worktree: "?".into(),
                        conflicted: false,
                        submodule: false,
                    });
                }
            }
            _ => {}
        }
    }
    st
}

fn entry(xy: &str, sub: &str, path: &str, orig_path: Option<String>, conflicted: bool) -> FileStatus {
    let mut chars = xy.chars();
    FileStatus {
        path: path.to_string(),
        orig_path,
        index: chars.next().unwrap_or('.').to_string(),
        worktree: chars.next().unwrap_or('.').to_string(),
        conflicted,
        submodule: sub.starts_with('S'),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_headers_and_entries() {
        let out = concat!(
            "# branch.oid 1234abcd\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 .M N... 100644 100644 100644 aaa bbb src/lib.rs\0",
            "1 A. N... 000000 100644 100644 000 ccc new file.txt\0",
            "2 R. N... 100644 100644 100644 ddd eee R100 after.md\0before.md\0",
            "u UU N... 100644 100644 100644 100644 f1 f2 f3 clash.rs\0",
            "? notes/todo.txt\0",
        );
        let st = parse(out);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(st.files.len(), 5);
        assert_eq!(st.files[0].worktree, "M");
        assert_eq!(st.files[0].index, ".");
        assert_eq!(st.files[1].path, "new file.txt");
        assert_eq!(st.files[2].path, "after.md");
        assert_eq!(st.files[2].orig_path.as_deref(), Some("before.md"));
        assert!(st.files[3].conflicted);
        assert_eq!(st.files[4].worktree, "?");
    }

    #[test]
    fn detached_and_initial() {
        let st = parse("# branch.oid (initial)\0# branch.head (detached)\0");
        assert_eq!(st.oid, None);
        assert_eq!(st.branch, None);
    }

    #[test]
    fn identifies_submodules_even_when_only_their_contents_are_dirty() {
        let st = parse(concat!(
            "1 .M SC.. 160000 160000 160000 aaa aaa module\0",
            "1 .M S.MU 160000 160000 160000 bbb bbb dirty module\0",
            "1 M. N... 100644 100644 100644 ccc ddd file.txt\0",
        ));
        assert!(st.files[0].submodule);
        assert!(st.files[1].submodule);
        assert!(!st.files[2].submodule);
    }
}
