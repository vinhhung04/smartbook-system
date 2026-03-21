import type { RegisterRequest } from './auth';
import { aiService } from './ai';
import { authService } from './auth';
import { bookService, type BookUpdateRequest, type IncompleteBookRequest } from './book';
import { goodsReceiptService, type GoodsReceiptCreateRequest } from './goods-receipt';
import {
  aiAPI,
  authAPI,
  clearToken,
  domainAPIs,
  gatewayAPI,
  getApiErrorMessage,
  getToken,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  inventoryAPI,
  setToken,
  TOKEN_KEY,
  USER_KEY,
} from './http-clients';
import { roleService, type RoleCreateRequest } from './role';
import { stockMovementService } from './stock-movement';
import { userService, type UserCreateRequest, type UserUpdateRequest } from './user';
import { warehouseService, type WarehouseCreateRequest } from './warehouse';

// Legacy-compatible named exports used by JSX pages.
export async function login(identifier: string, password: string) {
  try {
    return await authService.login({ identifier, password });
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Dang nhap that bai.'));
  }
}

export async function register(payload: RegisterRequest) {
  try {
    return await authService.register(payload);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Dang ky that bai.'));
  }
}

export async function getAllBooks(params?: Record<string, unknown>) {
  return bookService.getAll(params);
}

export async function findBookByBarcode(barcode: string) {
  return bookService.findByBarcode(barcode);
}

export async function createIncompleteBook(payload: IncompleteBookRequest) {
  return bookService.createIncomplete(payload);
}

export async function updateBookDetails(id: string, payload: BookUpdateRequest) {
  return bookService.update(id, payload);
}

export async function generateBookSummary(title: string, author: string) {
  return aiService.generateBookSummary(title, author);
}

export async function getGoodsReceipts(params?: Record<string, unknown>) {
  return goodsReceiptService.getAll(params);
}

export async function getGoodsReceiptDetail(id: string) {
  return goodsReceiptService.getById(id);
}

export async function createGoodsReceipt(payload: GoodsReceiptCreateRequest) {
  return goodsReceiptService.create(payload);
}

export async function updateGoodsReceipt(id: string, next: string | { status?: string }) {
  const status = typeof next === 'string' ? next : next?.status;
  if (!status) {
    throw new Error('Missing goods receipt status.');
  }
  return goodsReceiptService.updateStatus(id, status);
}

export async function getStockMovements(params?: Record<string, unknown>) {
  return stockMovementService.getAll(params);
}

export async function getWarehouses(params?: Record<string, unknown>) {
  return warehouseService.getAll(params);
}

export async function createWarehouse(payload: {
  code: string;
  name: string;
  address?: string;
  type?: string;
}) {
  const data: WarehouseCreateRequest = {
    code: payload.code,
    name: payload.name,
    address_line1: payload.address,
    warehouse_type: payload.type,
  };
  return warehouseService.create(data);
}

export async function getWarehouseLocations(warehouseId: string) {
  const locations = await warehouseService.getLocations(warehouseId);
  return { locations };
}

export async function getUsers(params?: Record<string, unknown>) {
  return userService.getAll(params);
}

export async function createUser(payload: UserCreateRequest) {
  return userService.create(payload);
}

export async function updateUser(id: string, payload: UserUpdateRequest) {
  return userService.update(id, payload);
}

export async function getRoles(params?: Record<string, unknown>) {
  return roleService.getAll(params);
}

export async function createRole(payload: RoleCreateRequest) {
  return roleService.create(payload);
}

export async function getPermissions() {
  return roleService.getPermissions();
}

export async function updateRolePermissions(roleId: string, permissionIds: string[]) {
  return roleService.update(roleId, { permission_ids: permissionIds });
}

export {
  TOKEN_KEY,
  USER_KEY,
  getToken,
  setToken,
  clearToken,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getApiErrorMessage,
  domainAPIs,
};

export { authAPI, inventoryAPI, aiAPI, gatewayAPI };
