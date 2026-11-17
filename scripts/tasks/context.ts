export interface SyncContext {
  now: number;
  force: boolean;
  /** Remove per-run request budgets (for local backfills). */
  backfill: boolean;
  log: (...args: unknown[]) => void;
  /** Non-fatal problems; the run exits non-zero at the end so the failure alert can fire. */
  errors: unknown[];
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
