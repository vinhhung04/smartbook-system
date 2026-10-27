import { LOW_CONFIDENCE_THRESHOLD, matchCoverCandidatesToAudit, nextCount } from './auditCoverMatch';
import type { CoverSearchCandidate } from '../api/coverSearch';
import type { StockAuditLine } from '../types/stockAudit';

function line(overrides: Partial<StockAuditLine>): StockAuditLine {
  return {
    id: 'l1',
    variant_id: 'v1',
    location_id: 'loc1',
    location_code: 'A-01',
    sku: null,
    isbn13: '9786041234567',
    isbn10: null,
    barcode: null,
    title: 'Sách A',
    expected_qty: 3,
    counted_qty: null,
    variance_qty: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<CoverSearchCandidate>): CoverSearchCandidate {
  return {
    id: 'b1',
    title: 'Sách A',
    subtitle: null,
    description: null,
    author: null,
    category: null,
    publisher: null,
    isbn: '978-604-123-456-7',
    language: null,
    publish_year: null,
    summary_vi: null,
    cover_image_url: null,
    quantity: 1,
    available_quantity: 1,
    variant_id: null,
    default_warehouse_id: null,
    default_location_id: null,
    reservable: true,
    is_incomplete: false,
    locations: [],
    confidence: 0.9,
    evidence: [{ signal: 'visual', score: 0.9, label: 'Ảnh bìa khớp 90%' }],
    ...overrides,
  };
}

describe('matchCoverCandidatesToAudit', () => {
  it('drops candidates that are not on this audit sheet', () => {
    const result = matchCoverCandidatesToAudit([candidate({ isbn: '9780000000000' })], [line({})]);
    expect(result).toEqual([]);
  });

  it('matches by ISBN ignoring dashes', () => {
    const [match] = matchCoverCandidatesToAudit([candidate({})], [line({})]);
    expect(match.line.id).toBe('l1');
    expect(match.lowConfidence).toBe(false);
    expect(match.evidence).toEqual(['Ảnh bìa khớp 90%']);
  });

  it('prefers the exact edition from the visual match', () => {
    const lines = [line({ id: 'l1', variant_id: 'v1', isbn13: null }), line({ id: 'l2', variant_id: 'v2', isbn13: null })];
    const result = matchCoverCandidatesToAudit([candidate({ variant_id: 'v2', isbn: null })], lines);
    expect(result.map((m) => m.line.id)).toEqual(['l2']);
  });

  it('offers one option per shelf location of the same book, never picking one silently', () => {
    const lines = [line({ id: 'l1', location_code: 'A-01' }), line({ id: 'l2', location_code: 'B-02' })];
    const result = matchCoverCandidatesToAudit([candidate({})], lines);
    expect(result.map((m) => m.line.location_code).sort()).toEqual(['A-01', 'B-02']);
  });

  it('flags low confidence and sorts by confidence', () => {
    const lines = [line({ id: 'l1', isbn13: '111' }), line({ id: 'l2', isbn13: '222' })];
    const result = matchCoverCandidatesToAudit(
      [candidate({ isbn: '111', confidence: 0.55 }), candidate({ id: 'b2', isbn: '222', confidence: 0.95 })],
      lines,
    );
    expect(result.map((m) => m.line.id)).toEqual(['l2', 'l1']);
    expect(result[1].lowConfidence).toBe(true);
    expect(result[1].confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it('keeps the best confidence when two candidates hit the same line', () => {
    const result = matchCoverCandidatesToAudit([candidate({ confidence: 0.6 }), candidate({ id: 'b2', confidence: 0.8 })], [line({})]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.8);
  });
});

describe('nextCount', () => {
  it('adds one copy to the current count', () => {
    expect(nextCount({ counted_qty: null })).toBe(1);
    expect(nextCount({ counted_qty: 4 })).toBe(5);
  });
});
