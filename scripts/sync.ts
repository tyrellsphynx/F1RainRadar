/**
 * Hourly data sync. Decides what needs doing and exits quickly when idle.
 *
 *   npm run sync           # normal run
 *   npm run sync -- --force  # refresh everything regardless of age
 */
import { z } from 'zod';
import {
  type Circuit,
  CircuitsFileSchema,
  type Meta,
  MetaSchema,
  type Race,
  type Schedule,
  ScheduleSchema,
} from '../src/lib/schemas.ts';
import { computeSiteState, weekendEnd } from '../src/lib/weekend.ts';
import { detectCoverage } from './lib/coverage.ts';
import { fetchJson } from './lib/http.ts';
import { type JolpicaCircuitInfo, fetchSeasonRaces, toCircuitInfo, toSchedule } from './lib/jolpica.ts';
import { fetchTimezone } from './lib/openmeteo.ts';
import { type Outline, fetchOutlines, matchOutline } from './lib/outlines.ts';
import { listSeasonDirs, readData, writeData } from './lib/store.ts';

/** Archive pages exist from the first season with OpenF1 data. */
export const FIRST_SEASON = 2023;
const DAILY_INTERVAL_MS = 23 * 3_600_000;
const COVERAGE_MAX_AGE_MS = 30 * 24 * 3_600_000;

const force = process.argv.includes('--force');
const now = Date.now();
const log = (...args: unknown[]) => console.log(`[sync]`, ...args);

async function loadSchedules(seasons: number[]): Promise<Schedule[]> {
  const schedules: Schedule[] = [];
  for (const season of seasons) {
    const schedule = await readData(`${season}/schedule.json`, ScheduleSchema);
    if (schedule) schedules.push(schedule);
  }
  return schedules;
}

const isSeasonFinished = (s: Schedule) => s.races.length > 0 && s.races.every((r) => weekendEnd(r) <= now);

/** Fetches schedules that are missing or not finished yet, plus next year's if published. */
async function syncSchedules(circuitInfo: Map<string, JolpicaCircuitInfo>): Promise<number> {
  const year = new Date(now).getUTCFullYear();
  let changed = 0;
  for (let season = FIRST_SEASON; season <= year + 1; season++) {
    const existing = await readData(`${season}/schedule.json`, ScheduleSchema);
    if (existing && isSeasonFinished(existing) && !force) continue;

    const { races: raw } = await fetchSeasonRaces(season);
    if (raw.length === 0) {
      log(`season ${season}: no calendar published yet`);
      continue;
    }
    for (const r of raw) circuitInfo.set(r.Circuit.circuitId, toCircuitInfo(r));
    const schedule = toSchedule(season, raw);
    if (await writeData(`${season}/schedule.json`, ScheduleSchema, schedule)) {
      log(`season ${season}: schedule updated (${schedule.races.length} races)`);
      changed++;
    }
  }
  return changed;
}

const JolpicaCircuitResponse = z.object({
  MRData: z.object({
    CircuitTable: z.object({
      Circuits: z.array(
        z.object({
          circuitId: z.string(),
          circuitName: z.string(),
          Location: z.object({ lat: z.string(), long: z.string(), locality: z.string(), country: z.string() }),
        }),
      ),
    }),
  }),
});

async function fetchCircuitInfo(id: string): Promise<JolpicaCircuitInfo> {
  const json = await fetchJson(`https://api.jolpi.ca/ergast/f1/circuits/${id}.json`);
  const c = JolpicaCircuitResponse.parse(json).MRData.CircuitTable.Circuits[0];
  if (!c) throw new Error(`Unknown circuit ${id}`);
  return {
    id: c.circuitId,
    name: c.circuitName,
    locality: c.Location.locality,
    country: c.Location.country,
    lat: Number(c.Location.lat),
    lon: Number(c.Location.long),
  };
}

/** Adds new circuits and refreshes timezone, radar coverage and outline when stale. */
async function syncCircuits(races: Race[], circuitInfo: Map<string, JolpicaCircuitInfo>): Promise<boolean> {
  const file = (await readData('circuits.json', CircuitsFileSchema)) ?? { circuits: {} };
  const ids = [...new Set(races.map((r) => r.circuitId))].sort();
  let outlines: Outline[] | null = null;

  for (const id of ids) {
    const existing: Circuit | undefined = file.circuits[id];
    const coverageAge = existing?.radarCoverage ? now - Date.parse(existing.radarCoverage.checkedAt) : Infinity;
    const info = circuitInfo.get(id) ?? (existing ? null : await fetchCircuitInfo(id));
    const needsWork = force || !existing || coverageAge > COVERAGE_MAX_AGE_MS || !existing.outline;
    if (!needsWork && !info) continue;

    const base = info ?? existing!;
    const circuit: Circuit = {
      id,
      name: base.name,
      locality: base.locality,
      country: base.country,
      lat: base.lat,
      lon: base.lon,
      timezone: existing?.timezone ?? (await fetchTimezone(base.lat, base.lon)),
      radarCoverage: existing?.radarCoverage ?? null,
      outline: existing?.outline ?? null,
    };

    if (force || coverageAge > COVERAGE_MAX_AGE_MS) {
      try {
        circuit.radarCoverage = await detectCoverage(circuit.lat, circuit.lon);
      } catch (err) {
        log(`circuit ${id}: coverage check failed, keeping previous value`, err);
      }
    }
    if (!circuit.outline || force) {
      outlines ??= await fetchOutlines();
      circuit.outline = matchOutline(circuit, outlines)?.coordinates ?? null;
      if (!circuit.outline) log(`circuit ${id}: no outline found`);
    }
    file.circuits[id] = circuit;
  }

  const changed = await writeData('circuits.json', CircuitsFileSchema, file);
  if (changed) log(`circuits updated (${Object.keys(file.circuits).length} total)`);
  return changed;
}

async function main() {
  const meta: Meta = (await readData('meta.json', MetaSchema)) ?? { lastDailySync: null, seasons: [], siteState: null };

  const dailyDue = force || !meta.lastDailySync || now - Date.parse(meta.lastDailySync) >= DAILY_INTERVAL_MS;
  if (dailyDue) {
    log('running daily sync');
    const circuitInfo = new Map<string, JolpicaCircuitInfo>();
    await syncSchedules(circuitInfo);
    const schedules = await loadSchedules(await listSeasonDirs());
    await syncCircuits(schedules.flatMap((s) => s.races), circuitInfo);
    meta.lastDailySync = new Date(now).toISOString();
  }

  const seasons = await listSeasonDirs();
  const schedules = await loadSchedules(seasons);
  meta.seasons = schedules.map((s) => s.season);
  const siteState = computeSiteState(
    schedules.flatMap((s) => s.races),
    now,
  );
  if (JSON.stringify(siteState) !== JSON.stringify(meta.siteState)) {
    log('site state changed', siteState);
  }
  meta.siteState = siteState;

  await writeData('meta.json', MetaSchema, meta);
  log('done');
}

main().catch((err) => {
  console.error('[sync] failed:', err);
  process.exit(1);
});
