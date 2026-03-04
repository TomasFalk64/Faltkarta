import React, { useEffect, useState } from "react";
import { Image, LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Polyline } from "react-native-svg";
import { LatLon, MapItem, Observation } from "../types/models";
import { latLonToImagePoint } from "../services/mapProjection";

type Props = {
  map: MapItem;
  imageUri?: string;
  centerCoord: LatLon;
  gpsPos: LatLon | null;
  observations: Observation[];
  draftPolygon: LatLon[];
  onPanGeoDelta: (deltaLat: number, deltaLon: number) => void;
  onManualPan: () => void;
  onRotationChanged?: (deg: number) => void;
  resetRotationSignal: number;
};

const VIRTUAL_IMAGE_WIDTH = 2000;
const VIRTUAL_IMAGE_HEIGHT = 2000;

export function MapCanvas({
  map,
  imageUri,
  centerCoord,
  gpsPos,
  observations,
  draftPolygon,
  onPanGeoDelta,
  onManualPan,
  onRotationChanged,
  resetRotationSignal,
}: Props) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const scale = useSharedValue(1);
  const scaleStart = useSharedValue(1);
  const rotation = useSharedValue(0);
  const rotationStart = useSharedValue(0);

  useEffect(() => {
    rotation.value = withTiming(0, { duration: 150 });
  }, [resetRotationSignal, rotation]);

  const centerImagePoint = latLonToImagePoint(
    map,
    centerCoord,
    VIRTUAL_IMAGE_WIDTH,
    VIRTUAL_IMAGE_HEIGHT
  );
  const baseTranslateX = size.width / 2 - centerImagePoint.x;
  const baseTranslateY = size.height / 2 - centerImagePoint.y;

  const panGesture = Gesture.Pan()
    .onStart(() => {
      panStartX.value = panX.value;
      panStartY.value = panY.value;
    })
    .onUpdate((e) => {
      panX.value = panStartX.value + e.translationX;
      panY.value = panStartY.value + e.translationY;
    })
    .onEnd((e) => {
      runOnJS(onManualPan)();
      runOnJS(applyPanToGeo)(e.translationX, e.translationY, scale.value, rotation.value);
      panX.value = withTiming(0, { duration: 140 });
      panY.value = withTiming(0, { duration: 140 });
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      scaleStart.value = scale.value;
    })
    .onUpdate((e) => {
      const next = scaleStart.value * e.scale;
      scale.value = Math.max(0.5, Math.min(8, next));
    });

  const rotationGesture = Gesture.Rotation()
    .onStart(() => {
      rotationStart.value = rotation.value;
    })
    .onUpdate((e) => {
      rotation.value = rotationStart.value + e.rotation;
      if (onRotationChanged) {
        runOnJS(onRotationChanged)((rotation.value * 180) / Math.PI);
      }
    });

  const gesture = Gesture.Simultaneous(panGesture, pinchGesture, rotationGesture);

  const mapStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: baseTranslateX + panX.value },
        { translateY: baseTranslateY + panY.value },
        { scale: scale.value },
        { rotateZ: `${rotation.value}rad` },
      ],
    };
  });

  function applyPanToGeo(dx: number, dy: number, currentScale: number, rotationRad: number) {
    const bounds = map.bbox ?? { minLat: 55.0, minLon: 11.0, maxLat: 69.5, maxLon: 24.2 };
    const lonSpan = bounds.maxLon - bounds.minLon;
    const latSpan = bounds.maxLat - bounds.minLat;
    const c = Math.cos(-rotationRad);
    const s = Math.sin(-rotationRad);
    const ux = dx * c - dy * s;
    const uy = dx * s + dy * c;
    const deltaLon = (-ux / (VIRTUAL_IMAGE_WIDTH * currentScale)) * lonSpan;
    const deltaLat = (uy / (VIRTUAL_IMAGE_HEIGHT * currentScale)) * latSpan;
    onPanGeoDelta(deltaLat, deltaLon);
  }

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }

  const pointMarkers = observations.filter((o) => o.kind === "point");
  const polygonObs = observations.filter((o) => o.kind === "polygon");

  const gpsPoint = gpsPos
    ? latLonToImagePoint(map, gpsPos, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT)
    : null;

  return (
    <View style={styles.wrapper} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.layer, mapStyle]}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.image} resizeMode="stretch" />
          ) : (
            <View style={[styles.image, styles.placeholder]}>
              <Text style={styles.placeholderText}>Ingen bakgrundsbild kopplad</Text>
              <Text style={styles.placeholderSubtext}>Importera PNG/JPG for visning av GeoTIFF i MVP</Text>
            </View>
          )}

          <Svg style={StyleSheet.absoluteFill} width={VIRTUAL_IMAGE_WIDTH} height={VIRTUAL_IMAGE_HEIGHT}>
            {polygonObs.map((obs) => {
              if (obs.kind !== "polygon") return null;
              const points = obs.wgs84
                .map((p) =>
                  latLonToImagePoint(map, p, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT)
                )
                .map((p) => `${p.x},${p.y}`)
                .join(" ");
              return (
                <Polyline
                  key={obs.id}
                  points={points}
                  stroke="#ca6702"
                  strokeWidth={4}
                  fill="rgba(202,103,2,0.15)"
                />
              );
            })}

            {draftPolygon.length > 1 && (
              <Polyline
                points={draftPolygon
                  .map((p) => latLonToImagePoint(map, p, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT))
                  .map((p) => `${p.x},${p.y}`)
                  .join(" ")}
                stroke="#0a9396"
                strokeWidth={4}
                fill="none"
              />
            )}

            {draftPolygon.map((p, i) => {
              const pt = latLonToImagePoint(map, p, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT);
              return <Circle key={`draft-${i}`} cx={pt.x} cy={pt.y} r={6} fill="#0a9396" />;
            })}
          </Svg>

          {gpsPoint && <View style={[styles.gpsDot, { left: gpsPoint.x - 8, top: gpsPoint.y - 8 }]} />}

          {pointMarkers.map((obs) => {
            if (obs.kind !== "point") return null;
            const pt = latLonToImagePoint(map, obs.wgs84, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT);
            return <View key={obs.id} style={[styles.pointDot, { left: pt.x - 6, top: pt.y - 6 }]} />;
          })}
        </Animated.View>
      </GestureDetector>
      <View pointerEvents="none" style={styles.crosshair}>
        <View style={styles.crosshairH} />
        <View style={styles.crosshairV} />
      </View>
    </View>
  );
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
    left: 0,
    top: 0,
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
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#3a86ff",
    borderWidth: 2,
    borderColor: "#e6f0ff",
  },
  pointDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#ee9b00",
    borderWidth: 1,
    borderColor: "#fff",
  },
});
