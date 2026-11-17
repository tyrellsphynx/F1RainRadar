/** Weather helpers shared by the sync script, the build and the browser. */
import type {
  ActualsFile,
  HistoryRace,
  Session,
  SessionForecast,
  SessionType,
  WeatherSummary,
  WeatherTimeline,
} from './schemas.ts';
import { SESSION_DURATION_MIN } from './schemas.ts';

const HOUR = 3_600_000;

/** Modelled data: a race counts as wet with at least this much precipitation in the race window. */
export const WET_THRESHOLD_MM = 0.5;
/**
 * Window: 1 hour before the start (a wet track at the start counts) until 2 hours after.
 * Checked against 27 well-known wet races 2003–2022: 19 detected vs 14 with the race-only window,
 * and no false positives among 10 known dry races.
 */
export const RACE_WINDOW_BEFORE_MS = HOUR;
export const RACE_WINDOW_AFTER_MS = 2 * HOUR;
/** Bump when the modelled rule changes; the sync then recomputes all modelled values. */
export const MODEL_RULE = 'pre1h-race2h';

/** Open-Meteo hourly response (only the fields we request). Times are unix seconds (timeformat=unixtime). */
export interface HourlyForecast {
  time: number[];
  precipitation: (number | null)[];
  precipitation_probability?: (number | null)[];
  temperature_2m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  weather_code?: (number | null)[];
}

/**
 * Open-Meteo hourly values describe the *preceding* hour: the value at 14:00 covers 13:00–14:00.
 * Returns indices of hours overlapping [start, end).
 */
export function hoursOverlapping(times: number[], startMs: number, endMs: number): number[] {
  const idx: number[] = [];
  times.forEach((t, i) => {
    const hourEnd = t * 1000;
    const hourStart = hourEnd - HOUR;
    if (hourStart < endMs && hourEnd > startMs) idx.push(i);
  });
  return idx;
}

const nums = (arr: (number | null)[] | undefined, idx: number[]) =>
  idx.map((i) => arr?.[i]).filter((v): v is number => typeof v === 'number');

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summariseForecast(hourly: HourlyForecast, session: Session): SessionForecast | null {
  const start = Date.parse(session.start);
  const end = start + SESSION_DURATION_MIN[session.type] * 60_000;
  const idx = hoursOverlapping(hourly.time, start, end);
  const precip = nums(hourly.precipitation, idx);
  const temps = nums(hourly.temperature_2m, idx);
  if (!idx.length || precip.length !== idx.length || !temps.length) return null;
  const probs = nums(hourly.precipitation_probability, idx);
  return {
    rainChance: probs.length ? Math.max(...probs) : null,
    precipMm: round1(precip.reduce((a, b) => a + b, 0)),
    tempC: round1(temps.reduce((a, b) => a + b, 0) / temps.length),
    windKmh: round1(Math.max(0, ...nums(hourly.wind_speed_10m, idx))),
    code: Math.max(0, ...nums(hourly.weather_code, idx)),
  };
}

/** Precipitation (mm) in the race window, or null when the archive has gaps. */
export function modelledRacePrecip(hourly: HourlyForecast, raceStartMs: number): number | null {
  const idx = hoursOverlapping(hourly.time, raceStartMs - RACE_WINDOW_BEFORE_MS, raceStartMs + RACE_WINDOW_AFTER_MS);
  const precip = nums(hourly.precipitation, idx);
  if (!idx.length || precip.length !== idx.length) return null;
  return round1(precip.reduce((a, b) => a + b, 0));
}

/* ---------- Measured weather (OpenF1) ---------- */

