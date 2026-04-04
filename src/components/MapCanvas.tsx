import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import {
  imagePointToLatLon,
  isCoordInsideMapBounds,
  latLonToImagePoint,
  getDisplayBounds3857,
  wgs84ToMeters3857,
  meters3857ToSource,
  sourceCrsToImagePoint,
  meters3857ToImagePoint,
} from "../services/mapProjection";
import { distanceMeters } from "../services/coords";
import { LatLon, MapItem, Observation } from "../types/models";

type Props = {
  map: MapItem;
  imageUri?: string;
  centerCoord: LatLon;
  gpsPos: LatLon | null;
  observations: Observation[];
  draftPolygon: LatLon[];
  showScaleBar: boolean;
  onPanGeoDelta: (deltaLat: number, deltaLon: number) => void;
  onManualPan: () => void;
  onPressPoint?: (observationId: string) => void;
};

type ProjectedPoint3857 = {
  meters3857: { x: number; y: number };
  sourceCrs: { x: number; y: number } | null;
};

const VIRTUAL_MAX_SIDE = 800;
const TARGET_DOT_SCREEN_SIZE = 22;
const MIN_DOT_SCREEN_SIZE = 18;
const MAX_DOT_SCREEN_SIZE = 40;
const TARGET_TOUCH_SCREEN_SIZE = 28;
const MIN_TOUCH_SCREEN_SIZE = 24;
const MAX_TOUCH_SCREEN_SIZE = 36;

