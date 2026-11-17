import { PNG } from 'pngjs';
import type { RadarCoverage } from '../../src/lib/schemas.ts';
import { fetchBuffer } from './http.ts';

/** RainViewer serves zoom 7 at most; one pixel is roughly 1.2 km at the equator. */
const ZOOM = 7;
const SIZE = 256;
/** Sample a disc of ~50 km around the circuit: rain approaching the track matters too. */
const RADIUS_PX = 40;

/**
 * The coverage mask is transparent where radar data exists and black where it doesn't.
 * `alpha` holds the alpha channel of a SIZE x SIZE tile centred on the circuit.
 */
export function classifyCoverage(alpha: ArrayLike<number>, size = SIZE, radius = RADIUS_PX) {
  const c = size / 2;
  let total = 0;
  let covered = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 > radius ** 2) continue;
      total++;
      if ((alpha[y * size + x] ?? 0) < 128) covered++;
    }
  }
  const fraction = total ? covered / total : 0;
  const level: RadarCoverage['level'] = fraction >= 0.9 ? 'full' : fraction >= 0.25 ? 'partial' : 'none';
  return { level, fraction: Math.round(fraction * 1000) / 1000 };
}

export async function detectCoverage(lat: number, lon: number): Promise<RadarCoverage> {
  const url = `https://tilecache.rainviewer.com/v2/coverage/0/${SIZE}/${ZOOM}/${lat.toFixed(4)}/${lon.toFixed(4)}/0/0_0.png`;
  const png = PNG.sync.read(await fetchBuffer(url));
  if (png.width !== SIZE || png.height !== SIZE) throw new Error(`Unexpected coverage tile size ${png.width}x${png.height}`);
  const alpha = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) alpha[i] = png.data[i * 4 + 3] ?? 0;
  return { ...classifyCoverage(alpha), checkedAt: new Date().toISOString() };
}
