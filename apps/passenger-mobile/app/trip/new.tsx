import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AddressAutocomplete } from '@/features/maps/AddressAutocomplete';
import { buildRoute, reverseGeocode } from '@/features/maps/api';
import type { AddressSuggestion, GeoPoint } from '@/features/maps/types';
import { estimatePricing } from '@/features/pricing/api';
import { createTrip, startSearch } from '@/features/trips/api';
import { ApiError } from '@/api/client';
import type { MapAdapterHandle } from '@/maps/MapAdapter';
import { boundsOfPoints, padBounds } from '@/maps/MapBounds';
import { MapCameraController } from '@/maps/MapCameraController';
import {
  destinationMarker,
  pickupMarker,
  type MapMarker,
} from '@/maps/MapMarker';
import { getMapView } from '@/maps/MapProviderFactory';
import { routePolyline, type MapPolyline } from '@/maps/MapPolyline';
import { useSessionStore } from '@/store/session';

type ResolvedPoint = {
  address: string;
  location: GeoPoint;
  placeId: string | null;
};

type RouteAndPrice = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoPoint[];
  recommendedPriceKopecks: number;
  minimumSuggestedPriceKopecks: number;
  maximumSuggestedPriceKopecks: number;
};

type PickMode = 'pickup' | 'destination' | null;

type PickCandidate = {
  location: GeoPoint;
  address: string | null;
  isLoading: boolean;
  error: string | null;
};

const REVERSE_GEOCODE_DEBOUNCE_MS = 300;

function formatKopecks(kopecks: number): string {
  return `${(kopecks / 100).toFixed(0)} ₽`;
}

