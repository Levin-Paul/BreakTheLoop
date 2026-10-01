// Thin expo-sqlite binding for relapse records, layered on the existing `db`
// handle. All SQL text and row mapping lives in `relapsePersistence.ts`
// (driver-free, so it can be executed against a real SQLite engine in Node).
// This file only runs those statements and converts driver failures into
// result objects — the same honest-result pattern every other repository uses.
//
// Privacy: the only values written here are the ones the user explicitly
// entered on the relapse screens. Nothing is inferred or captured.
import { requireDatabase, type CountResult, type PersistenceResult } from './schema';
import {
  COUNT_RELAPSE_EVENTS_SQL,
  INSERT_RELAPSE_EVENT_SQL,
  SELECT_RECENT_RELAPSE_EVENTS_SQL,
  UPDATE_RELAPSE_CHECK_IN_SQL,
  insertRelapseParams,
  rowToRelapseRecord,
  selectRecentRelapseParams,
  updateRelapseCheckInParams,
  type RelapseEventRow,
} from './relapsePersistence';
import type { RelapseRecord } from '../screens/relapseModel';
import db from './db';

export { RELAPSE_EVENTS_TABLE } from './relapsePersistence';
export type { CountResult, PersistenceResult } from './schema';

/** Outcome of reading relapse records back. */
export interface RelapseLoadResult {
  ok: boolean;
  relapses: RelapseRecord[];
  error?: string;
}

/**
 * Writes a newly recorded lapse. Returns `{ ok: false, error }` instead of
 * throwing, so a device without the native SQLite module shows an honest
 * "not saved" message rather than crashing or pretending to have saved.
 */
export function saveRelapseEvent(record: RelapseRecord): PersistenceResult {
  try {
    requireDatabase();
    db.runSync(INSERT_RELAPSE_EVENT_SQL, insertRelapseParams(record));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Attaches the optional post-lapse check-in to the EXISTING row, keyed by id.
 * Mirrors `saveUrgeOutcome`: an update, never a second insert, so a completed
 * check-in can never produce a duplicate relapse record. `changes === 0` is
 * reported as a failure instead of being silently ignored.
 */
export function saveRelapseCheckIn(record: RelapseRecord): PersistenceResult {
  try {
    requireDatabase();
    const result = db.runSync(UPDATE_RELAPSE_CHECK_IN_SQL, updateRelapseCheckInParams(record));
    if (result.changes === 0) {
      return { ok: false, error: `No stored relapse matched id ${record.id}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads the most recent relapse records, newest first. */
export function loadRecentRelapses(limit = 50): RelapseLoadResult {
  try {
    requireDatabase();
    const rows = db.getAllSync<RelapseEventRow>(
      SELECT_RECENT_RELAPSE_EVENTS_SQL,
      selectRecentRelapseParams(limit),
    );
    return { ok: true, relapses: rows.map(rowToRelapseRecord) };
  } catch (error) {
    return {
      ok: false,
      relapses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Number of stored relapse records. */
export function countRelapses(): CountResult {
  try {
    requireDatabase();
    const row = db.getFirstSync<{ count: number }>(COUNT_RELAPSE_EVENTS_SQL, []);
    return { ok: true, count: row?.count ?? 0 };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
