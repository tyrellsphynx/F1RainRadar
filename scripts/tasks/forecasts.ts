import {
  type CircuitsFile,
  ForecastFileSchema,
  type ForecastSnapshot,
  type Race,
} from '../../src/lib/schemas.ts';
import { summariseForecast } from '../../src/lib/weather.ts';
import { raceStart } from '../../src/lib/weekend.ts';
import { fetchForecast } from '../lib/openmeteo.ts';
import { readData, writeData } from '../lib/store.ts';
import { DAY, HOUR, type SyncContext } from './context.ts';

/** Start archiving forecasts this long before the first session. */
const SNAPSHOT_LEAD_MS = 7 * DAY;
/** Interval between snapshots (with some slack for late cron runs). */
const SNAPSHOT_INTERVAL_MS = 3 * HOUR - 15 * 60_000;

export const forecastPath = (race: Pick<Race, 'season' | 'round'>) => `${race.season}/forecasts/${race.round}.json`;

/**
 * Archives an Open-Meteo forecast for each not-yet-started session of upcoming race weekends.
 * The last snapshot before each session is later compared with what actually happened.
 */
export async function syncForecasts(ctx: SyncContext, races: Race[], circuits: CircuitsFile['circuits']) {
  for (const race of races) {
    const first = Date.parse(race.sessions[0]!.start);
    if (ctx.now < first - SNAPSHOT_LEAD_MS || ctx.now >= raceStart(race)) continue;

    const file = (await readData(forecastPath(race), ForecastFileSchema)) ?? { snapshots: [] };
    const last = file.snapshots.at(-1);
    if (last && ctx.now - Date.parse(last.fetchedAt) < SNAPSHOT_INTERVAL_MS && !ctx.force) continue;

    const circuit = circuits[race.circuitId];
    if (!circuit) continue;
    try {
      const hourly = await fetchForecast(circuit.lat, circuit.lon);
      const snapshot: ForecastSnapshot = { fetchedAt: new Date(ctx.now).toISOString(), sessions: {} };
      for (const session of race.sessions) {
        if (Date.parse(session.start) <= ctx.now) continue;
        const summary = summariseForecast(hourly, session);
        if (summary) snapshot.sessions[session.type] = summary;
      }
      if (!Object.keys(snapshot.sessions).length) continue;
      file.snapshots.push(snapshot);
      await writeData(forecastPath(race), ForecastFileSchema, file);
      ctx.log(`forecast snapshot ${race.season} R${race.round} (${Object.keys(snapshot.sessions).join(', ')})`);
    } catch (err) {
      ctx.log(`forecast ${race.season} R${race.round} failed`, err);
      ctx.errors.push(err);
    }
  }
}
