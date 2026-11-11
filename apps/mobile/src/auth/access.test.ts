import { canUseStaffFeature, isWarehouseManager, resolveAppArea } from './access';
import type { User } from '../types/auth';

const base: User = { id: 'u', username: 'u', email: 'u@x.vn', roles: [], permissions: [] };

describe('resolveAppArea', () => {
  it('sends readers to the customer area', () => {
    expect(resolveAppArea({ ...base, roles: ['CUSTOMER'] })).toBe('customer');
  });

  it('sends warehouse roles and superusers to the staff area', () => {
    expect(resolveAppArea({ ...base, roles: ['WAREHOUSE_STAFF'] })).toBe('staff');
    expect(resolveAppArea({ ...base, roles: ['ADMIN'] })).toBe('staff');
    expect(resolveAppArea({ ...base, is_superuser: true })).toBe('staff');
  });

  it('does not treat every non-customer as staff', () => {
    expect(resolveAppArea({ ...base, roles: ['SUPPLIER'] })).toBe('unsupported');
    expect(resolveAppArea({ ...base, roles: ['ACCOUNTANT'] })).toBe('unsupported');
    expect(resolveAppArea(base)).toBe('unsupported');
  });
});

describe('canUseStaffFeature', () => {
  const staff: User = { ...base, roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.task.read', 'inventory.task.progress'] };

  it('requires both a warehouse role and the permission, like the backend guard', () => {
    expect(canUseStaffFeature(staff, 'picking')).toBe(true);
    expect(canUseStaffFeature(staff, 'exceptions')).toBe(false);
    expect(canUseStaffFeature({ ...staff, roles: ['LIBRARIAN'] }, 'picking')).toBe(false);
  });

  it('lets superusers through and nobody when signed out', () => {
    expect(canUseStaffFeature({ ...base, is_superuser: true }, 'audit')).toBe(true);
    expect(canUseStaffFeature(null, 'picking')).toBe(false);
  });
});

describe('isWarehouseManager', () => {
  it('matches the backend canManageAssignment rule', () => {
    expect(isWarehouseManager({ ...base, roles: ['WAREHOUSE_MANAGER'] })).toBe(true);
    expect(isWarehouseManager({ ...base, roles: ['ADMIN'] })).toBe(true);
    expect(isWarehouseManager({ ...base, is_superuser: true })).toBe(true);
    expect(isWarehouseManager({ ...base, roles: ['WAREHOUSE_STAFF'] })).toBe(false);
  });
});
