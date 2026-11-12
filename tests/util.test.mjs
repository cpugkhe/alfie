import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTags } from '../src/lib/util.ts';

test('tags sort by semantic precedence, with releases above prereleases', () => {
  const tags = ['v1.9.0', 'v1.10.0-rc.2', 'v1.10.0-rc.10', 'v2', 'v1.10.0', 'nightly', 'v1.10.0-beta', 'v1.10.0-alpha.1'];
  assert.deepEqual(tags.sort(compareTags), ['v2', 'v1.10.0', 'v1.10.0-rc.10', 'v1.10.0-rc.2', 'v1.10.0-beta', 'v1.10.0-alpha.1', 'v1.9.0', 'nightly']);
  const prereleases = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  assert.deepEqual([...prereleases].reverse().sort(compareTags), [...prereleases].reverse());
  assert.ok(compareTags('v9007199254740993.0.0', 'v9007199254740992.0.0') < 0);
  assert.equal(Math.sign(compareTags('1.0.0+build.1', '1.0.0+build.2')), -Math.sign(compareTags('1.0.0+build.2', '1.0.0+build.1')));
});
