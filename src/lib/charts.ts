/**
 * Tiny SVG chart builders returning markup strings, usable at build time (set:html)
 * and in the browser (innerHTML). Axis labels carrying units use [data-u][data-axis]
 * so the units script can re-render them.
 */
import type { Compound, Strategy } from './schemas.ts';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (n: number) => Math.round(n * 10) / 10;

export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * mag)
    .reduce((best, s) => (Math.abs(s - raw) < Math.abs(best - raw) ? s : best));
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

function linePath(xs: number[], ys: (number | null)[]): string {
  let d = '';
  let pen = false;
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y === null || y === undefined) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${f(x)},${f(y)}`;
    pen = true;
  });
  return d;
}

/* ---------- Session weather timeline (measured) ---------- */

export interface TimelineSeries {
  label: string;
  color: string;
  values: (number | null)[];
}

export interface TimelineOptions {
  /** Seconds since session start. */
  t: number[];
  series: TimelineSeries[];
  rain: (0 | 1)[];
  width?: number;
  height?: number;
}

export function timelineChart({ t, series, rain, width = 720, height = 200 }: TimelineOptions): string {
  const m = { l: 36, r: 8, t: 8, b: 22 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const x0 = Math.min(0, ...t);
  const x1 = Math.max(x0 + 60, ...t);
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const yMin = Math.floor((all.length ? Math.min(...all) : 0) - 2);
  const yMax = Math.ceil((all.length ? Math.max(...all) : 40) + 2);
  const X = (s: number) => m.l + ((s - x0) / (x1 - x0)) * w;
  const Y = (v: number) => m.t + h - ((v - yMin) / (yMax - yMin)) * h;

  const parts: string[] = [];

  // Rain bands
  let runStart: number | null = null;
  rain.forEach((r, i) => {
    const ti = t[i]!;
    if (r && runStart === null) runStart = ti;
    const ending = runStart !== null && (!r || i === rain.length - 1);
    if (ending) {
      const end = r ? ti + 60 : ti;
      parts.push(
        `<rect x="${f(X(runStart!))}" y="${m.t}" width="${f(Math.max(2, X(end) - X(runStart!)))}" height="${h}" fill="rgb(74 168 255 / 0.22)"/>`,
      );
      runStart = null;
    }
  });

  // Y grid + labels
  for (const v of niceTicks(yMin, yMax, 4)) {
    parts.push(`<line x1="${m.l}" x2="${width - m.r}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="grid"/>`);
    parts.push(
      `<text x="${m.l - 6}" y="${f(Y(v) + 4)}" text-anchor="end" data-u="temp" data-v="${v}" data-axis>${v}°</text>`,
    );
  }
  // X ticks every 15 or 30 minutes
  const stepS = x1 - x0 > 5400 ? 1800 : 900;
  for (let s = Math.ceil(x0 / stepS) * stepS; s <= x1; s += stepS) {
    const abs = Math.abs(s);
    const label = `${s < 0 ? '−' : ''}${Math.floor(abs / 3600)}:${String(Math.floor((abs % 3600) / 60)).padStart(2, '0')}`;
    parts.push(`<text x="${f(X(s))}" y="${height - 6}" text-anchor="middle">${label}</text>`);
  }

  const xs = t.map(X);
  for (const s of series) {
    parts.push(
      `<path d="${linePath(xs, s.values.map((v) => (v === null ? null : Y(v))))}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`,
    );
  }

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))} during the session">${parts.join('')}</svg>`;
}

/* ---------- Tyre strategy ---------- */

export const COMPOUND_COLORS: Record<Compound, string> = {
  SOFT: '#ff3b30',
  MEDIUM: '#ffd60a',
  HARD: '#f2f2f2',
  INTERMEDIATE: '#34c759',
  WET: '#0a84ff',
  UNKNOWN: '#6b7280',
};

