// Thin expo-sqlite binding for urge episodes, layered on the existing `db` handle.
//
// All SQL text and row mapping lives in `urgePersistence.ts` (driver-free, so it
// can be executed against a real SQLite engine in tests). This file only runs
// those statements and converts driver failures into result objects.
//
// Privacy: the only values written here are the ones the user explicitly entered
// in the Urge flow. Nothing else is read from the device.
import { requireDatabase, type CountResult, type PersistenceResult } from './schema';
import {
  COUNT_COMPLETED_INTERVENTIONS_SQL,
  COUNT_URGES_SQL,
  INSERT_URGE_EVENT_SQL,
  SELECT_RECENT_URGE_EVENTS_SQL,
  UPDATE_URGE_OUTCOME_SQL,
  insertUrgeParams,
  rowToUrgeEvent,
  selectRecentUrgeParams,
  updateUrgeOutcomeParams,
  type UrgeEventRow,
} from './urgePersistence';
import type { UrgeEvent } from '../screens/urgeModel';
import db from './db';

export { URGE_EVENTS_TABLE } from './urgePersistence';
export type { CountResult, PersistenceResult } from './schema';

/** Outcome of reading urge episodes back. */
export interface LoadResult {
  ok: boolean;
  events: UrgeEvent[];
  error?: string;
}

/**
 * Writes the initial urge capture. Returns `{ ok: false, error }` instead of
 * throwing, so a device without the native SQLite module shows an honest
 * "not saved" message rather than crashing or pretending to have saved.
 */
export function saveUrgeEvent(event: UrgeEvent): PersistenceResult {
  try {
    requireDatabase();
    db.runSync(INSERT_URGE_EVENT_SQL, insertUrgeParams(event));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Writes the after-intervention intensity and its classification onto the
 * existing episode, keyed by id — the recheck never inserts a second row.
 */
export function saveUrgeOutcome(event: UrgeEvent): PersistenceResult {
  try {
    requireDatabase();
    const result = db.runSync(UPDATE_URGE_OUTCOME_SQL, updateUrgeOutcomeParams(event));
    if (result.changes === 0) {
      return { ok: false, error: `No stored urge matched id ${event.id}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads the most recent urge episodes, newest first, used for recent signals. */
export function loadRecentUrgeEvents(limit = 10): LoadResult {
  try {
    requireDatabase();
    const rows = db.getAllSync<UrgeEventRow>(
      SELECT_RECENT_URGE_EVENTS_SQL,
      selectRecentUrgeParams(limit),
    );
    return { ok: true, events: rows.map(rowToUrgeEvent) };
  } catch (error) {
    return {
      ok: false,
      events: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Number of stored urge episodes. */
export function countUrges(): CountResult {
  try {
    requireDatabase();
    const row = db.getFirstSync<{ count: number }>(COUNT_URGES_SQL, []);
    return { ok: true, count: row?.count ?? 0 };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Number of urge episodes carried through a recheck, i.e. interventions completed. */
export function countCompletedInterventions(): CountResult {
  try {
    requireDatabase();
    const row = db.getFirstSync<{ count: number }>(COUNT_COMPLETED_INTERVENTIONS_SQL, []);
    return { ok: true, count: row?.count ?? 0 };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
