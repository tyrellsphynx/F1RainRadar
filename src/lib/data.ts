import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import {
  type Circuit,
  CircuitsFileSchema,
  type Meta,
  MetaSchema,
  type Race,
  type Schedule,
  ScheduleSchema,
} from './schemas.ts';
import { computeSiteState, sortRaces } from './weekend.ts';

const DATA_DIR = join(process.cwd(), 'data');

function read<T extends z.ZodType>(file: string, schema: T): z.infer<T> {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Run "npm run sync" first (or check out the data branch into ./data).`);
  }
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

let cache: { meta: Meta; schedules: Schedule[]; circuits: Record<string, Circuit> } | null = null;

function load() {
  if (cache) return cache;
  const meta = read('meta.json', MetaSchema);
  const schedules = meta.seasons.map((season) => read(`${season}/schedule.json`, ScheduleSchema));
  const circuits = read('circuits.json', CircuitsFileSchema).circuits;
  cache = { meta, schedules, circuits };
  return cache;
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

export function racePath(race: Pick<Race, 'season' | 'slug'>): string {
  return url(`${race.season}/${race.slug}/`);
}

export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
