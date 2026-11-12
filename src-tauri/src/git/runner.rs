//! Single place where `git` is spawned. Every call is recorded in an in-memory log
//! so the UI can show exactly what ran.

use serde::Serialize;
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const LOG_CAP: usize = 500;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub repo: String,
    pub command: String,
    pub ok: bool,
    pub ms: u64,
    pub stderr: String,
    pub write: bool,
    pub at: u64,
}

fn log() -> &'static Mutex<(u64, VecDeque<LogEntry>)> {
    static LOG: OnceLock<Mutex<(u64, VecDeque<LogEntry>)>> = OnceLock::new();
    LOG.get_or_init(|| Mutex::new((0, VecDeque::new())))
}

pub fn log_entries(writes_only: bool) -> Vec<LogEntry> {
    let guard = log().lock().unwrap();
    guard
        .1
        .iter()
        .filter(|e| !writes_only || e.write)
        .cloned()
        .collect()
}

pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

pub struct Git {
    repo: PathBuf,
    args: Vec<String>,
    env: Vec<(String, String)>,
    stdin: Option<Vec<u8>>,
    write: bool,
    ok_codes: Vec<i32>,
}

impl Git {
    pub fn new(repo: impl AsRef<Path>) -> Self {
        Git {
            repo: repo.as_ref().to_path_buf(),
            args: Vec::new(),
            env: Vec::new(),
            stdin: None,
            write: false,
            ok_codes: vec![0],
        }
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    #[allow(dead_code)]
    pub fn env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }

    #[allow(dead_code)]
    pub fn stdin(mut self, data: impl Into<Vec<u8>>) -> Self {
        self.stdin = Some(data.into());
        self
    }

    /// Marks the command as one that changes the repository.
    #[allow(dead_code)]
    pub fn write(mut self) -> Self {
        self.write = true;
        self
    }

    /// Treat this exit code as success too (e.g. `diff --no-index` returns 1).
    pub fn allow(mut self, code: i32) -> Self {
        self.ok_codes.push(code);
        self
    }

    pub fn run(self) -> Result<Output, String> {
        let started = Instant::now();
        let mut cmd = Command::new("git");
        cmd.current_dir(&self.repo)
            .args(["-c", "core.quotepath=false", "-c", "color.ui=false"])
            .args(&self.args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if self.stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        if !self.write {
            // Reads must not touch the index, or the file watcher would loop.
            cmd.env("GIT_OPTIONAL_LOCKS", "0");
        }
        for (k, v) in &self.env {
            cmd.env(k, v);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start git: {e}"))?;
        if let Some(data) = &self.stdin {
            if let Some(mut pipe) = child.stdin.take() {
                let _ = pipe.write_all(data);
            }
        }
        let out = child
            .wait_with_output()
            .map_err(|e| format!("git did not finish: {e}"))?;

        let code = out.status.code().unwrap_or(-1);
        let ok = self.ok_codes.contains(&code);
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

        {
            let mut guard = log().lock().unwrap();
            guard.0 += 1;
            let id = guard.0;
            guard.1.push_back(LogEntry {
                id,
                repo: self.repo.to_string_lossy().into_owned(),
                command: format!("git {}", display_args(&self.args)),
                ok,
                ms: started.elapsed().as_millis() as u64,
                stderr: if ok { String::new() } else { stderr.clone() },
                write: self.write,
                at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
            });
            while guard.1.len() > LOG_CAP {
                guard.1.pop_front();
            }
        }

        if !ok {
            return Err(if stderr.is_empty() {
                format!("git exited with code {code}")
            } else {
                stderr
            });
        }
        Ok(Output {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr,
            code,
        })
    }
}

fn display_args(args: &[String]) -> String {
    args.iter()
        .map(|a| {
            let printable: String = a
                .chars()
                .map(|c| if c.is_control() { '·' } else { c })
                .collect();
            if printable.contains(' ') {
                format!("'{printable}'")
            } else {
                printable
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Read-only shortcut returning stdout.
pub fn git(repo: impl AsRef<Path>, args: &[&str]) -> Result<String, String> {
    Git::new(repo)
        .args(args.iter().copied())
        .run()
        .map(|o| o.stdout)
}
