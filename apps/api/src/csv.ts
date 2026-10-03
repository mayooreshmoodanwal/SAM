import { parse } from 'csv-parse/sync';

export function parseCsv(source: string): string[][] {
  return parse(source, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    max_record_size: 100_000,
  });
}
export const importHeaders = [
  'Part Name',
  'Short Name',
  'OEM Number',
  'SKU',
  'Category',
  'Brand',
  'Purchase Price',
  'Selling Price',
  'MRP',
  'GST',
  'Tax Mode',
  'HSN',
  'Opening Stock',
  'Minimum Stock',
  'Rack',
  'Barcode',
];
export function csvTemplate() {
  return importHeaders.join(',') + '\n';
}
