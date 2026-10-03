import test from 'node:test';
import assert from 'node:assert/strict';
import { warrantyWindow } from './warranty.js';
test('warranty month end is clamped and last day remains valid', () => {
  const sale = new Date('2026-01-30T20:00:00Z'); // 31 Jan in India
  assert.deepEqual(warrantyWindow(sale, 1, new Date('2026-02-28T10:00:00Z')), {
    start: '2026-01-31',
    end: '2026-02-28',
    expired: false,
  });
  assert.equal(warrantyWindow(sale, 1, new Date('2026-02-28T19:00:00Z')).expired, true);
});
