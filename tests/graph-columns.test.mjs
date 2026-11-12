import assert from 'node:assert/strict';
import test from 'node:test';
import { COLUMN_SPACING, MAX_COLUMN_WIDTH, graphColumnWidths } from '../src/lib/graph-columns.ts';

test('the commit message fills remaining space and saved columns stay independent', () => {
  const defaults = graphColumnWidths(1000, 52, {});
  assert.equal(Object.values(defaults).reduce((sum, width) => sum + width, COLUMN_SPACING), 1000);
  const resized = graphColumnWidths(1000, 52, { refs: 260, subject: 280, author: 180, time: 80 });
  assert.deepEqual(resized, { refs: 260, graph: 64, subject: 280, author: 180, sha: 64, time: 80 });
  assert.equal(graphColumnWidths(400, 52, {}).subject, 160);
});

test('minimum widths protect graph lanes and corrupt saved widths use safe defaults', () => {
  assert.equal(graphColumnWidths(1000, 150, { graph: 36 }).graph, 150);
  const widths = graphColumnWidths(1000, 52, { refs: -100, author: Infinity, sha: NaN, subject: MAX_COLUMN_WIDTH + 1 });
  assert.equal(widths.refs, 100);
  assert.equal(widths.author, 120);
  assert.equal(widths.sha, 64);
  assert.equal(widths.subject, MAX_COLUMN_WIDTH);
});

test('search hides the graph without reserving space for its saved width', () => {
  const widths = graphColumnWidths(1000, 0, { graph: 240 });
  assert.equal(widths.graph, 0);
  assert.equal(Object.values(widths).reduce((sum, width) => sum + width, COLUMN_SPACING - 8), 1000);
});
