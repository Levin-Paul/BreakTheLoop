// Thin expo-sqlite binding for ML signal observations, layered on the existing
// `db` handle. All SQL text and row mapping lives in `signalPersistence.ts`
// (driver-free, so it can be executed against a real SQLite engine in Node).
//
// Privacy: the ONLY values written here are the classifier's observation
// record — label, confidence, model version, timestamp. The user's text is
// never written to this table.
import { requireDatabase, type CountResult, type PersistenceResult } from './schema';
import {
  COUNT_ML_SIGNAL_EVENTS_SQL,
  CREATE_ML_SIGNAL_EVENTS_TABLE_SQL,
  INSERT_ML_SIGNAL_EVENT_SQL,
  SELECT_RECENT_ML_SIGNAL_EVENTS_SQL,
  insertMlSignalParams,
  rowToMlSignalObservation,
  selectRecentMlSignalParams,
  type MlSignalEventRow,
} from './signalPersistence';
import type { MlSignalObservation } from '../engine/patternEngine';
import db from './db';

export { ML_SIGNAL_EVENTS_TABLE } from './signalPersistence';
export type { CountResult, PersistenceResult } from './schema';

/** Outcome of reading ML signal observations back. */
export interface MlSignalLoadResult {
  ok: boolean;
  events: MlSignalObservation[];
  error?: string;
}

/** Creates the ML signal table. Safe to call repeatedly. */
export function initializeMlSignalTable(): PersistenceResult {
  try {
    requireDatabase();
    db.execSync(CREATE_ML_SIGNAL_EVENTS_TABLE_SQL);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Writes one ML signal observation. Returns `{ ok: false, error }` instead of
 * throwing, so a database problem becomes an honest "not saved" rather than a
 * crash or a fabricated success.
 */
export function saveMlSignalObservation(event: MlSignalObservation): PersistenceResult {
  try {
    requireDatabase();
    db.runSync(INSERT_ML_SIGNAL_EVENT_SQL, insertMlSignalParams(event));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads the most recent ML signal observations, newest first. */
export function loadRecentMlSignals(limit = 200): MlSignalLoadResult {
  try {
    requireDatabase();
    const rows = db.getAllSync<MlSignalEventRow>(
      SELECT_RECENT_ML_SIGNAL_EVENTS_SQL,
      selectRecentMlSignalParams(limit),
    );
    return { ok: true, events: rows.map(rowToMlSignalObservation) };
  } catch (error) {
    return {
      ok: false,
      events: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Number of stored ML signal observations. */
export function countMlSignalObservations(): CountResult {
  try {
    requireDatabase();
    const row = db.getFirstSync<{ count: number }>(COUNT_ML_SIGNAL_EVENTS_SQL, []);
    return { ok: true, count: row?.count ?? 0 };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
