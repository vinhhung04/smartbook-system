import { validateProfileDraft } from './profileForm';

const original = { full_name: 'Nguyễn Văn An', phone: '', birth_date: '', address: '' };
const now = new Date('2026-10-27T00:00:00Z');

describe('validateProfileDraft', () => {
  it('sends only changed fields', () => {
    const result = validateProfileDraft({ ...original, phone: '0901234567' }, original, now);
    expect(result).toEqual({ ok: true, update: { phone: '0901234567' } });
  });

  it('clears an optional field with null', () => {
    const result = validateProfileDraft({ ...original, address: '' }, { ...original, address: 'Hà Nội' }, now);
    expect(result).toEqual({ ok: true, update: { address: null } });
  });

  it.each([
    [{ full_name: '  ' }, 'full_name'],
    [{ phone: 'gọi tôi' }, 'phone'],
    [{ birth_date: '2000-02-30' }, 'birth_date'],
    [{ birth_date: '30/02/2000' }, 'birth_date'],
    [{ birth_date: '2030-01-01' }, 'birth_date'],
    [{ address: 'x'.repeat(501) }, 'address'],
  ])('rejects %o', (patch, field) => {
    const result = validateProfileDraft({ ...original, ...patch }, original, now);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe(field);
  });
});
