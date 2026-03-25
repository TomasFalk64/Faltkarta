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

const VIRTUAL_IMAGE_WIDTH = 1200;
const VIRTUAL_IMAGE_HEIGHT = 1200;
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

  const modeRef = useRef<"none" | "pan" | "pinch">("none");
  const pinchRef = useRef({ startDistance: 1, startScale: 1 });
  const centerRef = useRef(centerCoord);
  const scaleRef = useRef(scale);
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
    if (!bounds) return { width: VIRTUAL_IMAGE_WIDTH, height: VIRTUAL_IMAGE_HEIGHT };
    const widthMeters = bounds.maxX - bounds.minX;
    const heightMeters = bounds.maxY - bounds.minY;
    if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters) || widthMeters <= 0 || heightMeters <= 0) {
      return { width: VIRTUAL_IMAGE_WIDTH, height: VIRTUAL_IMAGE_HEIGHT };
    }
    const mapAspectRatio = widthMeters / heightMeters;
    if (!Number.isFinite(mapAspectRatio) || mapAspectRatio <= 0) {
      return { width: VIRTUAL_IMAGE_WIDTH, height: VIRTUAL_IMAGE_HEIGHT };
    }
    return {
      width: VIRTUAL_IMAGE_WIDTH,
      height: VIRTUAL_IMAGE_WIDTH / mapAspectRatio,
    };
  }, [displayBounds3857]);

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
    const metersPerPixel = widthMeters / (virtualSize.width * scale);
    const metersFor100px = metersPerPixel * 100;
    const niceMeters = roundToNiceNumber(metersFor100px);
    const barWidthPx = Math.max(20, Math.round(niceMeters / metersPerPixel));
    return {
      label: `${Math.round(niceMeters)} m`,
      widthPx: barWidthPx,
    };
  }, [displayBounds3857, scale, showScaleBar, virtualSize.width]);

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
            setScale(clamp(pinchRef.current.startScale * ratio, 0.5, 4));
            return;
          }
          setDrag({ x: gs.dx, y: gs.dy });
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
              const currentCenterPx = latLonToImagePoint(map, currentCenter, virtualSize.width, virtualSize.height);
              const nextCenterPx = {
                x: currentCenterPx.x - dx,
                y: currentCenterPx.y - dy,
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
    <View style={styles.wrapper} {...panResponder.panHandlers}>
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
          <Text style={styles.scaleBarText}>{scaleBar.label}</Text>
          <View style={[styles.scaleBar, { width: scaleBar.widthPx }]} />
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
    bottom: 35,
    alignItems: "flex-end",
  },
  scaleBarText: {
    color: "#f4f0e7",
    fontWeight: "700",
    marginBottom: 6,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  scaleBar: {
    borderBottomWidth: 4,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderColor: "#f4f0e7",
    height: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    elevation: 6,
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
