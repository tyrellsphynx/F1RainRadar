import { z } from 'zod';
import { type Schedule, type Standings, StandingsSchema } from '../../src/lib/schemas.ts';
import { raceStart } from '../../src/lib/weekend.ts';
import { fetchJson } from '../lib/http.ts';
import { readData, writeData } from '../lib/store.ts';
import type { SyncContext } from './context.ts';
import { isSeasonFinished } from './schedule.ts';

const BASE = 'https://api.jolpi.ca/ergast/f1';

const num = z.union([z.string(), z.number()]).transform(Number);

const DriverStandingsResponse = z.object({
  MRData: z.object({
    StandingsTable: z.object({
      StandingsLists: z.array(
        z.object({
          round: num,
          DriverStandings: z.array(
            z.object({
              position: num.optional(),
              points: num,
              wins: num,
              Driver: z.object({ code: z.string().optional(), givenName: z.string(), familyName: z.string() }),
              Constructors: z.array(z.object({ name: z.string() })),
            }),
          ),
        }),
      ),
    }),
  }),
});

const ConstructorStandingsResponse = z.object({
  MRData: z.object({
    StandingsTable: z.object({
      StandingsLists: z.array(
        z.object({
          ConstructorStandings: z.array(
            z.object({
              position: num.optional(),
              points: num,
              wins: num,
              Constructor: z.object({ name: z.string() }),
            }),
          ),
        }),
      ),
    }),
  }),
});

export async function syncStandings(ctx: SyncContext, schedules: Schedule[]) {
  for (const schedule of schedules) {
    const { season } = schedule;
    if (!schedule.races.some((r) => raceStart(r) < ctx.now)) continue; // season not started
    const existing = await readData(`${season}/standings.json`, StandingsSchema);
    if (existing && isSeasonFinished(schedule, ctx.now) && !ctx.force) continue;

    try {
      const d = DriverStandingsResponse.parse(await fetchJson(`${BASE}/${season}/driverStandings.json?limit=100`));
      const c = ConstructorStandingsResponse.parse(
        await fetchJson(`${BASE}/${season}/constructorStandings.json?limit=100`),
      );
      const dl = d.MRData.StandingsTable.StandingsLists[0];
      const cl = c.MRData.StandingsTable.StandingsLists[0];
      if (!dl || !cl) continue;

      const standings: Standings = {
        season,
        round: dl.round,
        drivers: dl.DriverStandings.map((s, i) => ({
          position: s.position ?? i + 1,
          points: s.points,
          wins: s.wins,
          code: s.Driver.code ?? s.Driver.familyName.slice(0, 3).toUpperCase(),
          name: `${s.Driver.givenName} ${s.Driver.familyName}`,
          team: s.Constructors.at(-1)?.name ?? '',
        })),
        constructors: cl.ConstructorStandings.map((s, i) => ({
          position: s.position ?? i + 1,
          points: s.points,
          wins: s.wins,
          name: s.Constructor.name,
        })),
      };
      if (await writeData(`${season}/standings.json`, StandingsSchema, standings)) {
        ctx.log(`standings ${season} updated (after round ${standings.round})`);
      }
    } catch (err) {
      ctx.log(`standings ${season} failed`, err);
      ctx.errors.push(err);
    }
  }
}
