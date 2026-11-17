import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toSchedule } from '../scripts/lib/jolpica.ts';
import type { Race } from '../src/lib/schemas.ts';
import {
  computeSiteState,
  isRadarWindow,
  nextSession,
  raceStatus,
  weekendEnd,
  weekendStart,
} from '../src/lib/weekend.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/jolpica-2026.json', import.meta.url), 'utf8'));
const races = toSchedule(2026, fixture.MRData.RaceTable.Races).races;
const vegas = races.find((r) => r.slug === 'las-vegas')!;
const t = (iso: string) => Date.parse(iso);

/** A fake opener of the following season. */
function opener2027(): Race {
  return {
    season: 2027,
    round: 1,
    raceName: 'Australian Grand Prix',
    slug: 'australian',
    circuitId: 'albert_park',
    sessions: [
      { type: 'FP1', start: '2027-03-05T01:30:00.000Z' },
      { type: 'Race', start: '2027-03-07T04:00:00.000Z' },
    ],
  };
}

describe('race weekend window', () => {
  // Vegas FP1 2026-11-20T00:30Z, race 2026-11-22T04:00Z
  it('opens 24h before FP1 and closes 24h after the race start', () => {
    expect(weekendStart(vegas)).toBe(t('2026-11-19T00:30:00Z'));
    expect(weekendEnd(vegas)).toBe(t('2026-11-23T04:00:00Z'));
  });

  it('isRadarWindow respects both bounds', () => {
    expect(isRadarWindow(vegas, t('2026-11-19T00:29:59Z'))).toBe(false);
    expect(isRadarWindow(vegas, t('2026-11-19T00:30:00Z'))).toBe(true);
    expect(isRadarWindow(vegas, t('2026-11-23T03:59:59Z'))).toBe(true);
    expect(isRadarWindow(vegas, t('2026-11-23T04:00:00Z'))).toBe(false);
  });

  it('raceStatus follows the window', () => {
    expect(raceStatus(vegas, t('2026-11-17T12:00:00Z'))).toBe('upcoming');
    expect(raceStatus(vegas, t('2026-11-21T12:00:00Z'))).toBe('live');
    expect(raceStatus(vegas, t('2026-11-24T00:00:00Z'))).toBe('completed');
  });

  it('nextSession returns a running session until it ends', () => {
    expect(nextSession(vegas, t('2026-11-20T00:45:00Z'))?.type).toBe('FP1');
    expect(nextSession(vegas, t('2026-11-20T01:31:00Z'))?.type).toBe('FP2');
    expect(nextSession(vegas, t('2026-11-22T07:00:00Z'))).toBeNull();
  });
});

describe('computeSiteState', () => {
  it('features the next race before its weekend, radar off', () => {
    expect(computeSiteState(races, t('2026-11-17T18:00:00Z'))).toEqual({
      mode: 'race',
      featured: { season: 2026, round: 21 },
      radarActive: false,
    });
  });

  it('turns the radar on during the weekend', () => {
    expect(computeSiteState(races, t('2026-11-21T12:00:00Z')).radarActive).toBe(true);
  });

  it('keeps featuring a race until 24h after its start, then switches', () => {
    expect(computeSiteState(races, t('2026-11-23T03:59:00Z')).featured).toEqual({ season: 2026, round: 21 });
    expect(computeSiteState(races, t('2026-11-23T04:00:00Z')).featured).toEqual({ season: 2026, round: 22 });
  });

  it('enters off-season after the finale when no next calendar exists', () => {
    expect(computeSiteState(races, t('2026-12-08T00:00:00Z'))).toEqual({
      mode: 'offseason',
      featured: null,
      radarActive: false,
    });
  });

  it('points at the next opener during the off-season once published', () => {
    const all = [...races, opener2027()];
    expect(computeSiteState(all, t('2027-01-15T00:00:00Z'))).toEqual({
      mode: 'offseason',
      featured: { season: 2027, round: 1 },
      radarActive: false,
    });
    // 24h before the opener's FP1 the race mode takes over.
    expect(computeSiteState(all, t('2027-03-04T02:00:00Z'))).toEqual({
      mode: 'race',
      featured: { season: 2027, round: 1 },
      radarActive: true,
    });
  });

  it('is independent of input order', () => {
    const now = t('2026-11-17T18:00:00Z');
    expect(computeSiteState([...races].reverse(), now)).toEqual(computeSiteState(races, now));
  });
});
