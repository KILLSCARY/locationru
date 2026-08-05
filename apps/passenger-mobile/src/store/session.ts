import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

type SessionState = {
  accessToken: string | null;
  activeTripId: string | null;
  hydrated: boolean;
  clear: () => Promise<void>;
  hydrate: () => Promise<void>;
  setSession: (accessToken: string, refreshToken: string) => Promise<void>;
  setActiveTripId: (tripId: string | null) => Promise<void>;
  refreshToken: string | null;
};

const ACCESS_TOKEN = 'passenger_access_token';
const REFRESH_TOKEN = 'passenger_refresh_token';
const ACTIVE_TRIP_ID = 'passenger_active_trip_id';

export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  refreshToken: null,
  activeTripId: null,
  hydrated: false,
  hydrate: async () => {
    const [accessToken, refreshToken, activeTripId] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN),
      SecureStore.getItemAsync(REFRESH_TOKEN),
      SecureStore.getItemAsync(ACTIVE_TRIP_ID),
    ]);
    set({ accessToken, refreshToken, activeTripId, hydrated: true });
  },
  setSession: async (accessToken, refreshToken) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN, accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN, refreshToken),
    ]);
    set({ accessToken, refreshToken });
  },
  setActiveTripId: async (activeTripId) => {
    if (activeTripId)
      await SecureStore.setItemAsync(ACTIVE_TRIP_ID, activeTripId);
    else await SecureStore.deleteItemAsync(ACTIVE_TRIP_ID);
    set({ activeTripId });
  },
  clear: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN),
      SecureStore.deleteItemAsync(REFRESH_TOKEN),
      SecureStore.deleteItemAsync(ACTIVE_TRIP_ID),
    ]);
    set({ accessToken: null, refreshToken: null, activeTripId: null });
  },
}));
