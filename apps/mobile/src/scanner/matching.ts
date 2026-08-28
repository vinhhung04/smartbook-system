/**
 * Compares a scanned/typed code against one or more expected values (location
 * codes, order numbers, etc.). Trims whitespace and matches case-insensitively,
 * since barcode scanners and manual entry can vary in case.
 */
export function matchesCode(candidates: (string | null | undefined)[], scanned: string): boolean {
  const normalizedScanned = scanned.trim().toUpperCase();
  if (!normalizedScanned) return false;

  return candidates
    .filter((c): c is string => Boolean(c))
    .some((c) => c.trim().toUpperCase() === normalizedScanned);
}
