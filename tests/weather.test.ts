import { describe, expect, it } from 'vitest';
import type { ActualsFile, WeatherTimeline } from '../src/lib/schemas.ts';
import { convert, formatValue } from '../src/lib/units.ts';
import {
  type HourlyForecast,
  despike,
  forecastLooksWet,
  hoursOverlapping,
  measuredVerdict,
  modelledRacePrecip,
  modelledVerdict,
  summariseForecast,
  summariseTimeline,
  weatherLabel,
} from '../src/lib/weather.ts';

const H = 3600;
const base = Date.parse('2026-11-22T00:00:00Z') / 1000;
/** 24 hourly values; Open-Meteo's value at time t covers the preceding hour. */
function hourly(precip: number[], extra: Partial<HourlyForecast> = {}): HourlyForecast {
  return { time: precip.map((_, i) => base + (i + 1) * H), precipitation: precip, ...extra };
}

describe('hoursOverlapping', () => {
  it('uses the preceding-hour convention', () => {
    const h = hourly(Array(24).fill(0));
    // Session 04:00–06:00 overlaps hours ending 05:00 and 06:00 (indices 4, 5).
    const start = (base + 4 * H) * 1000;
    expect(hoursOverlapping(h.time, start, start + 2 * H * 1000)).toEqual([4, 5]);
  });

  it('includes partially overlapping hours', () => {
    const h = hourly(Array(24).fill(0));
    const start = (base + 4.5 * H) * 1000;
    expect(hoursOverlapping(h.time, start, start + H * 1000)).toEqual([4, 5]);
  });
});

describe('modelledRacePrecip', () => {
  it('sums precipitation from 1 h before the start to 2 h after', () => {
    const p = Array(24).fill(0);
    p[2] = 5; // more than an hour before the start
    p[3] = 0.2; // the hour before the start: wet track at the start
    p[4] = 0.3;
    p[5] = 0.4;
    p[6] = 9; // after the race window
    expect(modelledRacePrecip(hourly(p), (base + 4 * H) * 1000)).toBe(0.9);
  });

  it('returns null when the archive has gaps', () => {
    const p: (number | null)[] = Array(24).fill(0);
    p[5] = null;
    expect(modelledRacePrecip({ ...hourly(Array(24).fill(0)), precipitation: p }, (base + 4 * H) * 1000)).toBeNull();
  });
});

describe('summariseForecast', () => {
  const n = 24;
  const h = hourly(Array(n).fill(0.1), {
    precipitation_probability: Array.from({ length: n }, (_, i) => i * 2),
    temperature_2m: Array(n).fill(14),
    wind_speed_10m: Array.from({ length: n }, (_, i) => i),
    weather_code: Array.from({ length: n }, (_, i) => (i === 5 ? 61 : 3)),
  });

  it('summarises a 2-hour race', () => {
    const f = summariseForecast(h, { type: 'Race', start: new Date((base + 4 * H) * 1000).toISOString() })!;
    expect(f).toEqual({ rainChance: 10, precipMm: 0.2, tempC: 14, windKmh: 5, code: 61 });
  });

  it('returns null outside the forecast range', () => {
    expect(summariseForecast(h, { type: 'FP1', start: '2027-01-01T00:00:00Z' })).toBeNull();
  });
});

describe('summariseTimeline', () => {
  const w: WeatherTimeline = {
    t: [0, 60, 120, 180, 240],
    air: [20, 20, 19, null, 19],
    track: [30, 31, 29, 28, null],
    humidity: [50, 60, 70, 80, 90],
    rain: [0, 1, 1, 0, 0],
    windKmh: [5, 10, 7, null, 3],
  };

  it('ignores samples outside the session', () => {
    const withPre: WeatherTimeline = {
      t: [-600, ...w.t],
      air: [5, ...w.air],
      track: [5, ...w.track],
      humidity: [100, ...w.humidity],
      rain: [1, ...w.rain],
      windKmh: [50, ...w.windKmh],
    };
    expect(summariseTimeline(withPre, 240)).toEqual(summariseTimeline(w, 240));
    expect(summariseTimeline({ ...withPre, rain: [1, 0, 0, 0, 0, 0] }, 240).rained).toBe(false);
  });

  it('computes averages, maxima and rain minutes', () => {
    expect(summariseTimeline(w, 240)).toEqual({
      rained: true,
      rainMinutes: 2,
      airAvg: 19.5,
      trackAvg: 29.5,
      trackMax: 31,
      humidityAvg: 70,
      windMaxKmh: 10,
    });
  });
});

