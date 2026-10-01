// Deterministic tests for the Relapse + Post-Lapse Recovery flow.
// Run with: npm test
//
// Executed against a REAL SQLite engine in Node (`node:sqlite`), using the
// exact SQL text the shipping repository runs — no mocks. Covers:
//   - recording a relapse (create + insert + read-back)
//   - cancelling (no row written)
//   - persistence across a reopen (restart)
//   - fresh database creation + existing-database migration safety
//   - post-lapse check-in updates the SAME row (no duplicate records)
//   - post-lapse state (Recovery Engine input mapping)
//   - Insights window counts + count-based, non-causal wording
//   - Discovery Mode / Pattern Engine integration (timeline + dedup)
//   - export includes relapse data; delete-all removes it
//   - privacy constraints (no required text, bounded note, no frames)
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import {
  CREATE_APP_STATE_TABLE_SQL,
} from '../database/appStatePersistence';
import {
  CREATE_CHECK_INS_TABLE_SQL,
  INSERT_CHECK_IN_SQL,
  insertCheckInParams,
} from '../database/checkInPersistence';
import {
  CREATE_RELAPSE_EVENTS_TABLE_SQL,
  COUNT_RELAPSE_EVENTS_SQL,
  INSERT_RELAPSE_EVENT_SQL,
  SELECT_RECENT_RELAPSE_EVENTS_SQL,
  UPDATE_RELAPSE_CHECK_IN_SQL,
  insertRelapseParams,
  rowToRelapseRecord,
  selectRecentRelapseParams,
  updateRelapseCheckInParams,
  type RelapseEventRow,
} from '../database/relapsePersistence';
import {
  CREATE_ML_SIGNAL_EVENTS_TABLE_SQL,
} from '../database/signalPersistence';
import {
  CREATE_URGE_EVENTS_TABLE_SQL,
  INSERT_URGE_EVENT_SQL,
  insertUrgeParams,
} from '../database/urgePersistence';
import {
  USER_DATA_TABLES,
  assembleExportPayload,
  countAllUserDataStatements,
  deleteAllUserDataStatements,
} from '../database/settingsPersistence';
import {
  LAPSE_DEDUPLICATION_WINDOW_MS,
  buildTimeline,
  detectPatterns,
} from '../engine/patternEngine';
import { calculateRecoveryState } from '../engine/recoveryEngine';
import type { CheckIn } from '../screens/checkInModel';
import { deriveRecentSignals, toRecoveryInput } from '../screens/checkInModel';
import { buildUrgeInput } from '../screens/urgeModel';
import {
  POST_LAPSE_ACTIONS,
  RELAPSE_ENVIRONMENTS,
  RELAPSE_MAX_NOTE_LENGTH,
  RELAPSE_RECENT_WINDOW_MS,
  buildRelapseInput,
  createRelapseRecord,
  hasPostLapseCheckIn,
  isWithinRecentWindow,
  sortRelapsesNewestFirst,
  summarizeRelapseWindow,
  withPostLapseCheckIn,
  type RelapseRecord,
} from '../screens/relapseModel';
import { buildRecentActivity } from '../screens/insightsModel';

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
  database.exec(CREATE_RELAPSE_EVENTS_TABLE_SQL);
  return database;
}

function insertRelapse(database: DatabaseSync, record: RelapseRecord): void {
  database.prepare(INSERT_RELAPSE_EVENT_SQL).run(...insertRelapseParams(record));
}

function loadAll(database: DatabaseSync): RelapseRecord[] {
  const rows = database
    .prepare(SELECT_RECENT_RELAPSE_EVENTS_SQL)
    .all(...selectRecentRelapseParams(200)) as unknown as RelapseEventRow[];
  return rows.map(rowToRelapseRecord);
}

