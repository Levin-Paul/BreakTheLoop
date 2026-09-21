// Pure persistence logic for check-ins: SQL text, bind parameters, row mapping.
//
// Like `urgePersistence.ts`, this module imports no database driver, so the exact
// statements that ship can be executed against a real SQLite engine in Node
// (`node:sqlite`) without the Expo native module. `checkInRepository.ts` is the
// thin binding that runs them through expo-sqlite.
//
// `import type` is erased at compile time, so there is no runtime dependency on
// the screens layer.
import type { CheckIn } from '../screens/checkInModel';

export const CHECK_INS_TABLE = 'check_ins';

/**
 * Column order is shared by every statement below, so the insert parameters and
 * the select projection can never drift apart.
 */
export const CHECK_IN_COLUMNS = [
  'id',
  'created_at',
  'mood',
  'urge',
  'energy',
  'stress',
  'controlled',
] as const;

const COLUMN_LIST = CHECK_IN_COLUMNS.join(', ');
const COLUMN_PLACEHOLDERS = CHECK_IN_COLUMNS.map(() => '?').join(', ');

export const CREATE_CHECK_INS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${CHECK_INS_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  mood INTEGER NOT NULL,
  urge INTEGER NOT NULL,
  energy INTEGER NOT NULL,
  stress INTEGER NOT NULL,
  controlled INTEGER NOT NULL
);`;

export const INSERT_CHECK_IN_SQL = `INSERT INTO ${CHECK_INS_TABLE} (${COLUMN_LIST}) VALUES (${COLUMN_PLACEHOLDERS})`;

export const SELECT_RECENT_CHECK_INS_SQL = `SELECT ${COLUMN_LIST} FROM ${CHECK_INS_TABLE}
   ORDER BY created_at DESC
   LIMIT ?`;

export const COUNT_CHECK_INS_SQL = `SELECT COUNT(*) AS count FROM ${CHECK_INS_TABLE}`;

/** Row shape as stored in SQLite (snake_case, booleans as 0/1). */
export interface CheckInRow {
  id: string;
  created_at: string;
  mood: number;
  urge: number;
  energy: number;
  stress: number;
  controlled: number;
}

/** Bind values for the statements above. */
export type CheckInBindValue = string | number | null;

/** Bind values for `INSERT_CHECK_IN_SQL`, in column order. */
export function insertCheckInParams(checkIn: CheckIn): CheckInBindValue[] {
  return [
    checkIn.id,
    checkIn.createdAt,
    checkIn.mood,
    checkIn.urge,
    checkIn.energy,
    checkIn.stress,
    checkIn.controlled ? 1 : 0,
  ];
}

/** Bind values for `SELECT_RECENT_CHECK_INS_SQL`. */
export function selectRecentCheckInParams(limit: number): CheckInBindValue[] {
  return [limit];
}

/** Maps a stored row back to the domain object. */
export function rowToCheckIn(row: CheckInRow): CheckIn {
  return {
    id: row.id,
    createdAt: row.created_at,
    mood: row.mood,
    urge: row.urge,
    energy: row.energy,
    stress: row.stress,
    controlled: row.controlled !== 0,
  };
}
