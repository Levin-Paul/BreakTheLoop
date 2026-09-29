// Deterministic tests for the Settings / Data Controls persistence layer.
// Run with: npm test
//
// Executed against a REAL SQLite engine in Node (`node:sqlite`), using the
// exact SQL text and helpers the shipping repositories run — no mocks, no
// placeholders. Covers:
//   - settings parse/serialize round-trip and defaults
//   - invalid payload surfacing (no silent reset)
//   - retention cutoff determinism + SQL boundary behavior (< cutoff)
//   - retention must never touch user-authored tables (check_ins, urge_events)
//   - delete-all statements cover exactly the user-data table set
//   - delete-all leaves a clean state: every user table count == 0
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import {
  CREATE_APP_STATE_TABLE_SQL,
  SELECT_APP_STATE_SQL,
  UPSERT_APP_STATE_SQL,
  selectAppStateParams,
  upsertAppStateParams,
} from '../database/appStatePersistence';
import {
  CREATE_CHECK_INS_TABLE_SQL,
  INSERT_CHECK_IN_SQL,
  insertCheckInParams,
  rowToCheckIn,
} from '../database/checkInPersistence';
import {
  CREATE_URGE_EVENTS_TABLE_SQL,
  INSERT_URGE_EVENT_SQL,
  insertUrgeParams,
  rowToUrgeEvent,
} from '../database/urgePersistence';
import {
  CREATE_ML_SIGNAL_EVENTS_TABLE_SQL,
  INSERT_ML_SIGNAL_EVENT_SQL,
  insertMlSignalParams,
  rowToMlSignalObservation,
} from '../database/signalPersistence';
import type { UrgeEffectiveness } from '../screens/urgeModel';
import {
  DELETE_OLD_SIGNALS_SQL,
  SETTINGS_SCHEMA_VERSION,
  USER_DATA_TABLES,
  assembleExportPayload,
  countAllUserDataStatements,
  defaultSettings,
  deleteAllUserDataStatements,
  deleteOldSignalsParams,
  parseAppSettings,
  retentionCutoffIso,
} from '../database/settingsPersistence';
import type { ExportedMlSignal } from '../database/settingsPersistence';
import type { MlSignalObservation } from '../engine/patternEngine';
import type { RiskState } from '../engine/types';

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(`${label} -> ${detail}`);
    console.log(`FAIL  ${label} -> ${detail}`);
  }
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  check(label, actual === expected, `expected ${String(expected)}, got ${String(actual)}`);
}

function countTable(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function openDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(CREATE_APP_STATE_TABLE_SQL);
  database.exec(CREATE_CHECK_INS_TABLE_SQL);
  database.exec(CREATE_URGE_EVENTS_TABLE_SQL);
  database.exec(CREATE_ML_SIGNAL_EVENTS_TABLE_SQL);
  return database;
}

// Fixed fixtures so every assertion is deterministic.
const T0 = Date.parse('2026-09-30T12:00:00.000Z');

function sampleCheckIn(id: string, createdAt: string) {
  return { id, createdAt, mood: 4, urge: 3, energy: 5, stress: 6, controlled: true };
}

function sampleUrge(id: string, createdAt: string) {
  return {
    id,
    createdAt,
    intensity: 8,
    feeling: 'bored at night',
    context: 'scrolling in bed',
    state: 'high_risk' as RiskState,
    score: 82,
    intervention: 'Box breathing',
    afterIntensity: 4,
    effectiveness: 'helped' as UrgeEffectiveness,
    outcomeAt: createdAt,
  };
}

