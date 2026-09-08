// Shared page-number generator for numbered pagination controls (ui/pagination.tsx).
// Produces a compressed range like [1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 12]
// instead of listing every page, once the total grows past a handful.
export function getPaginationRange(current: number, total: number): Array<number | "ellipsis-start" | "ellipsis-end"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const range: Array<number | "ellipsis-start" | "ellipsis-end"> = [1];
  if (current > 3) range.push("ellipsis-start");

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i += 1) range.push(i);

  if (current < total - 2) range.push("ellipsis-end");
  range.push(total);
  return range;
}