export function strategyChart(strategy: Strategy, width = 720): string {
  const row = 20;
  const m = { l: 74, r: 8, t: 6, b: 22 };
  const height = m.t + m.b + strategy.drivers.length * row;
  const w = width - m.l - m.r;
  const X = (lap: number) => m.l + (lap / strategy.totalLaps) * w;
  const parts: string[] = [];

  const lapStep = strategy.totalLaps > 40 ? 10 : 5;
  for (let lap = 0; lap <= strategy.totalLaps; lap += lapStep) {
    parts.push(`<line x1="${f(X(lap))}" x2="${f(X(lap))}" y1="${m.t}" y2="${height - m.b}" class="grid"/>`);
    parts.push(`<text x="${f(X(lap))}" y="${height - 6}" text-anchor="middle">${lap}</text>`);
  }

  strategy.drivers.forEach((d, i) => {
    const y = m.t + i * row;
    const pos = d.position ? `P${d.position}` : d.status.toUpperCase();
    parts.push(`<rect x="2" y="${y + 4}" width="3" height="${row - 8}" fill="${esc(d.colour)}"/>`);
    parts.push(`<text x="10" y="${y + row / 2 + 4}" class="pos">${esc(pos)}</text>`);
    parts.push(`<text x="${m.l - 6}" y="${y + row / 2 + 4}" text-anchor="end" class="drv"><title>${esc(d.name)} · ${esc(d.team)}</title>${esc(d.acronym)}</text>`);
    for (const s of strategy.stints.filter((st) => st.driver === d.number)) {
      const x = X(s.lapStart - 1);
      const bw = Math.max(1, X(s.lapEnd) - x - 1);
      parts.push(
        `<rect x="${f(x)}" y="${y + 3}" width="${f(bw)}" height="${row - 6}" rx="3" fill="${COMPOUND_COLORS[s.compound]}"><title>${esc(d.acronym)}: ${s.compound.toLowerCase()} laps ${s.lapStart}–${s.lapEnd}</title></rect>`,
      );
    }
  });

  return `<svg viewBox="0 0 ${width} ${height}" class="chart strategy" role="img" aria-label="Tyre strategy per driver">${parts.join('')}</svg>`;
}

/* ---------- Hourly forecast (rain bars + probability line) ---------- */

export interface ForecastChartOptions {
  /** Hour-end timestamps (ms). Each value covers the preceding hour. */
  times: number[];
  precip: number[];
  prob: (number | null)[];
  sessions: { start: number; end: number; label: string }[];
  /** Tick positions (ms) and their labels. */
  ticks: { at: number; label: string }[];
  /** Converts mm for display and gives its unit label. */
  precipDisplay: (mm: number) => number;
  precipUnit: string;
  width?: number;
  height?: number;
}

export function forecastChart(o: ForecastChartOptions): string {
  const width = o.width ?? 720;
  const height = o.height ?? 220;
  const m = { l: 38, r: 38, t: 18, b: 24 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const x0 = o.times[0]! - 3_600_000;
  const x1 = o.times.at(-1)!;
  const X = (ms: number) => m.l + ((ms - x0) / (x1 - x0)) * w;
  const pMax = Math.max(2, ...o.precip);
  const YP = (mm: number) => m.t + h - (mm / pMax) * h;
  const YC = (pct: number) => m.t + h - (pct / 100) * h;
  const parts: string[] = [];

  for (const s of o.sessions) {
    parts.push(
      `<rect x="${f(X(s.start))}" y="${m.t}" width="${f(Math.max(3, X(s.end) - X(s.start)))}" height="${h}" fill="rgb(225 6 0 / 0.16)"/>`,
    );
    parts.push(`<text x="${f(X(s.start))}" y="${m.t - 5}" class="session">${esc(s.label)}</text>`);
  }
  for (const v of [0, 25, 50, 75, 100]) {
    parts.push(`<line x1="${m.l}" x2="${width - m.r}" y1="${f(YC(v))}" y2="${f(YC(v))}" class="grid"/>`);
    parts.push(`<text x="${width - m.r + 4}" y="${f(YC(v) + 4)}" class="prob">${v}%</text>`);
  }
  for (const v of niceTicks(0, pMax, 3)) {
    const shown = o.precipDisplay(v);
    parts.push(
      `<text x="${m.l - 4}" y="${f(YP(v) + 4)}" text-anchor="end" class="mm">${shown < 1 && shown > 0 ? shown.toFixed(2) : Math.round(shown * 10) / 10}</text>`,
    );
  }
  parts.push(`<text x="4" y="${m.t - 5}" class="mm">${esc(o.precipUnit)}</text>`);

  const barW = Math.max(1, w / o.times.length - 1);
  o.times.forEach((t, i) => {
    const mm = o.precip[i] ?? 0;
    if (mm <= 0) return;
    parts.push(
      `<rect x="${f(X(t - 3_600_000) + 0.5)}" y="${f(YP(mm))}" width="${f(barW)}" height="${f(m.t + h - YP(mm))}" fill="#4aa8ff"/>`,
    );
  });
  parts.push(
    `<path d="${linePath(o.times.map((t) => X(t - 1_800_000)), o.prob.map((p) => (p === null ? null : YC(p))))}" fill="none" stroke="#f5b942" stroke-width="2" stroke-linejoin="round"/>`,
  );
  for (const tick of o.ticks) {
    if (tick.at < x0 || tick.at > x1) continue;
    parts.push(`<line x1="${f(X(tick.at))}" x2="${f(X(tick.at))}" y1="${m.t}" y2="${m.t + h}" class="grid"/>`);
    parts.push(`<text x="${f(X(tick.at))}" y="${height - 6}" text-anchor="middle">${esc(tick.label)}</text>`);
  }

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Hourly precipitation and rain probability">${parts.join('')}</svg>`;
}
