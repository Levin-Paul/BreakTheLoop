// Thin expo-sqlite binding for user settings, delete-all-data, retention
// pruning, and data export, layered on the existing `db` handle. All SQL text,
// validation, table lists, and export assembly live in `settingsPersistence.ts`
// (driver-free, testable in Node).
//
// Every function converts driver failures into result objects instead of
// throwing, so a Settings action becomes an honest success/failure rather than
// a crash.
//
// Privacy: settings are flags only; delete-all runs inside one transaction with
// an in-transaction zero-row verification; export reads only user-owned rows.
import db from './db';
import {
  DELETE_OLD_SIGNALS_SQL,
  SETTINGS_STATE_KEY,
  USER_DATA_TABLES,
  assembleExportPayload,
  countAllUserDataStatements,
  deleteAllUserDataStatements,
  deleteOldSignalsParams,
  defaultSettings,
  parseAppSettings,
  retentionCutoffIso,
  type AppSettings,
  type ExportPayload,
  type UserDataTable,
} from './settingsPersistence';
import {
  SELECT_APP_STATE_SQL,
  UPSERT_APP_STATE_SQL,
  selectAppStateParams,
  serializeAppState,
  upsertAppStateParams,
} from './appStatePersistence';
import { rowToCheckIn, type CheckInRow } from './checkInPersistence';
import { rowToUrgeEvent, type UrgeEventRow } from './urgePersistence';
import {
  rowToRelapseRecord,
  type RelapseEventRow,
} from './relapsePersistence';
import { rowToMlSignalObservation, type MlSignalEventRow } from './signalPersistence';
import { requireDatabase, type PersistenceResult } from './schema';

export type { AppSettings, ExportPayload, UserDataTable } from './settingsPersistence';
export { defaultSettings, SETTINGS_SCHEMA_VERSION } from './settingsPersistence';
export type { PersistenceResult } from './schema';

