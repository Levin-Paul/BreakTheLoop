// Pure persistence logic for ML signal observations: SQL text, bind parameters,
// row mapping. No database driver is imported here, so the exact statements can
// be executed against a real SQLite engine in Node (`node:sqlite`).
//
// This table stores ONLY the observation record: that the local model produced
// a signal for user-provided text at a point in time, with which model version.
// The user's text itself is NOT stored here — it already lives in the urge /
// check-in tables, exactly where the user typed it. Keeping the text out of
// this table means an ML signal can never be replayed or re-associated with
// content beyond what the user explicitly saved.
//
// `signalRepository.ts` is the thin binding that runs these statements through
// expo-sqlite.
import type { MlSignalObservation } from '../engine/patternEngine';
import { isTrainedTriggerLabel } from '../ml/triggerClassifier';

export const ML_SIGNAL_EVENTS_TABLE = 'ml_signal_events';

/**
 * Column order is shared by every statement below, so the insert parameters and
 * the select projection can never drift apart.
 */
export const ML_SIGNAL_EVENT_COLUMNS = [
  'id',
  'created_at',
  'label',
  'confidence',
  'source',
  'origin_source',
  'model_id',
  'model_version',
] as const;

const COLUMN_LIST = ML_SIGNAL_EVENT_COLUMNS.join(', ');
const COLUMN_PLACEHOLDERS = ML_SIGNAL_EVENT_COLUMNS.map(() => '?').join(', ');

export const CREATE_ML_SIGNAL_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${ML_SIGNAL_EVENTS_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  origin_source TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL
);`;

export const INSERT_ML_SIGNAL_EVENT_SQL = `INSERT INTO ${ML_SIGNAL_EVENTS_TABLE} (${COLUMN_LIST}) VALUES (${COLUMN_PLACEHOLDERS})`;

export const SELECT_RECENT_ML_SIGNAL_EVENTS_SQL = `SELECT ${COLUMN_LIST} FROM ${ML_SIGNAL_EVENTS_TABLE}
   ORDER BY created_at DESC
   LIMIT ?`;

export const COUNT_ML_SIGNAL_EVENTS_SQL = `SELECT COUNT(*) AS count FROM ${ML_SIGNAL_EVENTS_TABLE}`;

/** Row shape as stored in SQLite (snake_case). */
export interface MlSignalEventRow {
  id: string;
  created_at: string;
  label: string;
  confidence: number;
  source: string;
  origin_source: string;
  model_id: string;
  model_version: string;
}

/** Bind values for the statements above. */
export type MlSignalBindValue = string | number | null;

/** Bind values for `INSERT_ML_SIGNAL_EVENT_SQL`, in column order. */
export function insertMlSignalParams(event: MlSignalObservation): MlSignalBindValue[] {
  return [
    event.id,
    event.at,
    event.label,
    event.confidence,
    event.source,
    event.originSource,
    event.modelId,
    event.modelVersion,
  ];
}

/** Bind values for `SELECT_RECENT_ML_SIGNAL_EVENTS_SQL`. */
export function selectRecentMlSignalParams(limit: number): MlSignalBindValue[] {
  return [limit];
}

/**
 * Maps a stored row back to the engine-facing observation object. The stored
 * label is narrowed to the trained set: rows are only ever written from the
 * classifier's validated output, so an out-of-set label in the table would mean
 * someone wrote to it outside this module — which must surface, not pass.
 */
export function rowToMlSignalObservation(row: MlSignalEventRow): MlSignalObservation {
  if (!isTrainedTriggerLabel(row.label)) {
    throw new Error(`Stored ML signal has a non-trained label "${row.label}"; database was modified outside the app.`);
  }
  return {
    id: row.id,
    at: row.created_at,
    label: row.label,
    confidence: row.confidence,
    source: 'ml',
    originSource: row.origin_source,
    modelId: row.model_id,
    modelVersion: row.model_version,
  };
}
