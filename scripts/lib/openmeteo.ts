import { z } from 'zod';
import type { HourlyForecast } from '../../src/lib/weather.ts';
import { fetchJson } from './http.ts';

const TimezoneResponse = z.object({ timezone: z.string() });

/** IANA timezone for a location, e.g. "America/Los_Angeles". */
export async function fetchTimezone(lat: number, lon: number): Promise<string> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&daily=sunrise`;
  return TimezoneResponse.parse(await fetchJson(url)).timezone;
}

const nullableNums = z.array(z.number().nullable());
const HourlyResponse = z.object({
  utc_offset_seconds: z.number(),
  hourly: z.object({
    time: z.array(z.number()),
    precipitation: nullableNums,
    precipitation_probability: nullableNums.optional(),
    temperature_2m: nullableNums.optional(),
    wind_speed_10m: nullableNums.optional(),
    weather_code: nullableNums.optional(),
  }),
});

export const FORECAST_HOURLY = 'precipitation,precipitation_probability,temperature_2m,wind_speed_10m,weather_code';

/** 16-day hourly forecast, times as unix seconds. */
export async function fetchForecast(lat: number, lon: number): Promise<HourlyForecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=${FORECAST_HOURLY}&forecast_days=16&timeformat=unixtime&timezone=GMT`;
  return HourlyResponse.parse(await fetchJson(url)).hourly;
}

/** Reanalysis precipitation for whole days (YYYY-MM-DD, inclusive). Also returns the local UTC offset. */
export async function fetchArchive(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<{ hourly: HourlyForecast; utcOffsetSeconds: number }> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startDate}&end_date=${endDate}&hourly=precipitation&timeformat=unixtime&timezone=auto`;
  const parsed = HourlyResponse.parse(await fetchJson(url));
  return { hourly: parsed.hourly, utcOffsetSeconds: parsed.utc_offset_seconds };
}
