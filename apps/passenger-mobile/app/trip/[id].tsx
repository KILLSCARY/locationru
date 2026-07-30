import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { subscribeToTripRoom, type RealtimeEnvelope } from '@/api/realtime';
import type { TripStatus } from '@/api/types';
import { getBids, selectBid } from '@/features/bids/api';
import { buildRoute } from '@/features/maps/api';
import type { GeoPoint, RouteResult } from '@/features/maps/types';
import {
  createShareTripService,
  type ShareTripResult,
} from '@/features/share/shareTrip';
import { getTrip } from '@/features/trips/api';
import { bearingBetween, haversineMeters } from '@/maps/geo';
import {
  classifyLocationQuality,
  passengerMessageFor,
  type LocationQualityStatus,
} from '@/maps/locationQuality';
import type { MapAdapterHandle } from '@/maps/MapAdapter';
import { boundsOfPoints, padBounds } from '@/maps/MapBounds';
import { MapCameraController } from '@/maps/MapCameraController';
import { DriverMarkerInterpolator } from '@/maps/DriverMarkerInterpolator';
import {
  destinationMarker,
  driverMarker,
  pickupMarker,
  type MapMarker,
} from '@/maps/MapMarker';
import { getMapView } from '@/maps/MapProviderFactory';
import {
  remainingPolyline,
  routePolyline,
  traveledPolyline,
  type MapPolyline,
} from '@/maps/MapPolyline';
import { computeRouteProgress } from '@/maps/routeProgress';
import { Screen } from '@/components/Screen';
import { useSessionStore } from '@/store/session';

const DRIVER_EN_ROUTE_STATUSES: TripStatus[] = [
  'DRIVER_SELECTED',
  'PAYMENT_PENDING',
  'PAYMENT_RESERVED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
];
const FINISHED_STATUSES: TripStatus[] = [
  'COMPLETED',
  'SETTLED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_SYSTEM',
  'PAYMENT_FAILED',
  'DISPUTED',
  'REFUNDED',
];

const RENDER_TICK_MS = Math.round(
  1_000 / Number(process.env.EXPO_PUBLIC_MAP_MAX_RENDER_UPDATE_HZ ?? 5),
);
const ROUTE_RECOMPUTE_MIN_MOVE_METERS = 150;

const MapComponent = getMapView();
const shareTripService = createShareTripService();

type DriverLocationPayload = {
  driverId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: string;
};

