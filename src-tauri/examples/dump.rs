//! Prints what the backend returns for a repository, as JSON.
//! Usage: cargo run --example dump -- <repo path>
use serde_json::json;
use alfie_lib::git::{diff, log, refs, status};

fn main() {
    let repo = std::env::args().nth(1).expect("usage: dump <repo>");
    let status = status::load(&repo).expect("status");
    let refs = refs::load(&repo).expect("refs");
    let page = log::load(&repo, 2000, "all").expect("log");

    let mut details = serde_json::Map::new();
    let mut diffs = serde_json::Map::new();
    for c in page.commits.iter().take(50) {
        let d = log::detail(&repo, &c.id).expect("detail");
        for f in &d.files {
            let target = diff::DiffTarget::Commit { sha: c.id.clone() };
            let fd = diff::load(&repo, &target, &f.path, f.orig_path.as_deref()).expect("diff");
            diffs.insert(format!("commit:{}:{}", c.id, f.path), json!(fd));
        }
        details.insert(c.id.clone(), json!(d));
    }
    for f in &status.files {
        if f.worktree == "?" {
            let fd = diff::load(&repo, &diff::DiffTarget::Untracked, &f.path, None).expect("diff");
            diffs.insert(format!("untracked:{}", f.path), json!(fd));
            continue;
        }
        if f.index != "." {
            let fd = diff::load(&repo, &diff::DiffTarget::Staged, &f.path, None).expect("diff");
            diffs.insert(format!("staged:{}", f.path), json!(fd));
        }
        if f.worktree != "." {
            let fd = diff::load(&repo, &diff::DiffTarget::Unstaged, &f.path, None).expect("diff");
            diffs.insert(format!("unstaged:{}", f.path), json!(fd));
        }
    }
    println!(
        "{}",
        json!({ "status": status, "refs": refs, "log": page, "details": details, "diffs": diffs })
    );
}
