export type QuantityResult = { ok: true; value: number } | { ok: false; error: string };

type Options = {
  /** Smallest accepted value (default 1). Counting a shelf can legitimately be 0. */
  min?: number;
  /** Largest accepted value, e.g. what is left on the line or the bin's free capacity. */
  max?: number;
  /** How the limit is described in the error, e.g. "số còn lại của dòng". */
  maxLabel?: string;
};

// Book stock moves in whole copies. The backend's toInt() silently truncates "1.5"
// to 1, so a decimal must be refused here rather than recorded as something else.
const WHOLE_NUMBER = /^\d+$/;

export function parseWholeQuantity(raw: string, { min = 1, max, maxLabel }: Options = {}): QuantityResult {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, error: 'Vui lòng nhập số lượng' };
  if (!WHOLE_NUMBER.test(text)) return { ok: false, error: 'Số lượng phải là số nguyên không âm (không dùng dấu thập phân)' };
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'Số lượng quá lớn' };
  if (value < min) return { ok: false, error: min === 0 ? 'Số lượng không được âm' : `Số lượng phải từ ${min} trở lên` };
  if (max !== undefined && value > max) {
    return { ok: false, error: `Số lượng không được vượt quá ${max}${maxLabel ? ` (${maxLabel})` : ''}` };
  }
  return { ok: true, value };
}

/** Optional field (e.g. exception report quantities): empty means "not given". */
export function parseOptionalQuantity(raw: string): QuantityResult | { ok: true; value: undefined } {
  if (!String(raw ?? '').trim()) return { ok: true, value: undefined };
  return parseWholeQuantity(raw, { min: 0 });
}

/** Keeps only digits while typing — number-pad still lets some keyboards enter "." or "-". */
export function sanitizeQuantityInput(text: string): string {
  return text.replace(/[^0-9]/g, '');
}
