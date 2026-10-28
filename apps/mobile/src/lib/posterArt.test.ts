import { getClothColor, hashString } from './posterArt';

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
  });

  it('differs for different strings', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('getClothColor', () => {
  it('gives one category the same cloth every time', () => {
    expect(getClothColor('Kinh tế')).toBe(getClothColor('Kinh tế'));
  });

  it('treats a missing category like "Chưa phân loại"', () => {
    expect(getClothColor(null)).toBe(getClothColor('Chưa phân loại'));
  });

  it('gives different categories different cloth', () => {
    expect(getClothColor('Văn học Việt Nam')).not.toBe(getClothColor('Truyện ngắn'));
  });
});
