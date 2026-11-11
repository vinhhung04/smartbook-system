const numberFormat = new Intl.NumberFormat('vi-VN');
const percentFormat = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const moneyFormat = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });

export function formatNumber(value: number) {
  return numberFormat.format(Number(value || 0));
}

export function formatMoney(value: number) {
  return moneyFormat.format(Number(value || 0));
}

/** One decimal, Vietnamese separator: 63,5% */
export function formatPercent(value: number) {
  return `${percentFormat.format(Number(value || 0))}%`;
}

/** Share of a whole, formatted like {@link formatPercent}; 0 when the whole is empty. */
export function formatShare(part: number, whole: number) {
  return formatPercent(whole > 0 ? (part / whole) * 100 : 0);
}

export function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatTime(date: Date) {
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function getGreeting(hour: number) {
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}
