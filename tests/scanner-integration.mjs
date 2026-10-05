import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.TEST_API_URL;
if (!base?.startsWith('http://127.0.0.1:') || !process.env.TEST_ADMIN_PASSWORD)
  throw new Error('Use the disposable local scanner test harness.');
let cookie = '';
async function request(path, method = 'GET', body, status = 200, auth = cookie) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1', Cookie: auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return data;
}
await request('/auth/login', 'POST', {
  email: 'admin@shantiauto.local',
  password: process.env.TEST_ADMIN_PASSWORD,
});
const adminCookie = cookie;
const resolve = (code, auth = cookie, source = 'HARDWARE_KEYBOARD') =>
  request(
    '/product-codes/resolve',
    'POST',
    { code, scan_id: randomUUID(), source, context: 'BILLING' },
    200,
    auth,
  );
const create = (sku, stock, codes = []) =>
  request(
    '/parts',
    'POST',
    {
      name: `Scanner ${sku}`,
      sku,
      selling_price_paise: 11800,
      purchase_price_paise: 6000,
      gst_bps: 1800,
      opening_stock: stock,
      codes,
    },
    201,
  );
const legacy = await resolve('000012345');
assert.equal(legacy.status, 'FOUND');
assert.equal(legacy.product.sku, 'LEGACY-CLEAN');
const conflicts = await request('/product-codes/conflicts');
assert.ok(conflicts.some((c) => c.normalized_code === '001234'));
assert.equal((await resolve('001234')).status, 'LEGACY_CONFLICT');
const a = await create('SCAN-A', 5, [{ code: ' 000000001234\r\n', is_primary: true }]);
const b = await create('SCAN-B', 2);
const empty = await create('SCAN-EMPTY', 0, [{ code: 'SCAN-ZERO' }]);
const qr = await request('/product-codes/generate', 'POST', { part_id: a.id, kind: 'QR' }, 201);
const internal = await request(
  '/product-codes/generate',
  'POST',
  { part_id: a.id, kind: 'BARCODE' },
  201,
);
assert.match(qr.code, /^SAM:P:/);
assert.match(internal.code, /^SAM\d+/);
assert.equal((await resolve(qr.code)).product.id, a.id);
assert.equal((await resolve(internal.code)).product.id, a.id);
const mapping = (await request('/parts/' + a.id + '/codes')).find((c) => c.code === '000000001234');
assert.equal(mapping.is_primary, true);
assert.equal(
  (await request('/product-codes/validate', 'POST', { code: '000000001234' })).conflict.part_id,
  a.id,
);
const duplicate = await request(
  '/product-codes',
  'POST',
  { part_id: b.id, code: '000000001234' },
  409,
);
assert.match(duplicate.error, /Scanner SCAN-A/);
await request(
  '/parts',
  'POST',
  {
    name: 'Must roll back',
    sku: 'ROLLBACK-CODE',
    selling_price_paise: 1,
    codes: [{ code: '000000001234' }],
  },
  409,
);
assert.equal((await request('/parts?q=ROLLBACK-CODE')).length, 0);
const race = await Promise.all(
  [a, b].map((p) =>
    fetch(base + '/product-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1', Cookie: cookie },
      body: JSON.stringify({ part_id: p.id, code: 'RACE-CODE' }),
    }),
  ),
);
assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
await request('/product-codes/' + qr.id + '/primary', 'PATCH', {});
assert.equal((await request('/parts/' + a.id + '/codes')).filter((c) => c.is_primary).length, 1);
await request('/product-codes/' + qr.id + '/disable', 'PATCH', {});
assert.equal((await resolve(qr.code)).status, 'DISABLED_CODE');
await request('/product-codes', 'POST', { part_id: b.id, code: qr.code }, 409);
await request('/product-codes/' + qr.id + '/enable', 'PATCH', {});
await request('/parts/' + a.id, 'PATCH', { active: false });
assert.equal((await resolve(mapping.code)).status, 'INACTIVE_PRODUCT');
await request('/parts/' + a.id, 'PATCH', { active: true, selling_price_paise: 12500 });
assert.equal(Number((await resolve(mapping.code)).product.selling_price_paise), 12500);
assert.equal((await resolve('SCAN-ZERO')).status, 'OUT_OF_STOCK');
assert.equal((await resolve('NOT-MAPPED')).status, 'NOT_FOUND');
assert.equal((await resolve('https://example.invalid/?price=1')).status, 'NOT_FOUND');
const invoice = await request(
  '/sales/invoices',
  'POST',
  {
    lines: [
      { part_id: a.id, quantity: 2, scanned_code_id: mapping.id, added_via: 'HARDWARE_KEYBOARD' },
    ],
    payments: [{ mode: 'CASH', amount_paise: 25000 }],
  },
  201,
);
const detail = await request('/sales/invoices/' + invoice.id);
assert.equal(detail.lines[0].quantity, 2);
assert.equal(detail.lines[0].scanned_code_id, mapping.id);
const after = await request('/parts/' + a.id);
assert.equal(after.current_stock, 3);
const movement = after.ledger.find((l) => l.reference_id === invoice.id);
assert.equal(movement.previous_stock, 5);
assert.equal(movement.new_stock, 3);
assert.equal(movement.delta_current, -2);
await request(
  '/sales/invoices',
  'POST',
  {
    lines: [{ part_id: b.id, quantity: 1, scanned_code_id: mapping.id }],
    payments: [{ mode: 'CASH', amount_paise: 11800 }],
  },
  400,
);
// A stale scan never bypasses the transaction's final stock check.
const last = await create('LAST-SCANNED', 1, [{ code: 'LAST-SCANNED' }]);
await resolve('LAST-SCANNED');
await resolve('LAST-SCANNED');
const checkout = () =>
  fetch(base + '/sales/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1', Cookie: cookie },
    body: JSON.stringify({
      lines: [{ part_id: last.id, quantity: 1 }],
      payments: [{ mode: 'CASH', amount_paise: 11800 }],
    }),
  });
