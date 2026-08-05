import { Platform } from 'react-native';
import { api } from '@/api/client';
import { getDeviceId } from '@/features/auth/device-id';

export type DeviceTokenResponse = {
  id: string;
  status: string;
};

export type RegisterDeviceTokenInput = {
  pushToken: string;
  notificationsPermission: boolean;
  appVersion?: string;
  osVersion?: string;
  locale?: string;
};

const platform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';

// `application` is deliberately not sent — the server derives PASSENGER
// from the authenticated role, matching RegisterDeviceTokenDto.
export async function registerDeviceToken(
  input: RegisterDeviceTokenInput,
): Promise<DeviceTokenResponse> {
  const deviceId = await getDeviceId();
  return api<DeviceTokenResponse>('/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceId, platform, ...input }),
  });
}

export const revokeDeviceToken = (deviceTokenId: string) =>
  api<void>(`/notifications/devices/${deviceTokenId}`, { method: 'DELETE' });
