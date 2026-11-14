// Shared by the goods-receipt detail screen and its print sheet.
export function formatCurrency(value: number): string {
  return `${value.toLocaleString("vi-VN")} VND`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
