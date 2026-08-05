import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { GeoPoint } from '@/features/maps/types';
import type { MapAdapterHandle, MapAdapterProps } from './MapAdapter';
import { boundsCenter, padBounds, type MapBounds } from './MapBounds';
import type { MapMarker } from './MapMarker';

const IDLE_DEBOUNCE_MS = 150;
const FOCUS_SPAN_DEGREES = 0.01;
const FOLLOW_SPAN_DEGREES = 0.006;

// St. Petersburg — used only until a real viewport (fitBounds/focusPoint) is applied.
const DEFAULT_VIEWPORT: MapBounds = {
  minLatitude: 59.85,
  minLongitude: 30.25,
  maxLatitude: 59.98,
  maxLongitude: 30.45,
};

function boundsAroundPoint(point: GeoPoint, spanDegrees: number): MapBounds {
  return {
    minLatitude: point.latitude - spanDegrees / 2,
    minLongitude: point.longitude - spanDegrees / 2,
    maxLatitude: point.latitude + spanDegrees / 2,
    maxLongitude: point.longitude + spanDegrees / 2,
  };
}

const MARKER_COLORS: Record<MapMarker['kind'], string> = {
  pickup: '#34C759',
  destination: '#FF3B30',
  waypoint: '#FF9500',
  driver: '#12B0FF',
  user: '#FFFFFF',
  centerPin: '#12B0FF',
};

/**
 * Fully offline map view: no external SDK, just a linear lat/lng → pixel
 * projection over the current viewport. It renders a coordinate grid,
 * markers and polylines, and supports single-finger pan (no pinch-zoom —
 * out of scope for a development-only fallback). Forbidden in production;
 * see MapProviderFactory.
 */
export const DevelopmentMapView = memo(
  forwardRef<MapAdapterHandle, MapAdapterProps>(function DevelopmentMapView(
    { markers, polylines, onCameraIdle, onManualCameraMove },
    ref,
  ) {
    const [layout, setLayout] = useState({ width: 0, height: 0 });
    const [viewport, setViewport] = useState<MapBounds>(DEFAULT_VIEWPORT);
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragStartRef = useRef<{
      x: number;
      y: number;
      viewport: MapBounds;
    } | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        applyCamera: (command) => {
          if (idleTimer.current) clearTimeout(idleTimer.current);
          if (command.type === 'fitBounds') {
            setViewport(padBounds(command.bounds, 0.2));
          } else if (command.type === 'focusPoint') {
            setViewport(boundsAroundPoint(command.point, FOCUS_SPAN_DEGREES));
          } else {
            setViewport(boundsAroundPoint(command.point, FOLLOW_SPAN_DEGREES));
          }
        },
      }),
      [],
    );

    const project = useCallback((point: GeoPoint): { x: number; y: number } => {
      const v = viewportRef.current;
      const l = layoutRef.current;
      const lonSpan = v.maxLongitude - v.minLongitude || 1e-9;
      const latSpan = v.maxLatitude - v.minLatitude || 1e-9;
      return {
        x: ((point.longitude - v.minLongitude) / lonSpan) * l.width,
        y: ((v.maxLatitude - point.latitude) / latSpan) * l.height,
      };
    }, []);

    const scheduleIdle = useCallback(() => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        onCameraIdle?.(boundsCenter(viewportRef.current));
      }, IDLE_DEBOUNCE_MS);
    }, [onCameraIdle]);

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onMoveShouldSetPanResponder: (_event, gesture) =>
            Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
          onPanResponderGrant: (event) => {
            dragStartRef.current = {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
              viewport: viewportRef.current,
            };
            onManualCameraMove?.();
          },
          onPanResponderMove: (event) => {
            const start = dragStartRef.current;
            const l = layoutRef.current;
            if (!start || l.width === 0 || l.height === 0) return;

            const dx = event.nativeEvent.pageX - start.x;
            const dy = event.nativeEvent.pageY - start.y;
            const lonPerPixel =
              (start.viewport.maxLongitude - start.viewport.minLongitude) /
              l.width;
            const latPerPixel =
              (start.viewport.maxLatitude - start.viewport.minLatitude) /
              l.height;

            setViewport({
              minLongitude: start.viewport.minLongitude - dx * lonPerPixel,
              maxLongitude: start.viewport.maxLongitude - dx * lonPerPixel,
              minLatitude: start.viewport.minLatitude + dy * latPerPixel,
              maxLatitude: start.viewport.maxLatitude + dy * latPerPixel,
            });
          },
          onPanResponderRelease: () => {
            dragStartRef.current = null;
            scheduleIdle();
          },
          onPanResponderTerminate: () => {
            dragStartRef.current = null;
            scheduleIdle();
          },
        }),
      [onManualCameraMove, scheduleIdle],
    );

    const onLayout = useCallback((event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setLayout({ width, height });
    }, []);

    return (
      <View
        style={styles.container}
        onLayout={onLayout}
        {...panResponder.panHandlers}
      >
        <DevelopmentGrid />
        {polylines.map((polyline) => (
          <PolylineView
            key={polyline.id}
            points={polyline.points}
            project={project}
            kind={polyline.kind}
          />
        ))}
        {markers.map((marker) => (
          <MarkerView key={marker.id} marker={marker} project={project} />
        ))}
      </View>
    );
  }),
);

