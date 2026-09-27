// Deterministic tests for the model status boundary. Run with: npm test
//
// Covers: status when the runtime/model is available, status when unavailable
// (with the honest summarized reason), the exact trained label list, and the
// guarantee that no raw user text ever enters a status object.
import {
  getModelRuntimeStatus,
  summarizeStatusError,
  type ModelRuntimeStatus,
} from './modelStatus';
import {
  TRAINED_TRIGGER_LABELS,
  UNTRAINED_TRIGGER_LABELS,
  TRIGGER_MODEL_METADATA,
  createOnnxTriggerClassifier,
  createUnavailableTriggerClassifier,
  type TriggerTokenizer,
} from './triggerClassifier';
import { isTriggerModelBound, setTriggerClassifier, setTriggerModelUnavailableReason } from './mlRuntime';

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

function fakeTokenizer(maxLength = 64): TriggerTokenizer {
  return {
    maxLength,
    encode(text: string) {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, maxLength - 2);
      const inputIds = [101, ...words.map((_, i) => 1000 + i), 102];
      return { inputIds, attentionMask: inputIds.map(() => 1) };
    },
  };
}

async function main(): Promise<void> {
  // --- 1. Unavailable by default (fresh runtime binding) ---
  setTriggerClassifier(createUnavailableTriggerClassifier());
  const unavailable = getModelRuntimeStatus();
  assertEqual('unavailable: available flag', unavailable.available, false);
  assertEqual('unavailable: inferenceMode', unavailable.inferenceMode, 'local');
  assertEqual('unavailable: runtime name', unavailable.runtime, 'ONNX Runtime');
  assertEqual('unavailable: modelId', unavailable.modelId, 'trigger-classifier');
  check(
    'unavailable: honest error present',
    typeof unavailable.error === 'string' && unavailable.error.length > 0,
    'missing error',
  );
  check(
    'unavailable: error has no stack lines',
    unavailable.error !== undefined && !unavailable.error.includes('\n'),
    'error contains internal detail lines',
  );

  // --- 2. Deterministic projection of the same state ---
  const again = getModelRuntimeStatus();
  check(
    'status is deterministic for the same state',
    JSON.stringify(again) === JSON.stringify(unavailable),
    'two calls differed',
  );

  // --- 3. A concrete runtime failure surfaces a summarized honest reason ---
  setTriggerModelUnavailableReason(
    'ONNX trigger classifier failed to initialize: Unable to download asset from url: http://10.0.2.2:8081/assets/secret-path/model.onnx\n    at SomeInternalFrame',
  );
  const withReason = getModelRuntimeStatus();
  check(
    'failure reason summarized to first line',
    withReason.error !== undefined &&
      withReason.error.startsWith('ONNX trigger classifier failed to initialize'),
    withReason.error ?? 'missing',
  );
  check(
    'failure reason drops stack internals',
    withReason.error !== undefined && !withReason.error.includes('at SomeInternalFrame'),
    withReason.error ?? 'missing',
  );

  // --- 4. Available once a real session-backed adapter is bound ---
  const sessionAdapter = createOnnxTriggerClassifier({
    session: { async run() { return [0.1, 0.2, 0.7]; } },
    tokenizer: fakeTokenizer(),
  });
  setTriggerClassifier(sessionAdapter);
  check('available: runtime reports bound', isTriggerModelBound(), 'not bound');
  const available: ModelRuntimeStatus = getModelRuntimeStatus();
  assertEqual('available: available flag', available.available, true);
  assertEqual('available: inferenceMode', available.inferenceMode, 'local');
  check(
    'available: no error field',
    available.error === undefined,
    `unexpected error: ${available.error ?? ''}`,
  );

  // --- 5. Trained labels are exactly the three real ones, in tensor order ---
  const status = getModelRuntimeStatus();
  assertEqual('labels: count', status.trainedLabels.length, 3);
  check(
    'labels: exact list anger, sadness, anxiety (tensor order)',
    status.trainedLabels[0] === TRAINED_TRIGGER_LABELS[0] &&
      status.trainedLabels[1] === TRAINED_TRIGGER_LABELS[1] &&
      status.trainedLabels[2] === TRAINED_TRIGGER_LABELS[2],
    `got ${JSON.stringify(status.trainedLabels)}`,
  );
  check(
    'labels: no untrained label can appear in status',
    status.trainedLabels.every(
      (label) => !(UNTRAINED_TRIGGER_LABELS as readonly string[]).includes(label),
    ),
    'untrained label leaked into status',
  );
  check(
    'labels: metadata and status agree with the source of truth',
    TRIGGER_MODEL_METADATA.trainedLabels === TRAINED_TRIGGER_LABELS &&
      status.trainedLabels === TRAINED_TRIGGER_LABELS,
    'status does not use the source-of-truth list',
  );

  // --- 6. No raw user text can enter a status object ---
  setTriggerClassifier(createUnavailableTriggerClassifier());
  setTriggerModelUnavailableReason('runtime failed');
  const secret = 'my private urge text about exams and shame';
  const before = getModelRuntimeStatus();
  // The status API takes no input at all; simulate the strongest misuse: put
  // user text through the classifier, then read the status afterwards.
  const classifierWithText = createUnavailableTriggerClassifier();
  await classifierWithText.classify(secret);
  const after = getModelRuntimeStatus();
  const serialized = JSON.stringify(after) + JSON.stringify(before);
  check(
    'no user text in status before or after inference',
    !serialized.includes(secret) && !serialized.toLowerCase().includes('urge text'),
    'status leaked user text',
  );
  check(
    'status fields are only the documented set',
    (() => {
      const keys = Object.keys(after).sort().join(',');
      return keys === 'available,error,inferenceMode,modelId,runtime,trainedLabels';
    })(),
    `unexpected fields: ${Object.keys(after).join(',')}`,
  );

  // --- 7. summarizeStatusError edge cases ---
  assertEqual(
    'summarize: empty falls back to the honest default',
    summarizeStatusError('   '),
    'The local ONNX runtime is not integrated on this device yet, so no classification is performed.',
  );
  const long = 'x'.repeat(300);
  check(
    'summarize: very long reason is truncated',
    summarizeStatusError(long).length <= 140,
    'not truncated',
  );

  // --- Summary ---
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`  FAILED: ${failure}`);
    }
    throw new Error(`${failures.length} model status test(s) failed`);
  }
}

void main();
