import React, { useMemo, useRef, useState } from "react";
import { Image, PanResponder, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
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
  onRotationChanged?: (deg: number) => void;
  resetRotationSignal: number;
};

const VIRTUAL_IMAGE_WIDTH = 1200;
const VIRTUAL_IMAGE_HEIGHT = 1200;

const METERS_PER_LAT_DEG = 111320;
const METERS_PER_PIXEL = 1.5;

export function MapCanvas({
  map,
  imageUri,
  centerCoord,
  gpsPos,
  observations,
  draftPolygon,
  onPanGeoDelta,
  onManualPan,
}: Props) {
  const pointMarkers = useMemo(() => observations.filter((o) => o.kind === "point"), [observations]);
  const polygonObs = useMemo(() => observations.filter((o) => o.kind === "polygon"), [observations]);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ x: 0, y: 0 });
  const anchorRef = useRef<LatLon>(centerCoord);

  const anchorMetersPerLonDeg = Math.max(
    1,
    Math.abs(111320 * Math.cos((anchorRef.current.lat * Math.PI) / 180))
  );

  const mapShift = useMemo(() => {
    const eastMeters = (centerCoord.lon - anchorRef.current.lon) * anchorMetersPerLonDeg;
    const northMeters = (centerCoord.lat - anchorRef.current.lat) * METERS_PER_LAT_DEG;
    return {
      x: -eastMeters / METERS_PER_PIXEL,
      y: northMeters / METERS_PER_PIXEL,
    };
  }, [anchorMetersPerLonDeg, centerCoord.lat, centerCoord.lon]);

  const toLocalPoint = useMemo(() => {
    return (p: LatLon) => {
      const eastMeters = (p.lon - anchorRef.current.lon) * anchorMetersPerLonDeg;
      const northMeters = (p.lat - anchorRef.current.lat) * METERS_PER_LAT_DEG;
      return {
        x: VIRTUAL_IMAGE_WIDTH / 2 + eastMeters / METERS_PER_PIXEL,
        y: VIRTUAL_IMAGE_HEIGHT / 2 - northMeters / METERS_PER_PIXEL,
      };
    };
  }, [anchorMetersPerLonDeg]);

  const gpsPoint = gpsPos ? toLocalPoint(gpsPos) : null;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2,
        onPanResponderMove: (_, gs) => {
          const next = { x: gs.dx, y: gs.dy };
          dragRef.current = next;
          setDrag(next);
        },
        onPanResponderRelease: () => {
          const dx = dragRef.current.x;
          const dy = dragRef.current.y;
          dragRef.current = { x: 0, y: 0 };
          setDrag({ x: 0, y: 0 });
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          onManualPan();
          const eastMeters = -dx * METERS_PER_PIXEL;
          const northMeters = dy * METERS_PER_PIXEL;
          const deltaLon = eastMeters / anchorMetersPerLonDeg;
          const deltaLat = northMeters / METERS_PER_LAT_DEG;
          onPanGeoDelta(deltaLat, deltaLon);
        },
      }),
    [anchorMetersPerLonDeg, onManualPan, onPanGeoDelta]
  );

  return (
    <View style={styles.wrapper} {...panResponder.panHandlers}>
      <View
        style={[
          styles.layer,
          { transform: [{ translateX: mapShift.x + drag.x }, { translateY: mapShift.y + drag.y }] },
        ]}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
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

        {gpsPoint && <View style={[styles.gpsDot, { left: gpsPoint.x - 7, top: gpsPoint.y - 7 }]} />}

        {pointMarkers.map((obs) => {
          if (obs.kind !== "point") return null;
          const pt = toLocalPoint(obs.wgs84);
          return <View key={obs.id} style={[styles.pointDot, { left: pt.x - 5, top: pt.y - 5 }]} />;
        })}
      </View>

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
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#3a86ff",
    borderWidth: 2,
    borderColor: "#e6f0ff",
  },
  pointDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ee9b00",
    borderWidth: 1,
    borderColor: "#fff",
  },
});