function sampleSignal(id: string, at: string): MlSignalObservation {
  return {
    id,
    at,
    label: 'anxiety',
    confidence: 0.91,
    source: 'ml',
    originSource: 'urge_flow',
    modelId: 'trigger-classifier',
    modelVersion: 'test-1',
  };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1. Settings defaults + parse round-trip
  // ---------------------------------------------------------------------
  const defaults = defaultSettings();
  assertEqual('settings: default schema version', defaults.schemaVersion, SETTINGS_SCHEMA_VERSION);
  assertEqual('settings: monitoring enabled by default', defaults.monitoringEnabled, true);
  assertEqual('settings: default retention window', defaults.signalRetentionDays, 30);

  const roundTrip = parseAppSettings(JSON.parse(JSON.stringify(defaults)));
  assertEqual('settings: round-trips through JSON', roundTrip.monitoringEnabled, true);

  const older = parseAppSettings({ schemaVersion: 1, monitoringEnabled: false });
  assertEqual('settings: older payload fills retention from defaults', older.signalRetentionDays, 30);
  assertEqual('settings: older payload keeps monitoring false', older.monitoringEnabled, false);

  // Invalid payloads surface instead of silently resetting.
  const badPayloads: [string, unknown][] = [
    ['settings: non-object payload rejected', null],
    ['settings: array payload rejected', []],
    ['settings: non-boolean monitoring rejected', { monitoringEnabled: 'yes' }],
    ['settings: zero retention rejected', { signalRetentionDays: 0 }],
    ['settings: negative retention rejected', { signalRetentionDays: -5 }],
    ['settings: non-numeric retention rejected', { signalRetentionDays: '30' }],
  ];
  for (const [label, bad] of badPayloads) {
    let threw = false;
    try {
      parseAppSettings(bad);
    } catch {
      threw = true;
    }
    check(label, threw, 'no error thrown');
  }

  // The settings row round-trips through the real app_state table.
  const db = openDatabase();
  db.prepare(UPSERT_APP_STATE_SQL).run(
    ...upsertAppStateParams(
      'settings',
      JSON.stringify({ ...defaults, monitoringEnabled: false }),
      '2026-09-30T00:00:00.000Z',
    ),
  );
  const storedRow = db.prepare(SELECT_APP_STATE_SQL).get(...selectAppStateParams('settings')) as {
    value: string;
  };
  const storedSettings = parseAppSettings(JSON.parse(storedRow.value));
  assertEqual('settings: persisted via app_state survives', storedSettings.monitoringEnabled, false);

  // ---------------------------------------------------------------------
  // 2. Retention cutoff determinism
  // ---------------------------------------------------------------------
  assertEqual('retention: cutoff is deterministic', retentionCutoffIso(T0, 30), '2026-08-31T12:00:00.000Z');
  assertEqual('retention: 1-day cutoff', retentionCutoffIso(T0, 1), '2026-09-29T12:00:00.000Z');

  // ---------------------------------------------------------------------
  // 3. Retention SQL boundary: strictly older than cutoff is deleted
  // ---------------------------------------------------------------------
  const retentionDb = openDatabase();
  const cutoff = retentionCutoffIso(T0, 30);
  const signalRows: [string, string][] = [
    ['old-1', '2026-08-31T11:59:59.999Z'], // 1 ms before the cutoff -> deleted
    ['boundary', cutoff], // exactly at the cutoff -> KEPT (created_at < cutoff)
    ['new-1', '2026-09-15T00:00:00.000Z'], // newer -> kept
    ['new-2', '2026-09-30T00:00:00.000Z'], // newer -> kept
  ];
  for (const [id, at] of signalRows) {
    retentionDb.prepare(INSERT_ML_SIGNAL_EVENT_SQL).run(...insertMlSignalParams(sampleSignal(id, at)));
  }
  // User-authored history in the same database, far older than the window.
  retentionDb.prepare(INSERT_CHECK_IN_SQL).run(...insertCheckInParams(sampleCheckIn('keep-c1', '2026-08-01T00:00:00.000Z')));
  retentionDb.prepare(INSERT_URGE_EVENT_SQL).run(...insertUrgeParams(sampleUrge('keep-u1', '2026-08-01T00:00:00.000Z')));

  retentionDb.prepare(DELETE_OLD_SIGNALS_SQL).run(...deleteOldSignalsParams(cutoff));

  assertEqual('retention: strictly-older signal row deleted', countTable(retentionDb, 'ml_signal_events'), 3);
  const kept = retentionDb.prepare('SELECT id FROM ml_signal_events ORDER BY id').all() as { id: string }[];
  check(
    'retention: cutoff-boundary row kept',
    kept.some((row) => row.id === 'boundary'),
    JSON.stringify(kept),
  );
  assertEqual('retention: check-ins never auto-pruned', countTable(retentionDb, 'check_ins'), 1);
  assertEqual('retention: urges never auto-pruned', countTable(retentionDb, 'urge_events'), 1);

  // ---------------------------------------------------------------------
  // 4. Delete-all statements cover exactly the user-data tables
  // ---------------------------------------------------------------------
  const tables = [...USER_DATA_TABLES];
  check('delete-all: covers check_ins', tables.includes('check_ins'), tables.join(','));
  check('delete-all: covers urge_events', tables.includes('urge_events'), tables.join(','));
  check('delete-all: covers ml_signal_events', tables.includes('ml_signal_events'), tables.join(','));
  check('delete-all: covers app_state', tables.includes('app_state'), tables.join(','));
  assertEqual('delete-all: exactly four tables', tables.length, 4);
  check(
    'delete-all: statements are plain DELETEs (schema untouched)',
    deleteAllUserDataStatements().every((sql: string) => /^DELETE FROM \w+;?$/.test(sql)),
    deleteAllUserDataStatements().join(' | '),
  );
  check(
    'delete-all: one verification count per table',
    countAllUserDataStatements().length === tables.length &&
      countAllUserDataStatements().every((sql: string) => sql.startsWith('SELECT COUNT(*)')),
    countAllUserDataStatements().join(' | '),
  );

  // ---------------------------------------------------------------------
  // 5. Delete-all on a populated database leaves a clean state
  // ---------------------------------------------------------------------
  const deleteDb = openDatabase();
  deleteDb.prepare(INSERT_CHECK_IN_SQL).run(...insertCheckInParams(sampleCheckIn('c1', '2026-09-01T00:00:00.000Z')));
  deleteDb.prepare(INSERT_CHECK_IN_SQL).run(...insertCheckInParams(sampleCheckIn('c2', '2026-09-02T00:00:00.000Z')));
  deleteDb.prepare(INSERT_URGE_EVENT_SQL).run(...insertUrgeParams(sampleUrge('u1', '2026-09-01T00:00:00.000Z')));
  deleteDb.prepare(INSERT_ML_SIGNAL_EVENT_SQL).run(...insertMlSignalParams(sampleSignal('s1', '2026-09-01T00:00:00.000Z')));
  deleteDb
    .prepare(UPSERT_APP_STATE_SQL)
    .run(...upsertAppStateParams('onboarding', '{"completed":true,"completedAt":1}', '2026-09-01T00:00:00.000Z'));
  deleteDb
    .prepare(UPSERT_APP_STATE_SQL)
    .run(...upsertAppStateParams('discovery_mode', '{"enabled":true,"startedAt":1}', '2026-09-01T00:00:00.000Z'));
  deleteDb
    .prepare(UPSERT_APP_STATE_SQL)
    .run(
      ...upsertAppStateParams(
        'settings',
        '{"schemaVersion":1,"monitoringEnabled":false,"signalRetentionDays":30}',
        '2026-09-01T00:00:00.000Z',
      ),
    );

  assertEqual('delete-all: setup has check-ins', countTable(deleteDb, 'check_ins'), 2);
  assertEqual('delete-all: setup has urges', countTable(deleteDb, 'urge_events'), 1);
  assertEqual('delete-all: setup has signals', countTable(deleteDb, 'ml_signal_events'), 1);
  assertEqual('delete-all: setup has app_state rows', countTable(deleteDb, 'app_state'), 3);

  for (const statement of deleteAllUserDataStatements()) {
    deleteDb.exec(statement);
  }
  for (const statement of countAllUserDataStatements()) {
    const row = deleteDb.prepare(statement).get() as { count: number };
    assertEqual(`delete-all: ${statement} leaves 0 rows`, row.count, 0);
  }

  // No orphaned derived data: patterns are never stored as rows (the Pattern
  // Engine derives them from stored events), so empty source tables = no
  // orphaned pattern/discovery data anywhere.
  assertEqual('delete-all: app_state fully reset', countTable(deleteDb, 'app_state'), 0);

  // The schema itself survives deletion (tables still exist, just empty).
  let schemaIntact = true;
  for (const table of ['check_ins', 'urge_events', 'ml_signal_events', 'app_state']) {
    try {
      countTable(deleteDb, table);
    } catch {
      schemaIntact = false;
    }
  }
  check('delete-all: tables still exist after deletion (schema untouched)', schemaIntact, 'a table is missing');

  // ---------------------------------------------------------------------
  // 6. Export payload assembly mirrors the real stored rows
  // ---------------------------------------------------------------------
  const exportDb = openDatabase();
  exportDb.prepare(INSERT_CHECK_IN_SQL).run(...insertCheckInParams(sampleCheckIn('c1', '2026-09-01T10:00:00.000Z')));
  exportDb.prepare(INSERT_URGE_EVENT_SQL).run(...insertUrgeParams(sampleUrge('u1', '2026-09-01T11:00:00.000Z')));
  exportDb.prepare(INSERT_ML_SIGNAL_EVENT_SQL).run(...insertMlSignalParams(sampleSignal('s1', '2026-09-01T12:00:00.000Z')));

  // Read back through the same projections buildExportPayload uses.
  const checkInRow = exportDb
    .prepare('SELECT id, created_at, mood, urge, energy, stress, controlled FROM check_ins ORDER BY created_at ASC')
    .get() as { id: string; created_at: string; mood: number; urge: number; energy: number; stress: number; controlled: number };
  const urgeRow = exportDb
    .prepare(
      'SELECT id, created_at, intensity_before, trigger, context, state, score, intervention, intensity_after, effectiveness, outcome_at FROM urge_events ORDER BY created_at ASC',
    )
    .get() as {
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
  };
  const signalRow = exportDb
    .prepare(
      'SELECT id, created_at, label, confidence, source, origin_source, model_id, model_version FROM ml_signal_events ORDER BY created_at ASC',
    )
    .get() as {
    id: string;
    created_at: string;
    label: string;
    confidence: number;
    source: string;
    origin_source: string;
    model_id: string;
    model_version: string;
  };

  const payload = assembleExportPayload({
    exportedAt: '2026-09-30T12:00:00.000Z',
    settings: { monitoringEnabled: true, signalRetentionDays: 30 },
    checkIns: [rowToCheckIn(checkInRow)],
    urgeEvents: [rowToUrgeEvent(urgeRow)],
    mlSignals: [rowToMlSignalObservation(signalRow)],
  });

  assertEqual('export: schema version', payload.schemaVersion, '1');
  assertEqual('export: app name', payload.app.name, 'Break The Loop');
  assertEqual('export: check-in count', payload.checkIns.length, 1);
  assertEqual('export: urge count', payload.urgeEvents.length, 1);
  assertEqual('export: signal count', payload.mlSignalObservations.length, 1);
  assertEqual('export: check-in id', payload.checkIns[0]?.id, 'c1');
  assertEqual('export: check-in mood', payload.checkIns[0]?.mood, 4);
  assertEqual('export: check-in controlled', payload.checkIns[0]?.controlled, true);
  assertEqual('export: urge id', payload.urgeEvents[0]?.id, 'u1');
  assertEqual('export: urge intervention included', payload.urgeEvents[0]?.intervention, 'Box breathing');
  assertEqual('export: urge outcome included', payload.urgeEvents[0]?.effectiveness, 'helped');
  assertEqual('export: signal label', payload.mlSignalObservations[0]?.label, 'anxiety');
  assertEqual('export: signal confidence', payload.mlSignalObservations[0]?.confidence, 0.91);
  assertEqual('export: signal model version', payload.mlSignalObservations[0]?.modelVersion, 'test-1');
  check(
    'export: settings block present',
    payload.settings.monitoringEnabled === true && payload.settings.signalRetentionDays === 30,
    JSON.stringify(payload.settings),
  );
  check('export: exportedAt present', payload.exportedAt.length > 0, 'missing');

  // Round-trip through JSON.stringify: the exact bytes the share sheet hands out.
  const serialized = JSON.parse(JSON.stringify(payload));
  assertEqual('export: survives JSON round-trip', serialized.checkIns.length, 1);

  // The empty export is honest: zero arrays, not fabricated rows.
  const emptyPayload = assembleExportPayload({
    exportedAt: '2026-09-30T12:00:00.000Z',
    settings: { monitoringEnabled: true, signalRetentionDays: 30 },
    checkIns: [],
    urgeEvents: [],
    mlSignals: [],
  });
  assertEqual('export: empty export has no check-ins', emptyPayload.checkIns.length, 0);
  assertEqual('export: empty export has no urges', emptyPayload.urgeEvents.length, 0);
  assertEqual('export: empty export has no signals', emptyPayload.mlSignalObservations.length, 0);

  // Privacy: no text field duplicated into ML signal exports (text lives only
  // where the user typed it — urge_events), and no frames/pixels anywhere.
  check(
    'export: ML signal export carries no text field',
    payload.mlSignalObservations.every((row: ExportedMlSignal) => !('text' in row)),
    'text field found',
  );
  check(
    'export: no frames or pixels fields anywhere',
    !JSON.stringify(payload).toLowerCase().includes('frame'),
    'frame reference found',
  );

  // --- Summary ---
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`  FAILED: ${failure}`);
    }
    throw new Error(`${failures.length} settings/data-controls test(s) failed`);
  }
}

void main();
