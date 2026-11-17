/**
 * Live Open-Meteo forecasts in the browser:
 * - [data-forecast] blocks: per-session cards + hourly rain chart for one race;
 * - [data-fc-cell] table cells: rain chance per session (filled from the same data);
 * - [data-card-forecast] calendar cards: race rain chance, one multi-location request.
 */
import { forecastChart } from '../lib/charts.ts';
import { formatTime } from '../lib/format.ts';
import type { SessionType } from '../lib/schemas.ts';
import { convert, formatValue } from '../lib/units.ts';
import { type HourlyForecast, summariseForecast, weatherLabel } from '../lib/weather.ts';
import { getTzMode } from './time.ts';
import { getUnits, unitLabel } from './units.ts';

const HORIZON_MS = 15.5 * 86_400_000;
const HOURLY = 'precipitation,precipitation_probability,temperature_2m,wind_speed_10m,weather_code';

interface SessionInfo {
  type: SessionType;
  label: string;
  start: string;
  end: number;
}

const cache = new Map<string, Promise<HourlyForecast[]>>();

/** One request for any number of locations. */
function fetchHourly(points: { lat: number; lon: number }[]): Promise<HourlyForecast[]> {
  const key = points.map((p) => `${p.lat},${p.lon}`).join(';');
  if (!cache.has(key)) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p.lat).join(',')}` +
      `&longitude=${points.map((p) => p.lon).join(',')}&hourly=${HOURLY}` +
      `&forecast_days=16&past_days=2&timeformat=unixtime&timezone=GMT`;
    cache.set(
      key,
      fetch(url).then(async (res) => {
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        const json = await res.json();
        const list = (Array.isArray(json) ? json : [json]) as { hourly: HourlyForecast }[];
        return list.map((l) => l.hourly);
      }),
    );
  }
  return cache.get(key)!;
}

const fmt = (iso: string | number, tz: string, f: Parameters<typeof formatTime>[1]) =>
  formatTime(iso, f, getTzMode() === 'circuit' ? tz : undefined);

function renderBlock(root: HTMLElement, hourly: HourlyForecast) {
  const tz = root.dataset.tz!;
  const sessions = JSON.parse(root.dataset.sessions!) as SessionInfo[];
  const units = getUnits();
  const now = Date.now();

  // Session cards
  const cards = root.querySelector<HTMLElement>('[data-fc-sessions]')!;
  cards.innerHTML = '';
  for (const s of sessions) {
    const summary = summariseForecast(hourly, s);
    const card = document.createElement('div');
    card.className = 'fc-card';
    if (s.end < now) card.classList.add('past');
    if (!summary) {
      card.innerHTML = `<div class="fc-head"><strong>${s.label}</strong></div><p class="muted">No forecast yet</p>`;
    } else {
      const { icon, label } = weatherLabel(summary.code);
      card.innerHTML = `
        <div class="fc-head"><strong>${s.label}</strong><span class="muted">${fmt(s.start, tz, 'weekday-time')}</span></div>
        <div class="fc-main"><span class="fc-icon" title="${label}">${icon}</span>
          <span class="fc-chance">${summary.rainChance ?? '–'}<small>%</small></span></div>
        <div class="muted fc-detail">${label} · ${formatValue('precip', summary.precipMm, units)}
          · ${formatValue('temp', summary.tempC, units)} · wind ${formatValue('speed', summary.windKmh, units)}</div>`;
    }
    cards.append(card);
  }

  // Chart: from 6 h before the first session to 3 h after the race.
  const first = Date.parse(sessions[0]!.start);
  const last = sessions.at(-1)!.end;
  const idx = hourly.time
    .map((t, i) => [t * 1000, i] as const)
    .filter(([ms]) => ms > first - 6 * 3_600_000 && ms <= last + 3 * 3_600_000);
  const chartEl = root.querySelector<HTMLElement>('[data-fc-chart]')!;
  if (idx.length < 3) {
    chartEl.innerHTML = '';
    return;
  }
  const times = idx.map(([ms]) => ms);
  const ticks = times
    .filter((ms) => {
      const hour = Number(fmt(ms, tz, 'time').slice(0, 2));
      return hour % 6 === 0;
    })
    .map((ms) => {
      const hhmm = fmt(ms, tz, 'time');
      return { at: ms, label: hhmm.startsWith('00') ? fmt(ms, tz, 'weekday-time').split(' ')[0]! : hhmm };
    });
  chartEl.innerHTML = forecastChart({
    times,
    precip: idx.map(([, i]) => hourly.precipitation[i] ?? 0),
    prob: idx.map(([, i]) => hourly.precipitation_probability?.[i] ?? null),
    sessions: sessions.map((s) => ({ start: Date.parse(s.start), end: s.end, label: s.type })),
    ticks,
    precipDisplay: (mm) => convert('precip', mm, units),
    precipUnit: unitLabel('precip', units),
  });
}

function fillCells(raceKey: string, hourly: HourlyForecast, sessions: SessionInfo[]) {
  for (const s of sessions) {
    const cell = document.querySelector<HTMLElement>(`[data-fc-race="${raceKey}"][data-fc-cell="${s.type}"]`);
    if (!cell) continue;
    const summary = summariseForecast(hourly, s);
    if (!summary) continue;
    const { icon, label } = weatherLabel(summary.code);
    cell.innerHTML = `<span title="${label}">${icon}</span> <span class="mono">${summary.rainChance ?? '–'}%</span>`;
    cell.title = `Chance of rain during ${s.label}`;
  }
}

async function setupBlocks() {
  for (const root of document.querySelectorAll<HTMLElement>('[data-forecast]')) {
    const status = root.querySelector<HTMLElement>('[data-fc-status]')!;
    const sessions = JSON.parse(root.dataset.sessions!) as SessionInfo[];
    const first = Date.parse(sessions[0]!.start);
    if (first - Date.now() > HORIZON_MS) {
      const available = first - HORIZON_MS;
      status.textContent = `Forecasts go 16 days ahead. This race weekend's forecast appears around ${formatTime(available, 'date')}.`;
      root.querySelector<HTMLElement>('[data-fc-body]')!.hidden = true;
      continue;
    }
    try {
      const [hourly] = await fetchHourly([{ lat: Number(root.dataset.lat), lon: Number(root.dataset.lon) }]);
      const render = () => {
        renderBlock(root, hourly!);
        fillCells(root.dataset.raceKey!, hourly!, sessions);
      };
      render();
      status.hidden = true;
      root.querySelector<HTMLElement>('[data-fc-body]')!.hidden = false;
      document.addEventListener('unitschange', render);
      document.addEventListener('tzchange', render);
    } catch (err) {
      console.error(err);
      status.textContent = 'Forecast temporarily unavailable.';
    }
  }
}

async function setupCards() {
  const cards = [...document.querySelectorAll<HTMLElement>('[data-card-forecast]')].filter((el) => {
    const start = Number(el.dataset.raceStart);
    return start > Date.now() && start - Date.now() < HORIZON_MS;
  });
  if (!cards.length) return;
  try {
    const hourlies = await fetchHourly(cards.map((c) => ({ lat: Number(c.dataset.lat), lon: Number(c.dataset.lon) })));
    cards.forEach((card, i) => {
      const hourly = hourlies[i];
      if (!hourly) return;
      const summary = summariseForecast(hourly, { type: 'Race', start: new Date(Number(card.dataset.raceStart)).toISOString() });
      if (!summary || summary.rainChance === null) return;
      const { icon } = weatherLabel(summary.code);
      card.textContent = `${icon} ${summary.rainChance}% rain chance`;
      card.title = 'Forecast chance of rain during the race (Open-Meteo)';
      card.hidden = false;
    });
  } catch (err) {
    console.error(err);
  }
}

setupBlocks();
setupCards();