describe('despike', () => {
  it('removes single-sample glitches only', () => {
    expect(despike([30, 31, 0, 30, 29])).toEqual([30, 31, null, 30, 29]);
    // A genuine step change is kept.
    expect(despike([30, 30, 20, 20, 20])).toEqual([30, 30, 20, 20, 20]);
    expect(despike([null, 0, 30])).toEqual([null, 0, 30]);
  });
});

function actualsWith(rainMinutes: number, compounds: string[]): ActualsFile {
  const rained = rainMinutes > 0;
  return {
    sessions: {
      Race: {
        status: 'ok',
        sessionKey: 1,
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-01T02:00:00.000Z',
        weather: { t: [], air: [], track: [], humidity: [], rain: [], windKmh: [] },
        summary: {
          rained,
          rainMinutes,
          airAvg: 20,
          trackAvg: 30,
          trackMax: 35,
          humidityAvg: 60,
          windMaxKmh: 10,
        },
        strategy: {
          totalLaps: 50,
          drivers: [],
          stints: compounds.map((c, i) => ({ driver: 1, lapStart: i * 10 + 1, lapEnd: i * 10 + 10, compound: c as never })),
        },
      },
    },
  };
}

describe('wet verdicts', () => {
  it('measured: sustained rain at the track makes it wet', () => {
    expect(measuredVerdict(actualsWith(15, ['MEDIUM', 'HARD']))?.wet).toBe(true);
  });

  it('measured: a few drops on slicks stay dry', () => {
    const v = measuredVerdict(actualsWith(5, ['MEDIUM', 'HARD']))!;
    expect(v.wet).toBe(false);
    expect(v.detail).toContain('slicks');
  });

  it('measured: intermediates make it wet even without rain at the station', () => {
    const v = measuredVerdict(actualsWith(0, ['INTERMEDIATE', 'MEDIUM']))!;
    expect(v.wet).toBe(true);
    expect(v.detail).toContain('intermediate');
  });

  it('measured: dry when neither', () => {
    expect(measuredVerdict(actualsWith(0, ['SOFT', 'HARD']))?.wet).toBe(false);
  });

  it('measured: null without data', () => {
    expect(measuredVerdict(null)).toBeNull();
    expect(measuredVerdict({ sessions: {} })).toBeNull();
  });

  it('modelled: threshold of 0.5 mm', () => {
    expect(modelledVerdict({ modelledPrecipMm: 0.5 })?.wet).toBe(true);
    expect(modelledVerdict({ modelledPrecipMm: 0.4 })?.wet).toBe(false);
    expect(modelledVerdict({ modelledPrecipMm: null })).toBeNull();
  });

  it('forecast wet: 50% chance or 0.5 mm', () => {
    expect(forecastLooksWet({ rainChance: 50, precipMm: 0 })).toBe(true);
    expect(forecastLooksWet({ rainChance: 10, precipMm: 0.6 })).toBe(true);
    expect(forecastLooksWet({ rainChance: 30, precipMm: 0.1 })).toBe(false);
  });
});

describe('units', () => {
  it('converts and formats', () => {
    expect(formatValue('temp', 20, 'metric')).toBe('20 °C');
    expect(formatValue('temp', 20, 'imperial')).toBe('68 °F');
    expect(formatValue('speed', 16.09344, 'imperial')).toBe('10 mph');
    expect(formatValue('precip', 25.4, 'imperial')).toBe('1.0 in');
    expect(convert('temp', 0, 'imperial')).toBe(32);
  });
});

describe('weatherLabel', () => {
  it('maps WMO codes', () => {
    expect(weatherLabel(0).label).toBe('Clear');
    expect(weatherLabel(63).label).toBe('Rain');
    expect(weatherLabel(95).label).toBe('Thunderstorm');
  });
});
