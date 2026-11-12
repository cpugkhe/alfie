import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { ownerAvatar } from '../src/lib/remote.ts';

test('GitHub owners and organizations use their profile image; unknown hosts use initials', async () => {
  const signal = new AbortController().signal;
  assert.equal(await ownerAvatar({ host: 'github.com', owner: 'acme', path: 'acme/repo' }, signal), 'https://github.com/acme.png?size=64');
  assert.equal(await ownerAvatar({ host: 'git.example.com', owner: 'acme', path: 'acme/repo' }, signal), null);
});

test('GitLab uses the project namespace avatar and Bitbucket uses the workspace owner avatar', async () => {
  const signal = new AbortController().signal;
  const responses = [
    { namespace: { avatar_url: '/uploads/group.png' } },
    { links: { avatar: { href: 'https://cdn.example.com/workspace.png' } } },
    { namespace: { avatar_url: 'javascript:alert(1)' } },
    { namespace: null },
  ];
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json(responses.shift()));
  try {
    const gitlab = { host: 'gitlab.com', owner: 'acme', path: 'acme/team/repo' };
    assert.equal(await ownerAvatar(gitlab, signal), 'https://gitlab.com/uploads/group.png');
    assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://gitlab.com/api/v4/projects/acme%2Fteam%2Frepo');
    assert.equal(await ownerAvatar({ host: 'bitbucket.org', owner: 'acme', path: 'acme/repo' }, signal), 'https://cdn.example.com/workspace.png');
    assert.equal(await ownerAvatar(gitlab, signal), null);
    assert.equal(await ownerAvatar(gitlab, signal), null);
  } finally {
    fetchMock.mock.restore();
  }
});
