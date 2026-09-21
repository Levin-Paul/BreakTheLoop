// Thin expo-sqlite binding for check-ins, layered on the existing `db` handle.
//
// All SQL text and row mapping lives in `checkInPersistence.ts` (driver-free, so
// it can be executed against a real SQLite engine in tests). This file only runs
// those statements and converts driver failures into result objects.
//
// Privacy: the only values written here are the ones the user explicitly entered
// on the Check-In screen.
import {
  COUNT_CHECK_INS_SQL,
  INSERT_CHECK_IN_SQL,
  SELECT_RECENT_CHECK_INS_SQL,
  insertCheckInParams,
  rowToCheckIn,
  selectRecentCheckInParams,
  type CheckInRow,
} from './checkInPersistence';
import { requireDatabase, type CountResult, type PersistenceResult } from './schema';
import type { CheckIn } from '../screens/checkInModel';
import db from './db';

export type { CountResult, PersistenceResult } from './schema';

/** Outcome of reading check-ins back. */
export interface CheckInLoadResult {
  ok: boolean;
  checkIns: CheckIn[];
  error?: string;
}

/**
 * Writes a check-in. Returns `{ ok: false, error }` instead of throwing, so a
 * device without the native SQLite module shows an honest "not saved" message
 * rather than crashing or pretending to have saved.
 */
export function saveCheckIn(checkIn: CheckIn): PersistenceResult {
  try {
    requireDatabase();
    db.runSync(INSERT_CHECK_IN_SQL, insertCheckInParams(checkIn));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads the most recent check-ins, newest first. */
export function loadRecentCheckIns(limit = 5): CheckInLoadResult {
  try {
    requireDatabase();
    const rows = db.getAllSync<CheckInRow>(
      SELECT_RECENT_CHECK_INS_SQL,
      selectRecentCheckInParams(limit),
    );
    return { ok: true, checkIns: rows.map(rowToCheckIn) };
  } catch (error) {
    return {
      ok: false,
      checkIns: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Number of stored check-ins. */
export function countCheckIns(): CountResult {
  try {
    requireDatabase();
    const row = db.getFirstSync<{ count: number }>(COUNT_CHECK_INS_SQL, []);
    return { ok: true, count: row?.count ?? 0 };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
