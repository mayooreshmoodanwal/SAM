import { chromium, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import bwipjs from 'bwip-js';
const web = process.env.TEST_WEB_URL,
  password = process.env.TEST_ADMIN_PASSWORD;
if (!web?.startsWith('http://localhost:') || !password)
  throw new Error('Use the disposable scanner QA harness.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const headers = { 'X-SAM-Request': '1' };
async function api(path, data, method = 'post') {
  const r = await context.request[method](web + '/api' + path, {
    headers,
    ...(data === undefined ? {} : { data }),
  });
  if (!r.ok()) throw new Error(`${path}: ${await r.text()}`);
  return r.json();
}
async function hardware(code, suffix = 'Enter') {
  await page.keyboard.type(code, { delay: 3 });
  await page.keyboard.press(suffix);
}
async function billing() {
  await page.goto(web + '/#billing');
  await expect(page.getByText('Scanner Ready', { exact: false })).toBeVisible();
}
try {
  await api('/auth/login', { email: 'admin@shantiauto.local', password });
  const create = (name, sku, code, stock = 5) =>
    api('/parts', {
      name,
      sku,
      selling_price_paise: 10000,
      purchase_price_paise: 5000,
      opening_stock: stock,
      warranty_months: 12,
      codes: [{ code, is_primary: true, format: 'CODE_128' }],
    });
  const limited = await create('UI limited clutch', 'UI-SCAN-LIMIT', '000099887766', 2);
  const multiple = await create('UI many filter', 'UI-SCAN-MANY', 'UI-MULTI-1');
  const camera = await create('UI camera filter', 'UI-SCAN-CAMERA', 'UI-CAMERA-1');
  const qr = await api('/product-codes/generate', { kind: 'QR', part_id: camera.id });
  await billing();
  const search = page.getByPlaceholder('Part name, OEM, SKU or scan barcode…');
  await search.click();
  await page.keyboard.type('clutch plate', { delay: 80 });
  await expect(search).toHaveValue('clutch plate');
  await expect(page.locator('.cart-table tbody input.qty')).toHaveCount(0);
  await search.fill('');
  await hardware('000099887766');
  const qty = page.locator('.cart-table input.qty');
  await expect(qty).toHaveValue('1');
  await expect(search).toHaveValue('');
  const remarks = page.getByLabel('Remarks');
  await remarks.fill('Keep this customer note');
  await remarks.focus();
  await hardware('000099887766', 'Tab');
  await expect(qty).toHaveValue('2');
  await expect(remarks).toHaveValue('Keep this customer note');
  await qty.focus();
  await hardware('000099887766');
  await expect(
    page.getByText('Only 2 units of UI limited clutch are available.', { exact: true }),
  ).toBeVisible();
  await expect(qty).toHaveValue('2');
  await page.reload();
  await expect(page.getByText('Scanner Ready', { exact: false })).toBeVisible();
  await page.locator('#customer-select').focus();
  await hardware('UI-MULTI-1');
  await hardware('UI-MULTI-1');
  await hardware('UI-MULTI-1');
  await expect(qty).toHaveValue('3');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(qty).toHaveValue('3');
  await hardware('UNKNOWN-UI-CODE');
  await expect(page.getByText('Barcode not recognized', { exact: true })).toBeVisible();
  await expect(qty).toHaveValue('3');
  await page.screenshot({ path: '.local/scanner-qa/billing.png', fullPage: true });
  // Normal manual selection follows the same stock and cart path.
  await search.fill('UI camera filter');
  await page.getByRole('button').filter({ hasText: 'UI camera filter' }).first().click();
  await expect(page.locator('.cart-table input.qty')).toHaveCount(2);
  // Create a product and capture a scanner burst while the part name is focused.
  await page.goto(web + '/#parts');
  await page.getByRole('button', { name: '＋ Add part', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add part', exact: true });
  await dialog.getByLabel('Part name', { exact: true }).fill('UI created sensor');
  await dialog.getByLabel('Internal SKU').fill('UI-CREATED-SENSOR');
  await dialog.getByLabel('Selling price ₹').fill('99');
  await dialog.getByLabel('Part name', { exact: true }).focus();
  await hardware('UI-CREATED-CODE');
  await expect(dialog.getByLabel('Part name', { exact: true })).toHaveValue('UI created sensor');
  await expect(dialog.getByLabel('Product code value')).toHaveValue('UI-CREATED-CODE');
  await dialog.getByRole('button', { name: 'Add code', exact: true }).click();
  await expect(dialog.locator('.draft-code')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Generate QR', exact: true }).click();
  await expect(dialog.locator('.draft-code')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Save part', exact: true }).click();
  await page.getByRole('button', { name: 'Codes & Labels', exact: true }).click();
  await expect(page.locator('.code-preview')).toHaveCount(2);
  await page.getByLabel('Product code value').fill('UI-MULTI-1');
  await page.getByRole('button', { name: 'Check availability', exact: true }).click();
  await expect(page.getByText(/already assigned to UI many filter/)).toBeVisible();
  await page.getByRole('button', { name: 'Preview / Print label', exact: true }).first().click();
  await page.getByRole('button', { name: 'Generate labels', exact: true }).click();
  await expect(page.getByTitle('Printable product labels')).toBeVisible();
  await page.screenshot({ path: '.local/scanner-qa/labels.png', fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download labels' }).click();
  await (await downloadPromise).saveAs('.local/scanner-qa/labels.pdf');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  // Purchase receiving increments only a matching purchase line.
  const supplier = await api('/suppliers', { name: 'Scanner QA Supplier', phone: '9000000001' });
  const purchase = await api('/purchases', {
    supplier_id: supplier.id,
    lines: [{ part_id: multiple.id, quantity_ordered: 3, rate_paise: 5000, gst_bps: 0 }],
  });
  await page.goto(web + '/#purchases/' + purchase.id);
  await page.getByRole('button', { name: 'Receive goods', exact: true }).click();
  await hardware('UI-MULTI-1');
  await expect(page.getByRole('dialog').locator('input.qty')).toHaveValue('1');
  await hardware('UI-MULTI-1');
  await expect(page.getByRole('dialog').locator('input.qty')).toHaveValue('2');
  await hardware('000099887766');
  await expect(page.getByText(/no remaining quantity on this purchase/)).toBeVisible();
  await expect(page.getByRole('dialog').locator('input.qty')).toHaveValue('2');
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const sale = await api('/sales/invoices', {
    lines: [{ part_id: multiple.id, quantity: 1 }],
    payments: [{ mode: 'CASH', amount_paise: 10000 }],
  });
  await page.goto(web + '/#invoices/' + sale.id);
  await page.getByRole('button', { name: /sales return/i }).click();
  await hardware('000099887766');
  await expect(page.getByText('This product was not on the original invoice.')).toBeVisible();
  await hardware('UI-MULTI-1');
  await expect(page.getByText(/selected for return/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await page.goto(web + '/#warranty');
  await hardware('UI-MULTI-1');
  await expect(page.getByText(sale.invoice_number, { exact: true })).toBeVisible();
  // Decode real generated barcode and QR pixels from a synthetic MediaStream.
  const barcodePng = await bwipjs.toBuffer({
    bcid: 'code128',
    text: 'UI-CAMERA-1',
    scale: 4,
    height: 16,
    padding: 20,
    backgroundcolor: 'FFFFFF',
  });
  const qrPng = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: qr.code,
    scale: 6,
    padding: 4,
    eclevel: 'M',
    backgroundcolor: 'FFFFFF',
  });
  const mockCamera = ({ barcode }) => {
    window.__qaFrame = barcode;
    window.__qaStreams = [];
    window.__qaDeny = false;
    navigator.mediaDevices.getUserMedia = async () => {
      if (window.__qaDeny) throw new DOMException('Denied', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const draw = canvas.getContext('2d');
      const image = new Image();
      let last = '';
      const paint = () => {
        if (last !== window.__qaFrame) {
          last = window.__qaFrame;
          image.src = last || '';
        }
        draw.fillStyle = 'white';
        draw.fillRect(0, 0, 1280, 720);
        if (image.complete && image.naturalWidth) {
          const scale = Math.min(950 / image.naturalWidth, 500 / image.naturalHeight);
          const w = image.naturalWidth * scale,
            h = image.naturalHeight * scale;
          draw.drawImage(image, (1280 - w) / 2, (720 - h) / 2, w, h);
        }
      };
      paint();
      const timer = setInterval(paint, 60);
      const stream = canvas.captureStream(15);
      window.__qaStreams.push(stream);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          stop();
        };
      }
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: 'videoinput', deviceId: 'rear', label: 'Test rear camera' },
      { kind: 'videoinput', deviceId: 'front', label: 'Test front camera' },
    ];
  };
  const cameraArg = { barcode: 'data:image/png;base64,' + barcodePng.toString('base64') };
  await context.grantPermissions(['camera'], { origin: web });
  await context.addInitScript(mockCamera, cameraArg);
  await page.evaluate(mockCamera, cameraArg);
  const settings = await api('/scanner/settings', undefined, 'get');
  await api('/scanner/settings', { ...settings, continuous_camera: true }, 'patch');
  await page.reload();
  await billing();
  await page.getByRole('button', { name: 'Scan with camera', exact: true }).click();
  await expect(qty).toHaveValue('1', { timeout: 15000 });
  await page.waitForTimeout(2200);
  await expect(qty).toHaveValue('1');
  await page.evaluate(
    (value) => {
      window.__qaFrame = value;
    },
    'data:image/png;base64,' + qrPng.toString('base64'),
  );
  await expect(qty).toHaveValue('2', { timeout: 15000 });
  await page.waitForTimeout(2200);
  await expect(qty).toHaveValue('2');
  await page.screenshot({ path: '.local/scanner-qa/camera.png', fullPage: true });
  await page.getByRole('button', { name: 'Scan same label again' }).click();
  await expect(qty).toHaveValue('3');
  await page.getByRole('button', { name: 'Use hardware scanner / Close' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__qaStreams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.__qaDeny = true;
  });
  await page.getByRole('button', { name: 'Scan with camera', exact: true }).click();
  await expect(page.getByText(/Camera permission is required/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Enter code manually' }).click();
  await page.getByLabel('Barcode or QR value').fill('UI-CAMERA-1');
  await page.getByRole('button', { name: 'Resolve code', exact: true }).click();
  await expect(qty).toHaveValue('4');
  expect(errors).toEqual([]);
  console.log(
    'Browser checks passed: typing coexistence, focused fields, exact repeated scans, stock limits, create/capture, duplicates, labels, receiving, returns, warranty, real barcode/QR decoding, stationary frame suppression, camera cleanup and permission fallback.',
  );
} catch (error) {
  await page.screenshot({ path: '.local/scanner-qa/failure.png', fullPage: true }).catch(() => {});
  writeFileSync(
    '.local/scanner-qa/failure.txt',
    await page
      .locator('body')
      .innerText()
      .catch(() => ''),
  );
  throw error;
} finally {
  await context.close();
  await browser.close();
}
