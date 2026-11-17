import { z } from 'zod';

export const SESSION_TYPES = ['FP1', 'FP2', 'FP3', 'SQ', 'Sprint', 'Q', 'Race'] as const;
export const SessionTypeSchema = z.enum(SESSION_TYPES);
export type SessionType = z.infer<typeof SessionTypeSchema>;

export const SESSION_LABELS: Record<SessionType, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint Qualifying',
  Sprint: 'Sprint',
  Q: 'Qualifying',
  Race: 'Race',
};

/** Approximate session lengths, used to decide when a session is "live" or finished. */
export const SESSION_DURATION_MIN: Record<SessionType, number> = {
  FP1: 60,
  FP2: 60,
  FP3: 60,
  SQ: 45,
  Sprint: 60,
  Q: 60,
  Race: 120,
};

const IsoDate = z.iso.datetime({ offset: true });

export const SessionSchema = z.object({
  type: SessionTypeSchema,
  start: IsoDate,
});
export type Session = z.infer<typeof SessionSchema>;

export const RaceSchema = z.object({
  season: z.number().int(),
  round: z.number().int().positive(),
  raceName: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  circuitId: z.string(),
  wikipediaUrl: z.string().optional(),
  /** Sorted chronologically; always contains a Race session. */
  sessions: z.array(SessionSchema).min(1),
});
export type Race = z.infer<typeof RaceSchema>;

export const ScheduleSchema = z.object({
  season: z.number().int(),
  races: z.array(RaceSchema),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const RadarCoverageSchema = z.object({
  level: z.enum(['full', 'partial', 'none']),
  /** Share of sampled pixels around the circuit that have radar coverage (0..1). */
  fraction: z.number().min(0).max(1),
  checkedAt: IsoDate,
});
export type RadarCoverage = z.infer<typeof RadarCoverageSchema>;

export const CircuitSchema = z.object({
  id: z.string(),
  name: z.string(),
  locality: z.string(),
  country: z.string(),
  lat: z.number(),
  lon: z.number(),
  timezone: z.string(),
  radarCoverage: RadarCoverageSchema.nullable(),
  /** Track centreline as [lon, lat] pairs, from bacinger/f1-circuits. */
  outline: z.array(z.tuple([z.number(), z.number()])).nullable(),
});
export type Circuit = z.infer<typeof CircuitSchema>;

export const CircuitsFileSchema = z.object({
  circuits: z.record(z.string(), CircuitSchema),
});
export type CircuitsFile = z.infer<typeof CircuitsFileSchema>;

/* ---------- Forecasts (Open-Meteo) ---------- */

export const SessionForecastSchema = z.object({
  /** Highest hourly precipitation probability during the session, 0-100. */
  rainChance: z.number().min(0).max(100).nullable(),
  precipMm: z.number().min(0),
  tempC: z.number(),
  windKmh: z.number().min(0),
  /** Most severe WMO weather code during the session. */
  code: z.number().int(),
});
export type SessionForecast = z.infer<typeof SessionForecastSchema>;

export const ForecastSnapshotSchema = z.object({
  fetchedAt: IsoDate,
  sessions: z.partialRecord(SessionTypeSchema, SessionForecastSchema),
});
export type ForecastSnapshot = z.infer<typeof ForecastSnapshotSchema>;

export const ForecastFileSchema = z.object({
  snapshots: z.array(ForecastSnapshotSchema),
});
export type ForecastFile = z.infer<typeof ForecastFileSchema>;

/* ---------- Measured session data (OpenF1) ---------- */

/** Columnar weather timeline; `t` is seconds since the session start. */
export const WeatherTimelineSchema = z.object({
  t: z.array(z.number()),
  air: z.array(z.number().nullable()),
  track: z.array(z.number().nullable()),
  humidity: z.array(z.number().nullable()),
  rain: z.array(z.union([z.literal(0), z.literal(1)])),
  windKmh: z.array(z.number().nullable()),
});
export type WeatherTimeline = z.infer<typeof WeatherTimelineSchema>;

export const WeatherSummarySchema = z.object({
  rained: z.boolean(),
  rainMinutes: z.number(),
  airAvg: z.number().nullable(),
  trackAvg: z.number().nullable(),
  trackMax: z.number().nullable(),
  humidityAvg: z.number().nullable(),
  windMaxKmh: z.number().nullable(),
});
export type WeatherSummary = z.infer<typeof WeatherSummarySchema>;

export const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET', 'UNKNOWN'] as const;
export const CompoundSchema = z.enum(COMPOUNDS);
export type Compound = z.infer<typeof CompoundSchema>;

export const StrategySchema = z.object({
  totalLaps: z.number().int(),
  /** Ordered by finishing position; unclassified drivers last. */
  drivers: z.array(
    z.object({
      number: z.number().int(),
      acronym: z.string(),
      name: z.string(),
      team: z.string(),
      colour: z.string(),
      position: z.number().int().nullable(),
      status: z.enum(['finished', 'dnf', 'dns', 'dsq']),
    }),
  ),
  stints: z.array(
    z.object({
      driver: z.number().int(),
      lapStart: z.number().int(),
      lapEnd: z.number().int(),
      compound: CompoundSchema,
    }),
  ),
});
export type Strategy = z.infer<typeof StrategySchema>;

export const SessionActualSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    sessionKey: z.number().int(),
    start: IsoDate,
    end: IsoDate,
    weather: WeatherTimelineSchema,
    summary: WeatherSummarySchema,
    strategy: StrategySchema.nullable(),
  }),
  z.object({
    status: z.literal('unavailable'),
    attempts: z.number().int(),
    lastAttempt: IsoDate,
  }),
]);
export type SessionActual = z.infer<typeof SessionActualSchema>;