const avg = (values: (number | null)[]) => {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const max = (values: (number | null)[]) => {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? round1(Math.max(...v)) : null;
};

/**
 * Removes single-sample sensor glitches (e.g. track temperature dropping to 0 for one reading):
 * a value far from both neighbours, while the neighbours agree, becomes null.
 */
export function despike(values: (number | null)[], threshold = 8): (number | null)[] {
  return values.map((v, i) => {
    const prev = values[i - 1];
    const next = values[i + 1];
    if (v === null || prev == null || next == null) return v;
    const glitch = Math.abs(v - prev) > threshold && Math.abs(v - next) > threshold && Math.abs(prev - next) < threshold;
    return glitch ? null : v;
  });
}

/** Keeps samples within [fromS, toS] seconds since the session start. */
export function cropTimeline(w: WeatherTimeline, fromS: number, toS: number): WeatherTimeline {
  const keep = w.t.map((t) => t >= fromS && t <= toS);
  const pick = <T,>(arr: T[]) => arr.filter((_, i) => keep[i]);
  return {
    t: pick(w.t),
    air: pick(w.air),
    track: pick(w.track),
    humidity: pick(w.humidity),
    rain: pick(w.rain),
    windKmh: pick(w.windKmh),
  };
}

/** Summary over the session itself (0..durationS); samples before/after are ignored. */
export function summariseTimeline(full: WeatherTimeline, durationS: number): WeatherSummary {
  const w = cropTimeline(full, 0, durationS);
  // Samples are roughly one per minute; count the time between samples that report rain.
  let rainSeconds = 0;
  for (let i = 0; i < w.t.length; i++) {
    if (!w.rain[i]) continue;
    const next = w.t[i + 1] ?? (w.t[i] ?? 0) + 60;
    rainSeconds += Math.min(120, Math.max(0, next - (w.t[i] ?? 0)));
  }
  const track = despike(w.track);
  return {
    rained: w.rain.some((r) => r === 1),
    rainMinutes: Math.round(rainSeconds / 60),
    airAvg: avg(despike(w.air)),
    trackAvg: avg(track),
    trackMax: max(track),
    humidityAvg: avg(w.humidity),
    windMaxKmh: max(w.windKmh),
  };
}

/* ---------- Wet race classification ---------- */

export interface WetVerdict {
  wet: boolean;
  source: 'measured' | 'modelled';
  detail: string;
}

/**
 * Rain reported at the track for at least this long makes a race wet even if nobody changed tyres.
 * Shorter spells are typically a few drops (e.g. Miami and Canada 2025: 1–5 min, all on slicks).
 */
export const MEASURED_RAIN_MIN = 15;

/** Measured verdict (2023+): intermediate/wet tyres used, or sustained rain reported at the track. */
export function measuredVerdict(actuals: ActualsFile | null, type: SessionType = 'Race'): WetVerdict | null {
  const race = actuals?.sessions[type];
  if (!race || race.status !== 'ok') return null;
  const wetTyreDrivers = new Set(
    race.strategy?.stints.filter((s) => s.compound === 'INTERMEDIATE' || s.compound === 'WET').map((s) => s.driver),
  ).size;
  const { rained, rainMinutes } = race.summary;
  const wet = wetTyreDrivers > 0 || rainMinutes >= MEASURED_RAIN_MIN;
  const parts = [
    rained ? `rain reported for ~${rainMinutes} min` : 'no rain reported at the track',
    wetTyreDrivers > 0
      ? `${wetTyreDrivers} ${wetTyreDrivers === 1 ? 'driver' : 'drivers'} used intermediate/wet tyres`
      : race.strategy && 'everyone stayed on slicks',
  ];
  return { wet, source: 'measured', detail: parts.filter(Boolean).join(', ') };
}

export function modelledVerdict(race: Pick<HistoryRace, 'modelledPrecipMm'>): WetVerdict | null {
  if (race.modelledPrecipMm === null) return null;
  return {
    wet: race.modelledPrecipMm >= WET_THRESHOLD_MM,
    source: 'modelled',
    detail: `${race.modelledPrecipMm} mm modelled precipitation from 1 h before the start to 2 h after`,
  };
}

/* ---------- WMO weather codes ---------- */

export function weatherLabel(code: number): { icon: string; label: string } {
  if (code >= 95) return { icon: '⛈️', label: 'Thunderstorm' };
  if (code >= 85) return { icon: '🌨️', label: 'Snow showers' };
  if (code >= 80) return { icon: '🌦️', label: 'Rain showers' };
  if (code >= 71) return { icon: '❄️', label: 'Snow' };
  if (code >= 61) return { icon: '🌧️', label: 'Rain' };
  if (code >= 51) return { icon: '🌦️', label: 'Drizzle' };
  if (code >= 45) return { icon: '🌫️', label: 'Fog' };
  if (code >= 3) return { icon: '☁️', label: 'Overcast' };
  if (code >= 1) return { icon: '⛅', label: 'Partly cloudy' };
  return { icon: '☀️', label: 'Clear' };
}

/** For judging forecasts: a session "had rain" with at least this many minutes reported. */
export const SESSION_RAIN_MIN = 5;
export const sessionHadRain = (s: Pick<WeatherSummary, 'rainMinutes'>) => s.rainMinutes >= SESSION_RAIN_MIN;

/** "Wet" in forecast terms: likely rain during the session. */
export function forecastLooksWet(f: Pick<SessionForecast, 'rainChance' | 'precipMm'>): boolean {
  return (f.rainChance ?? 0) >= 50 || f.precipMm >= WET_THRESHOLD_MM;
}
