import { z } from 'zod';
import type { Compound, SessionType, Strategy, WeatherTimeline } from '../../src/lib/schemas.ts';
import { COMPOUNDS } from '../../src/lib/schemas.ts';
import { cropTimeline, despike } from '../../src/lib/weather.ts';
import { fetchJsonOrEmpty as fetchJson } from './http.ts';

const BASE = 'https://api.openf1.org/v1';

const OpenF1Session = z.object({
  session_key: z.number(),
  session_name: z.string(),
  date_start: z.string(),
  date_end: z.string(),
  year: z.number(),
  is_cancelled: z.boolean().optional(),
});
export type OpenF1Session = z.infer<typeof OpenF1Session>;

const SESSION_NAMES: Record<string, SessionType> = {
  'Practice 1': 'FP1',
  'Practice 2': 'FP2',
  'Practice 3': 'FP3',
  Qualifying: 'Q',
  'Sprint Qualifying': 'SQ',
  'Sprint Shootout': 'SQ',
  Sprint: 'Sprint',
  Race: 'Race',
};

export const sessionTypeOf = (name: string): SessionType | null => SESSION_NAMES[name] ?? null;

export async function fetchSessions(year: number): Promise<OpenF1Session[]> {
  return z.array(OpenF1Session).parse(await fetchJson(`${BASE}/sessions?year=${year}`));
}

/** Finds the OpenF1 session for one of our sessions: same type, start within 2 days. */
export function matchSession(
  sessions: OpenF1Session[],
  type: SessionType,
  startIso: string,
): OpenF1Session | null {
  const start = Date.parse(startIso);
  let best: OpenF1Session | null = null;
  let bestDiff = 2 * 86_400_000;
  for (const s of sessions) {
    if (s.is_cancelled || sessionTypeOf(s.session_name) !== type) continue;
    const diff = Math.abs(Date.parse(s.date_start) - start);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

const WeatherRow = z.object({
  date: z.string(),
  air_temperature: z.number().nullable(),
  track_temperature: z.number().nullable(),
  humidity: z.number().nullable(),
  rainfall: z.number().nullable(),
  wind_speed: z.number().nullable(),
});

const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Context kept around the session in the stored timeline. */
const TIMELINE_MARGIN_S = 15 * 60;

export async function fetchWeather(sessionKey: number, sessionStartIso: string, sessionEndIso: string): Promise<WeatherTimeline> {
  const rows = z.array(WeatherRow).parse(await fetchJson(`${BASE}/weather?session_key=${sessionKey}`));
  rows.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const start = Date.parse(sessionStartIso);
  const durationS = (Date.parse(sessionEndIso) - start) / 1000;
  const timeline: WeatherTimeline = {
    t: rows.map((r) => Math.round((Date.parse(r.date) - start) / 1000)),
    air: rows.map((r) => r1(r.air_temperature)),
    track: rows.map((r) => r1(r.track_temperature)),
    humidity: rows.map((r) => r1(r.humidity)),
    rain: rows.map((r) => (r.rainfall ? 1 : 0)),
    // OpenF1 reports wind in m/s.
    windKmh: rows.map((r) => r1(r.wind_speed === null ? null : r.wind_speed * 3.6)),
  };
  // OpenF1 includes readings from well before the session; keep a short margin only.
  const cropped = cropTimeline(timeline, -TIMELINE_MARGIN_S, durationS + TIMELINE_MARGIN_S);
  return { ...cropped, air: despike(cropped.air), track: despike(cropped.track) };
}

const Stint = z.object({
  driver_number: z.number(),
  lap_start: z.number().nullable(),
  lap_end: z.number().nullable(),
  compound: z.string().nullable(),
});
const Driver = z.object({
  driver_number: z.number(),
  name_acronym: z.string().nullable(),
  full_name: z.string().nullable(),
  team_name: z.string().nullable(),
  team_colour: z.string().nullable(),
});
const Result = z.object({
  driver_number: z.number(),
  position: z.number().nullable(),
  dnf: z.boolean().nullable().optional(),
  dns: z.boolean().nullable().optional(),
  dsq: z.boolean().nullable().optional(),
});

const toCompound = (c: string | null): Compound =>
  (COMPOUNDS as readonly string[]).includes(c ?? '') ? (c as Compound) : 'UNKNOWN';

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

/** Tyre stints, drivers and classification for a race or sprint. 3 requests. */
export async function fetchStrategy(sessionKey: number): Promise<Strategy | null> {
  const stints = z.array(Stint).parse(await fetchJson(`${BASE}/stints?session_key=${sessionKey}`));
  if (!stints.length) return null;
  const drivers = z.array(Driver).parse(await fetchJson(`${BASE}/drivers?session_key=${sessionKey}`));
  const results = z.array(Result).parse(await fetchJson(`${BASE}/session_result?session_key=${sessionKey}`));
  const resultBy = new Map(results.map((r) => [r.driver_number, r]));

  const cleanStints = stints
    .filter((s) => s.lap_start !== null && s.lap_end !== null && s.lap_end >= s.lap_start)
    .map((s) => ({ driver: s.driver_number, lapStart: s.lap_start!, lapEnd: s.lap_end!, compound: toCompound(s.compound) }))
    .sort((a, b) => a.driver - b.driver || a.lapStart - b.lapStart);

  const driverNumbers = [...new Set(cleanStints.map((s) => s.driver))];
  const driverInfo = new Map(drivers.map((d) => [d.driver_number, d]));
  const list: Strategy['drivers'] = driverNumbers.map((number) => {
    const d = driverInfo.get(number);
    const r = resultBy.get(number);
    const status = r?.dsq ? 'dsq' : r?.dns ? 'dns' : r?.dnf ? 'dnf' : 'finished';
    return {
      number,
      acronym: d?.name_acronym ?? String(number),
      name: d?.full_name ? titleCase(d.full_name) : `#${number}`,
      team: d?.team_name ?? '',
      colour: d?.team_colour ? `#${d.team_colour}` : '#888888',
      position: r?.position ?? null,
      status,
    };
  });
  list.sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.number - b.number);

  return {
    totalLaps: Math.max(...cleanStints.map((s) => s.lapEnd)),
    drivers: list,
    stints: cleanStints,
  };
}
