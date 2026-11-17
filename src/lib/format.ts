/** Shared between build-time rendering and browser scripts. */

export type TimeFormat = 'datetime' | 'time' | 'date' | 'weekday-time';

const OPTIONS: Record<TimeFormat, Intl.DateTimeFormatOptions> = {
  datetime: { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  'weekday-time': { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  date: { day: 'numeric', month: 'short' },
};

/** `timeZone` undefined means the viewer's own timezone. */
export function formatTime(iso: string | number, format: TimeFormat, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { ...OPTIONS[format], ...(timeZone ? { timeZone } : {}) }).format(
    new Date(iso),
  );
}

/** "20 – 22 Nov" or "30 Oct – 1 Nov" in the given timezone. */
export function formatDateRange(startIso: string | number, endIso: string | number, timeZone?: string): string {
  const tz = timeZone ? { timeZone } : {};
  const start = new Date(startIso);
  const end = new Date(endIso);
  const month = (d: Date) => new Intl.DateTimeFormat('en-GB', { month: 'short', ...tz }).format(d);
  const day = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', ...tz }).format(d);
  return month(start) === month(end)
    ? `${day(start)} – ${day(end)} ${month(end)}`
    : `${day(start)} ${month(start)} – ${day(end)} ${month(end)}`;
}

/** Short timezone label such as "PST" or "GMT+3". */
export function timeZoneLabel(iso: string | number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** "2d 04:13:09" style countdown; negative durations clamp to zero. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hms = [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  return d > 0 ? `${d}d ${hms}` : hms;
}
