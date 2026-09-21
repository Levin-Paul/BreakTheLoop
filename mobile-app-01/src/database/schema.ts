// Single entry point for local database setup.
//
// `initializeDatabase()` creates every table the app uses and is safe to call
// repeatedly. Every repository calls `requireDatabase()` before touching a
// table, so no query can run against a database that was never initialized.
import { CHECK_INS_TABLE } from './checkInPersistence';
import db from './db';
import { initializeTableStatements } from './schemaStatements';
import { URGE_EVENTS_TABLE } from './urgePersistence';

/** Result of setting up the local database. */
export interface DatabaseInitResult {
  ok: boolean;
  error?: string;
}

/** Outcome of a write. */
export interface PersistenceResult {
  ok: boolean;
  error?: string;
}

/** Outcome of a `COUNT(*)` query. */
export interface CountResult {
  ok: boolean;
  count: number;
  error?: string;
}

let initialized = false;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function columnNames(table: string): string[] {
  return db
    .getAllSync<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table])
    .map((row) => row.name);
}

/**
 * Creates the `check_ins` and `urge_events` tables.
 *
 * Older development builds created `urge_events` with different column names, and
 * `CREATE TABLE IF NOT EXISTS` would leave that shape in place, so any required
 * column renames are applied too. A failed setup is not cached: the next call
 * retries.
 */
export function initializeDatabase(): DatabaseInitResult {
  if (initialized) return { ok: true };
  try {
    for (const statement of initializeTableStatements(columnNames(URGE_EVENTS_TABLE))) {
      db.execSync(statement);
    }
    initialized = true;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Tables this app stores data in. */
export const LOCAL_TABLES = [CHECK_INS_TABLE, URGE_EVENTS_TABLE] as const;

/**
 * Called by every repository before it runs a statement. Throws when the
 * database is unavailable, which the repositories convert into a result object.
 */
export function requireDatabase(): void {
  const result = initializeDatabase();
  if (!result.ok) {
    throw new Error(result.error ?? 'SQLite is unavailable');
  }
}
