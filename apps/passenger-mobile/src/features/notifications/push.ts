import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { registerDeviceToken, revokeDeviceToken } from './api';
import { registerNotificationChannels } from './channels';

const DEVICE_TOKEN_ID_KEY = 'passenger_push_device_token_id';

function pushNotificationsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_PUSH_NOTIFICATIONS === 'true';
}

/**
 * Registers this device's native push token (FCM on Android, APNs on iOS —
 * never Expo's own push token service, since the backend sends through
 * firebase-admin/APNs directly) with the backend. Called after login and
 * again after session restore, mirroring driver-android's
 * PushTokenRegistrar. Every failure is swallowed — push registration must
 * never block or break the login/session flow it's called from.
 */
export async function registerForPushNotificationsAsync(): Promise<void> {
  if (!pushNotificationsEnabled()) return;
  // A simulator/emulator without Google Play Services or a real APNs
  // sandbox has no way to obtain a real push token — skip rather than let
  // getDevicePushTokenAsync() throw.
  if (!Device.isDevice) return;

  try {
    await registerNotificationChannels();

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let status = existingStatus;
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }

    const tokenResponse = await Notifications.getDevicePushTokenAsync();
    const response = await registerDeviceToken({
      pushToken: tokenResponse.data,
      notificationsPermission: status === 'granted',
      osVersion: Platform.Version?.toString(),
    });
    await SecureStore.setItemAsync(DEVICE_TOKEN_ID_KEY, response.id);
  } catch {
    // Push registration is best-effort — a simulator without FCM
    // credentials, a denied permission, or a transient network failure must
    // never surface as a login-blocking error.
  }
}

export async function revokeCurrentPushToken(): Promise<void> {
  const id = await SecureStore.getItemAsync(DEVICE_TOKEN_ID_KEY);
  if (!id) return;
  try {
    await revokeDeviceToken(id);
  } catch {
    // Best-effort — sign-out must proceed even if the revoke call fails.
  }
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_ID_KEY);
}
