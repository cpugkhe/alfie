use super::graph::{self, GraphRow};
use super::runner::{git, Git};
use serde::Serialize;

pub const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const FIELD: char = '\x1f';
const RECORD: char = '\x1e';

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub id: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub subject: String,
    pub graph: GraphRow,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<Commit>,
    pub has_more: bool,
    pub head: Option<String>,
}

pub fn head_oid(repo: &str) -> Option<String> {
    git(repo, &["rev-parse", "--verify", "-q", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `scope`: "all" (every branch, remote and tag), "local" (no remote-only
/// branches) or "current" (HEAD only).
pub fn load(repo: &str, limit: usize, scope: &str) -> Result<LogPage, String> {
    let Some(head) = head_oid(repo) else {
        return Ok(LogPage {
            commits: vec![],
            has_more: false,
            head: None,
        });
    };

    let mut cmd = Git::new(repo).args([
        "log".to_string(),
        "--date-order".to_string(),
        format!("--max-count={}", limit + 1),
        "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1e".to_string(),
    ]);
    cmd = match scope {
        "current" => cmd.arg("HEAD"),
        "local" => cmd.args(["--branches", "--tags", "HEAD"]),
        _ => cmd.args(["--exclude=refs/stash", "--all", "HEAD"]),
    };
    let out = cmd.arg("--").run()?.stdout;

    let mut commits = parse(&out);
    let has_more = commits.len() > limit;
    commits.truncate(limit);

    let rows = {
        let input: Vec<(&str, Vec<&str>)> = commits
            .iter()
            .map(|c| (c.id.as_str(), c.parents.iter().map(String::as_str).collect()))
            .collect();
        graph::layout(&input, Some(&head))
    };
    for (c, row) in commits.iter_mut().zip(rows) {
        c.graph = row;
    }

    Ok(LogPage {
        commits,
        has_more,
        head: Some(head),
    })
}

fn parse(out: &str) -> Vec<Commit> {
    out.split(RECORD)
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                return None;
            }
            let mut f = rec.split(FIELD);
            Some(Commit {
                id: f.next()?.to_string(),
                parents: f
                    .next()?
                    .split_whitespace()
                    .map(str::to_string)
                    .collect(),
                author: f.next()?.to_string(),
                email: f.next()?.to_string(),
                time: f.next()?.parse().unwrap_or(0),
                subject: f.next().unwrap_or("").to_string(),
                graph: GraphRow::default(),
            })
        })
        .collect()
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub status: String,
    pub path: String,
    pub orig_path: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub id: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    pub message: String,
    pub files: Vec<FileChange>,
}

/// The commit a diff of `sha` is taken against: first parent, or the empty tree.
pub fn diff_base(repo: &str, sha: &str) -> String {
    git(repo, &["rev-parse", "--verify", "-q", &format!("{sha}^1")])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| EMPTY_TREE.to_string())
}

pub fn detail(repo: &str, sha: &str) -> Result<CommitDetail, String> {
    let meta = git(
        repo,
        &[
            "show",
            "-s",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B",
            sha,
            "--",
        ],
    )?;
    let mut f = meta.splitn(9, FIELD);
    let mut next = || f.next().unwrap_or("").to_string();
    let id = next();
    let parents = next().split_whitespace().map(str::to_string).collect();
    let author = next();
    let email = next();
    let time = next().parse().unwrap_or(0);
    let committer = next();
    let committer_email = next();
    let commit_time = next().parse().unwrap_or(0);
    let message = next().trim_end().to_string();

    let base = diff_base(repo, sha);
    let names = git(
        repo,
        &["diff", "--name-status", "-z", "-M", &base, sha, "--"],
    )?;

    Ok(CommitDetail {
        id,
        parents,
        author,
        email,
        time,
        committer,
        committer_email,
        commit_time,
        message,
        files: parse_name_status(&names),
    })
}

pub fn parse_name_status(out: &str) -> Vec<FileChange> {
    let mut tokens = out.split('\0').filter(|t| !t.is_empty());
    let mut files = Vec::new();
    while let Some(status) = tokens.next() {
        let letter = status.chars().next().unwrap_or('M');
        if letter == 'R' || letter == 'C' {
            let (Some(orig), Some(path)) = (tokens.next(), tokens.next()) else {
                break;
            };
            files.push(FileChange {
                status: letter.to_string(),
                path: path.to_string(),
                orig_path: Some(orig.to_string()),
            });
        } else {
            let Some(path) = tokens.next() else { break };
            files.push(FileChange {
                status: letter.to_string(),
                path: path.to_string(),
                orig_path: None,
            });
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let out = "aaa\x1fbbb ccc\x1fAda\x1fada@x.io\x1f1700000000\x1fmerge: things\x1e\nbbb\x1f\x1fBob\x1fb@x.io\x1f1699999999\x1finit\x1e\n";
        let commits = parse(out);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].parents, vec!["bbb", "ccc"]);
        assert_eq!(commits[0].subject, "merge: things");
        assert!(commits[1].parents.is_empty());
        assert_eq!(commits[1].time, 1699999999);
    }

    #[test]
    fn parses_name_status_with_renames() {
        let out = "M\0src/a.rs\0R087\0old.txt\0new.txt\0A\0b c.md\0";
        let files = parse_name_status(out);
        assert_eq!(files.len(), 3);
        assert_eq!(files[1].status, "R");
        assert_eq!(files[1].path, "new.txt");
        assert_eq!(files[1].orig_path.as_deref(), Some("old.txt"));
        assert_eq!(files[2].path, "b c.md");
    }
}
