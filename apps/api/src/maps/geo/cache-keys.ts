import { createHash } from 'node:crypto';

import { normalizeAddressQuery } from './address-normalizer.js';
import { roundCoordinate } from './geo-math.js';
import type { RouteRequest } from '../maps.types.js';

/**
 * Redis cache keys for maps results. Keys are namespaced by capability and
 * provider so switching providers never returns another provider's cached data.
 * Coordinates are rounded and route parameters folded in, so equivalent
 * requests share a key while distinct ones never collide.
 */

const PREFIX = 'maps:v1';

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16);
}

export function suggestionsCacheKey(
  provider: string,
  query: string,
  bias: { latitude: number; longitude: number } | undefined,
  limit: number,
): string {
  const normalized = normalizeAddressQuery(query);
  const biasPart = bias
    ? `${roundCoordinate(bias.latitude)},${roundCoordinate(bias.longitude)}`
    : 'none';
  return `${PREFIX}:${provider}:suggest:${limit}:${biasPart}:${shortHash(
    normalized,
  )}`;
}

export function geocodeCacheKey(provider: string, address: string): string {
  return `${PREFIX}:${provider}:geocode:${shortHash(
    normalizeAddressQuery(address),
  )}`;
}

export function reverseGeocodeCacheKey(
  provider: string,
  latitude: number,
  longitude: number,
): string {
  return `${PREFIX}:${provider}:reverse:${roundCoordinate(
    latitude,
  )},${roundCoordinate(longitude)}`;
}

export function routeCacheKey(
  provider: string,
  kind: 'estimate' | 'build',
  request: RouteRequest,
): string {
  const parts = [
    `${roundCoordinate(request.origin.latitude)},${roundCoordinate(
      request.origin.longitude,
    )}`,
    `${roundCoordinate(request.destination.latitude)},${roundCoordinate(
      request.destination.longitude,
    )}`,
    request.waypoints
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map(
        (w) => `${roundCoordinate(w.latitude)},${roundCoordinate(w.longitude)}`,
      )
      .join('|'),
    request.transportMode,
    request.avoidTolls ? 'tolls0' : 'tolls1',
    request.avoidUnpavedRoads ? 'unpaved0' : 'unpaved1',
  ].join(';');

  return `${PREFIX}:${provider}:route:${kind}:${shortHash(parts)}`;
}
