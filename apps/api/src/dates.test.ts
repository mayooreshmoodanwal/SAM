import test from 'node:test';
import assert from 'node:assert/strict';
import { shopDate } from './dates.js';

test('shop date changes at midnight in India', () => {
  assert.equal(shopDate(new Date('2026-10-02T18:29:59Z')), '2026-10-02');
  assert.equal(shopDate(new Date('2026-10-02T18:30:00Z')), '2026-10-03');
});
