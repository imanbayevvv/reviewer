import { api } from './api-client';
import type { AuthResponse, LoginInput, RegisterInput, UserDto } from '@resale/contracts';

export function saveTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
}

export function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

export async function loginApi(input: LoginInput): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/api/auth/login', input);
  saveTokens(res.accessToken, res.refreshToken);
  return res;
}

export async function registerApi(input: RegisterInput): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/api/auth/register', input);
  saveTokens(res.accessToken, res.refreshToken);
  return res;
}

export async function fetchMe(): Promise<UserDto> {
  return api.get<UserDto>('/api/auth/me');
}

export async function logoutApi() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (refreshToken) {
    await api.post('/api/auth/logout', { refreshToken }).catch(() => {});
  }
  clearTokens();
}
