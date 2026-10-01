// Pure persistence logic for user settings: SQL text, bind parameters, payload
// validation, delete-all statements, retention SQL, and export assembly. No
// database driver is imported here, so the exact statements and mappings can be
// executed against a real SQLite engine in Node (`node:sqlite`).
//
// Settings live in the EXISTING `app_state` table as one more single-row fact
// about the app. This reuses the one app-state mechanism (no second settings
// system) and inherits its privacy properties: flags and timestamps only, no
// personal information, no user content.
//
// `settingsRepository.ts` is the thin expo-sqlite binding.
import { APP_STATE_TABLE } from './appStatePersistence';
import { RELAPSE_EVENTS_TABLE } from './relapsePersistence';

// Re-exported so the repository (and callers) have a single import surface for
// everything settings-related.
export {
  SELECT_APP_STATE_SQL,
  UPSERT_APP_STATE_SQL,
  selectAppStateParams,
  serializeAppState,
  upsertAppStateParams,
} from './appStatePersistence';
import type { CheckIn } from '../screens/checkInModel';
import type { UrgeEvent } from '../screens/urgeModel';
import type { RelapseRecord } from '../screens/relapseModel';
import type { MlSignalObservation } from '../engine/patternEngine';

/** Fixed row key for the settings payload. */
export const SETTINGS_STATE_KEY = 'settings';

/** Current shape version of the stored settings payload. */
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * User settings. Every field is a local behavioral flag — nothing here
 * identifies the user or describes their content.
 */
export interface AppSettings {
  /** Shape version of this payload (for forward-compatible migrations). */
  schemaVersion: number;
  /**
   * Kill switch for AUTOMATED recovery monitoring. Default true.
   *
   * When false: automated signal collection, monitoring-derived ML processing,
   * and monitoring-driven interventions stop. Manual check-ins, urges,
   * history, and insights remain fully usable, and stored data is untouched.
   */
  monitoringEnabled: boolean;
  /**
   * Retention window for AUTOMATED monitoring-derived signal records
   * (`ml_signal_events`), in days. User-authored recovery history
   * (check-ins, urges) is never auto-pruned. Explicitly stored here so the
   * policy is visible and changeable rather than hard-coded.
   */
  signalRetentionDays: number;
}

/** The shipped default settings. */
export function defaultSettings(): AppSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    monitoringEnabled: true,
    signalRetentionDays: 30,
  };
}

/**
 * Validates and normalizes a parsed settings payload. Throws on a malformed
 * payload (corruption must surface, never silently reset), and fills any
 * missing field from the defaults so an older payload survives an app update.
 */
export function parseAppSettings(raw: unknown): AppSettings {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Stored settings have an invalid shape.');
  }
  const record = raw as Record<string, unknown>;
  const defaults = defaultSettings();
  const monitoringEnabled = record.monitoringEnabled ?? defaults.monitoringEnabled;
  const signalRetentionDays = record.signalRetentionDays ?? defaults.signalRetentionDays;
  if (typeof monitoringEnabled !== 'boolean') {
    throw new Error('Stored monitoringEnabled is not a boolean.');
  }
  if (
    typeof signalRetentionDays !== 'number' ||
    !Number.isFinite(signalRetentionDays) ||
    signalRetentionDays < 1
  ) {
    throw new Error('Stored signalRetentionDays is not a positive number.');
  }
  const schemaVersion =
    typeof record.schemaVersion === 'number' ? record.schemaVersion : SETTINGS_SCHEMA_VERSION;
  return { schemaVersion, monitoringEnabled, signalRetentionDays };
}

// ---------------------------------------------------------------------------
// Delete-all-data
// ---------------------------------------------------------------------------

/**
 * Data-control SQL. These statements delete USER RECOVERY DATA only. The
 * schema-creating DDL is deliberately not part of this module: deleting data
 * must never touch table definitions.
 *
 * Tables included (current schema — inspected, not guessed):
 *   - `check_ins`          manual check-ins
 *   - `urge_events`        urge episodes incl. the intervention columns
 *   - `ml_signal_events`   automated monitoring-derived signal observations
 *   - `relapse_events`     recorded lapses + post-lapse check-in columns
 *   - `app_state`          onboarding / Discovery Mode / settings flags
 *
 * Tables that DO NOT exist in this schema (and are therefore not listed):
 * journal_entries, interventions, intervention_results, patterns —
 * interventions live as columns on `urge_events`, and patterns are derived
 * from stored events by the Pattern Engine, never stored as rows.
 */
export const USER_DATA_TABLES = [
  'check_ins',
  'urge_events',
  'ml_signal_events',
  RELAPSE_EVENTS_TABLE,
  APP_STATE_TABLE,
] as const;

export type UserDataTable = (typeof USER_DATA_TABLES)[number];

/** One DELETE statement per user-data table, executed inside a transaction. */
export function deleteAllUserDataStatements(): string[] {
  return USER_DATA_TABLES.map((table) => `DELETE FROM ${table};`);
}

