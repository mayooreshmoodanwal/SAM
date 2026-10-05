import { z } from 'zod';
import bwipjs from 'bwip-js';

export function normalizeCode(value: string): string {
  return value.trim();
}
export const codeValue = z
  .string()
  .max(520)
  .transform(normalizeCode)
  .pipe(
    z
      .string()
      .min(1, 'Enter a code.')
      .max(512)
      .regex(/^[^\x00-\x1f\x7f]+$/u, 'Codes cannot contain control characters.'),
  );
export const codeTypes = [
  'MANUFACTURER_BARCODE',
  'INTERNAL_BARCODE',
  'OEM_BARCODE',
  'QR_CODE',
  'SUPPLIER_BARCODE',
  'PACKAGING_BARCODE',
  'ALTERNATE_BARCODE',
] as const;
export const codeFormats = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'ITF',
  'CODABAR',
  'QR_CODE',
  'DATA_MATRIX',
  'UNKNOWN',
] as const;
export const codeInput = z.object({
  code: codeValue,
  code_type: z.enum(codeTypes).default('MANUFACTURER_BARCODE'),
  format: z.enum(codeFormats).default('UNKNOWN'),
  source: z
    .enum(['MANUFACTURER', 'SUPPLIER', 'SHANTI_AUTO_MOBILES', 'ADMIN_MANUAL', 'IMPORT', 'LEGACY'])
    .default('ADMIN_MANUAL'),
  is_primary: z.boolean().default(false),
  notes: z.string().max(1000).optional().nullable(),
  resolve_conflict: z.boolean().default(false),
});
export type CodeInput = z.infer<typeof codeInput>;
export const scanSource = z.enum(['HARDWARE_KEYBOARD', 'HARDWARE_HID', 'CAMERA', 'MANUAL_CODE']);
export const scanContext = z.enum([
  'BILLING',
  'PRODUCT_LOOKUP',
  'PRODUCT_BARCODE_CAPTURE',
  'PURCHASE_RECEIVING',
  'STOCK_LOOKUP',
  'SALES_RETURN',
  'WARRANTY',
]);
export const scannerSettings = z.object({
  enabled: z.boolean(),
  terminator: z.enum(['AUTO', 'ENTER', 'TAB']),
  min_length: z.number().int().min(1).max(32),
  max_gap_ms: z.number().int().min(10).max(100),
  max_average_ms: z.number().int().min(5).max(80),
  sound: z.boolean(),
  continuous_camera: z.boolean(),
  camera_facing: z.enum(['environment', 'user']),
  camera_cooldown_ms: z.number().int().min(500).max(5000),
});
const formats: Record<string, string> = {
  EAN_13: 'ean13',
  EAN_8: 'ean8',
  UPC_A: 'upca',
  UPC_E: 'upce',
  CODE_128: 'code128',
  CODE_39: 'code39',
  ITF: 'interleaved2of5',
  CODABAR: 'rationalizedCodabar',
  QR_CODE: 'qrcode',
  DATA_MATRIX: 'datamatrix',
};
export function barcodeOptions(code: string, format: string) {
  const actual =
    format === 'UNKNOWN' ? (/^[\x20-\x7e]{1,32}$/.test(code) ? 'CODE_128' : 'QR_CODE') : format;
  const matrix = actual === 'QR_CODE' || actual === 'DATA_MATRIX';
  return {
    bcid: formats[actual] || 'code128',
    text: code,
    scale: 3,
    paddingwidth: matrix ? 4 : 12,
    paddingheight: matrix ? 4 : 3,
    backgroundcolor: 'FFFFFF',
    ...(matrix ? { eclevel: 'M' } : { height: 12, includetext: false }),
  };
}
export function validateCodeFormat(code: string, format: string): void {
  if (format === 'UNKNOWN') return;
  const lengths: Record<string, number> = { EAN_13: 13, EAN_8: 8, UPC_A: 12, UPC_E: 8 };
  if (lengths[format] && (!/^\d+$/.test(code) || code.length !== lengths[format]))
    throw new Error(
      `${format.replace('_', '-')} requires ${lengths[format]} digits including its check digit.`,
    );
  try {
    bwipjs.toSVG(barcodeOptions(code, format));
  } catch {
    throw new Error(`The code is not valid for ${format.replaceAll('_', ' ')}.`);
  }
}
