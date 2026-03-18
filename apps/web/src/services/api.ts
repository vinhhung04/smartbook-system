import axios, { AxiosInstance } from 'axios';

// Create API client instances
const authBaseURL = import.meta.env.VITE_AUTH_BASE_URL || 'http://localhost:3002';
const inventoryBaseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const aiBaseURL = import.meta.env.VITE_AI_BASE_URL || 'http://localhost:8000';

const authAPI: AxiosInstance = axios.create({
  baseURL: authBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const inventoryAPI: AxiosInstance = axios.create({
  baseURL: inventoryBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const aiAPI: AxiosInstance = axios.create({
  baseURL: aiBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to attach JWT token
const addTokenInterceptor = (api: AxiosInstance) => {
  api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
};

addTokenInterceptor(authAPI);
addTokenInterceptor(inventoryAPI);
addTokenInterceptor(aiAPI);

export function getApiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export { authAPI, inventoryAPI, aiAPI };
