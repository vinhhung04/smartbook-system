export function formatDateTime(value?: string | null, locale = 'vi-VN') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(locale);
}

export function formatCurrencyVnd(value?: number | string | null) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('vi-VN')} VND`;
}

export function toNumber(value?: number | string | null) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

/** The reading-stats API only returns months that had loans; fill the gaps with 0 so one busy month does not render as a lone dot. */
export function fillMonths(data: { month: string; count: number }[], months = 12, now = new Date()) {
  const counts = new Map(data.map((d) => [d.month, d.count]));
  const last = data.length ? data[data.length - 1].month : '';
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = (last > nowKey ? last : nowKey).split('-').map(Number);
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(y, m - 1 - (months - 1 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { month: key, label: `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`, count: counts.get(key) ?? 0 };
  });
}
