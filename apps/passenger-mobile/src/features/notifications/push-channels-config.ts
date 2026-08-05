export type ChannelImportance = 'HIGH' | 'DEFAULT';

export type PushChannelConfig = {
  id: string;
  name: string;
  importance: ChannelImportance;
};

/**
 * One Android notification channel per backend NotificationCategory — ids
 * must stay in sync with ANDROID_CHANNEL_BY_CATEGORY in
 * firebase-push.provider.ts (that's what a background/killed-app delivery
 * uses to pick a channel; only a foreground-received notification goes
 * through this app's own handler). Mirrors driver-android's
 * PushNotificationChannel enum — keep both in sync. Deliberately has no
 * expo-notifications import, so this data is importable/testable under
 * plain Node without pulling in a native module.
 */
export const PUSH_CHANNELS: PushChannelConfig[] = [
  { id: 'trip_offers', name: 'Отклики на поездку', importance: 'HIGH' },
  { id: 'active_trip', name: 'Текущая поездка', importance: 'HIGH' },
  { id: 'payments', name: 'Платежи', importance: 'DEFAULT' },
  { id: 'driver_operations', name: 'Служебные', importance: 'DEFAULT' },
  { id: 'account', name: 'Аккаунт', importance: 'DEFAULT' },
  { id: 'security', name: 'Безопасность', importance: 'HIGH' },
];
