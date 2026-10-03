export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-SAM-Request': '1', ...options.headers },
  });
  if (!response.ok) {
    let message = 'Request failed.';
    try {
      message = (await response.json()).error || message;
    } catch {}
    if (response.status === 401 && message === 'Please sign in.')
      window.dispatchEvent(new Event('sam:session-expired'));
    throw new Error(message);
  }
  return response.json();
}
export const post = <T = any>(path: string, data: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T = any>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const rupees = (paise: unknown) =>
  `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateTime = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';
export const dateOnly = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
      })
    : '—';
export const paise = (rupeesValue: string | number) => Math.round(Number(rupeesValue || 0) * 100);

const shopDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function shopDate(date = new Date()): string {
  const parts = shopDateFormatter.formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function financialYearStart(date = new Date()): string {
  const [year, month] = shopDate(date).split('-').map(Number);
  return `${month >= 4 ? year : year - 1}-04-01`;
}

export function financialYearLabel(date = new Date()): string {
  const year = Number(financialYearStart(date).slice(0, 4));
  return `${year}–${String(year + 1).slice(-2)}`;
}
