import type { RouteRequest } from '../maps.types.js';
import type { RouteRequestDto } from './route-request.dto.js';

/** Fills defaults so downstream code always sees a fully-specified request. */
export function toRouteRequest(dto: RouteRequestDto): RouteRequest {
  return {
    origin: { latitude: dto.origin.latitude, longitude: dto.origin.longitude },
    destination: {
      latitude: dto.destination.latitude,
      longitude: dto.destination.longitude,
    },
    waypoints: (dto.waypoints ?? []).map((w) => ({
      latitude: w.latitude,
      longitude: w.longitude,
      sequence: w.sequence,
    })),
    transportMode: dto.transportMode ?? 'driving',
    avoidTolls: dto.avoidTolls ?? false,
    avoidUnpavedRoads: dto.avoidUnpavedRoads ?? false,
  };
}
