import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.resolve('@sveltejs/vite-plugin-svelte'));
const merge = require('deepmerge');

test('the build dependency cannot poison merged object prototypes', () => {
  const poisoned = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  for (const result of [merge(poisoned, {}), merge({}, poisoned), merge(Object.create(null), poisoned)]) {
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.polluted, undefined);
    assert.equal(result.safe, 1);
  }
  assert.deepEqual(merge({ nested: { a: 1 } }, { nested: { b: 2 } }), { nested: { a: 1, b: 2 } });
});
