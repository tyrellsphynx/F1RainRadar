import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDateRange, formatTime } from '../src/lib/format.ts';

describe('formatTime', () => {
  it('formats in the circuit timezone', () => {
    // Vegas FP1: Thursday evening local time, Friday in UTC
    expect(formatTime('2026-11-20T00:30:00Z', 'weekday-time', 'America/Los_Angeles')).toBe('Thu 16:30');
    expect(formatTime('2026-11-20T00:30:00Z', 'weekday-time', 'UTC')).toBe('Fri 00:30');
  });
});

describe('formatDateRange', () => {
  it('collapses the month when equal', () => {
    expect(formatDateRange('2026-11-20T00:30:00Z', '2026-11-22T04:00:00Z', 'America/Los_Angeles')).toBe('19 – 21 Nov');
  });

  it('shows both months across a month boundary', () => {
    expect(formatDateRange('2026-10-30T18:30:00Z', '2026-11-01T20:00:00Z', 'America/Mexico_City')).toBe(
      '30 Oct – 1 Nov',
    );
  });
});

describe('formatCountdown', () => {
  it('formats days, hours, minutes and seconds', () => {
    expect(formatCountdown((2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000)).toBe('2d 03:04:05');
    expect(formatCountdown(59_000)).toBe('00:00:59');
  });

  it('clamps negative durations', () => {
    expect(formatCountdown(-5000)).toBe('00:00:00');
  });
});
