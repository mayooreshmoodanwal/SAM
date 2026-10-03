import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

const latinFont = fileURLToPath(new URL('../assets/latin.woff', import.meta.url));
const devanagariFont = fileURLToPath(new URL('../assets/devanagari.woff', import.meta.url));
const money = (value: unknown) =>
  `₹${(Number(value || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (value: unknown) => String(value ?? '');

export async function renderInvoicePdf(invoice: any, lines: any[], business: any): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
  doc.registerFont('Latin', latinFont);
  doc.registerFont('Devanagari', devanagariFont);
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const left = 36;
  const right = 559;
  const width = right - left;
  const color = '#183246';

  function fontFor(value: string) {
    return /[\u0900-\u097f₹]/u.test(value) ? 'Devanagari' : 'Latin';
  }
  function draw(value: unknown, x: number, y: number, maxWidth: number, size = 9): number {
    const source = text(value);
    const tokens = source.match(/\r?\n|[\u0900-\u097f₹]+|[^\s\u0900-\u097f₹]+|[ \t]+/gu) || [];
    let cursorX = x;
    let cursorY = y;
    const lineHeight = size + 5;
    for (const token of tokens) {
      if (token === '\n' || token === '\r\n') {
        cursorX = x;
        cursorY += lineHeight;
        continue;
      }
      if (!token.trim() && cursorX === x) continue;
      const font = fontFor(token);
      doc.font(font).fontSize(size);
      for (const piece of doc.widthOfString(token) > maxWidth
        ? Array.from(
            new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment(token),
            (segment) => segment.segment,
          )
        : [token]) {
        const pieceWidth = doc.widthOfString(piece);
        if (cursorX > x && cursorX + pieceWidth > x + maxWidth) {
          cursorX = x;
          cursorY += lineHeight;
        }
        if (piece.trim()) doc.fillColor(color).text(piece, cursorX, cursorY, { lineBreak: false });
        cursorX += pieceWidth;
      }
    }
    return cursorY + lineHeight;
  }
  function rule(y: number) {
    doc.strokeColor('#c9d4db').lineWidth(0.7).moveTo(left, y).lineTo(right, y).stroke();
  }
  function newPage() {
    doc.addPage();
    return 42;
  }
  let y = 39;
  y = draw(business.name || 'Shanti Auto Mobiles', left, y, 320, 19);
  y = draw(business.address, left, y + 1, 320, 9);
  y = draw(
    [business.phone, business.gstin && `GSTIN: ${business.gstin}`].filter(Boolean).join(' · '),
    left,
    y,
    340,
  );
  draw('TAX INVOICE', 425, 40, 134, 12);
  draw(invoice.invoice_number, 425, 59, 134, 9);
  draw(
    new Date(invoice.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    425,
    75,
    134,
    8,
  );
  y = Math.max(y + 12, 109);
  rule(y);
  y += 12;
  draw('BILL TO', left, y, 250, 8);
  draw('VEHICLE', 315, y, 244, 8);
  const customerBottom = draw(invoice.customer_name || 'Walk-in Customer', left, y + 16, 250, 11);
  const phoneBottom = draw(
    [invoice.customer_phone, invoice.customer_gstin && `GSTIN: ${invoice.customer_gstin}`]
      .filter(Boolean)
      .join(' · '),
    left,
    customerBottom,
    250,
    8,
  );
  const vehicleBottom = draw(
    [
      invoice.registration_number,
      invoice.vehicle_model,
      invoice.chassis_number && `Chassis: ${invoice.chassis_number}`,
    ]
      .filter(Boolean)
      .join(' · '),
    315,
    y + 16,
    244,
    9,
  );
  y = Math.max(phoneBottom, vehicleBottom) + 12;

  const columns = [
    { label: '#', x: left, width: 22 },
    { label: 'PART / OEM', x: 58, width: 175 },
    { label: 'HSN', x: 237, width: 45 },
    { label: 'QTY', x: 286, width: 36 },
    { label: 'RATE', x: 326, width: 75 },
    { label: 'GST', x: 405, width: 62 },
    { label: 'AMOUNT', x: 471, width: 88 },
  ];
  function tableHeader(top: number) {
    doc.rect(left, top, width, 24).fill('#e9eef1');
    for (const col of columns) draw(col.label, col.x + 3, top + 6, col.width - 5, 8);
    return top + 24;
  }
  y = tableHeader(y);
  for (const [index, line] of lines.entries()) {
    if (y > 708) y = tableHeader(newPage());
    const top = y + 7;
    draw(index + 1, columns[0].x + 3, top, columns[0].width - 5);
    const nameBottom = draw(line.part_name, columns[1].x + 3, top, columns[1].width - 6);
    const skuBottom = draw(
      line.oem_number || line.sku,
      columns[1].x + 3,
      nameBottom,
      columns[1].width - 6,
      8,
    );
    draw(line.hsn, columns[2].x + 3, top, columns[2].width - 5);
    draw(`${line.quantity} ${line.unit}`, columns[3].x + 3, top, columns[3].width - 5);
    draw(money(line.rate_paise), columns[4].x + 3, top, columns[4].width - 5);
    draw(money(line.gst_paise), columns[5].x + 3, top, columns[5].width - 5);
    draw(money(line.total_paise), columns[6].x + 3, top, columns[6].width - 5);
    y = Math.max(top + 28, skuBottom + 5);
    rule(y);
  }
  const totals = [
    ['Subtotal', money(invoice.subtotal_paise)],
    ['Discount', money(invoice.discount_paise)],
    ['Taxable value', money(invoice.taxable_paise)],
    ...(Number(invoice.igst_paise) > 0
      ? [['IGST', money(invoice.igst_paise)]]
      : [
          ['CGST', money(invoice.cgst_paise)],
          ['SGST', money(invoice.sgst_paise)],
        ]),
    ['Grand total', money(invoice.total_paise)],
    ['Paid', money(invoice.paid_paise)],
    ['Pending', money(invoice.pending_paise)],
  ];
  if (y + totals.length * 20 + 110 > 795) y = newPage();
  y += 14;
  for (const [label, value] of totals) {
    if (label === 'Grand total') rule(y - 4);
    draw(label, 370, y, 100, label === 'Grand total' ? 10 : 9);
    draw(value, 476, y, 83, label === 'Grand total' ? 10 : 9);
    y += 20;
  }
  y += 15;
  rule(y);
  y += 10;
  y = draw(invoice.remarks || business.invoice_footer, left, y, width, 9);
  y = draw(business.terms, left, y + 4, width, 8);
  draw(`For ${business.name || 'Shanti Auto Mobiles'} · Authorized signature`, 315, y + 22, 244, 9);
  doc.end();
  return result;
}
