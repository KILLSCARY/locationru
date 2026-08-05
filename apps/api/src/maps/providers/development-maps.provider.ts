import { Injectable } from '@nestjs/common';
import type {
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
} from '@resilient-taxi/contracts';

import type { MapsProvider } from '../maps.types.js';
import { MapsProviderError } from '../maps.types.js';
import {
  haversineDistanceMeters,
  normalizeAddressQuery,
  routeBounds,
} from '../maps.utils.js';

interface FixtureAddress extends ResolvedAddress {
  aliases: string[];
  id: string;
  title: string;
}

const FIXTURES: FixtureAddress[] = [
  fixture(
    'dev:murino:ekaterininskaya-30',
    'Мурино, Екатерининская улица, 30',
    60.052281,
    30.440428,
    ['мурино екатерининская 30'],
  ),
  fixture(
    'dev:spb:nevsky-45',
    'Санкт-Петербург, Невский проспект, 45',
    59.934102,
    30.338448,
    ['спб невский 45', 'невский проспект 45'],
  ),
  fixture(
    'dev:spb:moskovsky-station',
    'Санкт-Петербург, Московский вокзал',
    59.929103,
    30.362328,
    ['спб московский вокзал', 'московский вокзал'],
  ),
  fixture(
    'dev:spb:pulkovo',
    'Санкт-Петербург, аэропорт Пулково',
    59.800292,
    30.262503,
    ['спб пулково', 'аэропорт пулково'],
  ),
];

@Injectable()
export class DevelopmentMapsProvider implements MapsProvider {
  readonly name = 'development';

  async searchAddress(
    query: string,
    _bias?: GeoPoint,
    limit = 5,
  ): Promise<AddressSuggestion[]> {
    const normalized = normalizeAddressQuery(query);
    return FIXTURES.filter((entry) =>
      [entry.formattedAddress, entry.title, ...entry.aliases]
        .map(normalizeAddressQuery)
        .some(
          (candidate) =>
            candidate.includes(normalized) || normalized.includes(candidate),
        ),
    )
      .slice(0, limit)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: 'Тестовый адрес · офлайн',
        fullAddress: entry.formattedAddress,
        location: entry.location,
        provider: this.name,
        providerPlaceId: entry.providerPlaceId,
      }));
  }

  async geocodeAddress(
    address: string,
    providerPlaceId?: string | null,
  ): Promise<ResolvedAddress> {
    const normalized = normalizeAddressQuery(address);
    const match = FIXTURES.find(
      (entry) =>
        entry.id === providerPlaceId ||
        [entry.formattedAddress, entry.title, ...entry.aliases]
          .map(normalizeAddressQuery)
          .some(
            (candidate) =>
              candidate.includes(normalized) || normalized.includes(candidate),
          ),
    );
    if (!match)
      throw new MapsProviderError('NOT_FOUND', 'Address was not found', false);
    return resolved(match);
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<ResolvedAddress> {
    const point = { latitude, longitude };
    const nearest = [...FIXTURES].sort(
      (left, right) =>
        haversineDistanceMeters(point, left.location) -
        haversineDistanceMeters(point, right.location),
    )[0];
    if (nearest && haversineDistanceMeters(point, nearest.location) <= 20_000) {
      return resolved(nearest);
    }
    return {
      formattedAddress: `Тестовая точка ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,
      location: point,
      provider: this.name,
      providerPlaceId: null,
      components: {},
    };
  }

  async buildRoute(request: RouteRequest): Promise<RouteResult> {
    const points = [request.origin, ...request.waypoints, request.destination];
    const distanceMeters = points
      .slice(1)
      .reduce(
        (total, point, index) =>
          total + haversineDistanceMeters(points[index]!, point),
        0,
      );
    return {
      distanceMeters,
      durationSeconds: Math.max(60, Math.ceil(distanceMeters / 8.33)),
      geometry: {
        type: 'LineString',
        coordinates: points.map((point) => [point.longitude, point.latitude]),
      },
      encodedPolyline: null,
      bounds: routeBounds(points),
      snappedWaypoints: points,
      provider: this.name,
      providerRouteId: `dev:${points.map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`).join('|')}`,
      warnings: [
        'Development route uses straight-line segments and does not follow roads',
      ],
    };
  }

  estimateRoute(request: RouteRequest): Promise<RouteResult> {
    return this.buildRoute(request);
  }

  async matchLocationToRoad(point: GeoPoint): Promise<GeoPoint> {
    return point;
  }

  async matchRoute(points: GeoPoint[]): Promise<GeoPoint[]> {
    return points;
  }

  searchPlaces(
    query: string,
    bias?: GeoPoint,
    limit?: number,
  ): Promise<AddressSuggestion[]> {
    return this.searchAddress(query, bias, limit);
  }

  async getPlaceDetails(providerPlaceId: string): Promise<ResolvedAddress> {
    return this.geocodeAddress(providerPlaceId, providerPlaceId);
  }
}

function fixture(
  id: string,
  formattedAddress: string,
  latitude: number,
  longitude: number,
  aliases: string[],
): FixtureAddress {
  const city = formattedAddress.startsWith('Мурино')
    ? 'Мурино'
    : 'Санкт-Петербург';
  return {
    id,
    title: formattedAddress,
    aliases,
    formattedAddress,
    location: { latitude, longitude },
    provider: 'development',
    providerPlaceId: id,
    components: {
      country: 'Россия',
      region: 'Санкт-Петербург и Ленинградская область',
      city,
    },
  };
}

function resolved(value: FixtureAddress): ResolvedAddress {
  return {
    formattedAddress: value.formattedAddress,
    location: value.location,
    providerPlaceId: value.providerPlaceId,
    provider: value.provider,
    components: value.components,
  };
}