const MapComponent = getMapView();

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
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [pickCandidate, setPickCandidate] = useState<PickCandidate | null>(
    null,
  );

  const mapRef = useRef<MapAdapterHandle>(null);
  const cameraController = useRef(new MapCameraController()).current;
  const reverseGeocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reverseGeocodeAbort = useRef<AbortController | null>(null);

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    if (pickup) list.push(pickupMarker(pickup.location, 'Подача'));
    if (destination)
      list.push(destinationMarker(destination.location, 'Назначение'));
    return list;
  }, [pickup, destination]);

  const polylines = useMemo<MapPolyline[]>(
    () => (routeAndPrice ? [routePolyline(routeAndPrice.geometry)] : []),
    [routeAndPrice],
  );

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

  const requestEstimate = useCallback(
    async (from: ResolvedPoint, to: ResolvedPoint) => {
      setError(null);
      setIsEstimating(true);
      try {
        const route = await buildRoute({
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
          geometry: route.geometry,
          recommendedPriceKopecks: pricing.recommendedPriceKopecks,
          minimumSuggestedPriceKopecks: pricing.minimumSuggestedPriceKopecks,
          maximumSuggestedPriceKopecks: pricing.maximumSuggestedPriceKopecks,
        });
        setCustomPriceKopecks(String(pricing.recommendedPriceKopecks));
        mapRef.current?.applyCamera(
          cameraController.fitRouteBounds(
            padBounds(boundsOfPoints(route.geometry), 0.25),
          ),
        );
      } catch {
        setError('Не удалось рассчитать маршрут и цену.');
      } finally {
        setIsEstimating(false);
      }
    },
    [cameraController],
  );

  const applyPickup = (resolved: ResolvedPoint) => {
    setPickup(resolved);
    setRouteAndPrice(null);
    if (destination) void requestEstimate(resolved, destination);
    else
      mapRef.current?.applyCamera(
        cameraController.focusPoint(resolved.location),
      );
  };

  const applyDestination = (resolved: ResolvedPoint) => {
    setDestination(resolved);
    setRouteAndPrice(null);
    if (pickup) void requestEstimate(pickup, resolved);
    else
      mapRef.current?.applyCamera(
        cameraController.focusPoint(resolved.location),
      );
  };

  const useCurrentLocationForPickup = async () => {
    setError(null);
    setIsLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setError(
          'Доступ к геолокации не разрешён. Можно выбрать адрес вручную или на карте.',
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      applyPickup({
        address: `Текущее местоположение (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`,
        location: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        placeId: null,
      });
    } catch {
      setError('Не удалось определить текущее местоположение.');
    } finally {
      setIsLocating(false);
    }
  };

  const startPickOnMap = (mode: Exclude<PickMode, null>) => {
    setPickMode(mode);
    setPickCandidate(null);
  };

  const cancelPickOnMap = () => {
    setPickMode(null);
    setPickCandidate(null);
    reverseGeocodeAbort.current?.abort();
  };

  const handleCameraIdle = useCallback(
    (center: GeoPoint) => {
      if (!pickMode) return;
      setPickCandidate({
        location: center,
        address: null,
        isLoading: true,
        error: null,
      });

      if (reverseGeocodeTimer.current)
        clearTimeout(reverseGeocodeTimer.current);
      reverseGeocodeAbort.current?.abort();
      const controller = new AbortController();
      reverseGeocodeAbort.current = controller;

      reverseGeocodeTimer.current = setTimeout(() => {
        reverseGeocode(center, controller.signal)
          .then((resolved) => {
            if (controller.signal.aborted) return;
            setPickCandidate({
              location: center,
              address: resolved.formattedAddress,
              isLoading: false,
              error: null,
            });
          })
          .catch((caught: unknown) => {
            if (controller.signal.aborted) return;
            if (caught instanceof ApiError && caught.status === 404) {
              setPickCandidate({
                location: center,
                address: null,
                isLoading: false,
                error: null,
              });
              return;
            }
            setPickCandidate({
              location: center,
              address: null,
              isLoading: false,
              error:
                'Не удалось определить адрес. Можно подтвердить координаты без адреса.',
            });
          });
      }, REVERSE_GEOCODE_DEBOUNCE_MS);
    },
    [pickMode],
  );

  const handleManualCameraMove = useCallback(() => {
    cameraController.onManualCameraMove();
  }, [cameraController]);

  const confirmPickOnMap = () => {
    if (!pickCandidate || !pickMode) return;
    const resolved: ResolvedPoint = {
      address:
        pickCandidate.address ??
        `Точка на карте (${pickCandidate.location.latitude.toFixed(5)}, ${pickCandidate.location.longitude.toFixed(5)})`,
      location: pickCandidate.location,
      placeId: null,
    };
    if (pickMode === 'pickup') applyPickup(resolved);
    else applyDestination(resolved);
    setPickMode(null);
    setPickCandidate(null);
  };

  const submit = async () => {
    if (!pickup || !destination) {
      setError('Выберите адрес подачи и назначения.');
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
    <View style={styles.container}>
      <MapComponent
        ref={mapRef}
        markers={markers}
        polylines={polylines}
        onCameraIdle={handleCameraIdle}
        onManualCameraMove={handleManualCameraMove}
      />

      {pickMode ? (
        <>
          <View style={styles.centerPin} pointerEvents="none">
            <View style={styles.centerPinDot} />
          </View>
          <View style={styles.pickPanel}>
            <Text style={styles.pickPanelTitle}>
              {pickMode === 'pickup' ? 'Точка подачи' : 'Точка назначения'}
            </Text>
            {pickCandidate?.isLoading && <ActivityIndicator />}
            {pickCandidate?.address && (
              <Text style={styles.panelText}>{pickCandidate.address}</Text>
            )}
            {!pickCandidate?.isLoading &&
              !pickCandidate?.address &&
              !pickCandidate?.error && (
                <Text style={styles.panelText}>
                  Адрес не найден — можно подтвердить точку по координатам.
                </Text>
              )}
            {pickCandidate?.error && (
              <Text style={styles.error}>{pickCandidate.error}</Text>
            )}
            <View style={styles.pickPanelButtons}>
              <Button title="Отмена" onPress={cancelPickOnMap} />
              <Button
                title="Подтвердить точку"
                onPress={confirmPickOnMap}
                disabled={!pickCandidate}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={styles.topPanel}>
            <View style={styles.field}>
              <Text style={styles.label}>Откуда</Text>
              <AddressAutocomplete
                placeholder="Начните вводить адрес подачи"
                resolvedAddress={pickup?.address ?? null}
                bias={destination?.location}
                onSelect={(suggestion) => {
                  const resolved = toResolvedPoint(suggestion);
                  if (resolved) applyPickup(resolved);
                }}
              />
              <View style={styles.inlineButtons}>
                <Button
                  title={isLocating ? 'Определяем…' : 'Моё местоположение'}
                  onPress={useCurrentLocationForPickup}
                  disabled={isLocating}
                />
                <Button
                  title="Выбрать на карте"
                  onPress={() => startPickOnMap('pickup')}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Куда</Text>
              <AddressAutocomplete
                placeholder="Начните вводить адрес назначения"
                resolvedAddress={destination?.address ?? null}
                bias={pickup?.location}
                onSelect={(suggestion) => {
                  const resolved = toResolvedPoint(suggestion);
                  if (resolved) applyDestination(resolved);
                }}
              />
              <Button
                title="Выбрать на карте"
                onPress={() => startPickOnMap('destination')}
              />
            </View>
          </View>

          <View style={styles.bottomSheet}>
            {isEstimating && (
              <Text style={styles.panelText}>Считаем маршрут и цену…</Text>
            )}
            {routeAndPrice && (
              <View style={styles.field}>
                <Text style={styles.panelText}>
                  Расстояние: {(routeAndPrice.distanceMeters / 1000).toFixed(1)}{' '}
                  км
                </Text>
                <Text style={styles.panelText}>
                  Время в пути: {Math.round(routeAndPrice.durationSeconds / 60)}{' '}
                  мин
                </Text>
                <Text style={styles.panelText}>
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
              title={isSubmitting ? 'Создаём…' : 'Найти водителя'}
              onPress={submit}
              disabled={isSubmitting || !pickup || !destination}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14151A' },
  topPanel: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    gap: 12,
  },
  bottomSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 8,
    backgroundColor: '#0A0A0B',
    borderRadius: 16,
    padding: 16,
  },
  field: { gap: 8 },
  label: { fontWeight: '600', color: '#FFFFFF' },
  panelText: { color: '#FFFFFF' },
  inlineButtons: { flexDirection: 'row', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#FF6B6B' },
  centerPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -10,
    marginTop: -20,
  },
  centerPinDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#12B0FF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  pickPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 8,
    backgroundColor: '#0A0A0B',
    borderRadius: 16,
    padding: 16,
  },
  pickPanelTitle: { fontWeight: '600', color: '#FFFFFF' },
  pickPanelButtons: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
});
