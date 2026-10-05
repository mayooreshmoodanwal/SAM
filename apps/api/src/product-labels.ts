import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import bwipjs from 'bwip-js';
import { fileURLToPath } from 'node:url';
import { barcodeOptions } from './product-code-domain.js';

export async function renderLabels(
  rows: any[],
  options: {
    template: string;
    layout: string;
    show_price: boolean;
    show_oem: boolean;
    show_sku: boolean;
  },
  business: string,
): Promise<Buffer> {
  const width = options.template === 'MINIMAL' ? 170 : 190,
    height = options.template === 'MINIMAL' ? 113 : 142;
  const roll = options.layout === 'ROLL';
  const doc = new PDFDocument({
    size: roll ? [width, height] : 'A4',
    margin: 0,
    autoFirstPage: false,
  });
  doc.registerFont('Label', fileURLToPath(new URL('../assets/latin.woff', import.meta.url)));
  doc.registerFont('Hindi', fileURLToPath(new URL('../assets/devanagari.woff', import.meta.url)));
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const columns = roll ? 1 : Math.floor((595.28 - 24) / width),
    perPage = roll ? 1 : columns * Math.floor((841.89 - 24) / height);
  let index = 0;
  for (const row of rows) {
    const svg = bwipjs.toSVG(barcodeOptions(row.code, row.format));
    for (let copy = 0; copy < row.quantity; copy++, index++) {
      if (index % perPage === 0) doc.addPage();
      const slot = index % perPage,
        x = roll ? 0 : 12 + (slot % columns) * width,
        y = roll ? 0 : 12 + Math.floor(slot / columns) * height;
      const draw = (text: string, offset: number, size = 8) =>
        doc
          .font(/[\u0900-\u097f₹]/u.test(text) ? 'Hindi' : 'Label')
          .fontSize(size)
          .fillColor('black')
          .text(text, x + 7, y + offset, {
            width: width - 14,
            height: size + 3,
            lineBreak: false,
            ellipsis: true,
            align: 'center',
          });
      if (options.template !== 'MINIMAL') draw(business, 6, 7);
      draw(row.name, options.template === 'MINIMAL' ? 6 : 18, 9);
      const info = [options.show_oem && row.oem_number, options.show_sku && row.sku]
        .filter(Boolean)
        .join(' · ');
      draw(info, options.template === 'MINIMAL' ? 19 : 32, 7);
      const top = options.template === 'MINIMAL' ? 32 : 46;
      SVGtoPDF(doc, svg, x + 7, y + top, {
        width: width - 14,
        height: height - top - 29,
        preserveAspectRatio: 'xMidYMid meet',
      });
      draw(row.code, height - 26, 7);
      if (options.show_price)
        draw(`₹${(Number(row.selling_price_paise) / 100).toFixed(2)}`, height - 14, 8);
    }
  }
  doc.end();
  return result;
}
