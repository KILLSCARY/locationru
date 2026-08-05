import { createHash } from 'node:crypto';

import type { GeoPoint, RouteRequest } from '@resilient-taxi/contracts';

export function normalizeAddressQuery(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function stableCacheKey(
  namespace: string,
  provider: string,
  value: unknown,
): string {
  const serialized = stableStringify(value);
  const digest = createHash('sha256').update(serialized).digest('hex');
  return `maps:v1:${namespace}:${provider}:${digest}`;
}

export function normalizedRouteRequest(request: RouteRequest): RouteRequest {
  return {
    origin: roundPoint(request.origin),
    destination: roundPoint(request.destination),
    waypoints: request.waypoints.map(roundPoint),
    transportMode: request.transportMode,
    avoidTolls: request.avoidTolls,
    avoidUnpavedRoads: request.avoidUnpavedRoads,
  };
}

export function haversineDistanceMeters(from: GeoPoint, to: GeoPoint): number {
  const radius = 6_371_000;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function routeBounds(points: GeoPoint[]) {
  return {
    southWest: {
      latitude: Math.min(...points.map((point) => point.latitude)),
      longitude: Math.min(...points.map((point) => point.longitude)),
    },
    northEast: {
      latitude: Math.max(...points.map((point) => point.latitude)),
      longitude: Math.max(...points.map((point) => point.longitude)),
    },
  };
}

function roundPoint(point: GeoPoint): GeoPoint {
  return {
    latitude: Number(point.latitude.toFixed(6)),
    longitude: Number(point.longitude.toFixed(6)),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
