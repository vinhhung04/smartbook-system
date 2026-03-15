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

export async function getAllBooks() {
  return apiRequest('/api/books', { method: 'GET' });
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