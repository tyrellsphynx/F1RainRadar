import { z } from 'zod';
import { fetchJson } from './http.ts';

const TimezoneResponse = z.object({ timezone: z.string() });

/** IANA timezone for a location, e.g. "America/Los_Angeles". */
export async function fetchTimezone(lat: number, lon: number): Promise<string> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&daily=sunrise`;
  return TimezoneResponse.parse(await fetchJson(url)).timezone;
}