function DevelopmentGrid() {
  const lines = Array.from({ length: 9 }, (_, index) => (index + 1) * 10);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.map((percent) => (
        <View
          key={`v-${percent}`}
          style={[styles.gridLineVertical, { left: `${percent}%` }]}
        />
      ))}
      {lines.map((percent) => (
        <View
          key={`h-${percent}`}
          style={[styles.gridLineHorizontal, { top: `${percent}%` }]}
        />
      ))}
    </View>
  );
}

function PolylineView({
  points,
  project,
  kind,
}: {
  points: GeoPoint[];
  project: (point: GeoPoint) => { x: number; y: number };
  kind: 'route' | 'traveled' | 'remaining';
}) {
  const color = kind === 'traveled' ? '#5A5F6A' : '#12B0FF';
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = project(points[index]!);
    const to = project(points[index + 1]!);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    segments.push(
      <View
        key={index}
        style={[
          styles.polylineSegment,
          {
            left: from.x,
            top: from.y - 1.5,
            width: length,
            backgroundColor: color,
            transform: [{ rotate: `${angle}deg` }],
          },
        ]}
      />,
    );
  }
  return <>{segments}</>;
}

function MarkerView({
  marker,
  project,
}: {
  marker: MapMarker;
  project: (point: GeoPoint) => { x: number; y: number };
}) {
  const { x, y } = project(marker.location);
  const isDriver = marker.kind === 'driver';
  return (
    <View
      style={[styles.markerContainer, { left: x - 10, top: y - 10 }]}
      pointerEvents="none"
    >
      <View
        style={[
          styles.markerDot,
          {
            backgroundColor: MARKER_COLORS[marker.kind],
            transform:
              isDriver && marker.bearingDegrees != null
                ? [{ rotate: `${marker.bearingDegrees}deg` }]
                : undefined,
          },
        ]}
      />
      <Text style={styles.markerLabel}>
        {marker.label ??
          `${marker.location.latitude.toFixed(4)}, ${marker.location.longitude.toFixed(4)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14151A',
    overflow: 'hidden',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#26282E',
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#26282E',
  },
  polylineSegment: {
    position: 'absolute',
    height: 3,
    borderRadius: 1.5,
    transformOrigin: 'left center',
  },
  markerContainer: {
    position: 'absolute',
    alignItems: 'center',
    width: 20,
  },
  markerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#0A0A0B',
  },
  markerLabel: {
    marginTop: 2,
    fontSize: 9,
    color: '#9B9EA6',
  },
});
