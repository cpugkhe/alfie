import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmation } from '../src/lib/confirmation.ts';

test('confirmation waits for an explicit choice and cancellation cannot become approval', async () => {
  const request = createConfirmation({ title: 'Reset to origin?', danger: true }, '/repo/a');
  let writes = 0;
  const operation = request.result.then((confirmed) => { if (confirmed) writes++; });
  await Promise.resolve();
  assert.equal(writes, 0);
  assert.equal(request.repo, '/repo/a');
  request.resolve(false);
  request.resolve(true);
  await operation;
  assert.equal(writes, 0);
});

test('approval resolves once and keeps the action label and repository together', async () => {
  const request = createConfirmation({ title: 'Reset', confirmLabel: 'Reset to remote' }, '/repo/b');
  let writes = 0;
  const operation = request.result.then((confirmed) => { if (confirmed) writes++; });
  request.resolve(true);
  request.resolve(true);
  await operation;
  assert.equal(writes, 1);
  assert.equal(request.confirmLabel, 'Reset to remote');
  const global = createConfirmation({ title: 'Delete space?' }, null);
  assert.equal(global.repo, null);
  global.resolve(false);
  assert.equal(await global.result, false);
});
