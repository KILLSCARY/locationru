import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { AddressAutocomplete } from '@/features/maps/AddressAutocomplete';
import type { AddressSuggestion, GeoPoint } from '@/features/maps/types';
import { estimateRoute } from '@/features/maps/api';
import { estimatePricing } from '@/features/pricing/api';
import { createTrip, startSearch } from '@/features/trips/api';
import { useSessionStore } from '@/store/session';

type ResolvedPoint = {
  address: string;
  location: GeoPoint;
  placeId: string | null;
};

type RouteAndPrice = {
  distanceMeters: number;
  durationSeconds: number;
  recommendedPriceKopecks: number;
  minimumSuggestedPriceKopecks: number;
  maximumSuggestedPriceKopecks: number;
};

function formatKopecks(kopecks: number): string {
  return `${(kopecks / 100).toFixed(0)} ₽`;
}

export default function NewTripScreen() {
  const setActiveTripId = useSessionStore((state) => state.setActiveTripId);
  const [pickup, setPickup] = useState<ResolvedPoint | null>(null);
  const [destination, setDestination] = useState<ResolvedPoint | null>(null);
  const [routeAndPrice, setRouteAndPrice] = useState<RouteAndPrice | null>(
    null,
  );
  const [customPriceKopecks, setCustomPriceKopecks] = useState('');
  const [isEstimating, setIsEstimating] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toResolvedPoint = (
    suggestion: AddressSuggestion,
  ): ResolvedPoint | null =>
    suggestion.location
      ? {
          address: suggestion.fullAddress,
          location: suggestion.location,
          placeId: suggestion.providerPlaceId,
        }
      : null;

  const useCurrentLocationForPickup = async () => {
    setError(null);
    setIsLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Доступ к геолокации не разрешён.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const location: GeoPoint = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setPickup({
        address: `Текущее местоположение (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`,
        location,
        placeId: null,
      });
      setRouteAndPrice(null);
    } catch {
      setError('Не удалось определить текущее местоположение.');
    } finally {
      setIsLocating(false);
    }
  };

  const requestEstimate = async (from: ResolvedPoint, to: ResolvedPoint) => {
    setError(null);
    setIsEstimating(true);
    try {
      const route = await estimateRoute({
        origin: from.location,
        destination: to.location,
      });
      const pricing = await estimatePricing({
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      });
      setRouteAndPrice({
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        recommendedPriceKopecks: pricing.recommendedPriceKopecks,
        minimumSuggestedPriceKopecks: pricing.minimumSuggestedPriceKopecks,
        maximumSuggestedPriceKopecks: pricing.maximumSuggestedPriceKopecks,
      });
      setCustomPriceKopecks(String(pricing.recommendedPriceKopecks));
    } catch {
      setError('Не удалось рассчитать маршрут и цену.');
    } finally {
      setIsEstimating(false);
    }
  };

  const onSelectPickup = (suggestion: AddressSuggestion) => {
    const resolved = toResolvedPoint(suggestion);
    if (!resolved) return;
    setPickup(resolved);
    setRouteAndPrice(null);
    if (destination) void requestEstimate(resolved, destination);
  };

  const onSelectDestination = (suggestion: AddressSuggestion) => {
    const resolved = toResolvedPoint(suggestion);
    if (!resolved) return;
    setDestination(resolved);
    setRouteAndPrice(null);
    if (pickup) void requestEstimate(pickup, resolved);
  };

  const submit = async () => {
    if (!pickup || !destination) {
      setError('Выберите адрес подачи и назначения из подсказок.');
      return;
    }
    const price = Number.parseInt(customPriceKopecks, 10);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Укажите цену поездки.');
      return;
    }
    if (routeAndPrice && price < routeAndPrice.minimumSuggestedPriceKopecks) {
      setError(
        `Цена не может быть ниже ${formatKopecks(routeAndPrice.minimumSuggestedPriceKopecks)}.`,
      );
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const trip = await createTrip({
        pickup: pickup.location,
        destination: destination.location,
        pickupAddress: pickup.address,
        destinationAddress: destination.address,
        ...(pickup.placeId ? { pickupPlaceId: pickup.placeId } : {}),
        ...(destination.placeId
          ? { destinationPlaceId: destination.placeId }
          : {}),
        passengerPriceKopecks: price,
      });
      await startSearch(trip.id);
      await setActiveTripId(trip.id);
      router.replace(`/trip/${trip.id}`);
    } catch {
      setError('Не удалось создать заказ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Screen>
      <Text>Куда поедем?</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Откуда</Text>
        <AddressAutocomplete
          placeholder="Начните вводить адрес подачи"
          resolvedAddress={pickup?.address ?? null}
          bias={destination?.location}
          onSelect={onSelectPickup}
        />
        <Button
          title={
            isLocating ? 'Определяем…' : 'Использовать текущее местоположение'
          }
          onPress={useCurrentLocationForPickup}
          disabled={isLocating}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Куда</Text>
        <AddressAutocomplete
          placeholder="Начните вводить адрес назначения"
          resolvedAddress={destination?.address ?? null}
          bias={pickup?.location}
          onSelect={onSelectDestination}
        />
      </View>

      {isEstimating && <Text>Считаем маршрут и цену…</Text>}

      {routeAndPrice && (
        <View style={styles.field}>
          <Text>
            Расстояние: {(routeAndPrice.distanceMeters / 1000).toFixed(1)} км
          </Text>
          <Text>
            Время в пути: {Math.round(routeAndPrice.durationSeconds / 60)} мин
          </Text>
          <Text>
            Рекомендуемая цена:{' '}
            {formatKopecks(routeAndPrice.recommendedPriceKopecks)} (
            {formatKopecks(routeAndPrice.minimumSuggestedPriceKopecks)}–
            {formatKopecks(routeAndPrice.maximumSuggestedPriceKopecks)})
          </Text>
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>Ваша цена (в копейках)</Text>
        <TextInput
          placeholder="Цена в копейках"
          keyboardType="number-pad"
          value={customPriceKopecks}
          onChangeText={setCustomPriceKopecks}
          style={styles.input}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Button
        title={isSubmitting ? 'Создаём…' : 'Создать и начать поиск'}
        onPress={submit}
        disabled={isSubmitting || !pickup || !destination}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
  },
  error: { color: '#c0392b' },
});