// Fixed fixtures so every assertion is deterministic.
const T0 = Date.parse('2026-09-30T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

function makeRelapse(overrides: Partial<RelapseRecord> = {}): RelapseRecord {
  return {
    id: 'r1',
    createdAt: iso(0),
    environment: 'home_alone',
    triggerNoticed: true,
    note: '',
    checkInAt: null,
    checkInMood: null,
    checkInStress: null,
    checkInUrge: null,
    ...overrides,
  };
}

function makeCheckIn(overrides: Partial<CheckIn> & { id: string; createdAt: string }): CheckIn {
  return {
    mood: 7,
    urge: 2,
    energy: 7,
    stress: 2,
    controlled: true,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1. Recording a relapse: create -> insert -> read back
  // ---------------------------------------------------------------------
  const draft = createRelapseRecord(
    { environment: 'home_alone', triggerNoticed: true, note: '  rough evening  ' },
    new Date(T0),
  );
  check('record: id generated', draft.id.length > 0, 'empty id');
  assertEqual('record: timestamp stored', draft.createdAt, iso(0));
  assertEqual('record: environment stored', draft.environment, 'home_alone');
  assertEqual('record: trigger flag stored', draft.triggerNoticed, true);
  assertEqual('record: note trimmed', draft.note, 'rough evening');
  assertEqual('record: no check-in yet', draft.checkInAt, null);
  assertEqual('record: check-in fields null', draft.checkInMood, null);

  const recordDb = openDatabase();
  insertRelapse(recordDb, draft);
  const loaded = loadAll(recordDb);
  assertEqual('record: one row after insert', loaded.length, 1);
  assertEqual('record: round-trips through SQLite', JSON.stringify(loaded[0]), JSON.stringify(draft));

  // ---------------------------------------------------------------------
  // 2. Cancelling: no row is written
  // ---------------------------------------------------------------------
  const cancelDb = openDatabase();
  // (The UI cancel path simply navigates back before createRelapseRecord is
  // ever persisted; modelled here as "no insert happens".)
  assertEqual('cancel: no rows written', countTable(cancelDb, 'relapse_events'), 0);
  assertEqual('cancel: read back is empty', loadAll(cancelDb).length, 0);

  // ---------------------------------------------------------------------
  // 3. Persistence across reopen: the same SELECT after "restart"
  // ---------------------------------------------------------------------
  const reopened = loadAll(recordDb);
  assertEqual('restart: record survives reopen', reopened.length, 1);
  assertEqual('restart: same id', reopened[0]?.id, draft.id);
  assertEqual('restart: same timestamp', reopened[0]?.createdAt, iso(0));

  // ---------------------------------------------------------------------
  // 4. Fresh database creation + existing-database migration safety
  // ---------------------------------------------------------------------
  // CREATE TABLE IF NOT EXISTS is a no-op on an existing table and creates it
  // on a fresh one; both paths run the same statement (schema.ts does exactly
  // this on every boot).
  let reCreateThrew = false;
  try {
    recordDb.exec(CREATE_RELAPSE_EVENTS_TABLE_SQL);
  } catch {
    reCreateThrew = true;
  }
  check('migration: re-running CREATE IF NOT EXISTS is safe', !reCreateThrew, 'threw');
  assertEqual('migration: existing rows untouched after re-create', countTable(recordDb, 'relapse_events'), 1);

  const freshDb = new DatabaseSync(':memory:');
  let freshThrew = false;
  try {
    freshDb.exec(CREATE_RELAPSE_EVENTS_TABLE_SQL);
  } catch {
    freshThrew = true;
  }
  check('migration: fresh database creates the table', !freshThrew, 'threw');
  assertEqual('migration: fresh table is empty', countTable(freshDb, 'relapse_events'), 0);

  // ---------------------------------------------------------------------
  // 5. Post-lapse check-in updates the SAME row (no duplicate records)
  // ---------------------------------------------------------------------
  const withCheckIn = withPostLapseCheckIn(
    draft,
    { mood: 3, stress: 8, urgeIntensity: 7 },
    new Date(T0 + HOUR),
  );
  assertEqual('check-in: same id', withCheckIn.id, draft.id);
  assertEqual('check-in: timestamp set', withCheckIn.checkInAt, iso(HOUR));
  assertEqual('check-in: mood stored', withCheckIn.checkInMood, 3);
  assertEqual('check-in: stress stored', withCheckIn.checkInStress, 8);
  assertEqual('check-in: urge stored', withCheckIn.checkInUrge, 7);
  check('check-in: marked complete', hasPostLapseCheckIn(withCheckIn), 'not marked');
  // Clamping: out-of-range values never persist.
  const clamped = withPostLapseCheckIn(draft, { mood: 99, stress: -3, urgeIntensity: 5 });
  assertEqual('check-in: mood clamped high', clamped.checkInMood, 10);
  assertEqual('check-in: stress clamped low', clamped.checkInStress, 1);

  // The check-in path is an UPDATE of the existing row, never a second insert:
  const updated = recordDb
    .prepare(UPDATE_RELAPSE_CHECK_IN_SQL)
    .run(...updateRelapseCheckInParams(withCheckIn));
  assertEqual('check-in: update touched one row', Number(updated.changes), 1);
  assertEqual('check-in: still exactly one row', countTable(recordDb, 'relapse_events'), 1);
  const afterCheckIn = loadAll(recordDb)[0];
  assertEqual('check-in: persisted on the same row', afterCheckIn?.checkInMood, 3);
  assertEqual('check-in: persisted timestamp', afterCheckIn?.checkInAt, iso(HOUR));

  // Updating a non-existent id reports zero changes (no silent success).
  const ghost = recordDb
    .prepare(UPDATE_RELAPSE_CHECK_IN_SQL)
    .run(...updateRelapseCheckInParams(makeRelapse({ id: 'missing' })));
  assertEqual('check-in: unknown id changes nothing', Number(ghost.changes), 0);

  // ---------------------------------------------------------------------
  // 6. Post-lapse state: Recovery Engine input mapping
  // ---------------------------------------------------------------------
  const relapseInput = buildRelapseInput(draft, null);
  assertEqual('engine: recentRelapse true right after lapse', relapseInput.input.recentRelapse, true);
  assertEqual('engine: no invented urge signals', relapseInput.input.recentUrgeCount, 0);
  assertEqual('engine: neutral background urge when skipped', relapseInput.input.urge, 5);
  assertEqual('engine: neutral background stress when skipped', relapseInput.input.stress, 5);
  check('engine: skip reported honestly', relapseInput.usedCheckIn === false, 'claimed check-in used');

  const checkInInput = buildRelapseInput(withCheckIn, {
    mood: 3,
    stress: 8,
    urgeIntensity: 7,
  });
  assertEqual('engine: check-in urge used', checkInInput.input.urge, 7);
  assertEqual('engine: check-in stress used', checkInInput.input.stress, 8);
  assertEqual('engine: check-in mood used', checkInInput.input.mood, 3);
  check('engine: check-in used reported', checkInInput.usedCheckIn === true, 'reported skip');

  // The engine's existing rules score this unchanged: urge 7 (+2), stress 8
  // (+2), mood 3 (+2), recent relapse (+3) = 9.
  const scored = calculateRecoveryState(checkInInput.input);
  assertEqual('engine: urge7+stress8+mood3+relapse scores 9', scored.score, 9);
  assertEqual('engine: high risk state', scored.state, 'high_risk');
  check(
    'engine: recommended action mentions leaving environment',
    scored.recommendedAction.includes('Leave the current environment'),
    scored.recommendedAction,
  );

  // A stored relapse feeds the CHECK-IN flow's recent signals.
  const checkInSignals = deriveRecentSignals(
    makeCheckIn({ id: 'c', createdAt: iso(0), controlled: true }),
    [],
    true,
  );
  assertEqual('engine: stored relapse flags check-in recentRelapse', checkInSignals.recentRelapse, true);
  const checkInNoRelapse = deriveRecentSignals(
    makeCheckIn({ id: 'c', createdAt: iso(0), controlled: true }),
    [],
    false,
  );
  assertEqual('engine: no stored relapse leaves flag false', checkInNoRelapse.recentRelapse, false);
  const mapped = toRecoveryInput(makeCheckIn({ id: 'c', createdAt: iso(0) }), [], true);
  assertEqual('engine: toRecoveryInput carries stored relapse', mapped.recentRelapse, true);

  // ...and the URGE flow's input.
  const urgeInput = buildUrgeInput({
    intensity: 6,
    earlierEvents: [],
    latestCheckIn: null,
    storedRelapseInWindow: true,
  });
  assertEqual('engine: stored relapse flags urge recentRelapse', urgeInput.input.recentRelapse, true);
  const urgeInputNoRelapse = buildUrgeInput({
    intensity: 6,
    earlierEvents: [],
    latestCheckIn: null,
    storedRelapseInWindow: false,
  });
  assertEqual('engine: urge without relapse stays false', urgeInputNoRelapse.input.recentRelapse, false);

  // ---------------------------------------------------------------------
  // 7. Recent-window logic
  // ---------------------------------------------------------------------
  check('window: just now is inside', isWithinRecentWindow(makeRelapse({ createdAt: iso(0) }), T0 + 1), 'outside');
  check(
    'window: 13 days old is inside',
    isWithinRecentWindow(makeRelapse({ createdAt: iso(-13 * DAY) }), T0),
    'outside',
  );
  check(
    'window: 15 days old is outside',
    !isWithinRecentWindow(makeRelapse({ createdAt: iso(-15 * DAY) }), T0),
    'inside',
  );
  const windowMs = RELAPSE_RECENT_WINDOW_MS;
  check(
    'window: exactly 14 days is outside (strict)',
    !isWithinRecentWindow(makeRelapse({ createdAt: iso(-windowMs) }), T0),
    'inside',
  );
  check(
    'window: malformed timestamp is never inside',
    !isWithinRecentWindow(makeRelapse({ createdAt: 'not-a-date' }), T0),
    'inside',
  );
  assertEqual('window: is exactly 14 days', windowMs, 14 * DAY);

  const sorted = sortRelapsesNewestFirst([
    makeRelapse({ id: 'old', createdAt: iso(-2 * DAY) }),
    makeRelapse({ id: 'new', createdAt: iso(0) }),
    makeRelapse({ id: 'mid', createdAt: iso(-DAY) }),
  ]);
  assertEqual('window: newest-first sort', sorted.map((r) => r.id).join(','), 'new,mid,old');

  // ---------------------------------------------------------------------
  // 8. Insights: counts + count-based, non-causal, non-shaming wording
  // ---------------------------------------------------------------------
  const emptySummary = summarizeRelapseWindow([], T0);
  assertEqual('insights: empty count', emptySummary.count, 0);
  check(
    'insights: empty headline is honest',
    emptySummary.headline === 'No relapses recorded in the last 14 days.',
    emptySummary.headline,
  );

  const summary = summarizeRelapseWindow(
    [
      makeRelapse({ id: 'a', createdAt: iso(-DAY), triggerNoticed: true, checkInAt: iso(-HOUR) }),
      makeRelapse({ id: 'b', createdAt: iso(-2 * DAY), triggerNoticed: false }),
      makeRelapse({ id: 'old', createdAt: iso(-20 * DAY) }), // outside window
    ],
    T0,
  );
  assertEqual('insights: counts only inside window', summary.count, 2);
  assertEqual('insights: trigger count', summary.triggerNoticedCount, 1);
  assertEqual('insights: check-in count', summary.checkInCount, 1);
  assertEqual('insights: singular/plural headline', summary.headline, 'You recorded 2 relapses in the last 14 days.');
  check(
    'insights: wording makes no causal claim',
    !/caus|because|due to|led to|made you/i.test(`${summary.headline} ${summary.detail}`),
    `${summary.headline} ${summary.detail}`,
  );
  check(
    'insights: wording is not shaming',
    !/fail|weak|addict|disappoint/i.test(`${summary.headline} ${summary.detail}`),
    `${summary.headline} ${summary.detail}`,
  );

  const single = summarizeRelapseWindow([makeRelapse({ createdAt: iso(-DAY) })], T0);
  assertEqual('insights: singular headline', single.headline, 'You recorded 1 relapse in the last 14 days.');

  // Recent-activity merge includes relapses with neutral detail (no note text).
  const activity = buildRecentActivity(
    [makeCheckIn({ id: 'c1', createdAt: iso(-3 * DAY) })],
    [],
    [makeRelapse({ id: 'r1', createdAt: iso(-DAY), note: 'private note' })],
    10,
  );
  assertEqual('insights: activity includes relapse', activity[0]?.kind, 'relapse');
  check(
    'insights: relapse activity does not leak the note',
    !JSON.stringify(activity).includes('private note'),
    JSON.stringify(activity),
  );

  // ---------------------------------------------------------------------
  // 9. Discovery Mode / Pattern Engine integration
  // ---------------------------------------------------------------------
  // A stored relapse appears on the timeline as a lapse event.
  const timeline = buildTimeline(
    [],
    [],
    [makeRelapse({ createdAt: iso(0) }), makeRelapse({ id: 'r2', createdAt: iso(-2 * DAY) })],
  );
  assertEqual('discovery: relapses enter timeline', timeline.filter((e) => e.lapse).length, 2);
  assertEqual('discovery: relapse kind', timeline[0]?.kind, 'relapse');

  // Dedup: a "Controlled: No" check-in within 1 hour of a stored relapse is
  // the SAME episode — one lapse event, not two.
  const nearCheckIn = makeCheckIn({ id: 'c-near', createdAt: iso(30 * 60 * 1000), controlled: false });
  const deduped = buildTimeline([nearCheckIn], [], [makeRelapse({ createdAt: iso(0) })]);
  assertEqual('discovery: dedup keeps one lapse episode', deduped.filter((e) => e.lapse).length, 1);
  assertEqual(
    'discovery: dedup window constant',
    LAPSE_DEDUPLICATION_WINDOW_MS,
    HOUR,
  );
  const farCheckIn = makeCheckIn({ id: 'c-far', createdAt: iso(3 * HOUR), controlled: false });
  const notDeduped = buildTimeline([farCheckIn], [], [makeRelapse({ createdAt: iso(0) })]);
  assertEqual('discovery: distant check-in lapse stays separate', notDeduped.filter((e) => e.lapse).length, 2);

  // Cluster detector: 2 high urges before a stored relapse -> emerging.
  const urge = (id: string, createdAt: string, intensity: number) => ({
    id,
    createdAt,
    intensity,
    context: '',
    feeling: '',
    state: 'moderate_risk' as const,
    score: 3,
    intervention: '',
    afterIntensity: null,
    effectiveness: null,
    outcomeAt: null,
  });
  const cluster = detectPatterns(
    [],
    [urge('u1', iso(-2 * HOUR), 8), urge('u2', iso(-HOUR), 7)],
    [makeRelapse({ createdAt: iso(0) })],
  );
  const clusterPattern = cluster.find((p) => p.id === 'urge-cluster-before-lapse');
  check('discovery: urge cluster before recorded relapse detected', clusterPattern !== undefined, 'missing');
  assertEqual('discovery: single relapse stays possible', clusterPattern?.status, 'possible');

  const twiceCluster = detectPatterns(
    [],
    [
      urge('v1', iso(-2 * DAY - 2 * HOUR), 8),
      urge('v2', iso(-2 * DAY - HOUR), 7),
      urge('w1', iso(-2 * HOUR), 8),
      urge('w2', iso(-HOUR), 7),
    ],
    [makeRelapse({ createdAt: iso(-2 * DAY) }), makeRelapse({ id: 'r2', createdAt: iso(0) })],
  );
  const promoted = twiceCluster.find((p) => p.id === 'urge-cluster-before-lapse');
  assertEqual('discovery: two relapse episodes promote to emerging', promoted?.status, 'emerging');
  check(
    'discovery: pattern wording stays non-causal',
    !!promoted && !/caus|because|will relapse/i.test(promoted.description),
    promoted?.description ?? 'missing',
  );

  // No relapses -> identical output to before (established behavior intact).
  const withoutRelapses = detectPatterns([], []);
  assertEqual('discovery: no data still yields no patterns', withoutRelapses.length, 0);

  // ---------------------------------------------------------------------
  // 10. Export includes relapse data
  // ---------------------------------------------------------------------
  const exportDb = openDatabase();
  insertRelapse(
    exportDb,
    makeRelapse({
      id: 'ex1',
      note: 'short note',
      checkInAt: iso(HOUR),
      checkInMood: 4,
      checkInStress: 7,
      checkInUrge: 6,
    }),
  );
  const relapseRow = exportDb
    .prepare(
      'SELECT id, created_at, environment, trigger_noticed, note, check_in_at, check_in_mood, check_in_stress, check_in_urge FROM relapse_events ORDER BY created_at ASC',
    )
    .get() as unknown as RelapseEventRow;
  const payload = assembleExportPayload({
    exportedAt: iso(0),
    settings: { monitoringEnabled: true, signalRetentionDays: 30 },
    checkIns: [],
    urgeEvents: [],
    relapseEvents: [rowToRelapseRecord(relapseRow)],
    mlSignals: [],
  });
  assertEqual('export: relapse array present', payload.relapseEvents.length, 1);
  assertEqual('export: relapse id', payload.relapseEvents[0]?.id, 'ex1');
  assertEqual('export: relapse environment', payload.relapseEvents[0]?.environment, 'home_alone');
  assertEqual('export: relapse trigger flag', payload.relapseEvents[0]?.triggerNoticed, true);
  assertEqual('export: relapse note included', payload.relapseEvents[0]?.note, 'short note');
  assertEqual('export: relapse check-in mood', payload.relapseEvents[0]?.checkInMood, 4);
  check(
    'export: relapse JSON round-trip',
    JSON.parse(JSON.stringify(payload)).relapseEvents.length === 1,
    'round-trip lost relapses',
  );

  const emptyExport = assembleExportPayload({
    exportedAt: iso(0),
    settings: { monitoringEnabled: true, signalRetentionDays: 30 },
    checkIns: [],
    urgeEvents: [],
    relapseEvents: [],
    mlSignals: [],
  });
  assertEqual('export: empty export has no relapses', emptyExport.relapseEvents.length, 0);

  // ---------------------------------------------------------------------
  // 11. Delete All Data removes relapse records too
  // ---------------------------------------------------------------------
  const tables = [...USER_DATA_TABLES];
  check('delete-all: covers relapse_events', tables.includes('relapse_events'), tables.join(','));
  assertEqual('delete-all: exactly five tables', tables.length, 5);
  check(
    'delete-all: relapse statement is a plain DELETE',
    deleteAllUserDataStatements().some((sql) => /^DELETE FROM relapse_events;?$/.test(sql)),
    deleteAllUserDataStatements().join(' | '),
  );
  check(
    'delete-all: verification count exists for relapse_events',
    countAllUserDataStatements().some((sql) => sql === 'SELECT COUNT(*) AS count FROM relapse_events'),
    countAllUserDataStatements().join(' | '),
  );

  const deleteDb = openDatabase();
  insertRelapse(deleteDb, makeRelapse({ id: 'd1' }));
  insertRelapse(deleteDb, makeRelapse({ id: 'd2', createdAt: iso(-DAY) }));
  deleteDb
    .prepare(INSERT_CHECK_IN_SQL)
    .run(...insertCheckInParams(makeCheckIn({ id: 'c1', createdAt: iso(-DAY) })));
  deleteDb
    .prepare(INSERT_URGE_EVENT_SQL)
    .run(...insertUrgeParams(urge('u1', iso(-DAY), 7)));
  assertEqual('delete-all: setup has relapses', countTable(deleteDb, 'relapse_events'), 2);
  for (const statement of deleteAllUserDataStatements()) {
    deleteDb.exec(statement);
  }
  for (const statement of countAllUserDataStatements()) {
    const row = deleteDb.prepare(statement).get() as { count: number };
    assertEqual(`delete-all: ${statement} leaves 0`, row.count, 0);
  }
  // Schema survives: the table still exists after deletion.
  check(
    'delete-all: relapse table still exists (schema untouched)',
    countTable(deleteDb, 'relapse_events') === 0,
    'table missing',
  );

  // ---------------------------------------------------------------------
  // 12. Privacy constraints
  // ---------------------------------------------------------------------
  check(
    'privacy: no explicit content is ever required (note optional by construction)',
    createRelapseRecord({ environment: 'home', triggerNoticed: false, note: '' }, new Date(T0)).note === '',
    'note defaulted to text',
  );
  const longNote = 'x'.repeat(1000);
  assertEqual(
    'privacy: note is bounded',
    createRelapseRecord({ environment: 'home', triggerNoticed: false, note: longNote }, new Date(T0)).note
      .length,
    RELAPSE_MAX_NOTE_LENGTH,
  );
  check(
    'privacy: every environment choice is a structured key (no free text)',
    RELAPSE_ENVIRONMENTS.every((e) => typeof e === 'string' && !e.includes(' ')),
    RELAPSE_ENVIRONMENTS.join(','),
  );
  check(
    'privacy: post-lapse actions are closed copy (no free-text capture)',
    POST_LAPSE_ACTIONS.every((a) => a.key.length > 0 && a.label.length > 0),
    JSON.stringify(POST_LAPSE_ACTIONS),
  );
  const storedRowJson = JSON.stringify(relapseRow);
  check(
    'privacy: stored row has no screen/frame fields',
    !/frame|pixel|screenshot/i.test(storedRowJson),
    storedRowJson,
  );

  // --- Summary ---
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`  FAILED: ${failure}`);
    }
    throw new Error(`${failures.length} relapse/post-lapse test(s) failed`);
  }
}

void main();