export const ActualsFileSchema = z.object({
  sessions: z.partialRecord(SessionTypeSchema, SessionActualSchema),
});
export type ActualsFile = z.infer<typeof ActualsFileSchema>;

/* ---------- Wet-race history ---------- */

export const HistoryRaceSchema = z.object({
  season: z.number().int(),
  round: z.number().int(),
  raceName: z.string(),
  circuitId: z.string(),
  /** UTC race start; when Jolpica has no time, 14:00 local is assumed. */
  start: IsoDate,
  startAssumed: z.boolean(),
  /** Open-Meteo reanalysis precipitation in the race window (see MODEL_RULE); null until fetched. */
  modelledPrecipMm: z.number().nullable(),
});
export type HistoryRace = z.infer<typeof HistoryRaceSchema>;

export const HistoryFileSchema = z.object({
  /** Rule used for modelledPrecipMm; values are recomputed when it changes. */
  modelRule: z.string().default(''),
  /** Seasons whose race list is complete in `races`. */
  seasons: z.array(z.number().int()),
  circuits: z.record(
    z.string(),
    z.object({ name: z.string(), locality: z.string(), country: z.string(), lat: z.number(), lon: z.number() }),
  ),
  races: z.array(HistoryRaceSchema),
});
export type HistoryFile = z.infer<typeof HistoryFileSchema>;

/* ---------- Standings (Jolpica) ---------- */

export const StandingsSchema = z.object({
  season: z.number().int(),
  round: z.number().int(),
  drivers: z.array(
    z.object({
      position: z.number().int(),
      points: z.number(),
      wins: z.number().int(),
      code: z.string(),
      name: z.string(),
      team: z.string(),
    }),
  ),
  constructors: z.array(
    z.object({
      position: z.number().int(),
      points: z.number(),
      wins: z.number().int(),
      name: z.string(),
    }),
  ),
});
export type Standings = z.infer<typeof StandingsSchema>;

/* ---------- Meta ---------- */

export const SiteStateSchema = z.object({
  mode: z.enum(['race', 'offseason']),
  featured: z.object({ season: z.number(), round: z.number() }).nullable(),
  radarActive: z.boolean(),
});
export type SiteState = z.infer<typeof SiteStateSchema>;

export const MetaSchema = z.object({
  lastDailySync: IsoDate.nullable(),
  seasons: z.array(z.number().int()),
  siteState: SiteStateSchema.nullable(),
});
export type Meta = z.infer<typeof MetaSchema>;
