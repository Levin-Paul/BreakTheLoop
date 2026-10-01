// Pure persistence logic for relapse records: SQL text, bind parameters, row
// mapping. No database driver is imported here, so the exact statements the
// shipping repository runs can be executed against a real SQLite engine in
// Node (`node:sqlite`) — the same pattern as urge/check-in/signal persistence.
//
// Privacy: this table stores ONLY the minimum structured recovery data the
// user explicitly entered on the relapse screens — a timestamp, a structured
// environment key, a trigger-noticed flag, and an optional bounded note the
// user chose to write. Nothing is inferred, captured, or required. The note is
// optional and never parsed for content anywhere in the codebase.
//
// `relapseRepository.ts` is the thin expo-sqlite binding.
import type { RelapseEnvironment, RelapseRecord } from '../screens/relapseModel';
import { isRelapseEnvironment } from '../screens/relapseModel';

export const RELAPSE_EVENTS_TABLE = 'relapse_events';

/**
 * Column order is shared by every statement below, so the insert parameters and
 * the select projection can never drift apart.
 */
export const RELAPSE_EVENT_COLUMNS = [
  'id',
  'created_at',
  'environment',
  'trigger_noticed',
  'note',
  'check_in_at',
  'check_in_mood',
  'check_in_stress',
  'check_in_urge',
] as const;

const COLUMN_LIST = RELAPSE_EVENT_COLUMNS.join(', ');
const COLUMN_PLACEHOLDERS = RELAPSE_EVENT_COLUMNS.map(() => '?').join(', ');

export const CREATE_RELAPSE_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${RELAPSE_EVENTS_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  environment TEXT NOT NULL,
  trigger_noticed INTEGER NOT NULL,
  note TEXT NOT NULL,
  check_in_at TEXT,
  check_in_mood INTEGER,
  check_in_stress INTEGER,
  check_in_urge INTEGER
);`;

export const INSERT_RELAPSE_EVENT_SQL = `INSERT INTO ${RELAPSE_EVENTS_TABLE} (${COLUMN_LIST}) VALUES (${COLUMN_PLACEHOLDERS})`;

/**
 * The post-lapse check-in updates the SAME row (keyed by id), so completing
 * the check-in can never create a second relapse record.
 */
export const UPDATE_RELAPSE_CHECK_IN_SQL = `UPDATE ${RELAPSE_EVENTS_TABLE}
   SET check_in_at = ?, check_in_mood = ?, check_in_stress = ?, check_in_urge = ?
   WHERE id = ?`;

export const SELECT_RECENT_RELAPSE_EVENTS_SQL = `SELECT ${COLUMN_LIST} FROM ${RELAPSE_EVENTS_TABLE}
   ORDER BY created_at DESC
   LIMIT ?`;

export const COUNT_RELAPSE_EVENTS_SQL = `SELECT COUNT(*) AS count FROM ${RELAPSE_EVENTS_TABLE}`;

/** Row shape as stored in SQLite (snake_case, booleans as 0/1). */
export interface RelapseEventRow {
  id: string;
  created_at: string;
  environment: string;
  trigger_noticed: number;
  note: string;
  check_in_at: string | null;
  check_in_mood: number | null;
  check_in_stress: number | null;
  check_in_urge: number | null;
}

/** Bind values for the statements above. */
export type RelapseBindValue = string | number | null;

/** Bind values for `INSERT_RELAPSE_EVENT_SQL`, in column order. */
export function insertRelapseParams(record: RelapseRecord): RelapseBindValue[] {
  return [
    record.id,
    record.createdAt,
    record.environment,
    record.triggerNoticed ? 1 : 0,
    record.note,
    record.checkInAt,
    record.checkInMood,
    record.checkInStress,
    record.checkInUrge,
  ];
}

/** Bind values for `UPDATE_RELAPSE_CHECK_IN_SQL`, in placeholder order. */
export function updateRelapseCheckInParams(record: RelapseRecord): RelapseBindValue[] {
  return [record.checkInAt, record.checkInMood, record.checkInStress, record.checkInUrge, record.id];
}

/** Bind values for `SELECT_RECENT_RELAPSE_EVENTS_SQL`. */
export function selectRecentRelapseParams(limit: number): RelapseBindValue[] {
  return [limit];
}

/**
 * Maps a stored row back to the domain object. The stored environment is
 * narrowed to the known set: rows are only ever written from the validated
 * form value, so an out-of-set key in the table would mean the database was
 * modified outside the app — which must surface, not pass silently.
 */
export function rowToRelapseRecord(row: RelapseEventRow): RelapseRecord {
  if (!isRelapseEnvironment(row.environment)) {
    throw new Error(
      `Stored relapse has an unknown environment "${row.environment}"; database was modified outside the app.`,
    );
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    environment: row.environment,
    triggerNoticed: row.trigger_noticed !== 0,
    note: row.note,
    checkInAt: row.check_in_at,
    checkInMood: row.check_in_mood,
    checkInStress: row.check_in_stress,
    checkInUrge: row.check_in_urge,
  };
}
