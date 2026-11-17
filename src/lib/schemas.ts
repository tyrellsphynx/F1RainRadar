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
