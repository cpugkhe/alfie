//! Watches open repositories and tells the UI when something changed.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const QUIET: Duration = Duration::from_millis(300);

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, RecommendedWatcher>>);

fn relevant(path: &Path) -> bool {
    let p = path.to_string_lossy();
    if p.ends_with(".lock") {
        return false;
    }
    if p.contains("/.git/") {
        return !(p.contains("/.git/objects/") || p.contains("/.git/logs/"));
    }
    true
}

impl Watchers {
    pub fn watch(&self, app: AppHandle, repo: String) -> Result<(), String> {
        let mut map = self.0.lock().unwrap();
        if map.contains_key(&repo) {
            return Ok(());
        }

        let (tx, rx) = mpsc::channel::<()>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                if matches!(ev.kind, EventKind::Access(_)) {
                    return;
                }
                if ev.paths.iter().any(|p| relevant(p)) {
                    let _ = tx.send(());
                }
            }
        })
        .map_err(|e| e.to_string())?;
        watcher
            .watch(Path::new(&repo), RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        // Debounce: emit once after events stop for a short while. The thread
        // ends when the watcher (and with it the sender) is dropped.
        let path = repo.clone();
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                loop {
                    match rx.recv_timeout(QUIET) {
                        Ok(()) => continue,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                let _ = app.emit("repo-changed", &path);
            }
        });

        map.insert(repo, watcher);
        Ok(())
    }

    pub fn unwatch(&self, repo: &str) {
        self.0.lock().unwrap().remove(repo);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_git_internals() {
        assert!(relevant(Path::new("/r/src/main.rs")));
        assert!(relevant(Path::new("/r/.git/HEAD")));
        assert!(relevant(Path::new("/r/.git/refs/heads/main")));
        assert!(relevant(Path::new("/r/.git/index")));
        assert!(!relevant(Path::new("/r/.git/index.lock")));
        assert!(!relevant(Path::new("/r/.git/objects/ab/cdef")));
        assert!(!relevant(Path::new("/r/.git/logs/HEAD")));
    }
}
