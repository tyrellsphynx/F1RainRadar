import { z } from 'zod';
import type { Race, Schedule, Session, SessionType } from '../../src/lib/schemas.ts';
import { fetchJson } from './http.ts';

const BASE = 'https://api.jolpi.ca/ergast/f1';

const DateTime = z.object({ date: z.string(), time: z.string().optional() });

const JolpicaRace = z.object({
  season: z.string(),
  round: z.string(),
  url: z.string().optional(),
  raceName: z.string(),
  Circuit: z.object({
    circuitId: z.string(),
    circuitName: z.string(),
    Location: z.object({
      lat: z.string(),
      long: z.string(),
      locality: z.string(),
      country: z.string(),
    }),
  }),
  date: z.string(),
  time: z.string().optional(),
  FirstPractice: DateTime.optional(),
  SecondPractice: DateTime.optional(),
  ThirdPractice: DateTime.optional(),
  SprintQualifying: DateTime.optional(),
  SprintShootout: DateTime.optional(),
  Sprint: DateTime.optional(),
  Qualifying: DateTime.optional(),
});
export type JolpicaRace = z.infer<typeof JolpicaRace>;

const JolpicaScheduleResponse = z.object({
  MRData: z.object({
    RaceTable: z.object({
      season: z.string().optional(),
      Races: z.array(JolpicaRace),
    }),
  }),
});

export interface JolpicaCircuitInfo {
  id: string;
  name: string;
  locality: string;
  country: string;
  lat: number;
  lon: number;
}

/** "Las Vegas Grand Prix" -> "las-vegas", "Bahrain Grand Prix in Malaysia" -> "bahrain-in-malaysia" */
export function raceSlug(raceName: string): string {
  const slug = raceName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/grand prix/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'race';
}

function toIso(dt: { date: string; time?: string | undefined } | undefined): string | null {
  if (!dt?.time) return null;
  const time = dt.time.endsWith('Z') ? dt.time : `${dt.time}Z`;
  const iso = `${dt.date}T${time}`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

export function toRace(raw: JolpicaRace): Race | null {
  const raceIso = toIso({ date: raw.date, time: raw.time });
  // Races without a start time can't be shown with session times; skip them.
  if (!raceIso) return null;

  const candidates: [SessionType, string | null][] = [
    ['FP1', toIso(raw.FirstPractice)],
    ['FP2', toIso(raw.SecondPractice)],
    ['FP3', toIso(raw.ThirdPractice)],
    ['SQ', toIso(raw.SprintQualifying ?? raw.SprintShootout)],
    ['Sprint', toIso(raw.Sprint)],
    ['Q', toIso(raw.Qualifying)],
    ['Race', raceIso],
  ];
  const sessions: Session[] = candidates
    .filter((c): c is [SessionType, string] => c[1] !== null)
    .map(([type, start]) => ({ type, start }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return {
    season: Number(raw.season),
    round: Number(raw.round),
    raceName: raw.raceName,
    slug: raceSlug(raw.raceName),
    circuitId: raw.Circuit.circuitId,
    ...(raw.url ? { wikipediaUrl: raw.url } : {}),
    sessions,
  };
}

export function toSchedule(season: number, rawRaces: JolpicaRace[]): Schedule {
  const races = rawRaces.map(toRace).filter((r): r is Race => r !== null);
  // Guarantee unique slugs within a season (e.g. two races with the same name).
  const seen = new Set<string>();
  for (const race of races) {
    if (seen.has(race.slug)) race.slug = `${race.slug}-${race.round}`;
    seen.add(race.slug);
  }
  return { season, races };
}

export function toCircuitInfo(raw: JolpicaRace): JolpicaCircuitInfo {
  return {
    id: raw.Circuit.circuitId,
    name: raw.Circuit.circuitName,
    locality: raw.Circuit.Location.locality,
    country: raw.Circuit.Location.country,
    lat: Number(raw.Circuit.Location.lat),
    lon: Number(raw.Circuit.Location.long),
  };
}

/** `season` is a year or "current". */
export async function fetchSeasonRaces(season: number | 'current'): Promise<{ season: number | null; races: JolpicaRace[] }> {
  const json = await fetchJson(`${BASE}/${season}.json?limit=100`);
  const table = JolpicaScheduleResponse.parse(json).MRData.RaceTable;
  const year = table.season ? Number(table.season) : table.Races[0] ? Number(table.Races[0].season) : null;
  return { season: year, races: table.Races };
}
