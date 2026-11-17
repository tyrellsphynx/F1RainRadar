import type { Race, Session, SiteState } from './schemas.ts';
import { SESSION_DURATION_MIN } from './schemas.ts';

const HOUR = 3_600_000;

/** Radar and "live weekend" status start this long before the first session. */
export const WEEKEND_LEAD_MS = 24 * HOUR;
/** The site moves on to the next race this long after the race start. */
export const WEEKEND_TAIL_MS = 24 * HOUR;

export function raceSession(race: Race): Session {
  const session = race.sessions.find((s) => s.type === 'Race');
  if (!session) throw new Error(`Race ${race.season}/${race.round} has no Race session`);
  return session;
}

export function raceStart(race: Race): number {
  return Date.parse(raceSession(race).start);
}

export function weekendStart(race: Race): number {
  const first = Math.min(...race.sessions.map((s) => Date.parse(s.start)));
  return first - WEEKEND_LEAD_MS;
}

export function weekendEnd(race: Race): number {
  return raceStart(race) + WEEKEND_TAIL_MS;
}

export function isRadarWindow(race: Race, now: number): boolean {
  return now >= weekendStart(race) && now < weekendEnd(race);
}

export function sessionEnd(session: Session): number {
  return Date.parse(session.start) + SESSION_DURATION_MIN[session.type] * 60_000;
}

export type RaceStatus = 'completed' | 'live' | 'upcoming';

export function raceStatus(race: Race, now: number): RaceStatus {
  if (now >= weekendEnd(race)) return 'completed';
  if (now >= weekendStart(race)) return 'live';
  return 'upcoming';
}

/** Next session that has not finished yet (may be currently running). */
export function nextSession(race: Race, now: number): Session | null {
  return race.sessions.find((s) => sessionEnd(s) > now) ?? null;
}

export function sortRaces(races: Race[]): Race[] {
  return [...races].sort((a, b) => raceStart(a) - raceStart(b));
}

/**
 * Decides what the home page features.
 * - The featured race is the first one whose weekend has not ended yet.
 * - Off-season: no future race is known, or the featured race is a season opener
 *   whose weekend has not started yet.
 */
export function computeSiteState(allRaces: Race[], now: number): SiteState {
  const races = sortRaces(allRaces);
  const featured = races.find((r) => weekendEnd(r) > now) ?? null;

  if (!featured) return { mode: 'offseason', featured: null, radarActive: false };

  const ref = { season: featured.season, round: featured.round };
  if (featured.round === 1 && now < weekendStart(featured)) {
    return { mode: 'offseason', featured: ref, radarActive: false };
  }
  return { mode: 'race', featured: ref, radarActive: isRadarWindow(featured, now) };
}

export function findRace(races: Race[], ref: { season: number; round: number } | null): Race | null {
  if (!ref) return null;
  return races.find((r) => r.season === ref.season && r.round === ref.round) ?? null;
}
