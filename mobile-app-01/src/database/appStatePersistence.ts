// Pure persistence logic for app-level state: SQL text, bind parameters, row
// mapping. No database driver is imported here, so the exact statements can be
// executed against a real SQLite engine in Node (`node:sqlite`).
//
// ONE table (`app_state`) holds both onboarding completion and Discovery Mode
// state. They are single-row facts about the app itself (not user content), so
// a second table would add surface area without adding anything. The row uses
// a fixed key so it is unique; values are JSON-encoded typed payloads.
//
// PRIVACY: this table stores only flags and timestamps — no personal
// information, no user content, no screen frames, no telemetry identifiers.
//
// `appStateRepository.ts` is the thin expo-sqlite binding.

export const APP_STATE_TABLE = 'app_state';

export const APP_STATE_COLUMNS = ['key', 'value', 'updated_at'] as const;

const COLUMN_LIST = APP_STATE_COLUMNS.join(', ');
const COLUMN_PLACEHOLDERS = APP_STATE_COLUMNS.map(() => '?').join(', ');

export const CREATE_APP_STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${APP_STATE_TABLE} (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

export const SELECT_APP_STATE_SQL = `SELECT value FROM ${APP_STATE_TABLE} WHERE key = ?`;
export const UPSERT_APP_STATE_SQL = `INSERT INTO ${APP_STATE_TABLE} (${COLUMN_LIST}) VALUES (${COLUMN_PLACEHOLDERS})
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

/** Fixed row key for onboarding completion. */
export const ONBOARDING_STATE_KEY = 'onboarding';
/** Fixed row key for Discovery Mode state. */
export const DISCOVERY_MODE_STATE_KEY = 'discovery_mode';

/** Onboarding state: a single completion fact. */
export interface OnboardingState {
  completed: boolean;
  /** Epoch ms of completion; absent until completed. */
  completedAt?: number;
}

/** Discovery Mode state: an on/off fact with its start time. */
export interface DiscoveryModeState {
  enabled: boolean;
  /** Epoch ms of when Discovery Mode was (re)started. */
  startedAt: number;
  /** Epoch ms of when it was switched off, if it ever was. */
  stoppedAt?: number;
}

/** Bind values for the statements above. */
export type AppStateBindValue = string | number | null;

/** Row shape as stored in SQLite. */
export interface AppStateRow {
  value: string;
}

/**
 * Parses a stored JSON payload into a typed state. Returns null when the row
 * is absent. Throws when the payload is malformed: a corrupted row must
 * surface, not silently reset (callers decide how to fail safely).
 */
export function parseAppState<T>(row: AppStateRow | null | undefined): T | null {
  if (!row || typeof row.value !== 'string') return null;
  return JSON.parse(row.value) as T;
}

/** Serializes a state object to its JSON payload. */
export function serializeAppState<T>(state: T): string {
  return JSON.stringify(state);
}

/** Bind values for `UPSERT_APP_STATE_SQL`. */
export function upsertAppStateParams(key: string, value: string, updatedAtIso: string): AppStateBindValue[] {
  return [key, value, updatedAtIso];
}

/** Bind values for `SELECT_APP_STATE_SQL`. */
export function selectAppStateParams(key: string): AppStateBindValue[] {
  return [key];
}

/** Parses the stored onboarding payload with shape validation. */
export function parseOnboardingState(row: AppStateRow | null | undefined): OnboardingState | null {
  const parsed = parseAppState<OnboardingState>(row);
  if (parsed === null) return null;
  if (typeof parsed.completed !== 'boolean') {
    throw new Error('Stored onboarding state has an invalid shape.');
  }
  return parsed;
}

/** Parses the stored Discovery Mode payload with shape validation. */
export function parseDiscoveryModeState(row: AppStateRow | null | undefined): DiscoveryModeState | null {
  const parsed = parseAppState<DiscoveryModeState>(row);
  if (parsed === null) return null;
  if (typeof parsed.enabled !== 'boolean' || typeof parsed.startedAt !== 'number') {
    throw new Error('Stored Discovery Mode state has an invalid shape.');
  }
  return parsed;
}
