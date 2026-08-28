import type { StaffRole } from './types';

// Reuses the exact color each role's home sidebar group already uses elsewhere in
// the app (admin=slate, warehouse tasks=violet, warehouse execution=cyan, library=amber)
// so the role dot on an avatar reads as "the same person" as their module color.
export const ROLE_META: Record<StaffRole, { label: string; dot: string; text: string; bg: string }> = {
  ADMIN: { label: 'Quản trị viên', dot: 'bg-slate-500', text: 'text-slate-600', bg: 'bg-slate-500/10' },
  WAREHOUSE_MANAGER: { label: 'Quản lý kho', dot: 'bg-violet-500', text: 'text-violet-600', bg: 'bg-violet-500/10' },
  WAREHOUSE_STAFF: { label: 'Nhân viên kho', dot: 'bg-cyan-500', text: 'text-cyan-600', bg: 'bg-cyan-500/10' },
  LIBRARIAN: { label: 'Thủ thư', dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-500/10' },
};
