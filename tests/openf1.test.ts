import { describe, expect, it } from 'vitest';
import { type OpenF1Session, matchSession, sessionTypeOf } from '../scripts/lib/openf1.ts';
import { niceTicks, strategyChart } from '../src/lib/charts.ts';

const sessions: OpenF1Session[] = [
  { session_key: 1, session_name: 'Practice 1', date_start: '2026-11-06T15:30:00+00:00', date_end: '2026-11-06T16:30:00+00:00', year: 2026 },
  { session_key: 2, session_name: 'Sprint Qualifying', date_start: '2026-11-06T19:30:00+00:00', date_end: '2026-11-06T20:15:00+00:00', year: 2026 },
  { session_key: 3, session_name: 'Race', date_start: '2026-11-08T17:00:00+00:00', date_end: '2026-11-08T19:00:00+00:00', year: 2026 },
  { session_key: 4, session_name: 'Race', date_start: '2026-11-22T04:00:00+00:00', date_end: '2026-11-22T06:00:00+00:00', year: 2026, is_cancelled: true },
];

describe('OpenF1 session matching', () => {
  it('maps session names', () => {
    expect(sessionTypeOf('Practice 2')).toBe('FP2');
    expect(sessionTypeOf('Sprint Shootout')).toBe('SQ');
    expect(sessionTypeOf('Day 1')).toBeNull();
  });

  it('matches by type and nearest start', () => {
    expect(matchSession(sessions, 'Race', '2026-11-08T17:00:00.000Z')?.session_key).toBe(3);
    expect(matchSession(sessions, 'SQ', '2026-11-06T20:00:00.000Z')?.session_key).toBe(2);
  });

  it('ignores cancelled sessions and far-away dates', () => {
    expect(matchSession(sessions, 'Race', '2026-11-22T04:00:00.000Z')).toBeNull();
    expect(matchSession(sessions, 'FP1', '2026-10-01T00:00:00.000Z')).toBeNull();
  });
});

describe('charts', () => {
  it('niceTicks picks round steps', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(13, 38, 4)).toEqual([15, 20, 25, 30, 35]);
  });

  it('strategyChart draws a bar per stint and escapes names', () => {
    const svg = strategyChart({
      totalLaps: 50,
      drivers: [{ number: 1, acronym: 'A<B', name: 'Test', team: 'T', colour: '#fff', position: 1, status: 'finished' }],
      stints: [
        { driver: 1, lapStart: 1, lapEnd: 20, compound: 'INTERMEDIATE' },
        { driver: 1, lapStart: 21, lapEnd: 50, compound: 'MEDIUM' },
      ],
    });
    expect(svg.match(/<rect [^>]*rx="3"/g)).toHaveLength(2);
    expect(svg).toContain('A&lt;B');
    expect(svg).not.toContain('A<B');
  });
});
