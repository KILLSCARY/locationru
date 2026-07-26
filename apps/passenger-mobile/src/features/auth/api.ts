import { api } from '@/api/client';
import type { TokenPair } from '@/api/types';

export const requestCode = (phone: string) =>
  api<{ status: 'accepted' }>('/auth/request-code', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });

export const verifyCode = (phone: string, code: string, deviceId: string) =>
  api<TokenPair>('/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ phone, code, deviceId, platform: 'WEB' }),
  });

export const refreshSession = (refreshToken: string) =>
  api<TokenPair>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
