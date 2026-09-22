// Deterministic tests for the Pattern Engine. Run with: npm test
//
// Every record below is constructed explicitly in the test, so the engine is
// measured against known input rather than against real user data. No pattern is
// invented and no causal claim is asserted.
import {
  confidenceForCount,
  detectPatterns,
  hasEnoughEvidence,
  statusForCount,
  type DetectedPattern,
} from './patternEngine';
import type { CheckIn } from '../screens/checkInModel';
import type { UrgeEvent } from '../screens/urgeModel';

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

const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString();
}

function checkIn(overrides: Partial<CheckIn> & { createdAt: string; id: string }): CheckIn {
  return {
    mood: 7,
    urge: 2,
    energy: 7,
    stress: 2,
    controlled: true,
    ...overrides,
  };
}

function urge(overrides: Partial<UrgeEvent> & { createdAt: string; id: string }): UrgeEvent {
  return {
    intensity: 5,
    context: '',
    feeling: '',
    state: 'low_risk',
    score: 2,
    intervention: '',
    afterIntensity: null,
    effectiveness: null,
    outcomeAt: null,
    ...overrides,
  };
}

function byId(patterns: DetectedPattern[], id: string): DetectedPattern | undefined {
  return patterns.find((pattern) => pattern.id === id);
}

// --- 1. No data -> no patterns (nothing is fabricated) ---
assertEqual('empty input yields no patterns', detectPatterns([], []).length, 0);
check('empty input is not enough evidence', !hasEnoughEvidence([]), 'reported enough evidence');

// --- 2. Status/confidence mappings are transparent ---
assertEqual('status count 1 is possible', statusForCount(1), 'possible');
assertEqual('status count 2 is emerging', statusForCount(2), 'emerging');
assertEqual('status count 3 is emerging', statusForCount(3), 'emerging');
assertEqual('status count 4 is recurring', statusForCount(4), 'recurring');
assertEqual('confidence count 6', confidenceForCount(6), 0.75);
check(
  'confidence rises with count but stays below 1',
  confidenceForCount(50) > confidenceForCount(6) && confidenceForCount(50) <= 0.9,
  `got ${confidenceForCount(50)}`,
);

// --- 3. Six distress -> high-urge sequences -> recurring ---
const recurringCheckIns: CheckIn[] = [];
const recurringUrges: UrgeEvent[] = [];
for (let i = 0; i < 6; i += 1) {
  recurringCheckIns.push(
    checkIn({ id: `c${i}`, createdAt: iso(i * DAY), stress: 8, mood: 3 }),
  );
  recurringUrges.push(urge({ id: `u${i}`, createdAt: iso(i * DAY + 2 * HOUR), intensity: 7 }));
}
const recurring = detectPatterns(recurringCheckIns, recurringUrges);
const distressPattern = byId(recurring, 'distress-before-high-urge');
check('distress pattern detected', distressPattern !== undefined, 'pattern missing');
assertEqual('distress pattern occurrences', distressPattern?.occurrenceCount, 6);
assertEqual('distress pattern status', distressPattern?.status, 'recurring');
assertEqual('distress pattern confidence', distressPattern?.confidence, 0.75);
check(
  'distress pattern has one evidence entry per occurrence',
  distressPattern?.evidence.length === 6,
  `got ${distressPattern?.evidence.length}`,
);
check('enough evidence for recurring', hasEnoughEvidence(recurring), 'not enough evidence');
check(
  'distress evidence is ordered chronologically',
  (distressPattern?.evidence[0]?.at ?? '') < (distressPattern?.evidence[5]?.at ?? ''),
  'evidence out of order',
);
check(
  'distress description makes no causal claim',
  !!distressPattern &&
    !/caus|because|made you|led to|due to/i.test(distressPattern.description),
  `description: ${distressPattern?.description}`,
);
check(
  'distress first/last seen are real stored timestamps',
  distressPattern?.firstSeenAt === iso(2 * HOUR) && distressPattern?.lastSeenAt === iso(5 * DAY + 2 * HOUR),
  `got ${distressPattern?.firstSeenAt} .. ${distressPattern?.lastSeenAt}`,
);

// --- 4. A lapse preceded by two high urges -> emerging ---
const lapseCheckIns: CheckIn[] = [
  checkIn({ id: 'l0', createdAt: iso(10 * DAY), controlled: false }),
  checkIn({ id: 'l1', createdAt: iso(20 * DAY), controlled: false }),
];
const lapseUrges: UrgeEvent[] = [
  urge({ id: 'lu0', createdAt: iso(10 * DAY - 2 * HOUR), intensity: 8 }),
  urge({ id: 'lu1', createdAt: iso(10 * DAY - 1 * HOUR), intensity: 7 }),
  urge({ id: 'lu2', createdAt: iso(20 * DAY - 2 * HOUR), intensity: 8 }),
  urge({ id: 'lu3', createdAt: iso(20 * DAY - 1 * HOUR), intensity: 9 }),
];
const lapse = detectPatterns(lapseCheckIns, lapseUrges);
const lapsePattern = byId(lapse, 'urge-cluster-before-lapse');
check('lapse cluster detected', lapsePattern !== undefined, 'pattern missing');
assertEqual('lapse cluster occurrences', lapsePattern?.occurrenceCount, 2);
assertEqual('lapse cluster status', lapsePattern?.status, 'emerging');
check('enough evidence for emerging', hasEnoughEvidence(lapse), 'not enough evidence');

// --- 5. A single sighting stays "possible" and is not promoted ---
const single = detectPatterns(
  [checkIn({ id: 's0', createdAt: iso(0), stress: 9 })],
  [urge({ id: 'su0', createdAt: iso(HOUR), intensity: 8 })],
);
assertEqual('single sighting occurrences', byId(single, 'distress-before-high-urge')?.occurrenceCount, 1);
assertEqual('single sighting status', byId(single, 'distress-before-high-urge')?.status, 'possible');
check('single sighting is not enough evidence', !hasEnoughEvidence(single), 'over-promoted');

// --- 6. Events outside the window are not linked ---
const outside = detectPatterns(
  [checkIn({ id: 'o0', createdAt: iso(0), stress: 9 })],
  [urge({ id: 'ou0', createdAt: iso(48 * HOUR), intensity: 8 })],
);
assertEqual('outside-window sequence is not detected', outside.length, 0);

// --- 7. Low signals do not form a pattern ---
const calm = detectPatterns(
  [checkIn({ id: 'k0', createdAt: iso(0) }), checkIn({ id: 'k1', createdAt: iso(DAY) })],
  [urge({ id: 'ku0', createdAt: iso(HOUR), intensity: 3 })],
);
assertEqual('calm data yields no patterns', calm.length, 0);

// --- Summary ---
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`  FAILED: ${failure}`);
  }
  throw new Error(`${failures.length} pattern engine test(s) failed`);
}
