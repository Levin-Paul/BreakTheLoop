// The statement list used to set up the local database, kept free of any
// database driver so `initializeDatabase()`'s exact sequence can be executed
// against a real SQLite engine in Node (`node:sqlite`).
import { CREATE_CHECK_INS_TABLE_SQL } from './checkInPersistence';
import { CREATE_URGE_EVENTS_TABLE_SQL, urgeEventRenameStatements } from './urgePersistence';

/** Statements that create every table. Safe to run repeatedly. */
export function createTableStatements(): string[] {
  return [CREATE_CHECK_INS_TABLE_SQL, CREATE_URGE_EVENTS_TABLE_SQL];
}

/**
 * The full initialization sequence, in order: create the tables first (so a
 * fresh install needs no renames), then apply any column renames required by a
 * database created by an earlier build.
 *
 * @param existingUrgeColumns column names reported for `urge_events`
 */
export function initializeTableStatements(existingUrgeColumns: readonly string[]): string[] {
  return [...createTableStatements(), ...urgeEventRenameStatements(existingUrgeColumns)];
}