/** Outcome of reading settings. `settings` is null before settings were first saved. */
export interface SettingsLoadResult {
  ok: boolean;
  settings: AppSettings | null;
  error?: string;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the settings row. Returns null when never written (callers apply defaults). */
export function loadSettings(): SettingsLoadResult {
  try {
    requireDatabase();
    const row = db.getFirstSync<{ value: string }>(
      SELECT_APP_STATE_SQL,
      selectAppStateParams(SETTINGS_STATE_KEY),
    );
    return { ok: true, settings: row ? parseStoredSettings(row.value) : null };
  } catch (error) {
    return { ok: false, settings: null, error: toMessage(error) };
  }
}

function parseStoredSettings(value: string): AppSettings | null {
  return parseAppSettings(JSON.parse(value));
}

/** Persists settings (idempotent upsert of the single settings row). */
export function saveSettings(settings: AppSettings): PersistenceResult {
  try {
    requireDatabase();
    db.runSync(
      UPSERT_APP_STATE_SQL,
      upsertAppStateParams(SETTINGS_STATE_KEY, serializeAppState(settings), new Date().toISOString()),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Loads stored settings, falling back to the shipped defaults. */
export function loadSettingsOrDefaults(): AppSettings {
  const loaded = loadSettings();
  return loaded.ok && loaded.settings ? loaded.settings : defaultSettings();
}

/**
 * Effective monitoring kill switch, with product-default semantics: an
 * unreadable or absent settings row means monitoring ENABLED (the default).
 * Manual flows never depend on this value.
 */
export function isMonitoringEnabled(): boolean {
  return loadSettingsOrDefaults().monitoringEnabled;
}

/**
 * Persists the monitoring kill switch and returns the resulting settings, so
 * the caller can render the actual stored state instead of an assumption.
 */
export function setMonitoringEnabled(enabled: boolean): PersistenceResult & { settings: AppSettings } {
  const settings = { ...loadSettingsOrDefaults(), monitoringEnabled: enabled };
  const saved = saveSettings(settings);
  return saved.ok ? { ok: true, settings } : { ok: false, settings: loadSettingsOrDefaults() };
}

/** Delete-all-data outcome. `verification` repeats the in-transaction counts. */
export interface DeleteAllResult extends PersistenceResult {
  deleted?: readonly UserDataTable[];
  verification?: { table: UserDataTable; rows: number }[];
}

/**
 * Deletes ALL user recovery data in one atomic transaction:
 *
 *   BEGIN
 *     DELETE FROM every user-data table (check_ins, urge_events,
 *     ml_signal_events, relapse_events, app_state)
 *     SELECT COUNT(*) per table  <- must all be 0, otherwise ROLLBACK
 *   COMMIT
 *
 * The schema (CREATE TABLE DDL) is never touched: only rows are removed.
 * `app_state` is included, so onboarding + Discovery Mode + settings reset and
 * the app returns to a deterministic fresh-install state (which also means the
 * next launch shows onboarding again — the documented product behavior for
 * "delete all recovery data").
 */
export function deleteAllUserData(): DeleteAllResult {
  try {
    requireDatabase();
    const deletes = deleteAllUserDataStatements();
    const counts = countAllUserDataStatements();
    db.withTransactionSync(() => {
      for (const statement of deletes) {
        db.execSync(statement);
      }
      counts.forEach((statement, index) => {
        const row = db.getFirstSync<{ count: number }>(statement, []);
        const remaining = row?.count ?? -1;
        if (remaining !== 0) {
          throw new Error(`Verification failed: ${USER_DATA_TABLES[index]} still has ${remaining} row(s).`);
        }
      });
    });
    return {
      ok: true,
      deleted: [...USER_DATA_TABLES],
      verification: USER_DATA_TABLES.map((table) => ({ table, rows: 0 })),
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/**
 * Reads every user-owned row for export and assembles the payload. Read-only;
 * no network; no file writes here — the caller decides how to share the
 * serialized payload (the Settings screen uses the platform share sheet, only
 * after the user explicitly taps Export).
 */
export function buildExportPayload(): { ok: boolean; data?: ExportPayload; error?: string } {
  try {
    requireDatabase();
    const checkInRows = db.getAllSync<CheckInRow>(
      'SELECT id, created_at, mood, urge, energy, stress, controlled FROM check_ins ORDER BY created_at ASC',
      [],
    );
    const urgeRows = db.getAllSync<UrgeEventRow>(
      'SELECT id, created_at, intensity_before, trigger, context, state, score, intervention, intensity_after, effectiveness, outcome_at FROM urge_events ORDER BY created_at ASC',
      [],
    );
    const signalRows = db.getAllSync<MlSignalEventRow>(
      'SELECT id, created_at, label, confidence, source, origin_source, model_id, model_version FROM ml_signal_events ORDER BY created_at ASC',
      [],
    );
    const relapseRows = db.getAllSync<RelapseEventRow>(
      'SELECT id, created_at, environment, trigger_noticed, note, check_in_at, check_in_mood, check_in_stress, check_in_urge FROM relapse_events ORDER BY created_at ASC',
      [],
    );
    const settings = loadSettingsOrDefaults();
    return {
      ok: true,
      data: assembleExportPayload({
        exportedAt: new Date().toISOString(),
        settings: {
          monitoringEnabled: settings.monitoringEnabled,
          signalRetentionDays: settings.signalRetentionDays,
        },
        checkIns: checkInRows.map(rowToCheckIn),
        urgeEvents: urgeRows.map(rowToUrgeEvent),
        relapseEvents: relapseRows.map(rowToRelapseRecord),
        mlSignals: signalRows.map(rowToMlSignalObservation),
      }),
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** Prune outcome; `deletedRows` is best-effort (SQLite row count when available). */
export interface PruneResult extends PersistenceResult {
  deletedRows?: number;
}

/**
 * Prunes AUTOMATED monitoring-derived signal records older than the retention
 * window. Never touches user-authored recovery history (check-ins, urges):
 * those belong to the user and are only removed by explicit delete-all.
 */
export function pruneOldMlSignals(nowMs: number, days: number): PruneResult {
  try {
    requireDatabase();
    const result = db.runSync(DELETE_OLD_SIGNALS_SQL, deleteOldSignalsParams(retentionCutoffIso(nowMs, days)));
    return { ok: true, deletedRows: result.changes };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}
