import type { GeoPoint } from '@/features/maps/types';
import { haversineMeters } from './geo';

export type LocationQualityStatus =
  | 'STABLE'
  | 'DEGRADED'
  | 'STALE'
  | 'SPOOFING_SUSPECTED'
  | 'UNAVAILABLE';

export type LocationQualitySample = {
  location: GeoPoint;
  accuracyMeters: number;
  /** ISO-8601 timestamp from the server, e.g. driver.location.updated payload. */
  recordedAt: string;
};

export type LocationQualityThresholds = {
  staleAfterSeconds: number;
  unavailableAfterSeconds: number;
  degradedAccuracyMeters: number;
  maxPlausibleSpeedMetersPerSecond: number;
};

export const DEFAULT_LOCATION_QUALITY_THRESHOLDS: LocationQualityThresholds = {
  staleAfterSeconds: Number(
    process.env.EXPO_PUBLIC_MAP_LOCATION_STALE_SECONDS ?? 15,
  ),
  unavailableAfterSeconds: Number(
    process.env.EXPO_PUBLIC_MAP_LOCATION_UNAVAILABLE_SECONDS ?? 60,
  ),
  degradedAccuracyMeters: 50,
  maxPlausibleSpeedMetersPerSecond: 55, // ~200 km/h
};

export type LocationQualityResult = {
  status: LocationQualityStatus;
  ageSeconds: number;
  impliedSpeedMetersPerSecond: number | null;
};

/**
 * Classifies a location sample for map rendering — distinct from the driver's
 * own upload-time accuracy classification (LOW/MEDIUM/HIGH on the server):
 * this axis is about how much a *consumer* of the sample should trust it right
 * now, given its age and its movement relative to the last known-good sample.
 */
export function classifyLocationQuality(
  sample: LocationQualitySample,
  previous: LocationQualitySample | null,
  nowMs: number,
  thresholds: LocationQualityThresholds = DEFAULT_LOCATION_QUALITY_THRESHOLDS,
): LocationQualityResult {
  const recordedAtMs = Date.parse(sample.recordedAt);
  const ageSeconds = Math.max(0, (nowMs - recordedAtMs) / 1000);

  if (ageSeconds > thresholds.unavailableAfterSeconds) {
    return {
      status: 'UNAVAILABLE',
      ageSeconds,
      impliedSpeedMetersPerSecond: null,
    };
  }
  if (ageSeconds > thresholds.staleAfterSeconds) {
    return { status: 'STALE', ageSeconds, impliedSpeedMetersPerSecond: null };
  }

  const impliedSpeed = impliedSpeedMetersPerSecond(sample, previous);
  if (
    impliedSpeed !== null &&
    impliedSpeed > thresholds.maxPlausibleSpeedMetersPerSecond
  ) {
    return {
      status: 'SPOOFING_SUSPECTED',
      ageSeconds,
      impliedSpeedMetersPerSecond: impliedSpeed,
    };
  }

  if (sample.accuracyMeters > thresholds.degradedAccuracyMeters) {
    return {
      status: 'DEGRADED',
      ageSeconds,
      impliedSpeedMetersPerSecond: impliedSpeed,
    };
  }

  return {
    status: 'STABLE',
    ageSeconds,
    impliedSpeedMetersPerSecond: impliedSpeed,
  };
}

function impliedSpeedMetersPerSecond(
  sample: LocationQualitySample,
  previous: LocationQualitySample | null,
): number | null {
  if (!previous) return null;
  const elapsedSeconds =
    (Date.parse(sample.recordedAt) - Date.parse(previous.recordedAt)) / 1000;
  if (elapsedSeconds <= 0) return null;
  return haversineMeters(previous.location, sample.location) / elapsedSeconds;
}

/** User-facing copy per status, kept neutral for the passenger, direct for the driver. */
export function passengerMessageFor(
  status: LocationQualityStatus,
): string | null {
  switch (status) {
    case 'STABLE':
      return null;
    case 'DEGRADED':
      return 'Уточняем положение машины…';
    case 'STALE':
      return 'Обновляем положение машины…';
    case 'SPOOFING_SUSPECTED':
      return 'Временная неточность в определении положения машины.';
    case 'UNAVAILABLE':
      return 'Не удаётся определить положение машины.';
    default:
      return null;
  }
}

export function driverMessageFor(status: LocationQualityStatus): string | null {
  switch (status) {
    case 'STABLE':
      return null;
    case 'DEGRADED':
      return 'Слабый сигнал геолокации — точность снижена.';
    case 'STALE':
      return 'Нет свежих данных геолокации.';
    case 'SPOOFING_SUSPECTED':
      return 'Похоже на подмену геолокации — координаты не используются.';
    case 'UNAVAILABLE':
      return 'Геолокация недоступна.';
    default:
      return null;
  }
}
