use super::log::diff_base;
use super::runner::Git;
use serde::{Deserialize, Serialize};

/// Diffs longer than this are cut off; the UI says so.
const MAX_LINES: usize = 8000;

#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiffTarget {
    Commit { sha: String },
    Stash { sha: String },
    Unstaged,
    Staged,
    Untracked,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// ` ` context, `+` added, `-` removed, `\` no-newline marker
    pub kind: String,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// Everything before the first hunk (`diff --git`, `index`, `---`, `+++`).
    pub header: String,
    pub hunks: Vec<Hunk>,
    pub binary: bool,
    pub truncated: bool,
    pub added: u32,
    pub removed: u32,
}

pub fn load(
    repo: &str,
    target: &DiffTarget,
    path: &str,
    orig_path: Option<&str>,
) -> Result<FileDiff, String> {
    let mut cmd = Git::new(repo).args(["diff", "--no-ext-diff", "-M"]);
    match target {
        DiffTarget::Commit { sha } => {
            cmd = cmd.arg(diff_base(repo, sha)).arg(sha.as_str());
        }
        DiffTarget::Stash { sha } => {
            let detail = super::log::stash_detail(repo, sha)?;
            let untracked = detail.parents.get(2).filter(|parent| {
                super::runner::git(repo, &["cat-file", "-e", &format!("{parent}:{path}")]).is_ok()
            });
            cmd = if let Some(parent) = untracked {
                cmd.arg(super::log::EMPTY_TREE).arg(parent.as_str())
            } else {
                cmd.arg(detail.parents[0].as_str()).arg(detail.id.as_str())
            };
        }
        DiffTarget::Unstaged => {}
        DiffTarget::Staged => cmd = cmd.arg("--cached"),
        DiffTarget::Untracked => {
            let out = Git::new(repo)
                .args(["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", path])
                .allow(1)
                .run()?;
            return Ok(parse(&out.stdout));
        }
    }
    cmd = cmd.arg("--");
    if let Some(orig) = orig_path {
        cmd = cmd.arg(orig);
    }
    let out = cmd.arg(path).run()?;
    Ok(parse(&out.stdout))
}

fn parse_range(s: &str) -> (u32, u32) {
    // "12,5" or "12"
    let s = s.trim_start_matches(['-', '+']);
    match s.split_once(',') {
        Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(0)),
        None => (s.parse().unwrap_or(0), 1),
    }
}

