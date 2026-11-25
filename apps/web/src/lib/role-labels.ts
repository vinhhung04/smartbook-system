// Seeded role names are English (auth-service seed); the staff UI shows them in Vietnamese.
// Custom roles keep the name an admin typed.
const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Quản trị viên',
  CUSTOMER: 'Bạn đọc',
  LIBRARIAN: 'Thủ thư',
  SUPPLIER: 'Nhà cung cấp',
  MANAGER: 'Quản lý',
  WAREHOUSE_STAFF: 'Nhân viên kho',
};

export function roleLabel(code: string, name?: string | null): string {
  return ROLE_LABELS[code] ?? name ?? code;
}
