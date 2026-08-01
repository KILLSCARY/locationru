import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { PUSH_CHANNELS } from './push-channels-config';

/** No-op on iOS — channels are an Android-only concept there. */
export async function registerNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    PUSH_CHANNELS.map((channel) =>
      Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance:
          channel.importance === 'HIGH'
            ? Notifications.AndroidImportance.HIGH
            : Notifications.AndroidImportance.DEFAULT,
      }),
    ),
  );
}
