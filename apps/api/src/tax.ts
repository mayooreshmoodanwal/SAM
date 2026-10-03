import { ValidationError } from './validation.js';
import { shopDate } from './dates.js';

export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE' | 'EXEMPT';
export type LineInput = {
  quantity: number;
  ratePaise: number;
  discountPaise?: number;
  gstBps: number;
  taxMode: TaxMode;
};
export type LineTotal = {
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
};
function roundedRatio(value: number, multiplier: number, divisor: number): number {
  return Number(
    (BigInt(value) * BigInt(multiplier) + BigInt(Math.floor(divisor / 2))) / BigInt(divisor),
  );
}
export function calculateLine(input: LineInput): LineTotal {
  const { quantity, ratePaise, gstBps, taxMode } = input;
  const discountPaise = input.discountPaise ?? 0;
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(ratePaise) ||
    ratePaise < 0 ||
    !Number.isSafeInteger(discountPaise) ||
    discountPaise < 0 ||
    !Number.isInteger(gstBps) ||
    gstBps < 0 ||
    gstBps > 10000
  )
    throw new ValidationError('Invalid invoice line.');
  const subtotalPaise = quantity * ratePaise;
  if (!Number.isSafeInteger(subtotalPaise))
    throw new ValidationError('Invoice line value is too large.');
  if (discountPaise > subtotalPaise) throw new ValidationError('Discount exceeds line value.');
  const afterDiscount = subtotalPaise - discountPaise;
  if (taxMode === 'EXEMPT' || gstBps === 0)
    return {
      subtotalPaise,
      discountPaise,
      taxablePaise: afterDiscount,
      gstPaise: 0,
      totalPaise: afterDiscount,
    };
  if (taxMode === 'INCLUSIVE') {
    const taxablePaise = roundedRatio(afterDiscount, 10000, 10000 + gstBps);
    return {
      subtotalPaise,
      discountPaise,
      taxablePaise,
      gstPaise: afterDiscount - taxablePaise,
      totalPaise: afterDiscount,
    };
  }
  const gstPaise = roundedRatio(afterDiscount, gstBps, 10000);
  if (!Number.isSafeInteger(afterDiscount + gstPaise))
    throw new ValidationError('Invoice line value is too large.');
  return {
    subtotalPaise,
    discountPaise,
    taxablePaise: afterDiscount,
    gstPaise,
    totalPaise: afterDiscount + gstPaise,
  };
}
export function calculateInvoice(lines: LineTotal[], invoiceDiscountPaise = 0, interstate = false) {
  const subtotalPaise = lines.reduce((n, l) => n + l.subtotalPaise, 0);
  const lineDiscountPaise = lines.reduce((n, l) => n + l.discountPaise, 0);
  const taxableBeforeDiscount = lines.reduce((n, l) => n + l.taxablePaise, 0);
  const gstBeforeDiscount = lines.reduce((n, l) => n + l.gstPaise, 0);
  const grossBeforeDiscount = taxableBeforeDiscount + gstBeforeDiscount;
  if (
    !Number.isSafeInteger(invoiceDiscountPaise) ||
    invoiceDiscountPaise < 0 ||
    invoiceDiscountPaise > grossBeforeDiscount
  )
    throw new ValidationError('Invalid invoice discount.');
  if (
    ![
      subtotalPaise,
      lineDiscountPaise,
      taxableBeforeDiscount,
      gstBeforeDiscount,
      grossBeforeDiscount,
    ].every(Number.isSafeInteger)
  )
    throw new ValidationError('Invoice value is too large.');
  // Invoice discount is a gross-amount discount; tax is reduced proportionally.
  const totalPaise = grossBeforeDiscount - invoiceDiscountPaise;
  const gstPaise = grossBeforeDiscount
    ? roundedRatio(gstBeforeDiscount, totalPaise, grossBeforeDiscount)
    : 0;
  const taxablePaise = totalPaise - gstPaise;
  const cgstPaise = interstate ? 0 : Math.floor(gstPaise / 2);
  const sgstPaise = interstate ? 0 : gstPaise - cgstPaise;
  return {
    subtotalPaise,
    discountPaise: lineDiscountPaise + invoiceDiscountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise: interstate ? gstPaise : 0,
    totalPaise,
    roundOffPaise: 0,
  };
}
export function financialYear(date = new Date()) {
  const [year, month] = shopDate(date).split('-').map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}
