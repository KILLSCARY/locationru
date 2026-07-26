import { Redirect } from 'expo-router';
import { useSessionStore } from '@/store/session';

export default function Index() {
  const token = useSessionStore((state) => state.accessToken);
  const activeTripId = useSessionStore((state) => state.activeTripId);
  if (!token) return <Redirect href="/auth" />;
  return <Redirect href={activeTripId ? `/trip/${activeTripId}` : '/trip/new'} />;
}
