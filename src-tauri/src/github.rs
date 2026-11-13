//! GitHub CLI setup and account-scoped requests. Tokens never cross the IPC boundary.

use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::ipc::Channel;

pub fn cli_path() -> Option<PathBuf> {
    let mut paths = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .unwrap_or_default();
    // Finder-launched apps do not inherit the user's shell PATH.
    if cfg!(target_os = "macos") {
        paths.extend(["/opt/homebrew/bin".into(), "/usr/local/bin".into()]);
    }
    paths.into_iter().map(|path| path.join("gh")).find(|path| path.is_file())
}

#[derive(Serialize)]
pub struct Account {
    login: String,
    active: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Connection {
    MissingCli,
    SignedOut { accounts: Vec<Account> },
    Connected { login: String, accounts: Vec<Account> },
    Error { message: String, accounts: Vec<Account> },
}

pub fn status(account: Option<&str>) -> Connection {
    let Some(gh) = cli_path() else { return Connection::MissingCli };
    status_with(&gh, account)
}

fn base_command(gh: &Path) -> Command {
    let mut command = Command::new(gh);
    command.env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .env_remove("GH_FORCE_TTY")
        .env_remove("GH_DEBUG")
        .stdin(Stdio::null());
    command
}

fn valid_login(login: &str) -> bool {
    !login.is_empty() && login.len() <= 39
        && login.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        && !login.starts_with('-')
}

/// `GH_TOKEN` applies only to this child, leaving the shared CLI default alone.
pub fn account_command(gh: &Path, account: Option<&str>) -> Result<Command, String> {
    let mut command = base_command(gh);
    if let Some(login) = account {
        if !valid_login(login) { return Err("Invalid GitHub account name.".into()); }
        let token = base_command(gh)
            .env_remove("GH_TOKEN").env_remove("GITHUB_TOKEN")
            .args(["auth", "token", "--hostname", "github.com", "--user", login])
            .output().map_err(|_| "Couldn't read the GitHub account credential.")?;
        if !token.status.success() || token.stdout.trim_ascii().is_empty() {
            return Err(format!("@{login} is no longer signed in. Add the account again."));
        }
        let token = String::from_utf8(token.stdout).map_err(|_| "Invalid GitHub credential.")?;
        command.env_remove("GITHUB_TOKEN").env("GH_TOKEN", token.trim());
    }
    Ok(command)
}

fn accounts_with(gh: &Path) -> Vec<Account> {
    let Ok(out) = base_command(gh)
        .args(["auth", "status", "--hostname", "github.com"])
        .output() else { return Vec::new() };
    parse_accounts(&format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

fn parse_accounts(output: &str) -> Vec<Account> {
    // shortcut: supports gh versions before JSON auth status, update if its text format changes.
    let mut accounts: Vec<Account> = Vec::new();
    let mut current = None;
    for line in output.lines() {
        if let Some(rest) = line.split_once("Logged in to github.com account ").map(|(_, rest)| rest) {
            current = None;
            if rest.contains("(GH_TOKEN)") || rest.contains("(GITHUB_TOKEN)") { continue; }
            if let Some(login) = rest.split_whitespace().next().filter(|login| valid_login(login)) {
                let index = accounts.iter().position(|account| account.login == login).unwrap_or_else(|| {
                    accounts.push(Account { login: login.to_string(), active: false });
                    accounts.len() - 1
                });
                current = Some(index);
            }
        } else if line.contains("Failed to log in to github.com account ") {
            current = None;
        } else if line.contains("Active account: true") {
            if let Some(index) = current { accounts[index].active = true; }
        }
    }
    accounts.sort_by(|a, b| a.login.cmp(&b.login));
    accounts
}

fn status_with(gh: &Path, account: Option<&str>) -> Connection {
    let accounts = accounts_with(gh);
    let Ok(mut command) = account_command(gh, account) else {
        return Connection::SignedOut { accounts };
    };
    match command
        .args(["api", "--hostname", "github.com", "user", "--jq", ".login"])
        .output()
    {
        Ok(out) if out.status.success() => {
            let login = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !login.is_empty() {
                return Connection::Connected { login, accounts };
            }
        }
        Ok(out) if out.status.code() == Some(4)
            || String::from_utf8_lossy(&out.stderr).contains("gh auth login")
            || String::from_utf8_lossy(&out.stderr).contains("HTTP 401") => {
            return Connection::SignedOut { accounts };
        }
        _ => {}
    }
    Connection::Error { message: "Couldn't reach GitHub. Check your connection and try again.".into(), accounts }
}

fn active_user(gh: &Path) -> Option<String> {
    let out = base_command(gh).args(["config", "get", "user", "--host", "github.com"]).output().ok()?;
    let user = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && valid_login(&user)).then_some(user)
}

fn restore_default(gh: &Path, previous: Option<&String>, signed_in: Option<&String>) -> Result<(), String> {
    // gh activates new logins. Restore only if nobody else has changed it since.
    if let (Some(previous), Some(login)) = (previous, signed_in) {
        if previous != login && active_user(gh).as_ref() == Some(login) {
            let restored = base_command(gh)
                .args(["auth", "switch", "--hostname", "github.com", "--user", previous])
                .stdout(Stdio::null()).stderr(Stdio::null()).status()
                .map(|status| status.success()).unwrap_or(false);
            if !restored {
                return Err("Account added, but the previous GitHub CLI default couldn't be restored. Check `gh auth status`.".into());
            }
        }
    }
    Ok(())
}

#[derive(Default)]
pub struct Login(Mutex<Option<Child>>);

impl Login {
    pub fn cancel(&self) -> Result<(), String> {
        if let Some(child) = self.0.lock().unwrap().as_mut() {
            child.kill().map_err(|e| format!("Couldn't stop GitHub sign-in: {e}"))?;
        }
        Ok(())
    }

    pub fn start(&self, on_code: Channel<String>) -> Result<Connection, String> {
        let gh = cli_path().ok_or("Install GitHub CLI to continue.")?;
        self.start_with(&gh, on_code)
    }

    fn start_with(&self, gh: &Path, on_code: Channel<String>) -> Result<Connection, String> {
        let mut guard = self.0.lock().unwrap();
        if guard.is_some() {
            return Err("A GitHub sign-in is already finishing. Try again in a moment.".into());
        }
        let previous = active_user(gh);
        let mut child = base_command(gh)
            .args(["auth", "login", "--hostname", "github.com", "--web", "--skip-ssh-key"])
            .env_remove("GH_TOKEN").env_remove("GITHUB_TOKEN")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Couldn't start GitHub sign-in: {e}"))?;
        let stderr = child.stderr.take().ok_or("Couldn't read GitHub sign-in.")?;
        *guard = Some(child);
        drop(guard);

        let mut signed_in = None;
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else {
                let _ = self.cancel();
                break;
            };
            if let Some(login) = line.split_once("Logged in as ").map(|(_, login)| login.trim()).filter(|login| valid_login(login)) {
                signed_in = Some(login.to_string());
            }
            if let Some(code) = device_code(&line) {
                if on_code.send(code.to_string()).is_err() {
                    let _ = self.cancel();
                    break;
                }
            }
        }
        let mut guard = self.0.lock().unwrap();
        let result = guard.as_mut().ok_or("GitHub sign-in was cancelled.")?.wait();
        let restored = restore_default(gh, previous.as_ref(), signed_in.as_ref());
        *guard = None;
        drop(guard);
        restored?;
        if !result.map_err(|e| e.to_string())?.success() {
            return Err("Sign-in didn't finish. Check your connection and try again.".into());
        }
        let login = signed_in.ok_or("Couldn't identify the signed-in account. Check the connection and try again.")?;
        Ok(status_with(gh, Some(&login)))
    }
}

fn device_code(line: &str) -> Option<&str> {
    // shortcut: gh's plain-text device code output, update this parser if the CLI changes it.
    let code = line.split_once("First copy your one-time code: ")?.1.trim();
    (code.len() == 9 && code.as_bytes()[4] == b'-'
        && code.bytes().enumerate().all(|(i, c)| i == 4 || c.is_ascii_uppercase() || c.is_ascii_digit()))
        .then_some(code)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{atomic::{AtomicU32, Ordering}, mpsc};
    use std::time::Duration;

    struct FakeCli(PathBuf);

    impl FakeCli {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!("alfie-gh-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
            fs::write(&path, r#"#!/bin/sh
case "$1/$2" in
  config/get) cat "$0.active" ;;
  auth/status)
    for user in personal octocat work; do
      echo "Logged in to github.com account $user (keyring)"
      if [ "$user" = "$(cat "$0.active")" ]; then echo 'Active account: true'; fi
    done ;;
  auth/token)
    if [ "$6" = missing ]; then exit 1; fi
    echo "fake-$6" ;;
  auth/login)
    echo '! First copy your one-time code: ABCD-1234' >&2
    if [ -f "$0.wait" ]; then exec /bin/sleep 30; fi
    echo octocat > "$0.active"
    echo 'Logged in as octocat' >&2 ;;
  auth/switch) echo "$6" > "$0.active" ;;
  api/*)
    case "$GH_TOKEN" in
      fake-*) echo "${GH_TOKEN#fake-}" ;;
      *) cat "$0.active" ;;
    esac ;;
esac
"#).unwrap();
            fs::write(path.with_extension("active"), "personal\n").unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            Self(path)
        }

        fn wait_file(&self) -> PathBuf {
            self.0.with_extension("wait")
        }
    }

    impl Drop for FakeCli {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
            let _ = fs::remove_file(self.wait_file());
            let _ = fs::remove_file(self.0.with_extension("active"));
        }
    }

    #[test]
    fn login_streams_the_code_and_verifies_the_connected_account() {
        let cli = FakeCli::new();
        let (tx, rx) = mpsc::channel();
        let channel = Channel::new(move |message| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = message {
                tx.send(serde_json::from_str::<String>(&json).unwrap()).unwrap();
            }
            Ok(())
        });
        let result = Login::default().start_with(&cli.0, channel).unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), "ABCD-1234");
        assert!(matches!(result, Connection::Connected { login, .. } if login == "octocat"));
        assert_eq!(active_user(&cli.0).as_deref(), Some("personal"));
    }

    #[test]
    fn cancelling_reaps_the_process_and_allows_another_login() {
        let cli = FakeCli::new();
        fs::write(cli.wait_file(), "").unwrap();
        let login = Login::default();
        let (tx, rx) = mpsc::channel();
        let channel = Channel::new(move |_| { tx.send(()).unwrap(); Ok(()) });
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| login.start_with(&cli.0, channel));
            rx.recv_timeout(Duration::from_secs(3)).unwrap();
            assert!(login.start_with(&cli.0, Channel::new(|_| Ok(()))).is_err());
            login.cancel().unwrap();
            assert!(worker.join().unwrap().is_err());
        });
        assert!(login.0.lock().unwrap().is_none());
        fs::remove_file(cli.wait_file()).unwrap();
        assert!(login.start_with(&cli.0, Channel::new(|_| Ok(()))).is_ok());
    }

    #[test]
    fn expired_authentication_and_network_failure_have_different_setup_states() {
        let cli = FakeCli::new();
        fs::write(&cli.0, "#!/bin/sh\necho 'HTTP 401' >&2\nexit 1\n").unwrap();
        assert!(matches!(status_with(&cli.0, None), Connection::SignedOut { .. }));
        fs::write(&cli.0, "#!/bin/sh\necho 'network unavailable' >&2\nexit 1\n").unwrap();
        assert!(matches!(status_with(&cli.0, None), Connection::Error { .. }));
    }

    #[test]
    fn simultaneous_repository_accounts_do_not_change_the_cli_default() {
        let cli = FakeCli::new();
        let mut personal = account_command(&cli.0, Some("personal")).unwrap();
        let mut work = account_command(&cli.0, Some("work")).unwrap();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| personal.arg("api").arg("user").output().unwrap());
            let second = scope.spawn(|| work.arg("api").arg("user").output().unwrap());
            assert_eq!(first.join().unwrap().stdout.trim_ascii(), b"personal");
            assert_eq!(second.join().unwrap().stdout.trim_ascii(), b"work");
        });
        assert_eq!(active_user(&cli.0).as_deref(), Some("personal"));
        assert!(account_command(&cli.0, Some("missing")).is_err());
        assert!(account_command(&cli.0, Some("--user=work")).is_err());
    }

    #[test]
    fn account_listing_only_exposes_usernames_and_the_default() {
        let accounts = parse_accounts(concat!(
            "Logged in to github.com account personal (keyring)\n",
            "- Active account: true\n- Token: private\n",
            "Logged in to github.com account work (keyring)\n- Active account: false\n",
            "Failed to log in to github.com account old\n",
            "Logged in to github.com account automated (GH_TOKEN)\n- Active account: true\n"
        ));
        let json = serde_json::to_string(&accounts).unwrap();
        assert_eq!(accounts.len(), 2);
        assert!(accounts[0].active);
        assert!(!accounts[1].active);
        assert!(!json.contains("private"));
    }

    #[test]
    fn adding_an_account_does_not_overwrite_a_default_changed_elsewhere() {
        let cli = FakeCli::new();
        fs::write(cli.0.with_extension("active"), "work\n").unwrap();
        restore_default(&cli.0, Some(&"personal".into()), Some(&"octocat".into())).unwrap();
        assert_eq!(active_user(&cli.0).as_deref(), Some("work"));
    }

    #[test]
    fn only_passes_the_expected_device_code_to_the_ui() {
        assert_eq!(device_code("! First copy your one-time code: ABCD-1234"), Some("ABCD-1234"));
        for line in ["token: ghp_private", "First copy your one-time code: bad", "First copy your one-time code: ABCD-1234 extra"] {
            assert_eq!(device_code(line), None);
        }
    }
}
