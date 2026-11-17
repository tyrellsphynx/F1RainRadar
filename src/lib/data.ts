import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import {
  type ActualsFile,
  ActualsFileSchema,
  type Circuit,
  CircuitsFileSchema,
  type ForecastFile,
  ForecastFileSchema,
  type HistoryFile,
  HistoryFileSchema,
  type Meta,
  MetaSchema,
  type Race,
  type Schedule,
  ScheduleSchema,
  type Standings,
  StandingsSchema,
} from './schemas.ts';
import { type WetVerdict, measuredVerdict, modelledVerdict } from './weather.ts';
import { computeSiteState, sortRaces } from './weekend.ts';

const DATA_DIR = join(process.cwd(), 'data');

function read<T extends z.ZodType>(file: string, schema: T): z.infer<T> {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run "npm run sync" first (or check out the data branch into ./data).`);
  }
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function readOptional<T extends z.ZodType>(file: string, schema: T): z.infer<T> | null {
  return existsSync(join(DATA_DIR, file)) ? read(file, schema) : null;
}

const memo = new Map<string, unknown>();
function cached<T>(key: string, load: () => T): T {
  if (!memo.has(key)) memo.set(key, load());
  return memo.get(key) as T;
}

function load() {
  return cached('core', () => {
    const meta = read('meta.json', MetaSchema);
    const schedules = meta.seasons.map((season) => read(`${season}/schedule.json`, ScheduleSchema));
    const circuits = read('circuits.json', CircuitsFileSchema).circuits;
    return { meta, schedules, circuits } as { meta: Meta; schedules: Schedule[]; circuits: Record<string, Circuit> };
  });
}

export const getMeta = () => load().meta;
export const getSeasons = () => load().schedules.map((s) => s.season);
export const getSchedule = (season: number) => load().schedules.find((s) => s.season === season) ?? null;
export const getAllRaces = (): Race[] => sortRaces(load().schedules.flatMap((s) => s.races));

export function getCircuit(id: string): Circuit {
  const circuit = load().circuits[id];
  if (!circuit) throw new Error(`Circuit ${id} missing from circuits.json`);
  return circuit;
}

export const getAllCircuits = () => load().circuits;

/** Site state at build time; falls back to computing it if meta has none. */
export function getSiteState() {
  return load().meta.siteState ?? computeSiteState(getAllRaces(), Date.now());
}

type RaceRef = { season: number; round: number };

export const getForecasts = (r: RaceRef): ForecastFile | null =>
  cached(`fc-${r.season}-${r.round}`, () => readOptional(`${r.season}/forecasts/${r.round}.json`, ForecastFileSchema));

export const getActuals = (r: RaceRef): ActualsFile | null =>
  cached(`ac-${r.season}-${r.round}`, () => readOptional(`${r.season}/actuals/${r.round}.json`, ActualsFileSchema));

export const getStandings = (season: number): Standings | null =>
  cached(`st-${season}`, () => readOptional(`${season}/standings.json`, StandingsSchema));

export const getHistory = (): HistoryFile | null => cached('history', () => readOptional('history.json', HistoryFileSchema));

/** Wet or dry for a completed race: measured (OpenF1) when available, otherwise modelled. */
export function wetVerdict(r: RaceRef): WetVerdict | null {
  const measured = measuredVerdict(getActuals(r));
  if (measured) return measured;
  const entry = getHistory()?.races.find((h) => h.season === r.season && h.round === r.round);
  return entry ? modelledVerdict(entry) : null;
}

export interface CircuitHistory {
  races: { season: number; round: number; raceName: string; verdict: WetVerdict }[];
  wet: number;
  total: number;
  /** Share of wet races, 0..1. */
  share: number;
}

export function circuitHistory(circuitId: string): CircuitHistory | null {
  return cached(`ch-${circuitId}`, () => {
    const history = getHistory();
    if (!history) return null;
    const races = history.races
      .filter((r) => r.circuitId === circuitId)
      .map((r) => ({ season: r.season, round: r.round, raceName: r.raceName, verdict: wetVerdict(r) }))
      .filter((r): r is CircuitHistory['races'][number] => r.verdict !== null);
    if (!races.length) return null;
    const wet = races.filter((r) => r.verdict.wet).length;
    return { races, wet, total: races.length, share: wet / races.length };
  });
}

export function racePath(race: Pick<Race, 'season' | 'slug'>): string {
  return url(`${race.season}/${race.slug}/`);
}

export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
