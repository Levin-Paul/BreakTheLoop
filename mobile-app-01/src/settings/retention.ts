// Data retention policy for AUTOMATED monitoring-derived signal records.
//
// WHY A RETENTION WINDOW EXISTS
// -----------------------------
// `ml_signal_events` grows by one row per automated ML signal observation. Its
// only consumer is the Pattern Engine's per-label summaries, which read a
// bounded recent window (PATTERN_HISTORY_LIMIT = 200 rows). Rows older than the
// retention window can therefore never contribute to anything the user sees,
// so keeping them forever would be indefinite accumulation without benefit.
//
// SCOPE
// -----
// Pruning touches ONLY `ml_signal_events` — the automated monitoring-derived
// table. User-authored recovery history (check_ins, urge_events) is NEVER
// auto-deleted; it belongs to the user and is removed only by the explicit
// "Delete all recovery data" action.
//
// The window (default 30 days) is a stored setting (`signalRetentionDays`), so
// the policy is visible and easy to change later without code archaeology.
//
// This module is driver-free AND database-free: the prune operation is INJECTED
// by the caller (the app passes `pruneOldMlSignals` from the repository), so
// the policy logic runs unchanged in Node tests.
import { retentionCutoffIso } from '../database/settingsPersistence';

/** The retention policy as shown in Settings/docs. */
export interface RetentionPolicy {
  /** Retention window for automated signal records, in days. */
  signalRetentionDays: number;
}

/** The prune operation the caller injects (see settingsRepository.pruneOldMlSignals). */
export type SignalPruner = (
  nowMs: number,
  days: number,
) => { ok: boolean; deletedRows?: number; error?: string };

/** Applies the retention policy and returns what actually happened. */
export interface RetentionResult {
  ok: boolean;
  /** Rows removed (when the prune succeeded). */
  deletedRows?: number;
  /** Present when the prune failed; boot is never blocked by a prune failure. */
  error?: string;
}

/** Validates a retention window: a whole number of days, at least 1. */
export function isValidRetentionDays(days: number): boolean {
  return Number.isFinite(days) && days >= 1;
}

/**
 * Runs the retention prune for automated signal records.
 *
 * `nowMs` is injected so the policy is deterministic and testable; so is the
 * prune operation itself. A failure here is reported, not thrown: retention is
 * housekeeping and must never block the app from starting.
 */
export function applySignalRetention(
  nowMs: number,
  policy: RetentionPolicy,
  prune: SignalPruner,
): RetentionResult {
  const days = policy.signalRetentionDays;
  if (!isValidRetentionDays(days)) {
    return { ok: false, error: 'Invalid retention window.' };
  }
  const cutoff = retentionCutoffIso(nowMs, days);
  if (Number.isNaN(Date.parse(cutoff))) {
    return { ok: false, error: 'Invalid retention cutoff.' };
  }
  const result = prune(nowMs, days);
  return result.ok ? { ok: true, deletedRows: result.deletedRows } : { ok: false, error: result.error };
}
