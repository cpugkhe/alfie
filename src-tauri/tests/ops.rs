//! End-to-end tests of write operations against real `git` in temp repos.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use alfie_lib::git::{diff, log, ops, refs, status};

static N: AtomicU32 = AtomicU32::new(0);

struct Repo(PathBuf);

impl Repo {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "alfie-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = Repo(dir);
        repo.sh(&["init", "-q", "-b", "main"]);
        repo.sh(&["config", "user.name", "Test"]);
        repo.sh(&["config", "user.email", "test@example.com"]);
        repo.sh(&["config", "commit.gpgsign", "false"]);
        repo
    }
    fn path(&self) -> &str {
        self.0.to_str().unwrap()
    }
    fn sh(&self, args: &[&str]) -> String {
        let out = Command::new("git").current_dir(&self.0).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).into_owned()
    }
    fn write(&self, name: &str, content: &str) {
        fs::write(self.0.join(name), content).unwrap();
    }
    fn read(&self, name: &str) -> String {
        fs::read_to_string(self.0.join(name)).unwrap()
    }
    fn commit_all(&self, msg: &str) {
        self.sh(&["add", "-A"]);
        self.sh(&["commit", "-q", "-m", msg]);
    }
}

impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn s(v: &str) -> Vec<String> {
    vec![v.to_string()]
}

#[test]
fn stage_unstage_commit_amend() {
    let r = Repo::new();
    r.write("a.txt", "one\n");
    ops::stage(r.path(), &s("a.txt")).unwrap();
    let st = status::load(r.path()).unwrap();
    assert_eq!(st.files[0].index, "A");

    // Unstaging works before the first commit too.
    ops::unstage(r.path(), &s("a.txt")).unwrap();
    assert_eq!(status::load(r.path()).unwrap().files[0].worktree, "?");

    ops::stage_all(r.path()).unwrap();
    ops::commit(r.path(), "first\n\nbody line", false).unwrap();
    assert_eq!(ops::last_message(r.path()).unwrap(), "first\n\nbody line");
    assert!(status::load(r.path()).unwrap().files.is_empty());

    r.write("a.txt", "one\ntwo\n");
    ops::stage_all(r.path()).unwrap();
    ops::commit(r.path(), "first, amended", true).unwrap();
    let page = log::load(r.path(), 10, "all").unwrap();
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].subject, "first, amended");

    let detail = log::detail(r.path(), &page.commits[0].id).unwrap();
    assert_eq!(detail.files.len(), 1);
    assert_eq!(detail.files[0].status, "A");
}

#[test]
fn discard_tracked_and_untracked() {
    let r = Repo::new();
    r.write("a.txt", "one\n");
    r.commit_all("init");
    r.write("a.txt", "changed\n");
    r.write("junk.txt", "x\n");
    ops::discard(r.path(), &s("a.txt"), &s("junk.txt")).unwrap();
    assert_eq!(r.read("a.txt"), "one\n");
    assert!(!r.0.join("junk.txt").exists());
}

const BASE: &str = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\nl15\nl16\nl17\nl18\nl19\nl20\n";

#[test]
fn stage_single_hunk_then_unstage_it() {
    let r = Repo::new();
    r.write("f.txt", BASE);
    r.commit_all("init");
    // two separate hunks
    r.write("f.txt", &BASE.replace("l2\n", "L2\n").replace("l19\n", "L19\n"));

    let d = diff::load(r.path(), &diff::DiffTarget::Unstaged, "f.txt", None).unwrap();
    assert_eq!(d.hunks.len(), 2);

    ops::apply_hunk(r.path(), "f.txt", 1, None, "stage").unwrap();
    let staged = r.sh(&["diff", "--cached"]);
    assert!(staged.contains("+L19") && !staged.contains("+L2\n"));
    let unstaged = r.sh(&["diff"]);
    assert!(unstaged.contains("+L2") && !unstaged.contains("+L19"));

    ops::apply_hunk(r.path(), "f.txt", 0, None, "unstage").unwrap();
    assert_eq!(r.sh(&["diff", "--cached"]), "");
}

