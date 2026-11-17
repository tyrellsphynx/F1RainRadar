import {
  type CircuitsFile,
  type HistoryFile,
  HistoryFileSchema,
  type HistoryRace,
  type Race,
} from '../../src/lib/schemas.ts';
import { MODEL_RULE, modelledRacePrecip } from '../../src/lib/weather.ts';
import { raceStart } from '../../src/lib/weekend.ts';
import { fetchSeasonRaces, toCircuitInfo } from '../lib/jolpica.ts';
import { fetchArchive } from '../lib/openmeteo.ts';
import { readData, writeData } from '../lib/store.ts';
import { DAY, type SyncContext } from './context.ts';
import { FIRST_SEASON } from './schedule.ts';

export const HISTORY_FIRST_SEASON = 2000;
/** The reanalysis archive lags real time by about 5 days. */
const ARCHIVE_LAG_MS = 6 * DAY;
const ARCHIVE_BUDGET = 250;
/** Assumed local start time when Jolpica has no race time (mostly pre-2005). */
const ASSUMED_LOCAL_HOUR = 14;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Builds the per-circuit wet-race history:
 * - race list 2000–2022 from Jolpica (once per season), 2023+ from our own schedules;
 * - modelled precipitation in the race window from the Open-Meteo archive.
 * Measured verdicts (2023+) come from the OpenF1 actuals at build time.
 */
export async function syncHistory(ctx: SyncContext, scheduleRaces: Race[], circuits: CircuitsFile['circuits']) {
  const file: HistoryFile = (await readData('history.json', HistoryFileSchema)) ?? {
    modelRule: MODEL_RULE,
    seasons: [],
    circuits: {},
    races: [],
  };
  if (file.modelRule !== MODEL_RULE) {
    ctx.log(`history: model rule changed (${file.modelRule || 'none'} -> ${MODEL_RULE}), recomputing`);
    for (const race of file.races) {
      race.modelledPrecipMm = null;
      // Converted 14:00-local starts fall on the same UTC date for all F1 venues; restore the placeholder.
      if (race.startAssumed) race.start = `${race.start.slice(0, 10)}T${String(ASSUMED_LOCAL_HOUR).padStart(2, '0')}:00:00.000Z`;
    }
    file.modelRule = MODEL_RULE;
  }
  const key = (r: { season: number; round: number }) => `${r.season}-${r.round}`;
  const byKey = new Map(file.races.map((r) => [key(r), r]));

  // 1. Pre-OpenF1 seasons from Jolpica.
  for (let season = HISTORY_FIRST_SEASON; season < FIRST_SEASON; season++) {
    if (file.seasons.includes(season)) continue;
    try {
      const { races } = await fetchSeasonRaces(season);
      for (const raw of races) {
        const info = toCircuitInfo(raw);
        file.circuits[info.id] ??= { name: info.name, locality: info.locality, country: info.country, lat: info.lat, lon: info.lon };
        const startAssumed = !raw.time;
        const start = startAssumed
          ? `${raw.date}T${String(ASSUMED_LOCAL_HOUR).padStart(2, '0')}:00:00.000Z` // corrected to local time below
          : new Date(`${raw.date}T${raw.time!.endsWith('Z') ? raw.time : `${raw.time}Z`}`).toISOString();
        const entry: HistoryRace = {
          season,
          round: Number(raw.round),
          raceName: raw.raceName,
          circuitId: info.id,
          start,
          startAssumed,
          modelledPrecipMm: null,
        };
        if (!byKey.has(key(entry))) byKey.set(key(entry), entry);
      }
      file.seasons.push(season);
      ctx.log(`history: added ${season} (${races.length} races)`);
    } catch (err) {
      ctx.log(`history: season ${season} failed`, err);
      ctx.errors.push(err);
    }
  }

  // 2. OpenF1-era races from our schedules, once completed.
  for (const race of scheduleRaces) {
    if (raceStart(race) > ctx.now) continue;
    const circuit = circuits[race.circuitId];
    if (circuit) {
      file.circuits[race.circuitId] = {
        name: circuit.name,
        locality: circuit.locality,
        country: circuit.country,
        lat: circuit.lat,
        lon: circuit.lon,
      };
    }
    const existing = byKey.get(key(race));
    const start = new Date(raceStart(race)).toISOString();
    if (!existing || existing.start !== start) {
      byKey.set(key(race), {
        season: race.season,
        round: race.round,
        raceName: race.raceName,
        circuitId: race.circuitId,
        start,
        startAssumed: false,
        modelledPrecipMm: null,
      });
    }
  }

  // 3. Modelled precipitation from the reanalysis archive.
  let requests = 0;
  const budget = ctx.backfill ? Infinity : ARCHIVE_BUDGET;
  for (const race of byKey.values()) {
    if (race.modelledPrecipMm !== null) continue;
    if (Date.parse(race.start) > ctx.now - ARCHIVE_LAG_MS) continue;
    if (requests >= budget) {
      ctx.log('history: archive budget used, continuing next run');
      break;
    }
    const circuit = file.circuits[race.circuitId];
    if (!circuit) continue;
    try {
      const day = Date.parse(race.start);
      const { hourly, utcOffsetSeconds } = await fetchArchive(
        circuit.lat,
        circuit.lon,
        isoDate(day - DAY),
        isoDate(day + DAY),
      );
      requests++;
      // Assumed starts are stored as "14:00Z" placeholders until converted from 14:00 local time here.
      const startMs = race.startAssumed ? day - utcOffsetSeconds * 1000 : day;
      const precip = modelledRacePrecip(hourly, startMs);
      if (precip !== null) {
        race.modelledPrecipMm = precip;
        race.start = new Date(startMs).toISOString();
      }
    } catch (err) {
      ctx.log(`history: archive ${race.season} R${race.round} failed`, err);
      ctx.errors.push(err);
      break;
    }
  }
  if (requests) ctx.log(`history: ${requests} archive request(s)`);

  file.seasons.sort((a, b) => a - b);
  file.races = [...byKey.values()].sort((a, b) => a.season - b.season || a.round - b.round);
  await writeData('history.json', HistoryFileSchema, file);
}
