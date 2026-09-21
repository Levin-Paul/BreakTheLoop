// Deterministic tests for the Recovery Engine. Run with: npm test
// Uses plain assertions, no test framework.
import { getIntervention } from './interventionEngine';
import { calculateRecoveryState } from './recoveryEngine';
import type { RecoveryInput } from './types';

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
  check(
    label,
    actual === expected,
    `expected ${String(expected)}, got ${String(actual)}`,
  );
}

/** A calm, neutral check-in used as the baseline for every scenario. */
function baseline(overrides: Partial<RecoveryInput> = {}): RecoveryInput {
  return {
    urge: 2,
    stress: 2,
    mood: 7,
    energy: 7,
    recentUrgeCount: 0,
    recentRelapse: false,
    ...overrides,
  };
}

// --- 1. Normal input -> stable ---
const normal = calculateRecoveryState(baseline());
assertEqual('normal input score', normal.score, 0);
assertEqual('normal input state', normal.state, 'stable');
assertEqual(
  'normal input action',
  normal.recommendedAction,
  'No intervention needed. Continue normally.',
);
assertEqual('normal input has no reasons', normal.reasons.length, 0);

// --- 2. High urge -> low_risk ---
const highUrge = calculateRecoveryState(baseline({ urge: 8 }));
assertEqual('high urge score', highUrge.score, 4);
assertEqual('high urge state', highUrge.state, 'low_risk');
assertEqual(
  'high urge action',
  highUrge.recommendedAction,
  'Take a short break and check in with yourself.',
);
assertEqual('high urge reason count (only triggered rules)', highUrge.reasons.length, 1);

// High urge between 6 and 8 scores 2 (not 4).
const midUrge = calculateRecoveryState(baseline({ urge: 6 }));
assertEqual('urge 6 score', midUrge.score, 2);
assertEqual('urge 6 state', midUrge.state, 'stable');

// --- 3. High urge + high stress -> moderate_risk or higher ---
const urgeAndStress = calculateRecoveryState(baseline({ urge: 8, stress: 8 }));
assertEqual('urge 8 + stress 8 score', urgeAndStress.score, 6);
check(
  'urge 8 + stress 8 state is moderate or high',
  urgeAndStress.state === 'moderate_risk' || urgeAndStress.state === 'high_risk',
  `got ${urgeAndStress.state}`,
);
assertEqual(
  'urge 8 + stress 8 action',
  urgeAndStress.recommendedAction,
  'Step away from the current environment for 10 minutes.',
);

// --- 4. Multiple recent urges -> elevated risk ---
const twoUrges = calculateRecoveryState(baseline({ recentUrgeCount: 2 }));
assertEqual('2 recent urges score', twoUrges.score, 2);
assertEqual('2 recent urges state', twoUrges.state, 'stable');

const threeUrges = calculateRecoveryState(baseline({ recentUrgeCount: 3 }));
assertEqual('3 recent urges score', threeUrges.score, 3);
assertEqual('3 recent urges state', threeUrges.state, 'low_risk');
check(
  '3 recent urges is worse than baseline',
  threeUrges.score > normal.score,
  `${threeUrges.score} vs ${normal.score}`,
);

// --- 5. Recent relapse -> elevated risk ---
const relapse = calculateRecoveryState(baseline({ recentRelapse: true }));
assertEqual('recent relapse score', relapse.score, 3);
assertEqual('recent relapse state', relapse.state, 'low_risk');
check(
  'recent relapse is worse than baseline',
  relapse.score > normal.score,
  `${relapse.score} vs ${normal.score}`,
);

// --- 6. Score is clamped to 0-10 ---
const maxed = calculateRecoveryState(
  baseline({
    urge: 10,
    stress: 10,
    mood: 1,
    energy: 1,
    recentUrgeCount: 5,
    recentRelapse: true,
  }),
);
assertEqual('maxed out score is clamped to 10', maxed.score, 10);
assertEqual('maxed out state', maxed.state, 'high_risk');
assertEqual(
  'maxed out action',
  maxed.recommendedAction,
  'Leave the current environment, put the phone away, and move to a shared or public space for 10 minutes.',
);

// --- 7. getIntervention is the single source of intervention text ---
assertEqual(
  'getIntervention stable',
  getIntervention('stable'),
  'No intervention needed. Continue normally.',
);
assertEqual(
  'getIntervention high_risk',
  getIntervention('high_risk'),
  'Leave the current environment, put the phone away, and move to a shared or public space for 10 minutes.',
);

// --- Summary ---
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`  FAILED: ${failure}`);
  }
  throw new Error(`${failures.length} recovery engine test(s) failed`);
}