#[test]
fn stage_selected_lines_only() {
    let r = Repo::new();
    r.write("f.txt", "a\nb\nc\n");
    r.commit_all("init");
    r.write("f.txt", "a\nB1\nB2\nc\nd\n");

    let d = diff::load(r.path(), &diff::DiffTarget::Unstaged, "f.txt", None).unwrap();
    let lines = &d.hunks[0].lines;
    let b2 = lines.iter().position(|l| l.kind == "+" && l.text == "B2").unwrap();

    // Stage only the added "B2" line: index becomes a, b, B2, c.
    ops::apply_hunk(r.path(), "f.txt", 0, Some(&[b2]), "stage").unwrap();
    assert_eq!(r.sh(&["show", ":f.txt"]), "a\nb\nB2\nc\n");
    // Working tree is untouched.
    assert_eq!(r.read("f.txt"), "a\nB1\nB2\nc\nd\n");

    // Unstage that one line again.
    let d = diff::load(r.path(), &diff::DiffTarget::Staged, "f.txt", None).unwrap();
    let b2 = d.hunks[0].lines.iter().position(|l| l.text == "B2").unwrap();
    ops::apply_hunk(r.path(), "f.txt", 0, Some(&[b2]), "unstage").unwrap();
    assert_eq!(r.sh(&["show", ":f.txt"]), "a\nb\nc\n");
}

#[test]
fn discard_selected_lines_only() {
    let r = Repo::new();
    r.write("f.txt", "a\nb\nc\n");
    r.commit_all("init");
    r.write("f.txt", "a\nb\nX\nc\nY\n");

    let d = diff::load(r.path(), &diff::DiffTarget::Unstaged, "f.txt", None).unwrap();
    let x = d.hunks[0].lines.iter().position(|l| l.text == "X").unwrap();
    ops::apply_hunk(r.path(), "f.txt", 0, Some(&[x]), "discard").unwrap();
    assert_eq!(r.read("f.txt"), "a\nb\nc\nY\n");
}

#[test]
fn branches_checkout_and_stash() {
    let r = Repo::new();
    r.write("a.txt", "one\n");
    r.commit_all("init");

    ops::create_branch(r.path(), "feature/x", None, true).unwrap();
    assert_eq!(status::load(r.path()).unwrap().branch.as_deref(), Some("feature/x"));

    ops::rename_branch(r.path(), "feature/x", "feature/y").unwrap();
    ops::checkout(r.path(), "main", "local").unwrap();
    ops::create_branch(r.path(), "side", Some("feature/y"), false).unwrap();
    let names: Vec<String> = refs::load(r.path()).unwrap().refs.into_iter().map(|r| r.short).collect();
    assert_eq!(names, vec!["feature/y", "main", "side"]);

    ops::delete_branch(r.path(), "side", false).unwrap();
    assert_eq!(refs::load(r.path()).unwrap().refs.len(), 2);

    // stash round trip, including an untracked file
    r.write("a.txt", "dirty\n");
    r.write("new.txt", "n\n");
    ops::stash_push(r.path(), Some("wip thing"), true).unwrap();
    assert!(status::load(r.path()).unwrap().files.is_empty());
    let stashes = refs::load(r.path()).unwrap().stashes;
    assert_eq!(stashes.len(), 1);
    assert!(stashes[0].message.contains("wip thing"));
    // stash commits must not leak into the graph
    assert_eq!(log::load(r.path(), 50, "all").unwrap().commits.len(), 1);

    ops::stash(r.path(), "stash@{0}", "pop").unwrap();
    assert_eq!(r.read("a.txt"), "dirty\n");
    assert!(r.0.join("new.txt").exists());
    assert!(refs::load(r.path()).unwrap().stashes.is_empty());

    // detached checkout
    let head = log::head_oid(r.path()).unwrap();
    ops::discard(r.path(), &s("a.txt"), &s("new.txt")).unwrap();
    ops::checkout(r.path(), &head, "commit").unwrap();
    assert_eq!(status::load(r.path()).unwrap().branch, None);
}

