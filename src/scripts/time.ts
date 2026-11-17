/**
 * Renders every <time data-utc> element in the visitor's timezone or the circuit's,
 * depending on the stored preference, and keeps countdowns ticking.
 */
import { type TimeFormat, formatCountdown, formatTime, timeZoneLabel } from '../lib/format.ts';

type TzMode = 'local' | 'circuit';
const STORAGE_KEY = 'tzMode';

export function getTzMode(): TzMode {
  return localStorage.getItem(STORAGE_KEY) === 'circuit' ? 'circuit' : 'local';
}

function render() {
  const mode = getTzMode();
  for (const el of document.querySelectorAll<HTMLElement>('[data-utc]')) {
    const utc = el.dataset.utc!;
    const circuitTz = el.dataset.tz;
    const fmt = (el.dataset.fmt ?? 'datetime') as TimeFormat;
    const primaryTz = mode === 'local' ? undefined : circuitTz;
    const primary = el.querySelector<HTMLElement>('.t-primary') ?? el;
    primary.textContent = formatTime(utc, fmt, primaryTz);
    primary.title = timeZoneLabel(utc, primaryTz);

    const secondary = el.querySelector<HTMLElement>('.t-secondary');
    if (secondary && circuitTz) {
      const otherTz = mode === 'local' ? circuitTz : undefined;
      secondary.textContent = `${mode === 'local' ? 'Track' : 'You'}: ${formatTime(utc, fmt, otherTz)} ${timeZoneLabel(utc, otherTz)}`;
    }
  }
  for (const btn of document.querySelectorAll<HTMLElement>('[data-tz-toggle]')) {
    btn.textContent = mode === 'local' ? 'Your time' : 'Track time';
    btn.title = 'Switch between your timezone and the track timezone';
  }
}

interface SessionTiming {
  label: string;
  start: number;
  end: number;
}

function tickCountdowns() {
  const now = Date.now();
  for (const el of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
    el.textContent = formatCountdown(Date.parse(el.dataset.countdown!) - now);
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-next-session]')) {
    const sessions = JSON.parse(el.dataset.nextSession!) as SessionTiming[];
    const next = sessions.find((s) => s.end > now);
    const label = el.querySelector('[data-next-label]')!;
    const countdown = el.querySelector('[data-next-countdown]')!;
    if (!next) {
      label.textContent = 'Race weekend';
      countdown.textContent = 'Complete';
    } else if (now >= next.start) {
      label.textContent = 'Live now';
      countdown.textContent = next.label;
    } else {
      label.textContent = `${next.label} starts in`;
      countdown.textContent = formatCountdown(next.start - now);
    }
  }

  for (const row of document.querySelectorAll<HTMLElement>('[data-session-row]')) {
    const start = Number(row.dataset.start);
    const end = Number(row.dataset.end);
    row.classList.toggle('done', now >= end);
    row.classList.toggle('current', now >= start && now < end);
  }
}

document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('[data-tz-toggle]')) return;
  localStorage.setItem(STORAGE_KEY, getTzMode() === 'local' ? 'circuit' : 'local');
  render();
});

render();
tickCountdowns();
setInterval(tickCountdowns, 1000);
