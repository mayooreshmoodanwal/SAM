import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv.js';
test('CSV quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('name,sku\r\n"Filter, oil",OF-1\r\n"A ""genuine"" part",A-2\r\n'), [
    ['name', 'sku'],
    ['Filter, oil', 'OF-1'],
    ['A "genuine" part', 'A-2'],
  ]);
});
test('CSV rejects malformed quoted records', () => {
  assert.throws(() => parseCsv('name,sku\n"unterminated,OF-1'));
});
