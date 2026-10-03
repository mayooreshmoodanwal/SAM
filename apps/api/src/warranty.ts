import { shopDate } from './dates.js';
export function warrantyWindow(saleInstant: Date, months: number, today = new Date()) {
  if (!Number.isInteger(months) || months <= 0) throw new Error('Invalid warranty period.');
  const start = shopDate(saleInstant);
  const [year, month, day] = start.split('-').map(Number);
  const targetMonthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(targetMonthIndex / 12),
    targetMonth = (targetMonthIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const end = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  return { start, end, expired: shopDate(today) > end };
}
