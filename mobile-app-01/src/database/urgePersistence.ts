// Pure persistence logic for urge episodes: the SQL text, the bind parameters,
// and the row <-> object mapping.
//
// This module deliberately imports no database driver, so the exact statements
// that ship can be executed against a real SQLite engine in Node (`node:sqlite`)
// without the Expo native module. `urgeRepository.ts` is the thin binding that
// runs them through expo-sqlite.
//
// `import type` is erased at compile time, so this file has no runtime
// dependency on the screens layer either.
import type { UrgeEffectiveness, UrgeEvent } from '../screens/urgeModel';

export const URGE_EVENTS_TABLE = 'urge_events';

/**
 * Column order is shared by every statement below, so the insert parameters and
 * the select projection can never drift apart.
 *
 * The post-intervention value lives in `intensity_after` on the *same* row as the
 * capture, so a recheck updates the episode instead of inserting a new one.
 */
export const URGE_EVENT_COLUMNS = [
  'id',
  'created_at',
  'intensity_before',
  'trigger',
  'context',
  'state',
  'score',
  'intervention',
  'intensity_after',
  'effectiveness',
  'outcome_at',
] as const;

const COLUMN_LIST = URGE_EVENT_COLUMNS.join(', ');
const COLUMN_PLACEHOLDERS = URGE_EVENT_COLUMNS.map(() => '?').join(', ');

export const CREATE_URGE_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${URGE_EVENTS_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  intensity_before INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  context TEXT NOT NULL,
  state TEXT NOT NULL,
  score INTEGER NOT NULL,
  intervention TEXT NOT NULL,
  intensity_after INTEGER,
  effectiveness TEXT,
  outcome_at TEXT
);`;

export const INSERT_URGE_EVENT_SQL = `INSERT INTO ${URGE_EVENTS_TABLE} (${COLUMN_LIST}) VALUES (${COLUMN_PLACEHOLDERS})`;

export const UPDATE_URGE_OUTCOME_SQL = `UPDATE ${URGE_EVENTS_TABLE}
   SET intensity_after = ?, effectiveness = ?, outcome_at = ?
   WHERE id = ?`;

export const SELECT_RECENT_URGE_EVENTS_SQL = `SELECT ${COLUMN_LIST} FROM ${URGE_EVENTS_TABLE}
   ORDER BY created_at DESC
   LIMIT ?`;

export const COUNT_URGES_SQL = `SELECT COUNT(*) AS count FROM ${URGE_EVENTS_TABLE}`;

/** Urges that were carried through a recheck, i.e. an intervention was completed. */
export const COUNT_COMPLETED_INTERVENTIONS_SQL = `SELECT COUNT(*) AS count FROM ${URGE_EVENTS_TABLE}
   WHERE intensity_after IS NOT NULL`;

/**
 * Earlier column names (from the first version of this table) mapped onto the
 * current ones. A development build that already created the old shape would
 * otherwise fail every insert with "no such column".
 */
export const URGE_EVENT_COLUMN_RENAMES = [
  { from: 'intensity', to: 'intensity_before' },
  { from: 'feeling', to: 'trigger' },
  { from: 'after_intensity', to: 'intensity_after' },
] as const;

/** Row shape as stored in SQLite (snake_case). */
export interface UrgeEventRow {
  id: string;
  created_at: string;
  intensity_before: number;
  trigger: string;
  context: string;
  state: string;
  score: number;
  intervention: string;
  intensity_after: number | null;
  effectiveness: string | null;
  outcome_at: string | null;
}

/** Bind values for the statements above. */
export type UrgeBindValue = string | number | null;

/**
 * Statements needed to bring a pre-existing table up to the current shape.
 * Pass the column names reported by `pragma_table_info`. Only renames that are
 * actually required are returned, so this is safe to run on every start.
 */
export function urgeEventRenameStatements(existingColumns: readonly string[]): string[] {
  const present = new Set(existingColumns);
  return URGE_EVENT_COLUMN_RENAMES.filter(
    (rename) => present.has(rename.from) && !present.has(rename.to),
  ).map(
    (rename) =>
      `ALTER TABLE ${URGE_EVENTS_TABLE} RENAME COLUMN ${rename.from} TO ${rename.to};`,
  );
}

/** Bind values for `INSERT_URGE_EVENT_SQL`, in column order. */
export function insertUrgeParams(event: UrgeEvent): UrgeBindValue[] {
  return [
    event.id,
    event.createdAt,
    event.intensity,
    event.feeling,
    event.context,
    event.state,
    event.score,
    event.intervention,
    event.afterIntensity,
    event.effectiveness,
    event.outcomeAt,
  ];
}

/** Bind values for `UPDATE_URGE_OUTCOME_SQL`, in placeholder order. */
export function updateUrgeOutcomeParams(event: UrgeEvent): UrgeBindValue[] {
  return [event.afterIntensity, event.effectiveness, event.outcomeAt, event.id];
}

/** Bind values for `SELECT_RECENT_URGE_EVENTS_SQL`. */
export function selectRecentUrgeParams(limit: number): UrgeBindValue[] {
  return [limit];
}

/** Maps a stored row back to the domain object. */
export function rowToUrgeEvent(row: UrgeEventRow): UrgeEvent {
  return {
    id: row.id,
    createdAt: row.created_at,
    intensity: row.intensity_before,
    context: row.context,
    feeling: row.trigger,
    state: row.state as UrgeEvent['state'],
    score: row.score,
    intervention: row.intervention,
    afterIntensity: row.intensity_after,
    effectiveness: row.effectiveness as UrgeEffectiveness | null,
    outcomeAt: row.outcome_at,
  };
}
