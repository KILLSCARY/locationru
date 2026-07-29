import { Injectable } from '@nestjs/common';

import { normalizeAddressQuery } from '../geo/address-normalizer.js';
import {
  boundsOf,
  haversineMeters,
  polylineLengthMeters,
  roundCoordinate,
} from '../geo/geo-math.js';
import type {
  AddressComponents,
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
} from '../maps.types.js';
import type {
  AddressSearchOptions,
  MapsProvider,
  MatchedLocation,
  PlaceDetails,
} from './maps-provider.interface.js';

export const DEVELOPMENT_PROVIDER_NAME = 'development';

interface SeedAddress {
  id: string;
  title: string;
  subtitle: string;
  fullAddress: string;
  location: GeoPoint;
  components: AddressComponents;
}

/**
 * Normalized tokens a query must all match to hit this seed address. Derived
 * from the address text itself (not a hand-maintained list) so every
 * documented test address matches when typed verbatim.
 */
function keywordsOf(seed: SeedAddress): string[] {
  return normalizeAddressQuery(`${seed.fullAddress} ${seed.subtitle}`)
    .split(' ')
    .filter(Boolean);
}

// A small, fixed set of real St. Petersburg / Leningrad-oblast addresses so the
// whole maps flow works offline and deterministically in development and tests.
const SEED_ADDRESSES: SeedAddress[] = [
  {
    id: 'dev-murino-ekaterininskaya-30',
    title: 'Екатерининская улица, 30',
    subtitle: 'Мурино, Ленинградская область',
    fullAddress: 'Мурино, Екатерининская улица, 30',
    location: { latitude: 60.045_9, longitude: 30.443_2 },
    components: {
      country: 'Россия',
      region: 'Ленинградская область',
      city: 'Мурино',
      street: 'Екатерининская улица',
      house: '30',
      postalCode: '188662',
    },
  },
  {
    id: 'dev-spb-nevsky-45',
    title: 'Невский проспект, 45',
    subtitle: 'Санкт-Петербург',
    fullAddress: 'Санкт-Петербург, Невский проспект, 45',
    location: { latitude: 59.932_6, longitude: 30.350_6 },
    components: {
      country: 'Россия',
      region: 'Санкт-Петербург',
      city: 'Санкт-Петербург',
      street: 'Невский проспект',
      house: '45',
      postalCode: '191025',
    },
  },
  {
    id: 'dev-spb-moskovsky-vokzal',
    title: 'Московский вокзал',
    subtitle: 'Санкт-Петербург, площадь Восстания',
    fullAddress: 'Санкт-Петербург, Московский вокзал',
    location: { latitude: 59.929_5, longitude: 30.362_1 },
    components: {
      country: 'Россия',
      region: 'Санкт-Петербург',
      city: 'Санкт-Петербург',
      street: 'площадь Восстания',
      house: '2',
      postalCode: '191036',
    },
  },
  {
    id: 'dev-spb-pulkovo',
    title: 'Аэропорт Пулково',
    subtitle: 'Санкт-Петербург, Пулковское шоссе',
    fullAddress: 'Санкт-Петербург, аэропорт Пулково',
    location: { latitude: 59.800_3, longitude: 30.262_5 },
    components: {
      country: 'Россия',
      region: 'Санкт-Петербург',
      city: 'Санкт-Петербург',
      street: 'Пулковское шоссе',
      house: '41',
      postalCode: '196140',
    },
  },
];

// Deterministic model constants for the fake router.
const DRIVING_METERS_PER_SECOND = 8.5; // ~30 km/h city average.
const ROUTE_WINDINGNESS = 1.3; // roads are ~30% longer than the crow flies.
const MIN_ROUTE_DISTANCE_METERS = 100;

function toSuggestion(seed: SeedAddress): AddressSuggestion {
  return {
    id: seed.id,
    title: seed.title,
    subtitle: seed.subtitle,
    fullAddress: seed.fullAddress,
    location: seed.location,
    provider: DEVELOPMENT_PROVIDER_NAME,
    providerPlaceId: seed.id,
  };
}

function toResolved(seed: SeedAddress): ResolvedAddress {
  return {
    formattedAddress: seed.fullAddress,
    location: seed.location,
    components: seed.components,
    provider: DEVELOPMENT_PROVIDER_NAME,
    providerPlaceId: seed.id,
  };
}

/**
 * Fully offline maps provider for development and tests. It never touches the
 * network: address search is a keyword match over a fixed seed set, geocoding
 * resolves to the seed coordinates, and routing is a deterministic interpolation
 * between origin and destination. The factory forbids selecting it in
 * production.
 */
