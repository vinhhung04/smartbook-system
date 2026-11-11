const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Quản trị viên',
  WAREHOUSE_MANAGER: 'Quản lý kho',
  WAREHOUSE_STAFF: 'Nhân viên kho',
  LIBRARIAN: 'Thủ thư',
  CUSTOMER: 'Bạn đọc',
  SUPPLIER: 'Nhà cung cấp',
};

export function describeRoles(roles: string[]): string {
  const labels = roles.map((role) => ROLE_LABEL[String(role).toUpperCase()] ?? role);
  return labels.length > 0 ? labels.join(', ') : 'Chưa có vai trò';
}

/** Greeting by local hour: morning until 11, afternoon until 18, evening after. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 11) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}
