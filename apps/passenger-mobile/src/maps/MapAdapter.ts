import type { GeoPoint } from '@/features/maps/types';
import type { CameraCommand } from './MapCameraController';
import type { MapMarker } from './MapMarker';
import type { MapPolyline } from './MapPolyline';

/**
 * The contract every concrete map view (a development canvas, a real SDK
 * wrapper) must satisfy. Domain/UI code renders markers and polylines and
 * issues camera commands through this contract only — it never imports a
 * map SDK's own types, so swapping providers never touches a screen.
 */
export type MapAdapterProps = {
  markers: MapMarker[];
  polylines: MapPolyline[];
  /** Fired once the camera stops moving (after a manual pan/zoom), for reverse geocoding the centre pin. */
  onCameraIdle?: (center: GeoPoint) => void;
  /** Fired the instant the user starts dragging/zooming — disables follow mode. */
  onManualCameraMove?: () => void;
};

export type MapAdapterHandle = {
  applyCamera: (command: CameraCommand) => void;
};

/** Identifies which concrete map implementation is mounted, for diagnostics/tests. */
export type MapProviderName = 'development' | 'yandex';