type BidSummary = {
  id: string;
  driver: { firstName: string; lastName: string; rating: number };
  vehicle: {
    brand: string;
    model: string;
    color: string;
    registrationNumber: string;
  };
  offeredPriceKopecks: number;
  distanceToPickupMeters: number;
  estimatedPickupSeconds: number;
};

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const token = useSessionStore((state) => state.accessToken);
  const setActiveTripId = useSessionStore((state) => state.setActiveTripId);

  const trip = useQuery({
    queryKey: ['trip', id],
    queryFn: () => getTrip(id),
    refetchInterval: 15_000,
  });
  const bids = useQuery({
    queryKey: ['bids', id],
    queryFn: () => getBids(id),
    refetchInterval: 15_000,
    enabled: !!trip.data && !FINISHED_STATUSES.includes(trip.data.status),
  });

  const status = trip.data?.status;
  const isSearching =
    status === 'DRAFT' ||
    status === 'SEARCHING' ||
    status === 'OFFERS_RECEIVED';
  const isDriverEnRoute = status
    ? DRIVER_EN_ROUTE_STATUSES.includes(status)
    : false;
  const isInProgress = status === 'IN_PROGRESS';
  const isFinished = status ? FINISHED_STATUSES.includes(status) : false;

  const mapRef = useRef<MapAdapterHandle>(null);
  const cameraController = useRef(new MapCameraController()).current;
  const interpolator = useRef(new DriverMarkerInterpolator()).current;
  const previousRawSample = useRef<{
    location: GeoPoint;
    recordedAt: string;
  } | null>(null);
  const lastRouteToPickupOrigin = useRef<GeoPoint | null>(null);
  const hasDriverPosition = useRef(false);

  const [renderedDriver, setRenderedDriver] = useState<{
    location: GeoPoint;
    bearingDegrees: number | null;
  } | null>(null);
  const [locationQuality, setLocationQuality] =
    useState<LocationQualityStatus | null>(null);
  const [tripRoute, setTripRoute] = useState<RouteResult | null>(null);
  const [routeToPickup, setRouteToPickup] = useState<RouteResult | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(true);
  const [shareResult, setShareResult] = useState<ShareTripResult | null>(null);

  // Marker/polyline render tick, decoupled from the raw WebSocket update rate.
  useEffect(() => {
    const tick = setInterval(() => {
      if (!hasDriverPosition.current) return;
      setRenderedDriver(interpolator.positionAt(Date.now()));
    }, RENDER_TICK_MS);
    return () => clearInterval(tick);
  }, [interpolator]);

  // Whole-trip route (pickup → destination), fetched once both points exist.
  useEffect(() => {
    if (!trip.data) return;
    let cancelled = false;
    buildRoute({ origin: trip.data.pickup, destination: trip.data.destination })
      .then((route) => {
        if (!cancelled) setTripRoute(route);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    trip.data?.pickup.latitude,
    trip.data?.pickup.longitude,
    trip.data?.destination.latitude,
    trip.data?.destination.longitude,
  ]);

  const recomputeRouteToPickup = useCallback(
    (driverLocation: GeoPoint) => {
      if (!trip.data) return;
      const last = lastRouteToPickupOrigin.current;
      if (
        last &&
        haversineMeters(last, driverLocation) < ROUTE_RECOMPUTE_MIN_MOVE_METERS
      )
        return;
      lastRouteToPickupOrigin.current = driverLocation;
      buildRoute({ origin: driverLocation, destination: trip.data.pickup })
        .then(setRouteToPickup)
        .catch(() => undefined);
    },
    [trip.data],
  );

  // WebSocket subscription: trip/bid updates invalidate queries; driver
  // location updates feed the interpolator directly (no query invalidation —
  // that would fight the smoothing with a poll-driven re-render).
  useEffect(() => {
    if (!id || !token) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['trip', id] });
      void queryClient.invalidateQueries({ queryKey: ['bids', id] });
    };
    const subscription = subscribeToTripRoom(id, {
      'trip.searching': invalidate,
      'trip.updated': invalidate,
      'trip.cancelled': invalidate,
      'bid.created': invalidate,
      'bid.withdrawn': invalidate,
      'bid.expired': invalidate,
      'bid.accepted': invalidate,
      'driver.arrived': invalidate,
      'trip.started': invalidate,
      'trip.completed': invalidate,
      'driver.location.updated': (payload, _envelope: RealtimeEnvelope) => {
        void _envelope;
        const sample = payload as DriverLocationPayload;
        const now = Date.now();
        const quality = classifyLocationQuality(
          {
            location: sample,
            accuracyMeters: sample.accuracyMeters,
            recordedAt: sample.recordedAt,
          },
          previousRawSample.current
            ? {
                location: previousRawSample.current.location,
                accuracyMeters: 0,
                recordedAt: previousRawSample.current.recordedAt,
              }
            : null,
          now,
        );
        setLocationQuality(quality.status);

        if (
          quality.status === 'SPOOFING_SUSPECTED' ||
          quality.status === 'STALE'
        ) {
          return; // Keep rendering the last trusted position.
        }

        const bearing = previousRawSample.current
          ? bearingBetween(previousRawSample.current.location, sample)
          : null;
        previousRawSample.current = {
          location: sample,
          recordedAt: sample.recordedAt,
        };

        interpolator.ingest(
          {
            location: sample,
            bearingDegrees: bearing,
            recordedAt: sample.recordedAt,
          },
          now,
        );
        hasDriverPosition.current = true;
        recomputeRouteToPickup(sample);
      },
    });
    return () => subscription.unsubscribe();
  }, [id, token, queryClient, interpolator, recomputeRouteToPickup]);

  // Camera: fit to the trip route once available; switch to follow-driver
  // once a driver position exists, but never fight a manual pan.
  useEffect(() => {
    if (renderedDriver) {
      if (cameraController.isFollowing) {
        const command = cameraController.updateDriverPosition(
          renderedDriver.location,
          renderedDriver.bearingDegrees,
        );
        if (command) mapRef.current?.applyCamera(command);
      } else if (!cameraController.lastCommand) {
        mapRef.current?.applyCamera(
          cameraController.startFollowingDriver(
            renderedDriver.location,
            renderedDriver.bearingDegrees,
          ),
        );
        setIsFollowing(true);
      }
    } else if (tripRoute && !cameraController.lastCommand) {
      mapRef.current?.applyCamera(
        cameraController.fitRouteBounds(
          padBounds(boundsOfPoints(tripRoute.geometry), 0.25),
        ),
      );
    }
  }, [renderedDriver, tripRoute, cameraController]);

  const handleManualCameraMove = useCallback(() => {
    cameraController.onManualCameraMove();
    setIsFollowing(false);
  }, [cameraController]);

  const resumeFollow = useCallback(() => {
    const command = cameraController.resumeFollowing();
    if (command) {
      mapRef.current?.applyCamera(command);
      setIsFollowing(true);
    }
  }, [cameraController]);

  const activeRoute = isInProgress ? tripRoute : (routeToPickup ?? tripRoute);
  const routeProgress = useMemo(
    () =>
      activeRoute && renderedDriver
        ? computeRouteProgress(activeRoute.geometry, renderedDriver.location)
        : null,
    [activeRoute, renderedDriver],
  );

  const markers = useMemo<MapMarker[]>(() => {
    if (!trip.data) return [];
    const list: MapMarker[] = [pickupMarker(trip.data.pickup, 'Подача')];
    if (isInProgress || renderedDriver)
      list.push(destinationMarker(trip.data.destination, 'Назначение'));
    if (renderedDriver)
      list.push(
        driverMarker(renderedDriver.location, renderedDriver.bearingDegrees),
      );
    return list;
  }, [trip.data, isInProgress, renderedDriver]);

  const polylines = useMemo<MapPolyline[]>(() => {
    if (isInProgress && routeProgress) {
      return [
        traveledPolyline(routeProgress.traveled),
        remainingPolyline(routeProgress.remaining),
      ];
    }
    if (activeRoute) return [routePolyline(activeRoute.geometry)];
    return [];
  }, [isInProgress, routeProgress, activeRoute]);

  const chooseBid = async (bidId: string) => {
    await selectBid(id, bidId);
    await queryClient.invalidateQueries({ queryKey: ['trip', id] });
    await queryClient.invalidateQueries({ queryKey: ['bids', id] });
  };

  const triggerSos = () => {
    // No SOS backend endpoint exists yet — surface the intent locally rather
    // than silently doing nothing or pretending to dispatch help.
    Alert.alert('SOS', 'Экстренный вызов пока не подключён к серверу.');
  };

  const shareTrip = async () => {
    const result = await shareTripService.createShareLink(id);
    setShareResult(result);
  };

  if (trip.isLoading) {
    return (
      <Screen>
        <Text>Загружаем поездку…</Text>
      </Screen>
    );
  }
  if (trip.isError || !trip.data) {
    return (
      <Screen>
        <Text>Не удалось загрузить поездку.</Text>
        <Button title="К заказу" onPress={() => router.replace('/trip/new')} />
      </Screen>
    );
  }

  const qualityMessage = locationQuality
    ? passengerMessageFor(locationQuality)
    : null;

  return (
    <View style={styles.container}>
      <MapComponent
        ref={mapRef}
        markers={markers}
        polylines={polylines}
        onManualCameraMove={handleManualCameraMove}
      />

      {!isFollowing && renderedDriver && (
        <View style={styles.resumeFollowButton}>
          <Button title="К машине" onPress={resumeFollow} />
        </View>
      )}

      {bottomSheetExpanded ? (
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.title}>Статус: {trip.data.status}</Text>
            <Button
              title="Свернуть"
              onPress={() => setBottomSheetExpanded(false)}
            />
          </View>
          <Text style={styles.text}>
            {trip.data.pickup.address} → {trip.data.destination.address}
          </Text>
          <Text style={styles.text}>
            Цена пассажира: {trip.data.passengerPriceKopecks} коп.
          </Text>

          {isSearching && (
            <SearchingSection
              bidsCount={bids.data?.length ?? 0}
              isLoading={bids.isLoading}
              isError={bids.isError}
              bids={bids.data ?? []}
              onChoose={chooseBid}
            />
          )}

          {isDriverEnRoute && (
            <DriverEnRouteSection
              routeToPickup={routeToPickup}
              qualityMessage={qualityMessage}
            />
          )}

          {isInProgress && (
            <ActiveTripSection
              remainingMeters={
                routeProgress
                  ? approximateLength(routeProgress.remaining)
                  : null
              }
              qualityMessage={qualityMessage}
              onSos={triggerSos}
              onShare={() => void shareTrip()}
              shareResult={shareResult}
            />
          )}

          {isFinished && (
            <Button
              title="Новый заказ"
              onPress={async () => {
                await setActiveTripId(null);
                router.replace('/trip/new');
              }}
            />
          )}
        </View>
      ) : (
        <View style={styles.collapsedBar}>
          <Button
            title="Развернуть"
            onPress={() => setBottomSheetExpanded(true)}
          />
        </View>
      )}
    </View>
  );
}

