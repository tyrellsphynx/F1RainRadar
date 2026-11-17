import { describe, expect, it } from 'vitest';
import { classifyCoverage } from '../scripts/lib/coverage.ts';
import { type Outline, haversineKm, matchOutline } from '../scripts/lib/outlines.ts';

const SIZE = 64;
const RADIUS = 10;

/** Alpha mask where pixels with x < cutoff are covered (transparent). */
function mask(cutoff: number) {
  const alpha = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) alpha[y * SIZE + x] = x < cutoff ? 0 : 255;
  return alpha;
}

describe('classifyCoverage', () => {
  it('detects full coverage', () => {
    expect(classifyCoverage(mask(SIZE), SIZE, RADIUS)).toEqual({ level: 'full', fraction: 1 });
  });

  it('detects no coverage', () => {
    expect(classifyCoverage(mask(0), SIZE, RADIUS)).toEqual({ level: 'none', fraction: 0 });
  });

  it('detects partial coverage when the circuit sits at the edge of coverage', () => {
    const result = classifyCoverage(mask(SIZE / 2), SIZE, RADIUS);
    expect(result.level).toBe('partial');
    expect(result.fraction).toBeGreaterThan(0.4);
    expect(result.fraction).toBeLessThan(0.6);
  });
});

describe('outline matching', () => {
  const outlines: Outline[] = [
    { id: 'us-2023', center: { lat: 36.1162, lon: -115.168 }, coordinates: [] },
    { id: 'us-2022', center: { lat: 25.958, lon: -80.239 }, coordinates: [] },
  ];

  it('computes distances', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.19, 1);
  });

  it('matches the nearest outline within range', () => {
    expect(matchOutline({ lat: 36.1147, lon: -115.173 }, outlines)?.id).toBe('us-2023');
  });

  it('returns null when nothing is close', () => {
    expect(matchOutline({ lat: 52.07, lon: -1.01 }, outlines)).toBeNull();
  });
});