/**
 * Verification statement for the delete-all operation: counts remaining rows
 * across every user-data table. After a successful delete-all every count must
 * be 0 — the check runs INSIDE the same transaction, before it commits.
 */
export function countAllUserDataStatements(): string[] {
  return USER_DATA_TABLES.map((table) => `SELECT COUNT(*) AS count FROM ${table}`);
}

// ---------------------------------------------------------------------------
// Retention (automated signal records only)
// ---------------------------------------------------------------------------

/** Retention SQL: prunes automated monitoring-derived signal records only. */
export const DELETE_OLD_SIGNALS_SQL = `DELETE FROM ml_signal_events
   WHERE created_at < ?`;

/** Bind values for `DELETE_OLD_SIGNALS_SQL` (ISO cutoff timestamp). */
export function deleteOldSignalsParams(cutoffIso: string): (string | number | null)[] {
  return [cutoffIso];
}

/** ISO cutoff for a retention window of `days` days ending now. */
export function retentionCutoffIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Export assembly (pure)
// ---------------------------------------------------------------------------

export interface ExportedCheckIn {
  id: string;
  createdAt: string;
  mood: number;
  urge: number;
  energy: number;
  stress: number;
  controlled: boolean;
}

export interface ExportedUrgeEvent {
  id: string;
  createdAt: string;
  intensity: number;
  context: string;
  feeling: string;
  state: string;
  score: number;
  intervention: string;
  afterIntensity: number | null;
  effectiveness: string | null;
  outcomeAt: string | null;
}

export interface ExportedMlSignal {
  id: string;
  at: string;
  label: string;
  confidence: number;
  source: string;
  originSource: string;
  modelId: string;
  modelVersion: string;
}

/** One exported relapse record; mirrors the relapse_events columns. */
export interface ExportedRelapseEvent {
  id: string;
  createdAt: string;
  environment: string;
  triggerNoticed: boolean;
  note: string;
  checkInAt: string | null;
  checkInMood: number | null;
  checkInStress: number | null;
  checkInUrge: number | null;
}

/**
 * The complete export payload, built from the ACTUAL schema. Tables that do
 * not exist in this app's schema (journal_entries, intervention tables,
 * pattern rows) are deliberately absent — nothing is fabricated.
 *
 * Deliberately NOT included anywhere in this payload: raw screen frames or
 * pixels, model weights or binaries, credentials/secrets/tokens, logs, or any
 * device data beyond the user-owned rows below.
 */
export interface ExportPayload {
  schemaVersion: string;
  exportedAt: string;
  app: { name: string };
  settings: { monitoringEnabled: boolean; signalRetentionDays: number };
  checkIns: ExportedCheckIn[];
  urgeEvents: ExportedUrgeEvent[];
  relapseEvents: ExportedRelapseEvent[];
  mlSignalObservations: ExportedMlSignal[];
}

/**
 * Assembles the export payload from the domain records the repositories return.
 * Pure and deterministic given the same inputs (except `exportedAt`), so it is
 * directly testable against populated and empty databases alike.
 */
export function assembleExportPayload(args: {
  readonly exportedAt: string;
  readonly settings: Pick<AppSettings, 'monitoringEnabled' | 'signalRetentionDays'>;
  readonly checkIns: readonly CheckIn[];
  readonly urgeEvents: readonly UrgeEvent[];
  readonly relapseEvents: readonly RelapseRecord[];
  readonly mlSignals: readonly MlSignalObservation[];
}): ExportPayload {
  return {
    schemaVersion: '1',
    exportedAt: args.exportedAt,
    app: { name: 'Break The Loop' },
    settings: {
      monitoringEnabled: args.settings.monitoringEnabled,
      signalRetentionDays: args.settings.signalRetentionDays,
    },
    checkIns: args.checkIns.map((checkIn) => ({
      id: checkIn.id,
      createdAt: checkIn.createdAt,
      mood: checkIn.mood,
      urge: checkIn.urge,
      energy: checkIn.energy,
      stress: checkIn.stress,
      controlled: checkIn.controlled,
    })),
    urgeEvents: args.urgeEvents.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      intensity: event.intensity,
      context: event.context,
      feeling: event.feeling,
      state: event.state,
      score: event.score,
      intervention: event.intervention,
      afterIntensity: event.afterIntensity,
      effectiveness: event.effectiveness,
      outcomeAt: event.outcomeAt,
    })),
    relapseEvents: args.relapseEvents.map((relapse) => ({
      id: relapse.id,
      createdAt: relapse.createdAt,
      environment: relapse.environment,
      triggerNoticed: relapse.triggerNoticed,
      note: relapse.note,
      checkInAt: relapse.checkInAt,
      checkInMood: relapse.checkInMood,
      checkInStress: relapse.checkInStress,
      checkInUrge: relapse.checkInUrge,
    })),
    mlSignalObservations: args.mlSignals.map((signal) => ({
      id: signal.id,
      at: signal.at,
      label: signal.label,
      confidence: signal.confidence,
      source: signal.source,
      originSource: signal.originSource,
      modelId: signal.modelId,
      modelVersion: signal.modelVersion,
    })),
  };
}
