import { z } from 'zod';
import { fetchJson } from './http.ts';

const GEOJSON_URL = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson';
/** Jolpica's circuit coordinates are approximate; accept outlines whose centre is this close. */
const MAX_MATCH_KM = 6;

const Feature = z.object({
  properties: z.object({ id: z.string(), Name: z.string().optional() }),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())),
  }),
});
const FeatureCollection = z.object({ features: z.array(z.unknown()) });

export interface Outline {
  id: string;
  center: { lat: number; lon: number };
  coordinates: [number, number][];
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function matchOutline(point: { lat: number; lon: number }, outlines: Outline[]): Outline | null {
  let best: Outline | null = null;
  let bestKm = Infinity;
  for (const outline of outlines) {
    const km = haversineKm(point, outline.center);
    if (km < bestKm) {
      best = outline;
      bestKm = km;
    }
  }
  return bestKm <= MAX_MATCH_KM ? best : null;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export async function fetchOutlines(): Promise<Outline[]> {
  const collection = FeatureCollection.parse(await fetchJson(GEOJSON_URL));
  const outlines: Outline[] = [];
  for (const raw of collection.features) {
    const parsed = Feature.safeParse(raw);
    if (!parsed.success) continue;
    const coordinates = parsed.data.geometry.coordinates.map((c) => [round5(c[0]), round5(c[1])] as [number, number]);
    const lons = coordinates.map((c) => c[0]);
    const lats = coordinates.map((c) => c[1]);
    outlines.push({
      id: parsed.data.properties.id,
      center: {
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lon: (Math.min(...lons) + Math.max(...lons)) / 2,
      },
      coordinates,
    });
  }
  return outlines;
}
