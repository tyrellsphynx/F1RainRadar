import { z } from 'zod';
import { type Circuit, CircuitsFileSchema, type Schedule, ScheduleSchema, type Race } from '../../src/lib/schemas.ts';
import { weekendEnd } from '../../src/lib/weekend.ts';
import { detectCoverage } from '../lib/coverage.ts';
import { fetchJson } from '../lib/http.ts';
import { type JolpicaCircuitInfo, fetchSeasonRaces, toCircuitInfo, toSchedule } from '../lib/jolpica.ts';
import { fetchTimezone } from '../lib/openmeteo.ts';
import { type Outline, fetchOutlines, matchOutline } from '../lib/outlines.ts';
import { listSeasonDirs, readData, writeData } from '../lib/store.ts';
import { DAY, type SyncContext } from './context.ts';

/** Archive pages exist from the first season with OpenF1 data. */
export const FIRST_SEASON = 2023;
const COVERAGE_MAX_AGE_MS = 30 * DAY;

export async function loadSchedules(): Promise<Schedule[]> {
  const schedules: Schedule[] = [];
  for (const season of await listSeasonDirs()) {
    const schedule = await readData(`${season}/schedule.json`, ScheduleSchema);
    if (schedule) schedules.push(schedule);
  }
  return schedules;
}

export const isSeasonFinished = (s: Schedule, now: number) =>
  s.races.length > 0 && s.races.every((r) => weekendEnd(r) <= now);

/** Fetches schedules that are missing or not finished yet, plus next year's if published. */
export async function syncSchedules(ctx: SyncContext, circuitInfo: Map<string, JolpicaCircuitInfo>) {
  const year = new Date(ctx.now).getUTCFullYear();
  for (let season = FIRST_SEASON; season <= year + 1; season++) {
    const existing = await readData(`${season}/schedule.json`, ScheduleSchema);
    if (existing && isSeasonFinished(existing, ctx.now) && !ctx.force) continue;

    const { races: raw } = await fetchSeasonRaces(season);
    if (raw.length === 0) {
      ctx.log(`season ${season}: no calendar published yet`);
      continue;
    }
    for (const r of raw) circuitInfo.set(r.Circuit.circuitId, toCircuitInfo(r));
    const schedule = toSchedule(season, raw);
    if (await writeData(`${season}/schedule.json`, ScheduleSchema, schedule)) {
      ctx.log(`season ${season}: schedule updated (${schedule.races.length} races)`);
    }
  }
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
export async function syncCircuits(ctx: SyncContext, races: Race[], circuitInfo: Map<string, JolpicaCircuitInfo>) {
  const file = (await readData('circuits.json', CircuitsFileSchema)) ?? { circuits: {} };
  const ids = [...new Set(races.map((r) => r.circuitId))].sort();
  let outlines: Outline[] | null = null;

  for (const id of ids) {
    const existing: Circuit | undefined = file.circuits[id];
    const coverageAge = existing?.radarCoverage ? ctx.now - Date.parse(existing.radarCoverage.checkedAt) : Infinity;
    const coverageDue = ctx.force || coverageAge > COVERAGE_MAX_AGE_MS;
    const info = circuitInfo.get(id) ?? (existing ? null : await fetchCircuitInfo(id));
    if (existing && !info && !coverageDue && existing.outline) continue;

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

    if (coverageDue) {
      try {
        circuit.radarCoverage = await detectCoverage(circuit.lat, circuit.lon);
      } catch (err) {
        ctx.log(`circuit ${id}: coverage check failed, keeping previous value`, err);
      }
    }
    if (!circuit.outline || ctx.force) {
      outlines ??= await fetchOutlines();
      circuit.outline = matchOutline(circuit, outlines)?.coordinates ?? null;
      if (!circuit.outline) ctx.log(`circuit ${id}: no outline found`);
    }
    file.circuits[id] = circuit;
  }

  if (await writeData('circuits.json', CircuitsFileSchema, file)) {
    ctx.log(`circuits updated (${Object.keys(file.circuits).length} total)`);
  }
}
