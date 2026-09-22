// Deterministic tests for the privacy filter and signal pipeline. Run with: npm test
import {
  ALLOWED_VISUAL_LABELS,
  detectSensitive,
  redactSensitive,
  screenText,
  screenVisual,
} from './privacyFilter';
import { processSignal, processSignals, type RawSignal } from './signalPipeline';

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

// --- 1. Sensitive content is detected ---
assertEqual('detects password', detectSensitive('my password: hunter2').includes('password'), true);
assertEqual('detects otp', detectSensitive('your OTP is 483920').includes('otp'), true);
assertEqual(
  'detects jwt',
  detectSensitive('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123XYZ').includes(
    'auth_token',
  ),
  true,
);
assertEqual(
  'detects api key assignment',
  detectSensitive('api_key=abcdef1234567890').includes('api_key'),
  true,
);
assertEqual(
  'detects sk-prefixed key',
  detectSensitive('sk-abcdefghijklmnop1234').includes('api_key'),
  true,
);
assertEqual('detects ssn', detectSensitive('ssn 123-45-6789').includes('government_id'), true);
assertEqual(
  'detects valid card number',
  detectSensitive('4242 4242 4242 4242').includes('payment_card'),
  true,
);

// --- 2. Ordinary text and numbers are NOT flagged ---
assertEqual('plain text is clean', detectSensitive('I felt anxious after work today.').length, 0);
assertEqual('bare 4-digit number is clean', detectSensitive('I checked in at 1720').length, 0);
assertEqual(
  'random 16-digit run failing luhn is clean',
  detectSensitive('1234 1234 1234 1234').length,
  0,
);

// --- 3. Redaction keeps the surrounding text ---
const redacted = redactSensitive('password: hunter2 and then I left');
check('redaction replaces secret', !redacted.text.includes('hunter2'), redacted.text);
check('redaction keeps context', redacted.text.includes('and then I left'), redacted.text);
check('redaction reports kind', redacted.redactions.includes('password'), 'missing kind');

// --- 4. screenText rejects sensitive text entirely ---
const blocked = screenText('my token is eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.zzzz1111');
check('sensitive text is rejected', !blocked.allowed, 'was allowed');
assertEqual('rejected text is empty', blocked.text, '');
check('rejection has a reason', !!blocked.reason, 'no reason');

// --- 5. Visual signals may only be coarse labels ---
for (const label of ALLOWED_VISUAL_LABELS) {
  check(`visual label "${label}" allowed`, screenVisual(label).allowed, 'rejected');
}
check('data URI visual rejected', !screenVisual('data:image/png;base64,iVBORw0KGgo=').allowed, 'allowed');
check('bare base64 visual rejected', !screenVisual('iVBORw0KGgoAAAANSUhEUg').allowed, 'allowed');

// --- 6. Pipeline kill switch ---
const baseRaw: RawSignal = { timestamp: 1_700_000_000_000, source: 'self_report', textSignal: 'feeling low' };
const disabled = processSignal(baseRaw, { enabled: false });
check('disabled pipeline rejects', !disabled.accepted, 'accepted while disabled');

// --- 7. Pipeline accepts a clean signal and preserves fields ---
const accepted = processSignal({
  timestamp: 1_700_000_000_000,
  source: 'usage_stats',
  appCategory: 'social',
  activityType: 'scroll',
  textSignal: 'I noticed I was scrolling a lot',
});
check('clean signal accepted', accepted.accepted, 'rejected');
if (accepted.accepted) {
  assertEqual('accepted source preserved', accepted.signal.source, 'usage_stats');
  assertEqual('accepted appCategory preserved', accepted.signal.appCategory, 'social');
  assertEqual('accepted activityType preserved', accepted.signal.activityType, 'scroll');
}

// --- 8. Pipeline rejects sensitive / malformed content ---
check(
  'pipeline rejects sensitive text',
  !processSignal({ timestamp: 1, source: 'manual', textSignal: 'password: hunter2' }).accepted,
  'accepted secret',
);
check(
  'pipeline rejects raw image visual',
  !processSignal({ timestamp: 1, source: 'manual', visualSignal: 'data:image/png;base64,AAAA' }).accepted,
  'accepted image',
);
check(
  'pipeline rejects invalid timestamp',
  !processSignal({ timestamp: NaN, source: 'manual', activityType: 'open' }).accepted,
  'accepted bad timestamp',
);
check(
  'pipeline rejects empty signal',
  !processSignal({ timestamp: 1, source: 'manual' }).accepted,
  'accepted empty',
);

// --- 9. Batch drops rejected signals with reasons ---
const batch = processSignals([
  { timestamp: 1, source: 'manual', activityType: 'open' },
  { timestamp: 2, source: 'manual', textSignal: 'password: hunter2' },
  { timestamp: 3, source: 'manual', visualSignal: 'video' },
]);
assertEqual('batch accepted count', batch.accepted.length, 2);
assertEqual('batch rejected count', batch.rejected.length, 1);
check('batch rejection carries reason', batch.rejected[0]?.reason.length > 0, 'no reason');

// --- Summary ---
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`  FAILED: ${failure}`);
  }
  throw new Error(`${failures.length} privacy pipeline test(s) failed`);
}