#[test]
fn push_fetch_pull_between_local_remotes() {
    let origin = Repo::new();
    origin.sh(&["config", "receive.denyCurrentBranch", "ignore"]);
    origin.write("a.txt", "one\n");
    origin.commit_all("init");

    let r = Repo::new();
    r.sh(&["remote", "add", "origin", origin.path()]);
    ops::fetch(r.path()).unwrap();
    ops::checkout(r.path(), "origin/main", "remote").unwrap();
    let st = status::load(r.path()).unwrap();
    assert_eq!(st.branch.as_deref(), Some("main"));
    assert_eq!(st.upstream.as_deref(), Some("origin/main"));

    // new branch without upstream: push sets it
    ops::create_branch(r.path(), "topic", None, true).unwrap();
    r.write("b.txt", "b\n");
    r.commit_all("topic work");
    ops::push(r.path(), false).unwrap();
    let st = status::load(r.path()).unwrap();
    assert_eq!(st.upstream.as_deref(), Some("origin/topic"));
    assert_eq!((st.ahead, st.behind), (0, 0));

    // remote moves ahead; pull fast-forwards
    origin.sh(&["checkout", "-q", "topic"]);
    origin.write("c.txt", "c\n");
    origin.commit_all("remote work");
    ops::fetch(r.path()).unwrap();
    assert_eq!(status::load(r.path()).unwrap().behind, 1);
    ops::pull(r.path()).unwrap();
    assert!(r.0.join("c.txt").exists());
}

#[test]
fn profile_identity_is_used_for_commits_without_touching_config() {
    use std::collections::HashMap;
    use alfie_lib::profiles::{self, Profile, Store};

    let r = Repo::new();
    r.write("a.txt", "one\n");
    profiles::save(Store {
        profiles: vec![Profile {
            id: "work".into(),
            name: "Work".into(),
            user_name: "Ada Work".into(),
            user_email: "ada@acme.io".into(),
            ..Default::default()
        }],
        bindings: HashMap::from([(r.path().to_string(), "work".to_string())]),
    })
    .unwrap();

    ops::stage_all(r.path()).unwrap();
    ops::commit(r.path(), "with profile", false).unwrap();
    assert_eq!(r.sh(&["log", "-1", "--format=%an <%ae> / %cn <%ce>"]).trim(),
        "Ada Work <ada@acme.io> / Ada Work <ada@acme.io>");
    // The repository's own config is left alone.
    assert_eq!(r.sh(&["config", "user.email"]).trim(), "test@example.com");
}

#[test]
fn soft_reset_undoes_and_redoes_a_commit() {
    let r = Repo::new();
    r.write("a.txt", "one\n");
    r.commit_all("first");
    let before = log::head_oid(r.path()).unwrap();
    r.write("a.txt", "two\n");
    r.commit_all("second");
    let after = log::head_oid(r.path()).unwrap();

    ops::reset(r.path(), &before, "soft").unwrap();
    assert_eq!(log::head_oid(r.path()).unwrap(), before);
    // The undone commit's changes are still there, staged.
    assert_eq!(status::load(r.path()).unwrap().files[0].index, "M");

    ops::reset(r.path(), &after, "soft").unwrap();
    assert_eq!(log::head_oid(r.path()).unwrap(), after);
    assert!(status::load(r.path()).unwrap().files.is_empty());
    assert!(ops::reset(r.path(), &before, "bogus").is_err());
}

#[test]
fn stash_message_can_be_edited_without_losing_content() {
    let r = Repo::new();
    r.write("a.txt", "one\n");
    r.commit_all("init");
    r.write("a.txt", "older\n");
    ops::stash_push(r.path(), Some("older"), false).unwrap();
    r.write("a.txt", "newer\n");
    ops::stash_push(r.path(), Some("newer"), false).unwrap();

    // Rename the older one (stash@{1}).
    let list = refs::load(r.path()).unwrap().stashes;
    let old = list.iter().find(|s| s.message.contains("older")).unwrap();
    assert_eq!(old.name, "stash@{1}");
    assert!(ops::stash_rename(r.path(), &old.name, "0000", "x").is_err());
    ops::stash_rename(r.path(), &old.name, &old.id, "On main: renamed").unwrap();

    let list = refs::load(r.path()).unwrap().stashes;
    assert_eq!(list.len(), 2);
    let renamed = list.iter().find(|s| s.message == "On main: renamed").unwrap();
    assert_eq!(renamed.id, old.id);
    assert!(list.iter().any(|s| s.message.contains("newer")));

    ops::stash(r.path(), &renamed.name, "pop").unwrap();
    assert_eq!(r.read("a.txt"), "older\n");
}

