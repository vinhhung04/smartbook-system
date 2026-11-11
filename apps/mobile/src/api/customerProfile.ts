import { apiFetch } from './client';
import type { CustomerProfile, CustomerProfileUpdate, MembershipInfo } from '../types/customerProfile';

export function getMyProfile() {
  return apiFetch<{ data: CustomerProfile }>('/my/profile');
}

/** 404 = the reader has no active membership plan (not an error for the profile screen). */
export function getMyMembership() {
  return apiFetch<{ data: MembershipInfo }>('/my/membership');
}

export function updateMyProfile(update: CustomerProfileUpdate) {
  return apiFetch<{ data: CustomerProfile }>('/my/profile', { method: 'PATCH', body: update });
}
