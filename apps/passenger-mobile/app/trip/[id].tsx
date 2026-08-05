import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect } from 'react';
import { Button, Text } from 'react-native';
import { connectRealtime } from '@/api/realtime';
import { Screen } from '@/components/Screen';
import { getBids, selectBid } from '@/features/bids/api';
import { getTrip } from '@/features/trips/api';
import { useSessionStore } from '@/store/session';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const token = useSessionStore((state) => state.accessToken);
  const setActiveTripId = useSessionStore((state) => state.setActiveTripId);
  const trip = useQuery({
    queryKey: ['trip', id],
    queryFn: () => getTrip(id),
    refetchInterval: 10_000,
  });
  const bids = useQuery({
    queryKey: ['bids', id],
    queryFn: () => getBids(id),
    refetchInterval: 10_000,
  });
  useEffect(() => {
    if (!token) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['trip', id] });
      void queryClient.invalidateQueries({ queryKey: ['bids', id] });
    };
    const socket = connectRealtime(token, refresh);
    socket.emit('room.join', { tripId: id });
    return () => {
      socket.disconnect();
    };
  }, [id, queryClient, token]);
  if (trip.isLoading)
    return (
      <Screen>
        <Text>Загружаем поездку…</Text>
      </Screen>
    );
  if (trip.isError || !trip.data)
    return (
      <Screen>
        <Text>Не удалось загрузить поездку.</Text>
        <Button title="К заказу" onPress={() => router.replace('/trip/new')} />
      </Screen>
    );
  const chooseBid = async (bidId: string) => {
    await selectBid(id, bidId);
    await queryClient.invalidateQueries({ queryKey: ['trip', id] });
    await queryClient.invalidateQueries({ queryKey: ['bids', id] });
  };
  const isFinished =
    trip.data.status.startsWith('CANCELLED') ||
    ['COMPLETED', 'SETTLED'].includes(trip.data.status);
  return (
    <Screen>
      <Text>Статус: {trip.data.status}</Text>
      <Text>
        {trip.data.pickup.formattedAddress} →{' '}
        {trip.data.destination.formattedAddress}
      </Text>
      <Text>
        {(trip.data.estimatedDistanceMeters / 1_000).toFixed(1)} км · ~
        {Math.ceil(trip.data.estimatedDurationSeconds / 60)} мин
      </Text>
      <Text>Цена пассажира: {trip.data.passengerPriceKopecks} коп.</Text>
      {isFinished && (
        <Button
          title="Новый заказ"
          onPress={async () => {
            await setActiveTripId(null);
            router.replace('/trip/new');
          }}
        />
      )}
      {!isFinished && <Text>Предложения водителей:</Text>}
      {bids.isLoading && <Text>Ищем предложения…</Text>}
      {bids.isError && (
        <Text>Нет сети. Попробуем обновить список автоматически.</Text>
      )}
      {bids.data?.length === 0 && <Text>Предложений пока нет.</Text>}
      {bids.data?.map((bid) => (
        <>
          <Text key={`${bid.id}-details`}>
            {bid.driver.firstName} {bid.driver.lastName}, {bid.vehicle.brand}{' '}
            {bid.vehicle.model}; {bid.offeredPriceKopecks} коп.;{' '}
            {bid.distanceToPickupMeters} м; ~{bid.estimatedPickupSeconds} сек
          </Text>
          <Button
            key={bid.id}
            title="Выбрать водителя"
            onPress={() => void chooseBid(bid.id)}
          />
        </>
      ))}
    </Screen>
  );
}