/// main: init, m1 ; topic (from init): t1
fn forked() -> Repo {
    let r = Repo::new();
    r.write("a.txt", "one\n");
    r.commit_all("init");
    r.sh(&["checkout", "-q", "-b", "topic"]);
    r.write("t.txt", "t\n");
    r.commit_all("t1");
    r.sh(&["checkout", "-q", "main"]);
    r.write("m.txt", "m\n");
    r.commit_all("m1");
    r
}

#[test]
fn merge_creates_merge_commit() {
    let r = forked();
    ops::merge(r.path(), "topic").unwrap();
    assert!(r.0.join("t.txt").exists());
    let page = log::load(r.path(), 10, "current").unwrap();
    assert_eq!(page.commits[0].parents.len(), 2);
    assert_eq!(status::load(r.path()).unwrap().state, None);
}

#[test]
fn rebase_replays_branch_linearly() {
    let r = forked();
    ops::checkout(r.path(), "topic", "local").unwrap();
    ops::rebase(r.path(), "main").unwrap();
    let subjects: Vec<String> = log::load(r.path(), 10, "current")
        .unwrap()
        .commits
        .into_iter()
        .map(|c| c.subject)
        .collect();
    assert_eq!(subjects, vec!["t1", "m1", "init"]);
}

#[test]
fn cherry_pick_and_revert() {
    let r = forked();
    let t1 = r.sh(&["rev-parse", "topic"]).trim().to_string();
    ops::pick(r.path(), &t1, false).unwrap();
    assert!(r.0.join("t.txt").exists());
    let head = log::head_oid(r.path()).unwrap();
    ops::pick(r.path(), &head, true).unwrap();
    assert!(!r.0.join("t.txt").exists());
    assert!(log::load(r.path(), 1, "current").unwrap().commits[0].subject.starts_with("Revert"));
}

#[test]
fn conflict_stops_reports_state_and_can_abort_or_continue() {
    let r = Repo::new();
    r.write("a.txt", "base\n");
    r.commit_all("init");
    r.sh(&["checkout", "-q", "-b", "topic"]);
    r.write("a.txt", "topic\n");
    r.commit_all("topic change");
    r.sh(&["checkout", "-q", "main"]);
    r.write("a.txt", "main\n");
    r.commit_all("main change");

    // merge: stop, abort
    assert!(ops::merge(r.path(), "topic").is_err());
    let st = status::load(r.path()).unwrap();
    assert_eq!(st.state.as_deref(), Some("merge"));
    assert!(st.files.iter().any(|f| f.conflicted));
    ops::sequence(r.path(), "merge", "abort").unwrap();
    assert_eq!(status::load(r.path()).unwrap().state, None);
    assert_eq!(r.read("a.txt"), "main\n");

    // rebase: stop, resolve, continue (must not wait for an editor)
    ops::checkout(r.path(), "topic", "local").unwrap();
    assert!(ops::rebase(r.path(), "main").is_err());
    assert_eq!(status::load(r.path()).unwrap().state.as_deref(), Some("rebase"));
    r.write("a.txt", "resolved\n");
    ops::stage(r.path(), &s("a.txt")).unwrap();
    ops::sequence(r.path(), "rebase", "continue").unwrap();
    assert_eq!(status::load(r.path()).unwrap().state, None);
    assert_eq!(r.read("a.txt"), "resolved\n");
    assert!(ops::sequence(r.path(), "merge", "skip").is_err());
}

#[test]
fn tags_create_delete_push() {
    let origin = Repo::new();
    origin.write("a.txt", "one\n");
    origin.commit_all("init");
    let r = Repo::new();
    r.sh(&["remote", "add", "origin", origin.path()]);
    ops::fetch(r.path()).unwrap();
    ops::checkout(r.path(), "origin/main", "remote").unwrap();
    let head = log::head_oid(r.path()).unwrap();

    ops::create_tag(r.path(), "v1", &head, None).unwrap();
    ops::create_tag(r.path(), "v2", &head, Some("release two")).unwrap();
    let tags: Vec<_> = refs::load(r.path()).unwrap().refs.into_iter().filter(|x| x.kind == "tag").collect();
    assert_eq!(tags.len(), 2);
    // annotated tags are peeled to the commit
    assert!(tags.iter().all(|t| t.target == head));
    assert_eq!(r.sh(&["cat-file", "-t", "v2"]).trim(), "tag");

    ops::push_tag(r.path(), "v2").unwrap();
    assert!(origin.sh(&["tag"]).contains("v2"));
    ops::delete_tag(r.path(), "v1").unwrap();
    assert_eq!(r.sh(&["tag"]).trim(), "v2");

    // remove from the remote only
    ops::delete_remote_tag(r.path(), "v2").unwrap();
    assert!(!origin.sh(&["tag"]).contains("v2"));
    assert_eq!(r.sh(&["tag"]).trim(), "v2");
    // deleting one that is not there is an error, not a silent success
    assert!(ops::delete_remote_tag(r.path(), "v2").is_err());
}

