/**
 * Turns raw git / ssh error text into something a person can act on:
 * a plain title, one line on what happened, and things to try.
 */
export interface Explained {
  title: string;
  why?: string;
  hints: string[];
}

interface Rule {
  test: RegExp;
  title: string;
  why: string;
  hints: string[];
}

const RULES: Rule[] = [
  {
    test: /permission denied \(publickey|sign_and_send_pubkey|agent refused operation|no such identity/i,
    title: 'SSH key was not accepted',
    why: 'The server refused the key, or ssh could not use it (missing file, or a passphrase it cannot ask for).',
    hints: [
      'Check this repository uses the right profile (⌘⇧U) and that the profile points at the right key (⌘,).',
      'If the key has a passphrase, load it once in a terminal: ssh-add --apple-use-keychain ~/.ssh/<key>',
      'Make sure the public key is added to your account on the git host.',
      'Use "Test connection" in Profiles (⌘,) to see which account the key signs in as.',
    ],
  },
  {
    test: /host key verification failed|authenticity of host/i,
    title: 'Unknown server key',
    why: 'This machine has never connected to that host, and Alfie will not accept a new host key silently.',
    hints: ['Run this once in a terminal and confirm the fingerprint: ssh -T git@<host>', 'Then try again.'],
  },
  {
    test: /could not resolve host|network is unreachable|connection timed out|operation timed out|connection refused|could not read from remote repository.*\n?.*(timed out|unreachable)/i,
    title: 'Cannot reach the remote',
    why: 'The network request to the git host failed.',
    hints: ['Check your internet connection or VPN.', 'Check the remote URL: git remote -v'],
  },
  {
    test: /authentication failed|could not read username|terminal prompts disabled/i,
    title: 'Sign-in to the remote failed',
    why: 'The remote uses HTTPS and git has no stored credentials for it.',
    hints: [
      'Switch the remote to SSH so a profile key is used: git remote set-url origin git@<host>:<owner>/<repo>.git',
      'Or sign in once from a terminal so the credential helper stores a token.',
    ],
  },
  {
    test: /repository not found|does not appear to be a git repository|could not read from remote repository/i,
    title: 'Remote repository not found',
    why: 'The URL is wrong, or this account has no access to it.',
    hints: ['Check the remote URL: git remote -v', 'Check the active profile is the account that has access (⌘⇧U).'],
  },
  {
    test: /stale info/i,
    title: 'Force push refused',
    why: 'Someone pushed to this branch after your last fetch, so --force-with-lease stopped to avoid overwriting their work.',
    hints: ['Fetch (⌘⇧F), look at what changed, then force push again if you still want to replace it.'],
  },
  {
    test: /non-fast-forward|fetch first|\[rejected\]|updates were rejected/i,
    title: 'Push rejected: the remote has commits you do not have',
    why: 'Your branch and the remote branch have diverged, or the remote moved ahead.',
    hints: [
      'Pull first (⌘⇧L), then push again.',
      'If you rewrote history on purpose (rebase, amend), use "Force push (with lease)" from the command palette (⌘⇧P).',
    ],
  },
  {
    test: /need to specify how to reconcile divergent branches|not possible to fast-forward/i,
    title: 'Pull needs a decision: branches have diverged',
    why: 'Both you and the remote have new commits, and git is not configured to merge or rebase them automatically.',
    hints: [
      'Fetch (⌘⇧F), then rebase onto the remote branch (⌘⇧E) for a straight history, or merge it (⌘⇧G).',
      'To choose once for all pulls: git config --global pull.rebase true (or false to merge).',
    ],
  },
  {
    test: /has no upstream branch|no tracking information|no upstream configured/i,
    title: 'Branch has no upstream',
    why: 'This branch is not linked to a branch on the remote yet.',
    hints: ['Push (⌘⇧K) once: Alfie sets the upstream on the first push.'],
  },
  {
    test: /would be overwritten by (checkout|merge)|commit your changes or stash them|local changes.*would be overwritten/i,
    title: 'Uncommitted changes are in the way',
    why: 'The operation needs to change files you have modified.',
    hints: ['Commit them, or stash them (⌘⇧S), then try again.'],
  },
  {
    test: /untracked working tree files would be overwritten/i,
    title: 'Untracked files are in the way',
    why: 'The operation would create files that already exist here untracked.',
    hints: ['Move, delete or commit those files, or stash including untracked (⌘⇧S).'],
  },
  {
    test: /conflict|automatic merge failed|could not apply|fix conflicts/i,
    title: 'Stopped on conflicts',
    why: 'The same lines were changed on both sides, so git cannot combine them on its own.',
    hints: [
      'Open the conflicted files (marked ! in Uncommitted changes) and fix the <<<<<<< sections.',
      'Tick each fixed file, then press Continue in the yellow banner.',
      'Or press Abort to go back to how things were.',
    ],
  },
  {
    test: /unmerged files|resolve your current index first|you have not concluded your merge|rebase in progress|cherry-pick is already in progress/i,
    title: 'Another operation is still in progress',
    why: 'A merge, rebase or cherry-pick was started and has not been finished.',
    hints: ['Finish it with Continue, or cancel it with Abort, in the yellow banner.'],
  },
  {
    test: /index\.lock|unable to create .*\.lock/i,
    title: 'The repository is locked',
    why: 'Another git process is running here, or one crashed and left its lock file behind.',
    hints: [
      'Wait a moment and retry (an editor or terminal may be running git).',
      'If nothing is running, remove the stale lock: rm .git/index.lock',
    ],
  },
  {
    test: /not fully merged/i,
    title: 'Branch is not fully merged',
    why: 'It has commits that exist nowhere else; deleting it would make them unreachable.',
    hints: ['Merge it first, or delete it again and confirm "Delete anyway".'],
  },
  {
    test: /already exists/i,
    title: 'That name is already taken',
    why: 'A branch, tag or folder with this name exists.',
    hints: ['Pick another name, or delete / rename the existing one first.'],
  },
  {
    test: /not a valid (branch|tag|ref|object) name|is not a valid/i,
    title: 'Name not allowed',
    why: 'Git ref names cannot contain spaces, "..", "~", "^", ":", "?", "*", "[" or end with "/" or ".lock".',
    hints: ['Use letters, digits, "-", "_", "." and "/" (for example feature/login-form).'],
  },
  {
    test: /nothing to commit|no changes added to commit/i,
    title: 'Nothing to commit',
    why: 'No changes are selected for the commit.',
    hints: ['Tick the files to include, or use "Select all".'],
  },
  {
    test: /hook (declined|failed)|pre-commit|commit-msg|pre-push/i,
    title: 'A git hook stopped this',
    why: 'The repository has a hook script (lint, tests, message check) that exited with an error.',
    hints: ['Read the hook output below and fix what it reports, then retry.'],
  },
  {
    test: /patch does not apply|patch failed/i,
    title: 'That change no longer fits the file',
    why: 'The file changed since the diff was shown.',
    hints: ['The diff has been reloaded — select the hunk or lines again and retry.'],
  },
  {
    test: /please tell me who you are|unable to auto-detect email|empty ident/i,
    title: 'Git does not know who you are',
    why: 'No name and email are configured for commits.',
    hints: ['Create a profile with your name and email (⌘,) and use it for this repository (⌘⇧U).'],
  },
  {
    test: /head is detached|detached head|not currently on a branch/i,
    title: 'No branch is checked out',
    why: 'HEAD points at a commit, not a branch, so there is nothing to move or push.',
    hints: ['Switch to a branch (⌘B), or create one here (⌘⇧N).'],
  },
  {
    test: /does not have any commits yet|bad revision 'head'|ambiguous argument 'head'/i,
    title: 'This repository has no commits yet',
    why: 'The action needs at least one commit.',
    hints: ['Make the first commit, then try again.'],
  },
  {
    test: /pathspec .* did not match|unknown revision|bad revision|not a valid object name|couldn't find remote ref/i,
    title: 'Git could not find that',
    why: 'The branch, tag, commit or file no longer exists under that name.',
    hints: ['Refresh (⌘R) or fetch (⌘⇧F) and try again.'],
  },
];

/** `context` is the busy label of the action, e.g. "Pushing…". */
export function explain(error: string, context?: string): Explained {
  const what = context?.replace(/…$/, '').trim();
  const rule = RULES.find((r) => r.test.test(error));
  if (rule) {
    return { title: rule.title, why: rule.why, hints: rule.hints };
  }
  return { title: what ? `${what} failed` : 'Something went wrong', hints: [] };
}
