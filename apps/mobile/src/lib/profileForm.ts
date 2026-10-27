import type { CustomerProfile, CustomerProfileUpdate } from '../types/customerProfile';

export type ProfileDraft = { full_name: string; phone: string; birth_date: string; address: string };

export function draftFromProfile(profile: CustomerProfile): ProfileDraft {
  return {
    full_name: profile.full_name ?? '',
    phone: profile.phone ?? '',
    birth_date: profile.birth_date ? profile.birth_date.slice(0, 10) : '',
    address: profile.address ?? '',
  };
}

export type ProfileCheck = { ok: true; update: CustomerProfileUpdate } | { ok: false; field: keyof ProfileDraft; error: string };

/** Mirrors borrow-service updateMyProfile validation; only changed fields are sent. */
export function validateProfileDraft(draft: ProfileDraft, original: ProfileDraft, now = new Date()): ProfileCheck {
  const name = draft.full_name.trim();
  if (!name || name.length > 150) return { ok: false, field: 'full_name', error: 'Họ tên không được để trống và tối đa 150 ký tự' };
  const phone = draft.phone.trim();
  if (phone && !/^\+?[0-9][0-9 .-]{6,28}$/.test(phone)) return { ok: false, field: 'phone', error: 'Số điện thoại không hợp lệ' };
  const birth = draft.birth_date.trim();
  if (birth) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    const valid = date && date.getUTCMonth() === Number(match![2]) - 1 && date.getUTCDate() === Number(match![3]);
    if (!valid || date!.getTime() > now.getTime() || date!.getUTCFullYear() < 1900) {
      return { ok: false, field: 'birth_date', error: 'Ngày sinh theo dạng YYYY-MM-DD và không ở tương lai' };
    }
  }
  const address = draft.address.trim();
  if (address.length > 500) return { ok: false, field: 'address', error: 'Địa chỉ tối đa 500 ký tự' };

  const update: CustomerProfileUpdate = {};
  if (name !== original.full_name.trim()) update.full_name = name;
  if (phone !== original.phone.trim()) update.phone = phone || null;
  if (birth !== original.birth_date.trim()) update.birth_date = birth || null;
  if (address !== original.address.trim()) update.address = address || null;
  return { ok: true, update };
}