function SearchingSection({
  bidsCount,
  isLoading,
  isError,
  bids,
  onChoose,
}: {
  bidsCount: number;
  isLoading: boolean;
  isError: boolean;
  bids: BidSummary[];
  onChoose: (bidId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.text}>
        Ищем машину поблизости… (найдено предложений: {bidsCount})
      </Text>
      {isLoading && <Text style={styles.text}>Ищем предложения…</Text>}
      {isError && (
        <Text style={styles.text}>
          Нет сети. Попробуем обновить список автоматически.
        </Text>
      )}
      {bids.length === 0 && !isLoading && (
        <Text style={styles.text}>Предложений пока нет.</Text>
      )}
      {bids.map((bid) => (
        <View key={bid.id} style={styles.bidRow}>
          <Text style={styles.text}>
            {bid.driver.firstName} {bid.driver.lastName}, {bid.vehicle.brand}{' '}
            {bid.vehicle.model}; {bid.offeredPriceKopecks} коп.;{' '}
            {bid.distanceToPickupMeters} м; ~{bid.estimatedPickupSeconds} сек
          </Text>
          <Button title="Выбрать водителя" onPress={() => onChoose(bid.id)} />
        </View>
      ))}
    </View>
  );
}

function DriverEnRouteSection({
  routeToPickup,
  qualityMessage,
}: {
  routeToPickup: RouteResult | null;
  qualityMessage: string | null;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.text}>Машина едет к вам</Text>
      {routeToPickup && (
        <Text style={styles.text}>
          Осталось ~{(routeToPickup.distanceMeters / 1000).toFixed(1)} км, ~
          {Math.round(routeToPickup.durationSeconds / 60)} мин
        </Text>
      )}
      {qualityMessage && <Text style={styles.text}>{qualityMessage}</Text>}
    </View>
  );
}

