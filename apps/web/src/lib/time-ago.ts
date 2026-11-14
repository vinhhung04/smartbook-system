/** Age in words for a queue row: "12 phút", "3 giờ", "Hôm qua", "5 ngày", then the date. */
export function timeAgo(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "-";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "-";
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Hôm qua";
  if (days < 30) return `${days} ngày`;
  return new Date(t).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