export function MapCanvas({
  map,
  imageUri,
  centerCoord,
  gpsPos,
  observations,
  draftPolygon,
  showScaleBar,
  onPanGeoDelta,
  onManualPan,
  onPressPoint,
}: Props) {
  const pointMarkers = useMemo(() => observations.filter((o) => o.kind === "point"), [observations]);
  const polygonObs = useMemo(() => observations.filter((o) => o.kind === "polygon"), [observations]);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });

  const modeRef = useRef<"none" | "pan" | "pinch">("none");
  const pinchRef = useRef({ startDistance: 1, startScale: 1 });
  const centerRef = useRef(centerCoord);
  const scaleRef = useRef(scale);
  const minScaleRef = useRef(1);
  const touchedPanRef = useRef(false);
  const pendingDragResetRef = useRef(false);

  useEffect(() => {
    centerRef.current = centerCoord;
  }, [centerCoord]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const displayBounds3857 = useMemo(() => getDisplayBounds3857(map), [map]);

  const virtualSize = useMemo(() => {
    const bounds = displayBounds3857;
    if (!bounds) return { width: VIRTUAL_MAX_SIDE, height: VIRTUAL_MAX_SIDE };
    const widthMeters = bounds.maxX - bounds.minX;
    const heightMeters = bounds.maxY - bounds.minY;
    if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters) || widthMeters <= 0 || heightMeters <= 0) {
      return { width: VIRTUAL_MAX_SIDE, height: VIRTUAL_MAX_SIDE };
    }
    const mapAspectRatio = widthMeters / heightMeters;
    if (!Number.isFinite(mapAspectRatio) || mapAspectRatio <= 0) {
      return { width: VIRTUAL_MAX_SIDE, height: VIRTUAL_MAX_SIDE };
    }
    if (mapAspectRatio >= 1) {
      return {
        width: VIRTUAL_MAX_SIDE,
        height: VIRTUAL_MAX_SIDE / mapAspectRatio,
      };
    }
    return {
      width: VIRTUAL_MAX_SIDE * mapAspectRatio,
      height: VIRTUAL_MAX_SIDE,
    };
  }, [displayBounds3857]);

  const minScale = useMemo(
    () => computeMinScale(viewSize.width, viewSize.height, virtualSize.width, virtualSize.height),
    [viewSize.width, viewSize.height, virtualSize.width, virtualSize.height]
  );

  useEffect(() => {
    if (!Number.isFinite(minScale)) return;
    minScaleRef.current = minScale;
    setScale((prev) => Math.max(prev, minScale));
  }, [minScale]);

  const centerImagePoint = useMemo(
    () => latLonToImagePoint(map, centerCoord, virtualSize.width, virtualSize.height),
    [map, centerCoord, virtualSize.width, virtualSize.height]
  );
  const committedShiftX = virtualSize.width / 2 - centerImagePoint.x;
  const committedShiftY = virtualSize.height / 2 - centerImagePoint.y;

  const toLocalPoint = useMemo(
    () =>
      (p: ProjectedPoint3857) => {
        if (map.georef && p.sourceCrs) {
          const px = sourceCrsToImagePoint(map, p.sourceCrs, virtualSize.width, virtualSize.height);
          return px ?? { x: 0, y: 0 };
        }
        if (!map.georef && displayBounds3857) {
          return meters3857ToImagePoint(displayBounds3857, p.meters3857, virtualSize.width, virtualSize.height);
        }
        return { x: 0, y: 0 };
      },
    [map, displayBounds3857, virtualSize.width, virtualSize.height]
  );

  const gpsPosProjected = useMemo(() => {
    if (!gpsPos) return null;
    const meters3857 = wgs84ToMeters3857(gpsPos);
    if (!meters3857) return null;
    const sourceCrs = map.georef ? meters3857ToSource(map, meters3857) : null;
    return { meters3857, sourceCrs };
  }, [gpsPos, map]);

  const projectedPoints = useMemo(() => {
    return pointMarkers
      .map((obs) => {
        const meters3857 = wgs84ToMeters3857(obs.wgs84);
        if (!meters3857) return null;
        const sourceCrs = map.georef ? meters3857ToSource(map, meters3857) : null;
        if (map.georef && !sourceCrs) return null;
        return { obs, meters3857, sourceCrs };
      })
      .filter(
        (item): item is {
          obs: (typeof pointMarkers)[number];
          meters3857: ProjectedPoint3857["meters3857"];
          sourceCrs: ProjectedPoint3857["sourceCrs"];
        } => !!item
      );
  }, [pointMarkers, map]);

  const projectedPolygons = useMemo(() => {
    return polygonObs.map((obs) => {
      const points = obs.wgs84
        .map((p) => {
          const meters3857 = wgs84ToMeters3857(p);
          if (!meters3857) return null;
          const sourceCrs = map.georef ? meters3857ToSource(map, meters3857) : null;
          if (map.georef && !sourceCrs) return null;
          return { meters3857, sourceCrs };
        })
        .filter((p): p is ProjectedPoint3857 => !!p);
      return { obs, points };
    });
  }, [polygonObs, map]);

  const projectedDraftPolygon = useMemo(() => {
    return draftPolygon
      .map((p) => {
        const meters3857 = wgs84ToMeters3857(p);
        if (!meters3857) return null;
        const sourceCrs = map.georef ? meters3857ToSource(map, meters3857) : null;
        if (map.georef && !sourceCrs) return null;
        return { meters3857, sourceCrs };
      })
      .filter((p): p is ProjectedPoint3857 => !!p);
  }, [draftPolygon, map]);

  const gpsPoint = gpsPosProjected ? toLocalPoint(gpsPosProjected) : null;
  const safeScale = Math.max(0.01, scale);
  const gpsDotSize = clamp(
    TARGET_DOT_SCREEN_SIZE / safeScale,
    MIN_DOT_SCREEN_SIZE / safeScale,
    MAX_DOT_SCREEN_SIZE / safeScale
  );
  const pointDotSize = clamp(
    TARGET_DOT_SCREEN_SIZE / safeScale,
    MIN_DOT_SCREEN_SIZE / safeScale,
    MAX_DOT_SCREEN_SIZE / safeScale
  );
  const pointTouchSize = clamp(
    TARGET_TOUCH_SCREEN_SIZE / safeScale,
    MIN_TOUCH_SCREEN_SIZE / safeScale,
    MAX_TOUCH_SCREEN_SIZE / safeScale
  );
  const gpsBorderWidth = clamp(1.5 / safeScale, 0.8 / safeScale, 2.0 / safeScale);
  const scaleBar = useMemo(() => {
    if (!showScaleBar) return null;
    const bounds = displayBounds3857;
    if (!bounds) return null;
    const widthMeters = bounds.maxX - bounds.minX;
    if (!Number.isFinite(widthMeters) || widthMeters <= 0) return null;

    // Geodesic distance for 100 screen pixels, independent of source CRS.
    const pixels = 100;
    const deltaImagePx = pixels / Math.max(0.01, scale);
    const p1 = centerImagePoint;
    const p2 = { x: centerImagePoint.x + deltaImagePx, y: centerImagePoint.y };
    const w1 = imagePointToLatLon(map, p1, virtualSize.width, virtualSize.height);
    const w2 = imagePointToLatLon(map, p2, virtualSize.width, virtualSize.height);
    const metersFor100px = distanceMeters(w1, w2);
    if (!Number.isFinite(metersFor100px) || metersFor100px <= 0) return null;
    const niceMeters = roundToNiceNumber(metersFor100px);
    const barWidthPx = Math.max(20, Math.round((niceMeters / metersFor100px) * pixels));
    return {
      label: `${Math.round(niceMeters)} m`,
      widthPx: barWidthPx,
    };
  }, [centerImagePoint, displayBounds3857, map, scale, showScaleBar, virtualSize.height, virtualSize.width]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2,
        onPanResponderGrant: (evt) => {
          touchedPanRef.current = false;
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            modeRef.current = "pinch";
            pinchRef.current = {
              startDistance: touchDistance(touches[0], touches[1]),
              startScale: scaleRef.current,
            };
          } else {
            modeRef.current = "pan";
          }
        },
        onPanResponderMove: (evt, gs) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            if (modeRef.current !== "pinch") {
              modeRef.current = "pinch";
              pinchRef.current = {
                startDistance: touchDistance(touches[0], touches[1]),
                startScale: scaleRef.current,
              };
              return;
            }
            const d = touchDistance(touches[0], touches[1]);
            const ratio = d / Math.max(1, pinchRef.current.startDistance);
            setScale(clamp(pinchRef.current.startScale * ratio, minScaleRef.current, 8));
            return;
          }
          const currentScale = Math.max(0.01, scaleRef.current);
          setDrag({ x: gs.dx / currentScale, y: gs.dy / currentScale });
          if (!touchedPanRef.current) {
            onManualPan();
            touchedPanRef.current = true;
          }
        },
        onPanResponderRelease: (_, gs) => {
          if (modeRef.current === "pan") {
            const dx = gs.dx;
            const dy = gs.dy;
            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
              const currentCenter = centerRef.current;
              const currentScale = Math.max(0.01, scaleRef.current);
              const currentCenterPx = latLonToImagePoint(map, currentCenter, virtualSize.width, virtualSize.height);
              const nextCenterPx = {
                x: currentCenterPx.x - dx / currentScale,
                y: currentCenterPx.y - dy / currentScale,
              };
              const nextCenter = imagePointToLatLon(map, nextCenterPx, virtualSize.width, virtualSize.height);
              onPanGeoDelta(nextCenter.lat - currentCenter.lat, nextCenter.lon - currentCenter.lon);
              pendingDragResetRef.current = true;
            } else {
              setDrag({ x: 0, y: 0 });
            }
          } else {
            setDrag({ x: 0, y: 0 });
          }
          modeRef.current = "none";
          touchedPanRef.current = false;
        },
        onPanResponderTerminate: () => {
          modeRef.current = "none";
          touchedPanRef.current = false;
          setDrag({ x: 0, y: 0 });
        },
      }),
    [map, onManualPan, onPanGeoDelta]
  );

  useEffect(() => {
    if (!pendingDragResetRef.current) return;
    setDrag({ x: 0, y: 0 });
    pendingDragResetRef.current = false;
  }, [centerCoord]);

  return (
    <View
      style={styles.wrapper}
      {...panResponder.panHandlers}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setViewSize({ width, height });
          const nextMinScale = computeMinScale(width, height, virtualSize.width, virtualSize.height);
          if (Number.isFinite(nextMinScale)) {
            minScaleRef.current = nextMinScale;
            if (scaleRef.current < nextMinScale) {
              setScale(nextMinScale);
            }
          }
        }
      }}
    >
      {!displayBounds3857 ? null : (
      <View
        style={[
          styles.layer,
          {
            width: virtualSize.width,
            height: virtualSize.height,
            marginLeft: -virtualSize.width / 2,
            marginTop: -virtualSize.height / 2,
            transform: [
              { scale },
              { translateX: committedShiftX + drag.x },
              { translateY: committedShiftY + drag.y },
            ],
          },
        ]}
      >
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: virtualSize.width, height: virtualSize.height }}
            resizeMode="stretch"
          />
        ) : (
          <View style={[styles.placeholder, { width: virtualSize.width, height: virtualSize.height }]}>
            <Text style={styles.placeholderText}>Kunde inte visa GeoTIFF-preview</Text>
            <Text style={styles.placeholderSubtext}>Importera kartan igen med en enklare GeoTIFF</Text>
          </View>
        )}

        <Svg style={StyleSheet.absoluteFill} width={virtualSize.width} height={virtualSize.height}>
          {projectedPolygons.map(({ obs, points }) => {
            if (obs.kind !== "polygon") return null;
            const polyline = points.map((p) => toLocalPoint(p)).map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <Polyline
                key={obs.id}
                points={polyline}
                stroke="#ca6702"
                strokeWidth={3}
                fill="rgba(202,103,2,0.15)"
              />
            );
          })}

          {projectedDraftPolygon.length > 1 && (
            <Polyline
              points={projectedDraftPolygon
                .map((p) => toLocalPoint(p))
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
              stroke="#0a9396"
              strokeWidth={3}
              fill="none"
            />
          )}

          {projectedDraftPolygon.map((p, i) => {
            const pt = toLocalPoint(p);
            return <Circle key={`draft-${i}`} cx={pt.x} cy={pt.y} r={5} fill="#0a9396" />;
          })}
        </Svg>

        {gpsPoint && (
          <View
            style={[
              styles.gpsDot,
              {
                width: gpsDotSize,
                height: gpsDotSize,
                borderRadius: gpsDotSize / 2,
                borderWidth: gpsBorderWidth,
                left: gpsPoint.x - gpsDotSize / 2,
                top: gpsPoint.y - gpsDotSize / 2,
              },
            ]}
          />
        )}

        {projectedPoints.map(({ obs, meters3857, sourceCrs }) => {
          if (obs.kind !== "point") return null;
          const pt = toLocalPoint({ meters3857, sourceCrs });
          return (
            <Pressable
              key={obs.id}
              onPress={() => onPressPoint?.(obs.id)}
              style={[
                styles.pointTouch,
                {
                  width: pointTouchSize,
                  height: pointTouchSize,
                  left: pt.x - pointTouchSize / 2,
                  top: pt.y - pointTouchSize / 2,
                },
              ]}
            >
              <View
                style={[
                  styles.pointDot,
                  {
                    width: pointDotSize,
                    height: pointDotSize,
                    borderRadius: pointDotSize / 2,
                    borderWidth: gpsBorderWidth,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      )}

      {!displayBounds3857 ? null : (
        <View pointerEvents="none" style={styles.crosshair}>
          <View style={styles.crosshairH} />
          <View style={styles.crosshairV} />
        </View>
      )}

      {!displayBounds3857 || !scaleBar ? null : (
        <View style={styles.scaleBarWrap}>
          <View style={styles.scaleBar}>
            <Text style={styles.scaleBarText}>{scaleBar.label}</Text>
            <View style={[styles.scaleBarLine, { width: scaleBar.widthPx }]}>
              <View style={styles.scaleBarTickLeft} />
              <View style={styles.scaleBarTickRight} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function touchDistance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number {
  const dx = b.pageX - a.pageX;
  const dy = b.pageY - a.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeMinScale(
  viewWidth: number,
  viewHeight: number,
  virtualWidth: number,
  virtualHeight: number
): number {
  if (!viewWidth || !viewHeight || !virtualWidth || !virtualHeight) return 1;
  const scaleX = viewWidth / virtualWidth;
  const scaleY = viewHeight / virtualHeight;
  const fitScale = Math.min(scaleX, scaleY);
  return Math.max(0.1, Math.min(1, fitScale));
}

function roundToNiceNumber(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  let nice = 1;
  if (n <= 1.5) nice = 1;
  else if (n <= 3) nice = 2;
  else if (n <= 7) nice = 5;
  else nice = 10;
  return nice * pow;
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: "#172121",
    overflow: "hidden",
  },
  layer: {
    position: "absolute",
    left: "50%",
    top: "50%",
  },
  placeholder: {
    backgroundColor: "#22323b",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  placeholderText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 18,
    marginBottom: 8,
  },
  placeholderSubtext: {
    color: "#d8dee3",
    textAlign: "center",
  },
  crosshair: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -20,
    marginTop: -20,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  crosshairH: {
    position: "absolute",
    width: 40,
    height: 2,
    backgroundColor: "#ff006e",
  },
  crosshairV: {
    position: "absolute",
    width: 2,
    height: 40,
    backgroundColor: "#ff006e",
  },
  scaleBarWrap: {
    position: "absolute",
    right: 20,
    bottom: 40,
    alignItems: "flex-end",
  },
  scaleBarText: {
    color: "#000",
    fontSize: 11,
    fontWeight: "400",
    textAlign: "center",
  },
  scaleBar: {
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: 6,
    minHeight: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.2)",
    alignSelf: "flex-start",
  },
  scaleBarLine: {
    marginTop: 2,
    height: 2,
    backgroundColor: "#000",
    borderRadius: 1,
  },
  scaleBarTickLeft: {
    position: "absolute",
    left: 0,
    width: 2,
    height: 8,
    top: -8,
    backgroundColor: "#000",
    borderRadius: 1,
  },
  scaleBarTickRight: {
    position: "absolute",
    right: 0,
    width: 2,
    height: 8,
    top: -8,
    backgroundColor: "#000",
    borderRadius: 1,
  },
  gpsDot: {
    position: "absolute",
    backgroundColor: "#3a86ff",
    borderWidth: 0,
    borderColor: "#e6f0ff",
  },
  pointDot: {
    backgroundColor: "#d62828",
    borderWidth: 0,
    borderColor: "#fff",
  },
  pointTouch: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});
