// Thin expo-sqlite binding for app-level state (onboarding + Discovery Mode),
// layered on the existing `db` handle. All SQL text and parsing lives in
// `appStatePersistence.ts` (driver-free, testable in Node).
//
// Every function converts driver failures into result objects instead of
// throwing, so App boot can fail safely: an unreadable state never corrupts the
// database and never silently skips onboarding logic.
//
// Privacy: this repository moves only flags and timestamps.
import db from './db';
import {
  CREATE_APP_STATE_TABLE_SQL,
  DISCOVERY_MODE_STATE_KEY,
  ONBOARDING_STATE_KEY,
  SELECT_APP_STATE_SQL,
  UPSERT_APP_STATE_SQL,
  parseDiscoveryModeState,
  parseOnboardingState,
  selectAppStateParams,
  serializeAppState,
  upsertAppStateParams,
  type AppStateRow,
  type DiscoveryModeState,
  type OnboardingState,
} from './appStatePersistence';
import { requireDatabase, type PersistenceResult } from './schema';

export type { PersistenceResult } from './schema';

/** Outcome of reading a state value. `state` is null when never written. */
export interface AppStateLoadResult<T> {
  ok: boolean;
  state: T | null;
  error?: string;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadState<T>(
  key: string,
  parse: (row: AppStateRow | null | undefined) => T | null,
): AppStateLoadResult<T> {
  try {
    requireDatabase();
    const row = db.getFirstSync<AppStateRow>(SELECT_APP_STATE_SQL, selectAppStateParams(key));
    return { ok: true, state: parse(row) };
  } catch (error) {
    return { ok: false, state: null, error: toMessage(error) };
  }
}

function saveState<T>(key: string, state: T): PersistenceResult {
  try {
    requireDatabase();
    db.runSync(
      UPSERT_APP_STATE_SQL,
      upsertAppStateParams(key, serializeAppState(state), new Date().toISOString()),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Reads onboarding completion. `state` is null on a fresh install. */
export function loadOnboardingState(): AppStateLoadResult<OnboardingState> {
  return loadState(ONBOARDING_STATE_KEY, parseOnboardingState);
}

/** Persists onboarding completion (idempotent; overwrites the single row). */
export function saveOnboardingState(state: OnboardingState): PersistenceResult {
  return saveState(ONBOARDING_STATE_KEY, state);
}

/** Reads Discovery Mode state. `state` is null before it is ever started. */
export function loadDiscoveryModeState(): AppStateLoadResult<DiscoveryModeState> {
  return loadState(DISCOVERY_MODE_STATE_KEY, parseDiscoveryModeState);
}

/** Persists Discovery Mode state (idempotent; overwrites the single row). */
export function saveDiscoveryModeState(state: DiscoveryModeState): PersistenceResult {
  return saveState(DISCOVERY_MODE_STATE_KEY, state);
}
