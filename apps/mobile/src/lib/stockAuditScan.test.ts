import { findAuditLineByCode, getAuditStatusLabel } from './stockAuditScan';
import type { StockAuditLine } from '../types/stockAudit';

const line = (overrides: Partial<StockAuditLine>): StockAuditLine => ({
  id: 'l1',
  variant_id: 'v1',
  location_id: 'loc',
  location_code: 'A-01-001',
  sku: null,
  isbn13: null,
  isbn10: null,
  barcode: null,
  title: 'Sách',
  expected_qty: 3,
  counted_qty: null,
  variance_qty: null,
  ...overrides,
});

describe('findAuditLineByCode', () => {
  const lines = [
    line({ id: 'a', sku: 'SKU-BK001-PB-01', isbn13: '9786041234567', isbn10: '6041234560', barcode: 'BC-BK001-PB-01' }),
    line({ id: 'b', sku: 'SKU-EXT-001-PB', isbn13: '9786042389001', barcode: 'BC-EXT-001' }),
  ];

  it('matches SKU, ISBN-13, ISBN-10 and the internal barcode', () => {
    expect(findAuditLineByCode(lines, 'SKU-BK001-PB-01')?.id).toBe('a');
    expect(findAuditLineByCode(lines, '9786041234567')?.id).toBe('a');
    expect(findAuditLineByCode(lines, '6041234560')?.id).toBe('a');
    expect(findAuditLineByCode(lines, 'BC-BK001-PB-01')?.id).toBe('a');
    expect(findAuditLineByCode(lines, 'BC-EXT-001')?.id).toBe('b');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(findAuditLineByCode(lines, '  bc-ext-001 ')?.id).toBe('b');
  });

  it('returns undefined for unknown or empty codes, and never matches a null field against an empty scan', () => {
    expect(findAuditLineByCode(lines, 'BC-UNKNOWN')).toBeUndefined();
    expect(findAuditLineByCode(lines, '')).toBeUndefined();
    expect(findAuditLineByCode(lines, '   ')).toBeUndefined();
  });
});

describe('getAuditStatusLabel', () => {
  it('uses the same Vietnamese wording as the web and falls back to the raw value', () => {
    expect(getAuditStatusLabel('IN_PROGRESS')).toBe('Đang kiểm');
    expect(getAuditStatusLabel('SUBMITTED')).toBe('Chờ duyệt');
    expect(getAuditStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
