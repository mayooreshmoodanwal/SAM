import assert from 'node:assert/strict';
const base = process.env.TEST_API_URL;
const password = process.env.TEST_ADMIN_PASSWORD;
if (
  !base ||
  !password ||
  (!base.startsWith('http://localhost:') && !base.startsWith('http://127.0.0.1:'))
)
  throw new Error(
    'Set TEST_API_URL to a local test API and TEST_ADMIN_PASSWORD to the seeded demo password.',
  );
let cookie = '';
async function request(path, method = 'GET', body, expected = 200, overrideCookie = cookie) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-SAM-Request': '1',
      ...(overrideCookie ? { Cookie: overrideCookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null;
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return data;
}
await request('/auth/login', 'POST', { email: 'admin@shantiauto.local', password });
const lookup = await request('/vehicles/lookup/MB1AA22BB33CC4455');
assert.equal(lookup.vehicle.model, '1616');
assert.ok(lookup.parts.length >= 1);
assert.ok((await request('/parts?q=clu%20pl')).some((part) => part.sku === 'CL-1616-BS6'));
await request(
  `/vehicles/${lookup.vehicle.id}/events`,
  'POST',
  { type: 'SERVICE_VISIT', description: 'Integration test counter visit', odometer: 80000 },
  201,
);
assert.ok((await request(`/vehicles/${lookup.vehicle.id}`)).events.length >= 1);
const sku = `TEST-${Date.now()}`;
const header =
  'Part Name,Short Name,OEM Number,SKU,Category,Brand,Purchase Price,Selling Price,MRP,GST,Tax Mode,HSN,Opening Stock,Minimum Stock,Rack,Barcode';
const row = `Test H-Series Filter,THF,TEST-OEM,${sku},Filters,Ashok Leyland,100,118,125,18,INCLUSIVE,8708,3,1,R9,`;
const csv = `${header}\n${row}\n`;
const preview = await request('/parts/import/preview', 'POST', { csv });
assert.equal(preview.valid.length, 1);
assert.equal(preview.invalid.length, 0);
await request('/parts/import/preview', 'POST', { csv: '"unterminated' }, 400);
await request('/parts/import', 'POST', { csv }, 201);
const part = (await request('/parts?q=' + sku))[0];
assert.equal(Number(part.current_stock), 3);
await request('/parts/' + part.id, 'PATCH', { mrp_paise: 12600 });
assert.equal((await request('/parts/' + part.id)).priceHistory.length, 1);
const reservation = await request(
  '/stock/reservations',
  'POST',
  { part_id: part.id, quantity: 2, reference: 'TEST-ORDER', reason: 'Integration test order' },
  201,
);
await request(
  '/sales/invoices',
  'POST',
  { lines: [{ part_id: part.id, quantity: 2 }], payments: [] },
  409,
);
await request(`/stock/reservations/${reservation.id}/release`, 'POST', {
  quantity: 2,
  reason: 'Test order closed',
});
const quote = await request('/sales/quote', 'POST', {
  lines: [{ part_id: part.id, quantity: 1 }],
  invoice_discount_paise: 1000,
});
assert.equal(quote.totals.totalPaise, 10800);
await request(
  '/sales/quote',
  'POST',
  { lines: [{ part_id: part.id, quantity: 1, discount_paise: 999999 }] },
  400,
);
await request(
  '/sales/invoices',
  'POST',
  { lines: [{ part_id: part.id, quantity: 4 }], payments: [] },
  409,
);
const invoice = await request(
  '/sales/invoices',
  'POST',
  {
    customer_id: lookup.vehicle.customer_id,
    vehicle_id: lookup.vehicle.id,
    lines: [{ part_id: part.id, quantity: 1 }],
    invoice_discount_paise: 1000,
    payments: [{ mode: 'UPI', amount_paise: 10800 }],
  },
  201,
);
const detail = await request('/sales/invoices/' + invoice.id);
assert.equal(Number(detail.total_paise), 10800);
assert.ok((await request('/reports/margins')).some((row) => row.id === part.id));
const pdf = await fetch(base + '/sales/invoices/' + invoice.id + '/pdf', {
  headers: { Cookie: cookie },
});
assert.equal(pdf.status, 200);
assert.match(pdf.headers.get('content-type'), /application\/pdf/);
assert.equal(
  Buffer.from(await pdf.arrayBuffer())
    .subarray(0, 5)
    .toString(),
  '%PDF-',
);
const salesBefore = (await request('/reports/sales')).reduce(
  (sum, row) => sum + Number(row.sales_paise),
  0,
);
const returned = await request(
  `/sales/invoices/${invoice.id}/returns`,
  'POST',
  {
    reason: 'Incorrect filter supplied',
    lines: [{ invoice_line_id: detail.lines[0].id, quantity: 1, condition: 'GOOD' }],
  },
  201,
);
assert.equal(Number(returned.refund_due_paise), 10800);
assert.equal(
  (await request('/reports/margins')).some((row) => row.id === part.id),
  false,
);
assert.equal(
  (await request('/reports/top-parts')).some((row) => row.id === part.id),
  false,
);
const salesAfter = (await request('/reports/sales')).reduce(
  (sum, row) => sum + Number(row.sales_paise),
  0,
);
assert.equal(salesBefore - salesAfter, 10800);
await request(
  `/sales/returns/${returned.id}/refunds`,
  'POST',
  { mode: 'UPI', amount_paise: 10800 },
  201,
);
await request(
  `/sales/returns/${returned.id}/refunds`,
  'POST',
  { mode: 'UPI', amount_paise: 1 },
  400,
);
const paidQuote = await request('/sales/quote', 'POST', {
  lines: [{ part_id: part.id, quantity: 2 }],
});
const concurrentBody = {
  lines: [{ part_id: part.id, quantity: 2 }],
  payments: [{ mode: 'CASH', amount_paise: paidQuote.totals.totalPaise }],
};
const concurrent = await Promise.all([
  fetch(base + '/sales/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1', Cookie: cookie },
    body: JSON.stringify(concurrentBody),
  }),
  fetch(base + '/sales/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1', Cookie: cookie },
    body: JSON.stringify(concurrentBody),
  }),
]);
assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
const supplier = (await request('/suppliers'))[0];
assert.ok(Array.isArray((await request('/suppliers/' + supplier.id)).parts));
const purchasedBefore = Number((await request('/dashboard')).purchases.today_paise);
const purchase = await request(
  '/purchases',
  'POST',
  {
    supplier_id: supplier.id,
    lines: [{ part_id: part.id, quantity_ordered: 2, rate_paise: 10000 }],
  },
  201,
);
const purchaseDetail = await request('/purchases/' + purchase.id);
const lineId = purchaseDetail.lines[0].id;
assert.equal(
  (
    await request(`/purchases/${purchase.id}/receive`, 'POST', {
      lines: [{ line_id: lineId, quantity: 1 }],
    })
  ).status,
  'PARTIALLY_RECEIVED',
);
assert.equal(
  (
    await request(`/purchases/${purchase.id}/receive`, 'POST', {
      lines: [{ line_id: lineId, quantity: 1 }],
    })
  ).status,
  'RECEIVED',
);
const purchaseAfter = await request('/purchases/' + purchase.id);
assert.equal(Number(purchaseAfter.received_value_paise), Number(purchaseAfter.total_paise));
assert.equal(
  Number((await request('/dashboard')).purchases.today_paise) - purchasedBefore,
  Number(purchaseAfter.total_paise),
);
assert.ok(Array.isArray(await request('/reports/top-parts')));
assert.ok(Array.isArray(await request('/reports/margins')));
assert.ok(Array.isArray((await request('/reports/finance')).receivables));
assert.ok(Array.isArray(await request('/notifications')));
const purchaseReturn = await request(
  `/purchases/${purchase.id}/returns`,
  'POST',
  { part_id: part.id, quantity: 1, reason: 'Damaged by supplier', refund_paise: 0 },
  201,
);
await request(
  `/purchases/${purchase.id}/payments`,
  'POST',
  { amount_paise: Number(purchaseAfter.total_paise), mode: 'UPI' },
  400,
);
await request(
  `/purchases/${purchase.id}/payments`,
  'POST',
  {
    amount_paise: Number(purchaseAfter.total_paise) - Number(purchaseReturn.credit_paise),
    mode: 'UPI',
  },
  201,
);
const after = (await request('/parts?q=' + sku))[0];
assert.equal(Number(after.current_stock), 2);
const noCredit = await request(
  '/customers',
  'POST',
  { name: `No Credit ${sku}`, credit_limit_paise: 0, credit_period_days: 0 },
  201,
);
await request(
  '/sales/invoices',
  'POST',
  { customer_id: noCredit.id, lines: [{ part_id: part.id, quantity: 1 }], payments: [] },
  409,
);
await request(
  '/sales/invoices',
  'POST',
  {
    customer_id: noCredit.id,
    lines: [{ part_id: part.id, quantity: 1 }],
    payments: [],
    credit_override: true,
  },
  201,
);
const employeeEmail = `counter-${Date.now()}@shantiauto.local`;
await request(
  '/auth/users',
  'POST',
  { name: 'Test Counter', email: employeeEmail, password: 'CounterOnly-1234!', role: 'EMPLOYEE' },
  201,
);
const employeeLogin = await fetch(base + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1' },
  body: JSON.stringify({ email: employeeEmail, password: 'CounterOnly-1234!' }),
});
assert.equal(employeeLogin.status, 200);
const employeeCookie = employeeLogin.headers.get('set-cookie').split(';')[0];
await request(
  '/sales/invoices',
  'POST',
  {
    customer_id: noCredit.id,
    lines: [{ part_id: part.id, quantity: 1 }],
    payments: [],
    credit_override: true,
  },
  409,
  employeeCookie,
);
await request('/reports/sales', 'GET', undefined, 403, employeeCookie);
await request('/settings', 'GET', undefined, 403, employeeCookie);
const employeePart = await request('/parts/' + part.id, 'GET', undefined, 200, employeeCookie);
assert.equal(employeePart.purchase_price_paise, undefined);
assert.deepEqual(employeePart.priceHistory, []);
const employeeInvoice = await request(
  '/sales/invoices/' + invoice.id,
  'GET',
  undefined,
  200,
  employeeCookie,
);
assert.equal(employeeInvoice.lines[0].cost_paise, undefined);
await request(
  '/auth/change-password',
  'POST',
  { currentPassword: 'wrong', newPassword: 'CounterUpdated-1234!' },
  401,
  employeeCookie,
);
await request(
  '/auth/change-password',
  'POST',
  { currentPassword: 'CounterOnly-1234!', newPassword: 'CounterUpdated-1234!' },
  200,
  employeeCookie,
);
await request('/auth/me', 'GET', undefined, 401, employeeCookie);
const updatedLogin = await fetch(base + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1' },
  body: JSON.stringify({ email: employeeEmail, password: 'CounterUpdated-1234!' }),
});
assert.equal(updatedLogin.status, 200);
const fakeEmail = `missing-${Date.now()}@example.invalid`;
for (let i = 0; i < 5; i++)
  await request('/auth/login', 'POST', { email: fakeEmail, password: 'incorrect' }, 401);
await request('/auth/login', 'POST', { email: fakeEmail, password: 'incorrect' }, 429);
console.log(
  'Integration flows passed: lookup, import, reservation, tax, invoice PDF, return/refund, concurrent stock, purchase receive/return, permissions, password rotation, login throttling.',
);
