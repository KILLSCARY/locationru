import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { registerForPushNotificationsAsync } from '@/features/notifications/push';
import {
  parsePushDataPayload,
  routeForDeepLink,
} from '@/features/notifications/payload';
import { useSessionStore } from '@/store/session';

const queryClient = new QueryClient();

// Foreground display behavior — a background/killed-app delivery is shown
// by the OS itself using the Android channel/APNs alert the backend already
// sends; this only governs what happens while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function SessionBootstrap({ children }: PropsWithChildren) {
  const hydrated = useSessionStore((state) => state.hydrated);
  const hydrate = useSessionStore((state) => state.hydrate);
  const accessToken = useSessionStore((state) => state.accessToken);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && accessToken) void registerForPushNotificationsAsync();
  }, [hydrated, accessToken]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const payload = parsePushDataPayload(
          response.notification.request.content.data,
        );
        const path = routeForDeepLink(payload?.deepLink);
        if (path) router.push(path as Parameters<typeof router.push>[0]);
      },
    );
    return () => subscription.remove();
  }, []);

  if (!hydrated)
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  return children;
}

export default function RootLayout() {
  const [client] = useState(() => queryClient);
  return (
    <QueryClientProvider client={client}>
      <SessionBootstrap>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ title: 'Вход' }} />
          <Stack.Screen name="trip/new" options={{ title: 'Новая поездка' }} />
          <Stack.Screen name="trip/[id]" options={{ title: 'Поездка' }} />
        </Stack>
      </SessionBootstrap>
    </QueryClientProvider>
  );
}