function ActiveTripSection({
  remainingMeters,
  qualityMessage,
  onSos,
  onShare,
  shareResult,
}: {
  remainingMeters: number | null;
  qualityMessage: string | null;
  onSos: () => void;
  onShare: () => void;
  shareResult: ShareTripResult | null;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.text}>В пути</Text>
      {remainingMeters !== null && (
        <Text style={styles.text}>
          Осталось ~{(remainingMeters / 1000).toFixed(1)} км
        </Text>
      )}
      {qualityMessage && <Text style={styles.text}>{qualityMessage}</Text>}
      <View style={styles.sheetHeader}>
        <Button title="SOS" onPress={onSos} color="#FF3B30" />
        <Button title="Поделиться поездкой" onPress={onShare} />
      </View>
      {shareResult && (
        <Text style={styles.text}>
          Ссылка (development): {shareResult.shareUrl}
        </Text>
      )}
    </View>
  );
}

function approximateLength(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#14151A' },
  bottomSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 8,
    backgroundColor: '#0A0A0B',
    borderRadius: 16,
    padding: 16,
    maxHeight: '60%',
  },
  collapsedBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontWeight: '600', color: '#FFFFFF' },
  text: { color: '#FFFFFF' },
  section: { gap: 6, marginTop: 8 },
  bidRow: { gap: 4, marginBottom: 8 },
  resumeFollowButton: {
    position: 'absolute',
    top: 50,
    right: 16,
  },
});
