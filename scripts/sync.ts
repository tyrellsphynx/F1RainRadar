/**
 * Hourly data sync. Decides what needs doing and exits quickly when idle.
 *
 *   npm run sync                 # normal run
 *   npm run sync -- --force      # refresh everything regardless of age
 *   npm run sync -- --backfill   # no per-run request budgets (slow; for local backfills)
 */
import { CircuitsFileSchema, type Meta, MetaSchema } from '../src/lib/schemas.ts';
import { computeSiteState } from '../src/lib/weekend.ts';
import type { JolpicaCircuitInfo } from './lib/jolpica.ts';
import { readData, writeData } from './lib/store.ts';
import { syncActuals } from './tasks/actuals.ts';
import { HOUR, type SyncContext } from './tasks/context.ts';
import { syncForecasts } from './tasks/forecasts.ts';
import { syncHistory } from './tasks/history.ts';
import { loadSchedules, syncCircuits, syncSchedules } from './tasks/schedule.ts';
import { syncStandings } from './tasks/standings.ts';

const DAILY_INTERVAL_MS = 23 * HOUR;

const ctx: SyncContext = {
  now: Date.now(),
  force: process.argv.includes('--force'),
  backfill: process.argv.includes('--backfill'),
  log: (...args) => console.log('[sync]', ...args),
  errors: [],
};

async function main() {
  const meta: Meta = (await readData('meta.json', MetaSchema)) ?? { lastDailySync: null, seasons: [], siteState: null };

  const dailyDue = ctx.force || !meta.lastDailySync || ctx.now - Date.parse(meta.lastDailySync) >= DAILY_INTERVAL_MS;
  if (dailyDue) {
    ctx.log('running daily tasks');
    const circuitInfo = new Map<string, JolpicaCircuitInfo>();
    await syncSchedules(ctx, circuitInfo);
    const schedules = await loadSchedules();
    await syncCircuits(
      ctx,
      schedules.flatMap((s) => s.races),
      circuitInfo,
    );
    await syncStandings(ctx, schedules);
    meta.lastDailySync = new Date(ctx.now).toISOString();
  }

  const schedules = await loadSchedules();
  const races = schedules.flatMap((s) => s.races);
  const circuits = (await readData('circuits.json', CircuitsFileSchema))?.circuits ?? {};

  await syncForecasts(ctx, races, circuits);
  await syncActuals(ctx, races);
  await syncHistory(ctx, races, circuits);

  meta.seasons = schedules.map((s) => s.season);
  const siteState = computeSiteState(races, ctx.now);
  if (JSON.stringify(siteState) !== JSON.stringify(meta.siteState)) ctx.log('site state changed', siteState);
  meta.siteState = siteState;
  await writeData('meta.json', MetaSchema, meta);

  if (ctx.errors.length) {
    console.error(`[sync] finished with ${ctx.errors.length} error(s)`);
    process.exitCode = 1;
  } else {
    ctx.log('done');
  }
}

main().catch((err) => {
  console.error('[sync] failed:', err);
  process.exit(1);
});
