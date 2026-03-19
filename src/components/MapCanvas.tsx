import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import {
  imagePointToLatLon,
  isCoordInsideMapBounds,
  latLonToImagePoint,
} from "../services/mapProjection";
import { LatLon, MapItem, Observation } from "../types/models";

type Props = {
  map: MapItem;
  imageUri?: string;
  centerCoord: LatLon;
  gpsPos: LatLon | null;
  observations: Observation[];
  draftPolygon: LatLon[];
  onPanGeoDelta: (deltaLat: number, deltaLon: number) => void;
  onManualPan: () => void;
  onPressPoint?: (observationId: string) => void;
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
  onPanGeoDelta,
  onManualPan,
  onPressPoint,
}: Props) {
  const pointMarkers = useMemo(() => observations.filter((o) => o.kind === "point"), [observations]);
  const polygonObs = useMemo(() => observations.filter((o) => o.kind === "polygon"), [observations]);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const panStepRef = useRef({ x: 0, y: 0 });
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

  const centerImagePoint = useMemo(
    () => latLonToImagePoint(map, centerCoord, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT),
    [map, centerCoord]
  );
  const committedShiftX = VIRTUAL_IMAGE_WIDTH / 2 - centerImagePoint.x;
  const committedShiftY = VIRTUAL_IMAGE_HEIGHT / 2 - centerImagePoint.y;

  const toLocalPoint = useMemo(
    () => (p: LatLon) => latLonToImagePoint(map, p, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT),
    [map]
  );

  const gpsPoint = gpsPos && isCoordInsideMapBounds(map, gpsPos) ? toLocalPoint(gpsPos) : null;
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
            panStepRef.current = { x: 0, y: 0 };
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
          panStepRef.current = { x: gs.dx, y: gs.dy };
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
              const currentCenterPx = latLonToImagePoint(
                map,
                currentCenter,
                VIRTUAL_IMAGE_WIDTH,
                VIRTUAL_IMAGE_HEIGHT
              );
              const nextCenterPx = {
                x: currentCenterPx.x - dx,
                y: currentCenterPx.y - dy,
              };
              const nextCenter = imagePointToLatLon(
                map,
                nextCenterPx,
                VIRTUAL_IMAGE_WIDTH,
                VIRTUAL_IMAGE_HEIGHT
              );
              onPanGeoDelta(nextCenter.lat - currentCenter.lat, nextCenter.lon - currentCenter.lon);
              pendingDragResetRef.current = true;
            } else {
              setDrag({ x: 0, y: 0 });
            }
          } else {
            setDrag({ x: 0, y: 0 });
          }
          modeRef.current = "none";
          panStepRef.current = { x: 0, y: 0 };
          touchedPanRef.current = false;
        },
        onPanResponderTerminate: () => {
          modeRef.current = "none";
          panStepRef.current = { x: 0, y: 0 };
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
      <View
        style={[
          styles.layer,
          {
            transform: [
              { scale },
              { translateX: committedShiftX + drag.x },
              { translateY: committedShiftY + drag.y },
            ],
          },
        ]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.image} resizeMode="stretch" />
        ) : (
          <View style={[styles.image, styles.placeholder]}>
            <Text style={styles.placeholderText}>Kunde inte visa GeoTIFF-preview</Text>
            <Text style={styles.placeholderSubtext}>Importera kartan igen med en enklare GeoTIFF</Text>
          </View>
        )}

        <Svg style={StyleSheet.absoluteFill} width={VIRTUAL_IMAGE_WIDTH} height={VIRTUAL_IMAGE_HEIGHT}>
          {polygonObs.map((obs) => {
            if (obs.kind !== "polygon") return null;
            const points = obs.wgs84
              .map((p) => toLocalPoint(p))
              .map((p) => `${p.x},${p.y}`)
              .join(" ");
            return (
              <Polyline
                key={obs.id}
                points={points}
                stroke="#ca6702"
                strokeWidth={3}
                fill="rgba(202,103,2,0.15)"
              />
            );
          })}

          {draftPolygon.length > 1 && (
            <Polyline
              points={draftPolygon
                .map((p) => toLocalPoint(p))
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
              stroke="#0a9396"
              strokeWidth={3}
              fill="none"
            />
          )}

          {draftPolygon.map((p, i) => {
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

        {pointMarkers.map((obs) => {
          if (obs.kind !== "point") return null;
          const pt = toLocalPoint(obs.wgs84);
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

      <View pointerEvents="none" style={styles.crosshair}>
        <View style={styles.crosshairH} />
        <View style={styles.crosshairV} />
      </View>
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

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: "#172121",
    overflow: "hidden",
  },
  layer: {
    width: VIRTUAL_IMAGE_WIDTH,
    height: VIRTUAL_IMAGE_HEIGHT,
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -VIRTUAL_IMAGE_WIDTH / 2,
    marginTop: -VIRTUAL_IMAGE_HEIGHT / 2,
  },
  image: {
    width: VIRTUAL_IMAGE_WIDTH,
    height: VIRTUAL_IMAGE_HEIGHT,
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
