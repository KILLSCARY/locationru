import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSessionStore } from '@/store/session';

const queryClient = new QueryClient();

function SessionBootstrap({ children }: PropsWithChildren) {
  const hydrated = useSessionStore((state) => state.hydrated);
  const hydrate = useSessionStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
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
