import { Platform } from 'react-native';
import { api } from '@/api/client';
import type { TokenPair } from '@/api/types';
import { getDeviceId } from './device-id';

export type RequestCodeResult = {
  requestId: string;
  expiresInSeconds: number;
  resendInSeconds: number;
};

const platform =
  Platform.OS === 'android' ? 'ANDROID' : Platform.OS === 'ios' ? 'IOS' : 'WEB';

export const requestCode = async (
  phone: string,
): Promise<RequestCodeResult> => {
  const deviceId = await getDeviceId();
  return api<RequestCodeResult>('/auth/request-code', {
    method: 'POST',
    body: JSON.stringify({ phone, deviceId }),
  });
};

export const resendCode = async (
  requestId: string,
  phone: string,
): Promise<RequestCodeResult> => {
  const deviceId = await getDeviceId();
  return api<RequestCodeResult>('/auth/resend-code', {
    method: 'POST',
    body: JSON.stringify({ requestId, phone, deviceId }),
  });
};

export const verifyCode = async (
  requestId: string,
  phone: string,
  code: string,
): Promise<TokenPair> => {
  const deviceId = await getDeviceId();
  return api<TokenPair>('/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ requestId, phone, code, deviceId, platform }),
  });
};

export const refreshSession = (refreshToken: string) =>
  api<TokenPair>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
