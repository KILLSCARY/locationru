import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'passenger_device_id';

/** Stable per-install identifier used only for auth rate-limiting/session bookkeeping — never a hardware/ad identifier. */
export async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;

  const generated = `passenger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, generated);
  return generated;
}
