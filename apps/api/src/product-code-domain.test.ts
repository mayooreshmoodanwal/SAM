import test from 'node:test';
import assert from 'node:assert/strict';
import { codeInput, codeValue, validateCodeFormat, barcodeOptions } from './product-code-domain.js';
import bwipjs from 'bwip-js';
test('codes trim suffixes and preserve zeros, case and meaningful internal spaces', () => {
  assert.equal(codeValue.parse(' \t001234567890\r\n'), '001234567890');
  assert.equal(codeValue.parse('SAM:Part:a B'), 'SAM:Part:a B');
  assert.throws(() => codeValue.parse('a\u0000b'));
  assert.throws(() => codeValue.parse('a'.repeat(513)));
  assert.throws(() => codeValue.parse(' \r\n'));
  assert.equal(
    codeValue.parse('https://example.invalid/?price=1'),
    'https://example.invalid/?price=1',
  );
});
test('EAN check digits are validated; alphanumeric codes remain supported', () => {
  validateCodeFormat('4006381333931', 'EAN_13');
  assert.throws(() => validateCodeFormat('4006381333932', 'EAN_13'));
  assert.throws(() => validateCodeFormat('123', 'UPC_A'));
  validateCodeFormat('SAM0000000001', 'CODE_128');
  validateCodeFormat('SAM:P:00000001', 'QR_CODE');
  assert.match(bwipjs.toSVG(barcodeOptions('SAM:P:00000001', 'QR_CODE')), /<svg/);
  assert.equal(codeInput.parse({ code: ' 0000123 ' }).code, '0000123');
});
