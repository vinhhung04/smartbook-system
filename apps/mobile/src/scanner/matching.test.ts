import { matchesCode } from './matching';

describe('matchesCode', () => {
  it('matches when scanned code equals a candidate exactly', () => {
    expect(matchesCode(['LOC-A1', 'BARCODE123'], 'LOC-A1')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(matchesCode(['LOC-A1'], 'loc-a1')).toBe(true);
    expect(matchesCode(['loc-a1'], 'LOC-A1')).toBe(true);
  });

  it('ignores surrounding whitespace on both sides', () => {
    expect(matchesCode(['LOC-A1'], '  loc-a1  ')).toBe(true);
    expect(matchesCode(['  LOC-A1  '], 'loc-a1')).toBe(true);
  });

  it('matches against any candidate in the list, not just the first', () => {
    expect(matchesCode(['id-uuid', 'LOC-A1', 'BARCODE123'], 'BARCODE123')).toBe(true);
  });

  it('rejects a code that matches none of the candidates', () => {
    expect(matchesCode(['LOC-A1', 'BARCODE123'], 'LOC-B2')).toBe(false);
  });

  it('rejects an empty or whitespace-only scan', () => {
    expect(matchesCode(['LOC-A1'], '')).toBe(false);
    expect(matchesCode(['LOC-A1'], '   ')).toBe(false);
  });

  it('skips null/undefined candidates without matching them', () => {
    expect(matchesCode([null, undefined, 'LOC-A1'], 'LOC-A1')).toBe(true);
    expect(matchesCode([null, undefined], 'LOC-A1')).toBe(false);
  });
});
