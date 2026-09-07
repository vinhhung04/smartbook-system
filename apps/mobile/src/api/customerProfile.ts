import { apiFetch } from './client';
import type { CustomerProfile, MembershipInfo } from '../types/customerProfile';

export function getMyProfile() {
  return apiFetch<{ data: CustomerProfile }>('/my/profile');
}

export function getMyMembership() {
  return apiFetch<{ data: MembershipInfo }>('/my/membership');
}
