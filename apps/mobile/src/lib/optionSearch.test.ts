import { filterOptions, normalizeSearchText } from './optionSearch';

const OPTIONS = [
  { id: '1', title: 'Nguyễn Văn Hùng', subtitle: 'hung', keywords: 'hung@smartbook.vn' },
  { id: '2', title: 'Trần Thị Đào', subtitle: 'dao' },
  { id: '3', title: 'WH-HCM-01 — Kho HCM Chính', keywords: 'WH-HCM-01' },
];

describe('normalizeSearchText', () => {
  it('removes diacritics including đ', () => {
    expect(normalizeSearchText('Đào Hà Nội')).toBe('dao ha noi');
  });
});

describe('filterOptions', () => {
  it('returns everything for an empty query', () => {
    expect(filterOptions(OPTIONS, '  ')).toHaveLength(3);
  });

  it('matches without diacritics', () => {
    expect(filterOptions(OPTIONS, 'van hung').map((o) => o.id)).toEqual(['1']);
    expect(filterOptions(OPTIONS, 'dao').map((o) => o.id)).toEqual(['2']);
  });

  it('matches hidden keywords such as codes and emails', () => {
    expect(filterOptions(OPTIONS, 'smartbook.vn').map((o) => o.id)).toEqual(['1']);
    expect(filterOptions(OPTIONS, 'wh-hcm').map((o) => o.id)).toEqual(['3']);
  });

  it('requires every term to match', () => {
    expect(filterOptions(OPTIONS, 'hung dao')).toEqual([]);
  });
});
