import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Button,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  AddressSuggestion,
  PricingEstimate,
  ResolvedAddress,
} from '@resilient-taxi/contracts';

import { Screen } from '@/components/Screen';
import { createTrip, startSearch } from '@/features/trips/api';
import {
  estimatePrice,
  geocodeSuggestion,
  reverseGeocode,
  searchAddresses,
} from '@/features/trips/maps-api';
import { useSessionStore } from '@/store/session';

type AddressFieldProps = {
  label: string;
  value: ResolvedAddress | null;
  onChange: (value: ResolvedAddress | null) => void;
  allowCurrentLocation?: boolean;
};

function AddressField({
  label,
  value,
  onChange,
  allowCurrentLocation,
}: AddressFieldProps) {
  const [query, setQuery] = useState(value?.formattedAddress ?? '');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (value?.formattedAddress === query || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAddresses(query.trim(), controller.signal)
        .then(setSuggestions)
        .catch((error: unknown) => {
          if (error instanceof Error && error.name !== 'AbortError') {
            setMessage('Не удалось загрузить подсказки адреса');
          }
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value?.formattedAddress]);

  const select = async (suggestion: AddressSuggestion) => {
    setMessage(null);
    try {
      const resolved = await geocodeSuggestion(suggestion);
      onChange(resolved);
      setQuery(resolved.formattedAddress);
      setSuggestions([]);
    } catch {
      setMessage('Не удалось уточнить выбранный адрес');
    }
  };

  const useCurrentLocation = async () => {
    setMessage(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setMessage('Разрешение на геолокацию не предоставлено');
      return;
    }
    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const resolved = await reverseGeocode({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      });
      onChange(resolved);
      setQuery(resolved.formattedAddress);
      setSuggestions([]);
    } catch {
      setMessage('Не удалось определить текущий адрес');
    }
  };

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        placeholder="Начните вводить адрес"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          if (text !== value?.formattedAddress) onChange(null);
        }}
      />
      {allowCurrentLocation && (
        <Button
          title="Использовать моё местоположение"
          onPress={useCurrentLocation}
        />
      )}
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion.id}
          style={styles.suggestion}
          onPress={() => void select(suggestion)}
        >
          <Text>{suggestion.title}</Text>
          {suggestion.subtitle && (
            <Text style={styles.muted}>{suggestion.subtitle}</Text>
          )}
        </Pressable>
      ))}
      {value && (
        <Text style={styles.resolved}>
          ✓ {value.formattedAddress} ({value.location.latitude.toFixed(5)},{' '}
          {value.location.longitude.toFixed(5)})
        </Text>
      )}
      {message && <Text style={styles.error}>{message}</Text>}
    </View>
  );
}

export default function NewTripScreen() {
  const setActiveTripId = useSessionStore((state) => state.setActiveTripId);
  const [pickup, setPickup] = useState<ResolvedAddress | null>(null);
  const [destination, setDestination] = useState<ResolvedAddress | null>(null);
  const [estimate, setEstimate] = useState<PricingEstimate | null>(null);
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!pickup || !destination) {
      setEstimate(null);
      return;
    }
    const controller = new AbortController();
    estimatePrice(
      {
        origin: pickup.location,
        destination: destination.location,
        waypoints: [],
        transportMode: 'CAR',
        avoidTolls: false,
        avoidUnpavedRoads: false,
      },
      controller.signal,
    )
      .then((nextEstimate) => {
        setEstimate(nextEstimate);
        setPrice(String(nextEstimate.recommendedPriceKopecks));
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== 'AbortError') {
          setMessage('Не удалось рассчитать маршрут. Попробуйте ещё раз.');
        }
      });
    return () => controller.abort();
  }, [pickup, destination]);

  const submit = async () => {
    if (!pickup || !destination || !estimate) {
      setMessage('Выберите адрес подачи и назначения из подсказок');
      return;
    }
    const passengerPriceKopecks = Number(price);
    if (
      !Number.isSafeInteger(passengerPriceKopecks) ||
      passengerPriceKopecks <= 0
    ) {
      setMessage('Цена должна быть целым числом копеек');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const trip = await createTrip({
        pickup: {
          formattedAddress: pickup.formattedAddress,
          latitude: pickup.location.latitude,
          longitude: pickup.location.longitude,
          providerPlaceId: pickup.providerPlaceId,
        },
        destination: {
          formattedAddress: destination.formattedAddress,
          latitude: destination.location.latitude,
          longitude: destination.location.longitude,
          providerPlaceId: destination.providerPlaceId,
        },
        passengerPriceKopecks,
        waypoints: [],
      });
      await startSearch(trip.id);
      await setActiveTripId(trip.id);
      router.replace(`/trip/${trip.id}`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось создать поездку',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.heading}>Новая поездка</Text>
      <AddressField
        label="Откуда"
        value={pickup}
        onChange={setPickup}
        allowCurrentLocation
      />
      <AddressField
        label="Куда"
        value={destination}
        onChange={setDestination}
      />
      {estimate && (
        <View style={styles.estimate}>
          <Text>
            Маршрут: {(estimate.distanceMeters / 1_000).toFixed(1)} км ·{' '}
            {Math.ceil(estimate.durationSeconds / 60)} мин
          </Text>
          <Text>
            Рекомендуемая цена: {estimate.recommendedPriceKopecks} коп.
            (диапазон {estimate.minimumSuggestedPriceKopecks}–
            {estimate.maximumSuggestedPriceKopecks})
          </Text>
        </View>
      )}
      <Text style={styles.label}>Ваша цена, копейки</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={price}
        onChangeText={setPrice}
        placeholder="Например, 130000"
      />
      {message && <Text style={styles.error}>{message}</Text>}
      <Button
        title={submitting ? 'Создаём…' : 'Создать и начать поиск'}
        onPress={() => void submit()}
        disabled={submitting || !estimate}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: '700' },
  fieldGroup: { gap: 8 },
  label: { fontWeight: '600' },
  input: {
    borderColor: '#9ca3af',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  suggestion: {
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  muted: { color: '#6b7280', fontSize: 12 },
  resolved: { color: '#166534' },
  estimate: {
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    gap: 6,
    padding: 12,
  },
  error: { color: '#b91c1c' },
});