pub fn parse(text: &str) -> FileDiff {
    let mut diff = FileDiff::default();
    let mut header = Vec::new();
    let mut count = 0usize;
    let (mut old_no, mut new_no) = (0u32, 0u32);

    for line in text.split('\n') {
        if line.starts_with("@@ ") {
            // @@ -a,b +c,d @@ context
            let mut parts = line.splitn(5, ' ');
            parts.next();
            let (old_start, old_lines) = parse_range(parts.next().unwrap_or(""));
            let (new_start, new_lines) = parse_range(parts.next().unwrap_or(""));
            old_no = old_start;
            new_no = new_start;
            diff.hunks.push(Hunk {
                header: line.to_string(),
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
            continue;
        }
        let Some(hunk) = diff.hunks.last_mut() else {
            if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
                diff.binary = true;
            }
            if !line.is_empty() {
                header.push(line);
            }
            continue;
        };
        if count >= MAX_LINES {
            diff.truncated = true;
            break;
        }
        let Some(first) = line.chars().next() else {
            // Trailing empty string after the final newline.
            continue;
        };
        let body = &line[first.len_utf8()..];
        let entry = match first {
            '+' => {
                diff.added += 1;
                new_no += 1;
                DiffLine {
                    kind: "+".into(),
                    old_no: None,
                    new_no: Some(new_no - 1),
                    text: body.to_string(),
                }
            }
            '-' => {
                diff.removed += 1;
                old_no += 1;
                DiffLine {
                    kind: "-".into(),
                    old_no: Some(old_no - 1),
                    new_no: None,
                    text: body.to_string(),
                }
            }
            ' ' => {
                old_no += 1;
                new_no += 1;
                DiffLine {
                    kind: " ".into(),
                    old_no: Some(old_no - 1),
                    new_no: Some(new_no - 1),
                    text: body.to_string(),
                }
            }
            '\\' => DiffLine {
                kind: "\\".into(),
                old_no: None,
                new_no: None,
                text: body.trim_start().to_string(),
            },
            _ => continue,
        };
        hunk.lines.push(entry);
        count += 1;
    }
    diff.header = header.join("\n");
    diff
}

/// Builds a patch for one hunk, optionally limited to some of its lines
/// (indexes into `hunk.lines`). `reverse` must be true when the patch will be
/// applied with `git apply --reverse` (unstage, discard): unselected lines
/// then have to match the *new* side of the diff instead of the old one.
pub fn build_patch(
    diff: &FileDiff,
    hunk: usize,
    lines: Option<&[usize]>,
    reverse: bool,
) -> Result<String, String> {
    let h = diff.hunks.get(hunk).ok_or("hunk no longer exists")?;
    let selected = |i: usize| lines.is_none_or(|l| l.contains(&i));

    let mut body = String::new();
    let (mut old, mut new, mut changes) = (0u32, 0u32, 0u32);
    let mut last_kept = false;
    for (i, line) in h.lines.iter().enumerate() {
        let kind = match line.kind.as_str() {
            " " => Some(' '),
            "+" if selected(i) => Some('+'),
            "+" => reverse.then_some(' '),
            "-" if selected(i) => Some('-'),
            "-" => (!reverse).then_some(' '),
            // "\ No newline at end of file" belongs to the line before it.
            _ => {
                if last_kept {
                    body.push_str("\\ ");
                    body.push_str(&line.text);
                    body.push('\n');
                }
                continue;
            }
        };
        last_kept = kind.is_some();
        let Some(kind) = kind else { continue };
        match kind {
            ' ' => {
                old += 1;
                new += 1;
            }
            '+' => {
                new += 1;
                changes += 1;
            }
            _ => {
                old += 1;
                changes += 1;
            }
        }
        body.push(kind);
        body.push_str(&line.text);
        body.push('\n');
    }
    if changes == 0 {
        return Err("No changed lines selected".into());
    }
    Ok(format!(
        "{}\n@@ -{},{} +{},{} @@\n{}",
        diff.header, h.old_start, old, h.new_start, new, body
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "diff --git a/f.txt b/f.txt\nindex 111..222 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,4 @@ fn main\n one\n-two\n+2\n+2.5\n three\n@@ -10 +11 @@\n-x\n+y\n\\ No newline at end of file\n";

    #[test]
    fn parses_hunks_and_line_numbers() {
        let d = parse(SAMPLE);
        assert_eq!(d.hunks.len(), 2);
        assert_eq!((d.added, d.removed), (3, 2));
        assert!(d.header.starts_with("diff --git"));
        assert!(d.header.ends_with("+++ b/f.txt"));

        let h = &d.hunks[0];
        assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (1, 3, 1, 4));
        let nos: Vec<(Option<u32>, Option<u32>)> =
            h.lines.iter().map(|l| (l.old_no, l.new_no)).collect();
        assert_eq!(
            nos,
            vec![
                (Some(1), Some(1)),
                (Some(2), None),
                (None, Some(2)),
                (None, Some(3)),
                (Some(3), Some(4)),
            ]
        );

        let h2 = &d.hunks[1];
        assert_eq!((h2.old_start, h2.old_lines, h2.new_start, h2.new_lines), (10, 1, 11, 1));
        assert_eq!(h2.lines.last().unwrap().kind, "\\");
    }

    #[test]
    fn patch_for_whole_hunk() {
        let d = parse(SAMPLE);
        let p = build_patch(&d, 0, None, false).unwrap();
        assert!(p.starts_with("diff --git a/f.txt b/f.txt\n"));
        assert!(p.contains("\n@@ -1,3 +1,4 @@\n one\n-two\n+2\n+2.5\n three\n"));
    }

    #[test]
    fn patch_for_selected_lines_forward() {
        let d = parse(SAMPLE);
        // only "+2.5" (index 3): "-two" stays as context, "+2" is dropped
        let p = build_patch(&d, 0, Some(&[3]), false).unwrap();
        assert!(p.ends_with("@@ -1,3 +1,4 @@\n one\n two\n+2.5\n three\n"));
    }

    #[test]
    fn patch_for_selected_lines_reverse() {
        let d = parse(SAMPLE);
        // only "+2.5": "-two" is dropped, "+2" stays as context
        let p = build_patch(&d, 0, Some(&[3]), true).unwrap();
        assert!(p.ends_with("@@ -1,3 +1,4 @@\n one\n 2\n+2.5\n three\n"));
    }

    #[test]
    fn patch_keeps_no_newline_marker_and_rejects_empty_selection() {
        let d = parse(SAMPLE);
        let p = build_patch(&d, 1, None, false).unwrap();
        assert!(p.ends_with("-x\n+y\n\\ No newline at end of file\n"));
        assert!(build_patch(&d, 0, Some(&[0]), false).is_err());
        assert!(build_patch(&d, 9, None, false).is_err());
    }

    #[test]
    fn detects_binary() {
        let d = parse("diff --git a/i.png b/i.png\nindex 1..2 100644\nBinary files a/i.png and b/i.png differ\n");
        assert!(d.binary);
        assert!(d.hunks.is_empty());
    }
}