@Injectable()
export class DevelopmentMapsProvider implements MapsProvider {
  readonly name = DEVELOPMENT_PROVIDER_NAME;

  searchAddress(
    query: string,
    options?: AddressSearchOptions,
  ): Promise<AddressSuggestion[]> {
    const normalized = normalizeAddressQuery(query);
    const tokens = normalized.split(' ').filter(Boolean);
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 10));

    const matches = SEED_ADDRESSES.filter((seed) =>
      tokens.every((token) =>
        keywordsOf(seed).some((keyword) => keyword.includes(token)),
      ),
    );

    const ranked = options?.biasLocation
      ? this.sortByProximity(matches, options.biasLocation)
      : matches;

    return Promise.resolve(ranked.slice(0, limit).map(toSuggestion));
  }

  searchPlaces(
    query: string,
    options?: AddressSearchOptions,
  ): Promise<AddressSuggestion[]> {
    return this.searchAddress(query, options);
  }

  getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
    const seed = SEED_ADDRESSES.find((candidate) => candidate.id === placeId);
    if (!seed) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ ...toResolved(seed), title: seed.title });
  }

  geocodeAddress(address: string): Promise<ResolvedAddress | null> {
    const normalized = normalizeAddressQuery(address);
    const tokens = normalized.split(' ').filter(Boolean);
    const seed = SEED_ADDRESSES.find((candidate) =>
      tokens.every((token) =>
        keywordsOf(candidate).some((keyword) => keyword.includes(token)),
      ),
    );
    return Promise.resolve(seed ? toResolved(seed) : null);
  }

  reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<ResolvedAddress | null> {
    const point: GeoPoint = { latitude, longitude };
    const nearest = this.sortByProximity(SEED_ADDRESSES, point)[0];
    if (!nearest) {
      return Promise.resolve(null);
    }
    // Snap to the seed address so reverse geocoding is deterministic.
    return Promise.resolve(toResolved(nearest));
  }

  buildRoute(request: RouteRequest): Promise<RouteResult> {
    return Promise.resolve(this.route(request));
  }

  estimateRoute(request: RouteRequest): Promise<RouteResult> {
    return Promise.resolve(this.route(request));
  }

  matchLocationToRoad(
    location: GeoPoint,
    _previousLocation?: GeoPoint,
  ): Promise<MatchedLocation> {
    void _previousLocation;
    return Promise.resolve({ location, confidence: 1 });
  }

  matchRoute(points: GeoPoint[]): Promise<GeoPoint[]> {
    return Promise.resolve(points);
  }

  private route(request: RouteRequest): RouteResult {
    const ordered: GeoPoint[] = [
      request.origin,
      ...request.waypoints
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((w) => ({ latitude: w.latitude, longitude: w.longitude })),
      request.destination,
    ];

    const geometry = this.densify(ordered);
    const straightLine = polylineLengthMeters(ordered);
    const distanceMeters = Math.max(
      MIN_ROUTE_DISTANCE_METERS,
      Math.round(straightLine * ROUTE_WINDINGNESS),
    );
    const speed =
      request.transportMode === 'walking'
        ? DRIVING_METERS_PER_SECOND / 6
        : DRIVING_METERS_PER_SECOND;
    const durationSeconds = Math.max(1, Math.round(distanceMeters / speed));

    return {
      distanceMeters,
      durationSeconds,
      geometry,
      encodedPolyline: null,
      bounds: boundsOf(geometry),
      provider: DEVELOPMENT_PROVIDER_NAME,
      providerRouteId: null,
      warnings: [],
      snappedWaypoints: request.waypoints.map((w) => ({
        latitude: w.latitude,
        longitude: w.longitude,
      })),
    };
  }

  /** Interpolates intermediate points so the geometry looks like a polyline. */
  private densify(points: GeoPoint[]): GeoPoint[] {
    const result: GeoPoint[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const steps = 8;
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        result.push({
          latitude: roundCoordinate(
            from.latitude + (to.latitude - from.latitude) * t,
          ),
          longitude: roundCoordinate(
            from.longitude + (to.longitude - from.longitude) * t,
          ),
        });
      }
    }
    const last = points[points.length - 1]!;
    result.push({
      latitude: roundCoordinate(last.latitude),
      longitude: roundCoordinate(last.longitude),
    });
    return result;
  }

  private sortByProximity<T extends { location: GeoPoint }>(
    items: T[],
    origin: GeoPoint,
  ): T[] {
    return items
      .slice()
      .sort(
        (a, b) =>
          haversineMeters(origin, a.location) -
          haversineMeters(origin, b.location),
      );
  }
}
