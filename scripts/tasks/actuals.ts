import { ActualsFileSchema, type ActualsFile, type Race, type Session } from '../../src/lib/schemas.ts';
import { summariseTimeline } from '../../src/lib/weather.ts';
import { raceStart, sessionEnd } from '../../src/lib/weekend.ts';
import { HttpError } from '../lib/http.ts';
import { type OpenF1Session, fetchSessions, fetchStrategy, fetchWeather, matchSession } from '../lib/openf1.ts';
import { readData, writeData } from '../lib/store.ts';
import { HOUR, type SyncContext } from './context.ts';
import { FIRST_SEASON } from './schedule.ts';

/** OpenF1 data is free once it's 30 min past the session end; wait a bit longer. */
const SETTLE_MS = HOUR;
/** OpenF1 counts this window around every session as "live" (paid). Avoid calling it then. */
const LIVE_MARGIN_MS = 30 * 60_000;
/** Requests per run (~30/min allowed), so a run stays around 5 minutes. */
const REQUEST_BUDGET = 140;
const RETRY_AFTER_MS = 12 * HOUR;
const MAX_ATTEMPTS = 6;

export const actualsPath = (race: Pick<Race, 'season' | 'round'>) => `${race.season}/actuals/${race.round}.json`;

function inLiveWindow(races: Race[], now: number): boolean {
  return races.some((r) =>
    r.sessions.some((s) => now >= Date.parse(s.start) - LIVE_MARGIN_MS && now <= sessionEnd(s) + LIVE_MARGIN_MS),
  );
}

/** Fetches measured weather (all sessions) and tyre strategy (race and sprint) from OpenF1. */
export async function syncActuals(ctx: SyncContext, allRaces: Race[]) {
  if (inLiveWindow(allRaces, ctx.now)) {
    ctx.log('actuals: a session is live, skipping OpenF1 this run');
    return;
  }

  const files = new Map<string, ActualsFile>();
  const pending: { race: Race; session: Session }[] = [];
  const races = allRaces
    .filter((r) => r.season >= FIRST_SEASON)
    .sort((a, b) => raceStart(b) - raceStart(a)); // newest first

  for (const race of races) {
    const file = (await readData(actualsPath(race), ActualsFileSchema)) ?? { sessions: {} };
    files.set(actualsPath(race), file);
    for (const session of race.sessions) {
      if (ctx.now < sessionEnd(session) + SETTLE_MS) continue;
      const entry = file.sessions[session.type];
      // Measured data never changes once fetched, even with --force.
      if (entry?.status === 'ok') continue;
      if (
        entry?.status === 'unavailable' &&
        !ctx.force &&
        (entry.attempts >= MAX_ATTEMPTS || ctx.now - Date.parse(entry.lastAttempt) < RETRY_AFTER_MS)
      ) {
        continue;
      }
      pending.push({ race, session });
    }
  }
  if (!pending.length) return;
  ctx.log(`actuals: ${pending.length} session(s) pending`);

  let requests = 0;
  const sessionLists = new Map<number, OpenF1Session[]>();
  const budget = ctx.backfill ? Infinity : REQUEST_BUDGET;

  for (const { race, session } of pending) {
    if (requests + 5 > budget) {
      ctx.log('actuals: request budget used, continuing next run');
      break;
    }
    const path = actualsPath(race);
    const file = files.get(path)!;
    try {
      let list = sessionLists.get(race.season);
      if (!list) {
        list = await fetchSessions(race.season);
        requests++;
        sessionLists.set(race.season, list);
      }
      const match = matchSession(list, session.type, session.start);
      const weather = match ? await fetchWeather(match.session_key, match.date_start, match.date_end) : null;
      requests++;

      if (!match || !weather || weather.t.length === 0) {
        const prev = file.sessions[session.type];
        file.sessions[session.type] = {
          status: 'unavailable',
          attempts: (prev?.status === 'unavailable' ? prev.attempts : 0) + 1,
          lastAttempt: new Date(ctx.now).toISOString(),
        };
      } else {
        const isRace = session.type === 'Race' || session.type === 'Sprint';
        const strategy = isRace ? await fetchStrategy(match.session_key) : null;
        if (isRace) requests += 3;
        file.sessions[session.type] = {
          status: 'ok',
          sessionKey: match.session_key,
          start: new Date(match.date_start).toISOString(),
          end: new Date(match.date_end).toISOString(),
          weather,
          summary: summariseTimeline(weather, (Date.parse(match.date_end) - Date.parse(match.date_start)) / 1000),
          strategy,
        };
        ctx.log(`actuals ${race.season} R${race.round} ${session.type}: ok`);
      }
      await writeData(path, ActualsFileSchema, file);
    } catch (err) {
      if (err instanceof HttpError && [401, 403, 429].includes(err.status)) {
        ctx.log(`actuals: OpenF1 refused (${err.status}), stopping for this run`);
        return;
      }
      ctx.log(`actuals ${race.season} R${race.round} ${session.type} failed`, err);
      ctx.errors.push(err);
    }
  }
}
