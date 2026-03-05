import React, { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
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

const VIRTUAL_IMAGE_WIDTH = 1200;
const VIRTUAL_IMAGE_HEIGHT = 1200;

export function MapCanvas({ map, imageUri, gpsPos, observations, draftPolygon }: Props) {
  const pointMarkers = useMemo(() => observations.filter((o) => o.kind === "point"), [observations]);
  const polygonObs = useMemo(() => observations.filter((o) => o.kind === "polygon"), [observations]);

  const gpsPoint = gpsPos
    ? latLonToImagePoint(map, gpsPos, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT)
    : null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.layer}>
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
              .map((p) => latLonToImagePoint(map, p, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT))
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
                .map((p) => latLonToImagePoint(map, p, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT))
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
              stroke="#0a9396"
              strokeWidth={3}
              fill="none"
            />
          )}

          {draftPolygon.map((p, i) => {
            const pt = latLonToImagePoint(map, p, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT);
            return <Circle key={`draft-${i}`} cx={pt.x} cy={pt.y} r={5} fill="#0a9396" />;
          })}
        </Svg>

        {gpsPoint && <View style={[styles.gpsDot, { left: gpsPoint.x - 7, top: gpsPoint.y - 7 }]} />}

        {pointMarkers.map((obs) => {
          if (obs.kind !== "point") return null;
          const pt = latLonToImagePoint(map, obs.wgs84, VIRTUAL_IMAGE_WIDTH, VIRTUAL_IMAGE_HEIGHT);
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
