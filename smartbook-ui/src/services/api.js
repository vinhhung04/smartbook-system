const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL || 'http://localhost:3002';

export const TOKEN_KEY = 'token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getTokenPayload() {
  try {
    const token = getToken();
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length < 2) return null;

    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function hasPermission(permissionCode) {
  const payload = getTokenPayload();
  if (!payload) return false;
  if (payload.is_superuser) return true;

  const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
  return permissions.includes(permissionCode);
}

export function hasAnyPermission(permissionCodes = []) {
  const payload = getTokenPayload();
  if (!payload) return false;
  if (payload.is_superuser) return true;

  const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
  return permissionCodes.some((code) => permissions.includes(code));
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;

  return payload.message || payload.error || payload.detail || fallback;
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
  };

  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    const message = createErrorMessage(payload, `Request failed with status ${response.status}`);
    throw new Error(message);
  }

  return payload;
}

export async function login(identifier, password) {
  const response = await fetch(`${AUTH_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: identifier,
      email: identifier,
      password,
    }),
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    const message = createErrorMessage(payload, 'Login failed');
    throw new Error(message);
  }

  const token = payload?.token || payload?.accessToken || payload?.data?.token;

  if (!token) {
    throw new Error('Login response does not include token');
  }

  return payload;
}

export async function register(payload) {
  const response = await fetch(`${AUTH_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    const message = createErrorMessage(data, 'Register failed');
    throw new Error(message);
  }

  return data;
}

async function authApiRequest(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
  };

  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${AUTH_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    const message = createErrorMessage(payload, `Request failed with status ${response.status}`);
    throw new Error(message);
  }

  return payload;
}

export async function getUsers(params = {}) {
  const query = new URLSearchParams();

  if (params.search) query.set('search', params.search);
  if (params.status) query.set('status', params.status);

  const suffix = query.toString() ? `?${query}` : '';
  return authApiRequest(`/iam/users${suffix}`, { method: 'GET' });
}

export async function createUser(payload) {
  return authApiRequest('/iam/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateUser(id, payload) {
  return authApiRequest(`/iam/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getRoles() {
  return authApiRequest('/iam/roles', { method: 'GET' });
}

export async function createRole(payload) {
  return authApiRequest('/iam/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getPermissions() {
  return authApiRequest('/iam/permissions', { method: 'GET' });
}

export async function updateRolePermissions(roleId, permissionIds) {
  return authApiRequest(`/iam/roles/${roleId}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permission_ids: permissionIds }),
  });
}

export async function getAllBooks() {
  return apiRequest('/api/books', { method: 'GET' });
}

export async function updateBookDetails(id, payload) {
  return apiRequest(`/api/books/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getWarehouses() {
  return apiRequest('/api/warehouses', { method: 'GET' });
}

export async function createWarehouse(payload) {
  return apiRequest('/api/warehouses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getWarehouseLocations(warehouseId) {
  return apiRequest(`/api/warehouses/${warehouseId}/locations`, { method: 'GET' });
}

export async function createGoodsReceipt(payload) {
  return apiRequest('/api/goods-receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getGoodsReceipts() {
  return apiRequest('/api/goods-receipts', { method: 'GET' });
}

export async function getGoodsReceiptDetail(id) {
  return apiRequest(`/api/goods-receipts/${id}`, { method: 'GET' });
}

export async function updateGoodsReceipt(id, payload) {
  return apiRequest(`/api/goods-receipts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function findBookByBarcode(barcode) {
  const safeBarcode = encodeURIComponent(String(barcode || '').trim());
  return apiRequest(`/api/books/barcode/${safeBarcode}`, { method: 'GET' });
}

export async function createIncompleteBook(payload) {
  return apiRequest('/api/books/incomplete', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getStockMovements() {
  return apiRequest('/api/stock-movements', { method: 'GET' });
}