/// origin with one commit on main, and a clone-like repo tracking it.
fn with_origin() -> (Repo, Repo) {
    let origin = Repo::new();
    origin.sh(&["config", "receive.denyCurrentBranch", "ignore"]);
    origin.write("a.txt", "one\n");
    origin.commit_all("init");
    let r = Repo::new();
    r.sh(&["remote", "add", "origin", origin.path()]);
    ops::fetch(r.path()).unwrap();
    ops::checkout(r.path(), "origin/main", "remote").unwrap();
    (origin, r)
}

#[test]
fn update_branch_fast_forwards_without_checkout() {
    let (origin, r) = with_origin();
    ops::create_branch(r.path(), "feature", None, true).unwrap();
    origin.write("b.txt", "b\n");
    origin.commit_all("remote work");

    // main is not checked out; it still moves forward
    ops::update_branch(r.path(), "main").unwrap();
    assert_eq!(r.sh(&["rev-parse", "main"]), origin.sh(&["rev-parse", "main"]));
    assert_eq!(status::load(r.path()).unwrap().branch.as_deref(), Some("feature"));
    assert!(!r.0.join("b.txt").exists());

    // a branch with its own commits is refused, not rewritten
    ops::checkout(r.path(), "main", "local").unwrap();
    r.write("local.txt", "l\n");
    r.commit_all("local only");
    ops::checkout(r.path(), "feature", "local").unwrap();
    origin.write("c.txt", "c\n");
    origin.commit_all("more remote work");
    let local_main = r.sh(&["rev-parse", "main"]);
    assert!(ops::update_branch(r.path(), "main").is_err());
    assert_eq!(r.sh(&["rev-parse", "main"]), local_main);

    // no upstream: clear error
    assert!(ops::update_branch(r.path(), "feature").unwrap_err().contains("no upstream"));
}

#[test]
fn update_branch_pulls_when_it_is_the_current_one() {
    let (origin, r) = with_origin();
    origin.write("b.txt", "b\n");
    origin.commit_all("remote work");
    ops::update_branch(r.path(), "main").unwrap();
    assert!(r.0.join("b.txt").exists());
}

#[test]
fn base_is_guessed_counted_and_merged_in() {
    let (origin, r) = with_origin();
    // on main itself there is no base
    assert_eq!(ops::base_info(r.path(), None).name, None);

    ops::create_branch(r.path(), "feature", None, true).unwrap();
    r.write("f.txt", "f\n");
    r.commit_all("feature work");
    let info = ops::base_info(r.path(), None);
    assert_eq!(info.name.as_deref(), Some("main"));
    assert_eq!(info.target.as_deref(), Some("origin/main"));
    assert!(info.guessed);
    assert_eq!(info.behind, 0);

    origin.write("b.txt", "b\n");
    origin.commit_all("remote work");
    ops::fetch(r.path()).unwrap();
    assert_eq!(ops::base_info(r.path(), Some("main")).behind, 1);
    assert!(!ops::base_info(r.path(), Some("main")).guessed);

    origin.write("c.txt", "c\n");
    origin.commit_all("newer remote work");
    // fetches the newest base itself, then merges
    ops::update_from_base(r.path(), "main").unwrap();
    assert!(r.0.join("b.txt").exists() && r.0.join("c.txt").exists() && r.0.join("f.txt").exists());
    assert_eq!(ops::base_info(r.path(), Some("main")).behind, 0);
    assert_eq!(status::load(r.path()).unwrap().branch.as_deref(), Some("feature"));
    // local main was moved forward too
    assert_eq!(r.sh(&["rev-parse", "main"]), origin.sh(&["rev-parse", "main"]));
    // a base that is gone falls back to the guess
    assert_eq!(ops::base_info(r.path(), Some("nope")).name.as_deref(), Some("main"));
}
