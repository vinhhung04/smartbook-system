import { getCategoryGradient, getMonogramLetter, hashString } from './posterArt';

describe('getCategoryGradient', () => {
  it('returns the same gradient for a known category every time', () => {
    const first = getCategoryGradient('Van hoc Viet Nam');
    const second = getCategoryGradient('Van hoc Viet Nam');
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
  });

  it('treats null category the same as the literal "Chưa phân loại" bucket', () => {
    expect(getCategoryGradient(null)).toEqual(getCategoryGradient('Chưa phân loại'));
  });

  it('returns a deterministic fallback gradient for an unknown category', () => {
    const first = getCategoryGradient('Some Future Category');
    const second = getCategoryGradient('Some Future Category');
    expect(first).toEqual(second);
  });

  it('gives different categories different gradients', () => {
    expect(getCategoryGradient('Van hoc Viet Nam')).not.toEqual(getCategoryGradient('Truyen ngan'));
  });
});

describe('getMonogramLetter', () => {
  it('returns the uppercased first letter of the title', () => {
    expect(getMonogramLetter('Dế Mèn Phiêu Lưu Ký')).toBe('D');
  });

  it('handles a title starting with punctuation by skipping to the first letter', () => {
    expect(getMonogramLetter('"Chiếc lá cuối cùng"')).toBe('C');
  });

  it('falls back to # when there is no letter at all', () => {
    expect(getMonogramLetter('123')).toBe('#');
  });
});

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
  });

  it('differs for different strings', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});
