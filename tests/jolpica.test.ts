import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type JolpicaRace, raceSlug, toRace, toSchedule } from '../scripts/lib/jolpica.ts';
import { ScheduleSchema } from '../src/lib/schemas.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/jolpica-2026.json', import.meta.url), 'utf8'));
const rawRaces: JolpicaRace[] = fixture.MRData.RaceTable.Races;

describe('raceSlug', () => {
  it('strips "Grand Prix" and normalises', () => {
    expect(raceSlug('Las Vegas Grand Prix')).toBe('las-vegas');
    expect(raceSlug('Bahrain Grand Prix in Malaysia')).toBe('bahrain-in-malaysia');
    expect(raceSlug('São Paulo Grand Prix')).toBe('sao-paulo');
    expect(raceSlug('70th Anniversary Grand Prix')).toBe('70th-anniversary');
  });
});

describe('toSchedule', () => {
  const schedule = toSchedule(2026, rawRaces);

  it('produces a valid schedule with all 23 races', () => {
    expect(() => ScheduleSchema.parse(schedule)).not.toThrow();
    expect(schedule.races).toHaveLength(23);
  });

  it('maps a sprint weekend in chronological order', () => {
    const china = schedule.races.find((r) => r.slug === 'chinese')!;
    expect(china.sessions.map((s) => s.type)).toEqual(['FP1', 'SQ', 'Sprint', 'Q', 'Race']);
    expect(china.sessions.at(-1)!.start).toBe('2026-03-15T07:00:00.000Z');
  });

  it('maps a conventional weekend', () => {
    const vegas = schedule.races.find((r) => r.slug === 'las-vegas')!;
    expect(vegas.round).toBe(21);
    expect(vegas.circuitId).toBe('vegas');
    expect(vegas.sessions.map((s) => s.type)).toEqual(['FP1', 'FP2', 'FP3', 'Q', 'Race']);
  });

  it('keeps slugs unique within a season', () => {
    const dup = toSchedule(2020, [rawRaces[0]!, rawRaces[0]!]);
    expect(dup.races.map((r) => r.slug)).toEqual(['australian', 'australian-1']);
  });
});

describe('toRace', () => {
  it('skips races without a start time', () => {
    const { time: _time, ...noTime } = rawRaces[0]!;
    expect(toRace(noTime as JolpicaRace)).toBeNull();
  });

  it('drops sessions without a time', () => {
    const race = toRace({ ...rawRaces[0]!, FirstPractice: { date: '2026-03-06' } })!;
    expect(race.sessions.map((s) => s.type)).not.toContain('FP1');
  });
});
