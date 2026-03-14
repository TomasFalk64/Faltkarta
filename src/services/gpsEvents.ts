export type GpsSample = {
  lat: number;
  lon: number;
  rawAccuracy: number;
  timestamp: number;
};

type GpsListener = (sample: GpsSample) => void;

const listeners = new Set<GpsListener>();

export function subscribeGpsSamples(listener: GpsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitGpsSample(sample: GpsSample) {
  listeners.forEach((listener) => listener(sample));
}
