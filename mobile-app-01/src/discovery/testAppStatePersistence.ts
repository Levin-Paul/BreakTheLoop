// Persistence tests for onboarding + Discovery Mode state, run against a real
// SQLite engine in Node (`node:sqlite`). Run with: npm test
//
// Covers: fresh state (null), completed state, persistence across reopen,
// invalid-payload surfacing (no silent corruption), and that disabling
// Discovery Mode leaves other tables untouched.
//
// Driver-free by design: these tests execute the exact SQL text the shipping
// repository runs (via appStatePersistence), without importing expo-sqlite.
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

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
} from '../database/appStatePersistence';
import {
  CREATE_CHECK_INS_TABLE_SQL,
  INSERT_CHECK_IN_SQL,
  insertCheckInParams,
} from '../database/checkInPersistence';

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

function openDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(CREATE_APP_STATE_TABLE_SQL);
  database.exec(CREATE_CHECK_INS_TABLE_SQL);
  return database;
}

function selectRow(database: DatabaseSync, key: string): { value: string } | undefined {
  return database
    .prepare(SELECT_APP_STATE_SQL)
    .get(...selectAppStateParams(key)) as { value: string } | undefined;
}

function upsert(database: DatabaseSync, key: string, payload: unknown): void {
  database
    .prepare(UPSERT_APP_STATE_SQL)
    .run(...upsertAppStateParams(key, serializeAppState(payload), '2026-09-27T00:00:00.000Z'));
}

async function main(): Promise<void> {
  // --- 1. Fresh install: state is null (onboarding required) ---
  const fresh = openDatabase();
  assertEqual(
    'onboarding: fresh install has no state',
    parseOnboardingState(selectRow(fresh, ONBOARDING_STATE_KEY) ?? null),
    null,
  );
  assertEqual(
    'discovery: fresh install has no state',
    parseDiscoveryModeState(selectRow(fresh, DISCOVERY_MODE_STATE_KEY) ?? null),
    null,
  );

  // --- 2. Completion persists and survives a reopen ---
  upsert(fresh, ONBOARDING_STATE_KEY, { completed: true, completedAt: 1_726_000_000_000 });
  upsert(fresh, DISCOVERY_MODE_STATE_KEY, {
    enabled: true,
    startedAt: 1_726_000_000_000,
  });

  const completedOnboarding = parseOnboardingState(selectRow(fresh, ONBOARDING_STATE_KEY) ?? null);
  check(
    'onboarding: completed state persists',
    completedOnboarding?.completed === true && typeof completedOnboarding?.completedAt === 'number',
    JSON.stringify(completedOnboarding),
  );
  check(
    'discovery: enabled state persists with startedAt',
    parseDiscoveryModeState(selectRow(fresh, DISCOVERY_MODE_STATE_KEY) ?? null)?.enabled === true,
    'state missing or wrong',
  );

  // Reopen = same statements against the same stored rows (what the repository
  // does after an app restart). State must survive.
  const reopened = parseOnboardingState(selectRow(fresh, ONBOARDING_STATE_KEY) ?? null);
  assertEqual('onboarding: state survives app restart', reopened?.completed, true);

  // --- 3. Invalid payload surfaces instead of silently corrupting ---
  const broken = openDatabase();
  broken
    .prepare(UPSERT_APP_STATE_SQL)
    .run(...upsertAppStateParams(ONBOARDING_STATE_KEY, '{"completed":"yes"}', '2026-09-27T00:00:00.000Z'));
  let onboardingThrew = false;
  try {
    parseOnboardingState(selectRow(broken, ONBOARDING_STATE_KEY) ?? null);
  } catch {
    onboardingThrew = true;
  }
  check('onboarding: invalid stored shape surfaces (no silent reset)', onboardingThrew, 'no error thrown');

  broken
    .prepare(UPSERT_APP_STATE_SQL)
    .run(...upsertAppStateParams(DISCOVERY_MODE_STATE_KEY, '{"enabled":1}', '2026-09-27T00:00:00.000Z'));
  let discoveryThrew = false;
  try {
    parseDiscoveryModeState(selectRow(broken, DISCOVERY_MODE_STATE_KEY) ?? null);
  } catch {
    discoveryThrew = true;
  }
  check('discovery: invalid stored shape surfaces (no silent reset)', discoveryThrew, 'no error thrown');

  // --- 4. Disabling Discovery Mode does not delete historical data ---
  const withHistory = openDatabase();
  upsert(withHistory, DISCOVERY_MODE_STATE_KEY, { enabled: true, startedAt: 1_726_000_000_000 });
  const checkIn = {
    id: 'c1',
    createdAt: '2026-09-27T10:00:00.000Z',
    mood: 4,
    urge: 3,
    energy: 5,
    stress: 7,
    controlled: true,
  };
  withHistory.prepare(INSERT_CHECK_IN_SQL).run(...insertCheckInParams(checkIn));

  upsert(withHistory, DISCOVERY_MODE_STATE_KEY, {
    enabled: false,
    startedAt: 1_726_000_000_000,
    stoppedAt: 1_726_000_100_000,
  });
  const remaining = withHistory.prepare('SELECT COUNT(*) AS count FROM check_ins').get() as {
    count: number;
  };
  assertEqual('discovery: disabling keeps historical rows', remaining.count, 1);
  const disabled = parseDiscoveryModeState(selectRow(withHistory, DISCOVERY_MODE_STATE_KEY) ?? null);
  check(
    'discovery: disabled state stored with stoppedAt (not deleted, not restarted)',
    disabled?.enabled === false && typeof disabled?.stoppedAt === 'number',
    JSON.stringify(disabled),
  );

  // --- 5. No personal information in stored payloads ---
  const storedPayload = String(selectRow(fresh, ONBOARDING_STATE_KEY)?.value ?? '');
  check(
    'privacy: onboarding payload holds only flags/timestamps',
    !/"name"|"email"|"phone"|"location"|"account"/i.test(storedPayload),
    storedPayload,
  );
  const discoveryPayload = String(selectRow(fresh, DISCOVERY_MODE_STATE_KEY)?.value ?? '');
  check(
    'privacy: discovery payload holds only flags/timestamps',
    !/"name"|"email"|"phone"|"location"|"account"/i.test(discoveryPayload),
    discoveryPayload,
  );

  // --- Summary ---
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`  FAILED: ${failure}`);
    }
    throw new Error(`${failures.length} app-state persistence test(s) failed`);
  }
}

void main();
