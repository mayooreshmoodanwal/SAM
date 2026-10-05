import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeyboardBurst,
  CameraGate,
  defaultSettings,
  addCartProduct,
  type CartLine,
} from './core.ts';

function burst(code: string, gap: number, suffix = 'Enter') {
  const input = new KeyboardBurst();
  let time = 100;
  for (const char of code) {
    input.push(char, time, defaultSettings);
    time += gap;
  }
  return input.push(suffix, time, defaultSettings);
}
test('hardware accepts leading zeros, Enter and Tab; slow normal typing is not a scan', () => {
  assert.equal(burst('001234567890', 5), '001234567890');
  assert.equal(burst('SAM0000000001', 7, 'Tab'), 'SAM0000000001');
  assert.equal(burst('clutch plate', 80), null);
  assert.equal(burst('ab', 5), null);
});
test('suffix does not double fire and scans do not survive an input timeout', () => {
  const reader = new KeyboardBurst();
  '012345'.split('').forEach((c, i) => reader.push(c, 100 + i * 5, defaultSettings));
  assert.equal(reader.push('Enter', 135, defaultSettings), '012345');
  assert.equal(reader.push('Tab', 140, defaultSettings), null);
  reader.push('1', 200, defaultSettings);
  reader.push('2', 250, defaultSettings);
  assert.equal(reader.push('Enter', 255, defaultSettings), null);
  assert.equal(burst('001234', 5, 'Tab'), '001234');
});
test('scanner timing and suffix are configurable', () => {
  const reader = new KeyboardBurst(),
    settings = {
      ...defaultSettings,
      max_gap_ms: 60,
      max_average_ms: 55,
      terminator: 'TAB' as const,
    };
  'ABCD'.split('').forEach((c, i) => reader.push(c, 100 + i * 45, settings));
  assert.equal(reader.push('Tab', 285, settings), 'ABCD');
  'ABCD'.split('').forEach((c, i) => reader.push(c, 400 + i * 5, settings));
  assert.equal(reader.push('Enter', 425, settings), null);
});
test('stationary camera label is counted once; leave/reenter and explicit repeat work', () => {
  const gate = new CameraGate();
  let accepted = 0;
  for (let t = 0; t < 2400; t += 100) if (gate.accept('LABEL-A', t, 1000)) accepted++;
  assert.equal(accepted, 1);
  assert.equal(gate.accept('LABEL-A', 3500, 1000), true);
  assert.equal(gate.accept('LABEL-B', 3600, 1000), true);
  assert.equal(gate.accept('LABEL-A', 3800, 1000), true);
  gate.reset();
  assert.equal(gate.accept('LABEL-A', 3900, 1000), true);
});
test('three scans create one line with current price and enforce available stock', () => {
  let cart: CartLine[] = [];
  const part = {
    id: 'a',
    name: 'Clutch plate',
    available_stock: 3,
    selling_price_paise: 10000,
    active: true,
  };
  for (let i = 0; i < 3; i++)
    cart = addCartProduct(
      cart,
      { ...part, selling_price_paise: 10000 + i },
      { source: 'HARDWARE_KEYBOARD', codeId: 'code-a' },
    ).cart;
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
  assert.equal(cart[0].part.selling_price_paise, 10002);
  assert.equal(cart[0].scanned_code_id, 'code-a');
  assert.throws(() => addCartProduct(cart, part), /Only 3/);
  assert.equal(cart[0].quantity, 3);
  assert.throws(() => addCartProduct([], { ...part, available_stock: 0 }), /out of stock/);
  assert.throws(() => addCartProduct([], { ...part, active: false }), /inactive/);
});
