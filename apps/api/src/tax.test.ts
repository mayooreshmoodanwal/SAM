import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLine, calculateInvoice, financialYear } from './tax.js';
test('inclusive GST preserves entered selling price', () => {
  assert.deepEqual(
    calculateLine({ quantity: 1, ratePaise: 10000, gstBps: 1800, taxMode: 'INCLUSIVE' }),
    {
      subtotalPaise: 10000,
      discountPaise: 0,
      taxablePaise: 8475,
      gstPaise: 1525,
      totalPaise: 10000,
    },
  );
});
test('exclusive and exempt GST', () => {
  assert.equal(
    calculateLine({ quantity: 1, ratePaise: 10000, gstBps: 1800, taxMode: 'EXCLUSIVE' }).totalPaise,
    11800,
  );
  assert.equal(
    calculateLine({ quantity: 1, ratePaise: 10000, gstBps: 1800, taxMode: 'EXEMPT' }).gstPaise,
    0,
  );
});
test('discount and split tax reconcile to total', () => {
  const line = calculateLine({
    quantity: 2,
    ratePaise: 10000,
    discountPaise: 2000,
    gstBps: 1800,
    taxMode: 'EXCLUSIVE',
  });
  const invoice = calculateInvoice([line], 1000);
  assert.equal(invoice.totalPaise, invoice.taxablePaise + invoice.cgstPaise + invoice.sgstPaise);
  assert.equal(invoice.discountPaise, 3000);
  assert.equal(invoice.totalPaise, line.totalPaise - 1000);
});
test('large safe values use exact integer tax rounding and reject overflow', () => {
  const ratePaise = 9_000_000_000_000_000;
  const inclusive = calculateLine({
    quantity: 1,
    ratePaise,
    gstBps: 1800,
    taxMode: 'INCLUSIVE',
  });
  assert.equal(inclusive.taxablePaise, Number((BigInt(ratePaise) * 10_000n + 5_900n) / 11_800n));
  assert.throws(() =>
    calculateLine({ quantity: 2, ratePaise, gstBps: 1800, taxMode: 'EXCLUSIVE' }),
  );
});
test('financial year starts in April', () => {
  assert.equal(financialYear(new Date('2026-03-31T12:00:00Z')), '25-26');
  assert.equal(financialYear(new Date('2026-04-01T00:00:00Z')), '26-27');
});
