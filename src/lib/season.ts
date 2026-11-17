import { getSchedule, wetVerdict } from './data.ts';
import { weekendEnd } from './weekend.ts';

export interface SeasonRainSummary {
  completed: number;
  /** Races with a verdict (measured or modelled). */
  judged: number;
  wet: number;
  wetRaces: string[];
}

export function seasonRainSummary(season: number, now: number): SeasonRainSummary {
  const races = (getSchedule(season)?.races ?? []).filter((r) => weekendEnd(r) <= now);
  const verdicts = races.map((r) => ({ race: r, verdict: wetVerdict(r) })).filter((v) => v.verdict !== null);
  const wet = verdicts.filter((v) => v.verdict!.wet);
  return {
    completed: races.length,
    judged: verdicts.length,
    wet: wet.length,
    wetRaces: wet.map((v) => v.race.raceName),
  };
}