assert.deepEqual(
  (await Promise.all([checkout(), checkout()])).map((r) => r.status).sort(),
  [201, 409],
);
const csv =
  'Part Name,SKU,Category,Selling Price,Barcode,Alternate Barcode,QR Identifier\nImported scanner part,SCAN-IMPORT,Filters,100,001001,ALT-001,SAM:P:IMPORT\n';
await request('/parts/import', 'POST', { csv }, 201);
assert.equal((await resolve('ALT-001')).product.sku, 'SCAN-IMPORT');
assert.equal((await resolve('SAM:P:IMPORT')).product.sku, 'SCAN-IMPORT');
assert.ok(
  (
    await request('/parts/import/preview', 'POST', {
      csv: csv.replace('SCAN-IMPORT', 'SCAN-IMPORT-2'),
    })
  ).duplicates.length,
);
await request(
  '/auth/users',
  'POST',
  {
    name: 'Scanner operator',
    email: 'scan-counter@example.invalid',
    password: 'ScannerCounter-456!',
    role: 'EMPLOYEE',
  },
  201,
);
await request('/auth/login', 'POST', {
  email: 'scan-counter@example.invalid',
  password: 'ScannerCounter-456!',
});
const employeeCookie = cookie;
const employee = await resolve(mapping.code);
assert.equal(employee.product.purchase_price_paise, undefined);
assert.equal(employee.product.cost_paise, undefined);
assert.equal(employee.product.preferred_supplier_id, undefined);
await request('/product-codes', 'POST', { part_id: b.id, code: 'EMPLOYEE-CODE' }, 403);
await request('/product-codes/generate', 'POST', { kind: 'BARCODE', part_id: b.id }, 403);
await request('/product-codes/' + mapping.id + '/disable', 'PATCH', {}, 403);
await request('/product-codes/' + mapping.id + '/primary', 'PATCH', {}, 403);
await request('/product-codes/validate', 'POST', { code: 'TEST' }, 403);
await request('/scanner/settings', 'PATCH', {}, 403);
cookie = adminCookie;
for (const codeId of [mapping.id, qr.id]) {
  const pdf = await fetch(base + '/product-codes/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1', Cookie: cookie },
    body: JSON.stringify({
      items: [{ part_id: a.id, code_id: codeId, quantity: 5 }],
      show_price: true,
    }),
  });
  assert.equal(pdf.status, 200);
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
}
const image = await fetch(base + '/product-codes/' + mapping.id + '/image', {
  headers: { Cookie: cookie },
});
assert.match(await image.text(), /<svg/);
const events = await request('/audit');
assert.ok(events.some((e) => e.action === 'BARCODE_ASSIGNED'));
console.log(
  'Scanner API checks passed: migration, exact codes, duplicates/races, atomic create, status, live prices, scanned invoices/ledger, concurrent checkout, import, privacy, permissions and label PDFs.',
);
