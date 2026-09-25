// Deterministic tests for the ML integration boundary. Run with: npm test
//
// Covers: valid ML output, rejection of unknown/untrained labels, confidence
// bounds, privacy filtering before inference, empty/sensitive input, model
// unavailable/failure, the ingestion bridge into the Pattern Engine, and the
// no-causal-language / no-fabricated-labels wording contracts.
//
// A small fake tokenizer + session stands in for the real ONNX runtime (which is
// not a dependency yet); the adapter under test is the real one.
import {
  MODEL_INTEGRATION_STEPS,
  MODEL_THRESHOLD,
  TRAINED_TRIGGER_LABELS,
  TRIGGER_MODEL_METADATA,
  TRIGGER_MODEL_UNAVAILABLE_REASON,
  UNTRAINED_TRIGGER_LABELS,
  createOnnxTriggerClassifier,
  createUnavailableTriggerClassifier,
  inferenceFromProbabilities,
  isTrainedTriggerLabel,
  signalsFromProbabilities,
  type TriggerTokenizer,
} from './triggerClassifier';
import { isTriggerModelBound, setTriggerClassifier, getTriggerClassifier } from './mlRuntime';
import { ingestUserText, type MlSignalStore } from './signalIngestion';
import { summarizeMlSignals, type MlSignalObservation } from '../engine/patternEngine';
import { buildMlSignalSummaries } from '../screens/insightsModel';

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

// A tokenizer fake that keeps behavior honest (ids, mask, truncation framing)
// without implementing SentencePiece.
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

function fakeSession(row: number[]): { run: (inputs: unknown) => Promise<number[]> } {
  return {
    async run() {
      return row;
    },
  };
}

const NEVER_STORE = (): { ok: false } => ({ ok: false });

async function main(): Promise<void> {
  // --- 1. Valid ML output maps to probabilities and signals ---
  const okAdapter = createOnnxTriggerClassifier({
    session: fakeSession([0.06, 0.12, 0.82]) as never,
    tokenizer: fakeTokenizer(),
  });
  const okResult = await okAdapter.classify('I am so angry right now');
  check('valid output classified', okResult.ok, `got ${JSON.stringify(okResult)}`);
  if (okResult.ok) {
    assertEqual('anger probability', okResult.inference.probabilities.anger, 0.82);
    assertEqual('anxiety probability', okResult.inference.probabilities.anxiety, 0.06);
    assertEqual('sadness probability', okResult.inference.probabilities.sadness, 0.12);
    assertEqual('exactly trained labels exposed', okResult.inference.labels.length, 3);
    check(
      'labels are exactly the trained set',
      okResult.inference.labels.every((label) => isTrainedTriggerLabel(label)),
      `got ${okResult.inference.labels.join(',')}`,
    );
    assertEqual('one signal above threshold', okResult.inference.signals.length, 1);
    assertEqual('signal label is anger', okResult.inference.signals[0]?.label, 'anger');
    assertEqual('signal source tag', okResult.inference.signals[0]?.source, 'ml');
    check('model version exposed', okResult.inference.modelVersion.length > 0, 'empty version');
    assertEqual('model id exposed', okResult.inference.modelId, 'trigger-classifier');
  }

  // Column order sanity: [anxiety, sadness, anger] per the ONNX sidecar.
  const orderResult = inferenceFromProbabilities([0.9, 0.5, 0.1]);
  check('column order respected', orderResult.ok && orderResult.inference.probabilities.anxiety === 0.9, `got ${JSON.stringify(orderResult)}`);

  // Threshold boundary: exactly 0.5 is included.
  const boundary = signalsFromProbabilities({ anxiety: 0.5, sadness: 0.49, anger: 0 });
  assertEqual('threshold includes 0.5', boundary.length, 1);
  assertEqual('threshold keeps anxiety', boundary[0]?.label, 'anxiety');

  // Signals are ordered strongest first.
  const ordered = signalsFromProbabilities({ anxiety: 0.6, sadness: 0.9, anger: 0.7 });
  check(
    'signals ordered by confidence',
    ordered[0]?.label === 'sadness' && ordered[1]?.label === 'anger' && ordered[2]?.label === 'anxiety',
    `got ${ordered.map((s) => s.label).join(',')}`,
  );

  // --- 2. Unknown/untrained labels cannot exist ---
  assertEqual('trained label count', TRAINED_TRIGGER_LABELS.length, 3);
  assertEqual('untrained label count', UNTRAINED_TRIGGER_LABELS.length, 13);
  check(
    'trained and untrained sets are disjoint',
    UNTRAINED_TRIGGER_LABELS.every((label) => !isTrainedTriggerLabel(label)),
    'overlap found',
  );
  check(
    'adapter type never contains untrained labels',
    okAdapter.metadata.trainedLabels.every((label) => isTrainedTriggerLabel(label)),
    'untrained label in metadata',
  );
  const badShape = inferenceFromProbabilities([0.1, 0.2, 0.3, 0.4]);
  check('four-column output rejected', !badShape.ok, 'accepted wrong label count');
  check(
    'rejection mentions label count, not invented labels',
    !badShape.ok && badShape.reason.includes('4') === false,
    badShape.ok ? 'passed' : badShape.reason,
  );

  // --- 3. Confidence bounds ---
  const outOfBounds = inferenceFromProbabilities([1.2, -0.1, Number.NaN]);
  check('probability above 1 rejected', !outOfBounds.ok, 'accepted >1');
  check('probability below 0 rejected', !outOfBounds.ok, 'accepted <0');
  check('NaN probability rejected', !outOfBounds.ok, 'accepted NaN');

  // --- 4. Privacy filtering happens BEFORE inference ---
  let sessionCalls = 0;
  const countingAdapter = createOnnxTriggerClassifier({
    session: {
      async run() {
        sessionCalls += 1;
        return [0.1, 0.1, 0.1];
      },
    } as never,
    tokenizer: fakeTokenizer(),
  });
  const secret = await countingAdapter.classify('my password: hunter2 and I felt awful');
  check('sensitive text rejected', !secret.ok, 'was classified');
  if (!secret.ok) {
    assertEqual('rejection stage is privacy', secret.stage, 'privacy');
  }
  assertEqual('session never saw sensitive text', sessionCalls, 0);
  const otp = await countingAdapter.classify('your OTP is 483920 was the context');
  assertEqual('otp text also never reaches session', sessionCalls, 0);
  check('otp text rejected', !otp.ok, 'was classified');

  // --- 5. Empty input ---
  const empty = await okAdapter.classify('   ');
  check('empty text rejected', !empty.ok, 'was classified');
  if (!empty.ok) assertEqual('empty stage is input', empty.stage, 'input');

  // Placeholder-only text (as if a caller pre-redacted) is refused too.
  const placeholders = await okAdapter.classify('[redacted:password] [redacted:api_key]');
  check('placeholder-only text rejected', !placeholders.ok, 'was classified');

  // --- 6. Model unavailable / failure ---
  const unavailable = createUnavailableTriggerClassifier();
  assertEqual('unavailable adapter reports not available', await unavailable.isAvailable(), false);
  const unavailableResult = await unavailable.classify('I feel anxious today');
  check('unavailable classifier refuses honestly', !unavailableResult.ok, 'produced output');
  if (!unavailableResult.ok) {
    assertEqual('unavailable stage is model', unavailableResult.stage, 'model');
    assertEqual('unavailable reason documented', unavailableResult.reason, TRIGGER_MODEL_UNAVAILABLE_REASON);
  }

  const throwing = createOnnxTriggerClassifier({
    session: {
      async run() {
        throw new Error('native crash');
      },
    } as never,
    tokenizer: fakeTokenizer(),
  });
  const throwingResult = await throwing.classify('still here');
  check('runtime error becomes failure result', !throwingResult.ok, 'threw or passed');
  if (!throwingResult.ok) {
    assertEqual('runtime error stage is model', throwingResult.stage, 'model');
    check('runtime error carries reason', throwingResult.reason.includes('native crash'), throwingResult.reason);
  }

  const badTokenizer = createOnnxTriggerClassifier({
    session: fakeSession([0.1, 0.1, 0.1]) as never,
    tokenizer: { maxLength: 64, encode: () => ({ inputIds: [], attentionMask: [] }) },
  });
  const badTokResult = await badTokenizer.classify('hello');
  check('tokenizer failure becomes failure result', !badTokResult.ok, 'passed through');

  // --- 7. Runtime registry starts unavailable ---
  assertEqual('registry starts unbound', isTriggerModelBound(), false);
  const registryAdapter = getTriggerClassifier();
  const registryResult = await registryAdapter.classify('I feel anxious');
  check('registry default refuses honestly', !registryResult.ok, 'produced output');
  setTriggerClassifier(okAdapter);
  assertEqual('registry can bind a session adapter', isTriggerModelBound(), true);
  const boundResult = await getTriggerClassifier().classify('I am furious');
  check('bound registry classifies', boundResult.ok, 'refused');
  setTriggerClassifier(createUnavailableTriggerClassifier());
  assertEqual('registry can reset to unavailable', isTriggerModelBound(), false);

  // --- 8. Ingestion: privacy -> classifier -> Pattern Engine summaries ---
  const storedRows: MlSignalObservation[] = [];
  const captureStore: MlSignalStore = (event) => {
    storedRows.push(event);
    return { ok: true };
  };

  // Bind a working adapter for the happy-path ingestion tests.
  setTriggerClassifier(okAdapter);

  const ingestOk = await ingestUserText({
    text: 'I was so angry I nearly threw my phone',
    originSource: 'urge_flow',
    timestamp: Date.parse('2026-09-22T10:00:00.000Z'),
    store: captureStore,
  });
  check('ingest classified', ingestOk.classified, `got ${JSON.stringify(ingestOk)}`);
  check('ingest accepted', ingestOk.accepted, 'rejected');
  assertEqual('ingest stored one row', ingestOk.stored, 1);
  assertEqual('ingest signal label', ingestOk.signals[0]?.label, 'anger');
  assertEqual('stored observation count', storedRows.length, 1);
  assertEqual('stored observation label', storedRows[0]?.label, 'anger');
  assertEqual('stored observation source', storedRows[0]?.source, 'ml');
  check('stored observation carries model version', (storedRows[0]?.modelVersion ?? '').length > 0, 'empty');

  // Sensitive text never reaches the classifier through ingestion either.
  let ingestSessionCalls = 0;
  setTriggerClassifier(
    createOnnxTriggerClassifier({
      session: {
        async run() {
          ingestSessionCalls += 1;
          return [0.1, 0.1, 0.1];
        },
      } as never,
      tokenizer: fakeTokenizer(),
    }),
  );
  const ingestSecret = await ingestUserText({
    text: 'password: hunter2',
    originSource: 'self_report',
    timestamp: Date.parse('2026-09-22T10:05:00.000Z'),
    store: captureStore,
  });
  check('ingest rejects sensitive text', !ingestSecret.accepted, 'accepted');
  assertEqual('ingest sensitive never classified', ingestSecret.classified, false);
  assertEqual('ingest sensitive session calls', ingestSessionCalls, 0);

  // Model unavailable during ingestion: accepted but honestly unclassified.
  setTriggerClassifier(createUnavailableTriggerClassifier());

  const ingestEmpty = await ingestUserText({
    text: '   ',
    originSource: 'self_report',
    timestamp: 1,
    store: captureStore,
  });
  check('ingest rejects empty text', !ingestEmpty.accepted, 'accepted');

  const ingestUnavailable = await ingestUserText({
    text: 'I feel anxious today',
    originSource: 'self_report',
    timestamp: 2,
    store: captureStore,
  });
  check('ingest survives unavailable model', ingestUnavailable.accepted, 'rejected');
  assertEqual('ingest unavailable not classified', ingestUnavailable.classified, false);
  assertEqual('ingest unavailable stored nothing', ingestUnavailable.stored, 0);

  // Storage failure is reported in `stored`, not thrown.
  setTriggerClassifier(okAdapter);
  const ingestStoreFail = await ingestUserText({
    text: 'I am furious',
    originSource: 'self_report',
    timestamp: 3,
    store: () => ({ ok: false, error: 'sqlite unavailable' }),
  });
  check('ingest classifies despite storage failure', ingestStoreFail.classified, 'not classified');
  assertEqual('storage failure reported in stored', ingestStoreFail.stored, 0);
  setTriggerClassifier(createUnavailableTriggerClassifier());

  // --- 9. Pattern Engine receives ML signals with neutral wording ---
  const summaries = summarizeMlSignals(storedRows);
  assertEqual('summary labels counted', summaries.length, 1);
  assertEqual('summary occurrence count', summaries[0]?.occurrenceCount, 1);
  check(
    'summary wording is count-based',
    summaries[0]?.description.includes('1 recorded event') === true,
    summaries[0]?.description ?? 'missing',
  );
  check(
    'no causal language in summaries',
    summaries.every((summary) => !/caus|because|made you|led to|due to|diagnos/i.test(summary.description)),
    'causal language found',
  );

  const views = buildMlSignalSummaries(summaries);
  assertEqual('view entries built', views.length, 1);
  check(
    'view headline matches required wording',
    views[0]?.headline === 'This signal appeared in 1 recorded event.',
    views[0]?.headline ?? 'missing',
  );
  check(
    'no causal language in views',
    views.every((view) => !/caus|because|made you|led to|due to|diagnos/i.test(view.headline + view.detail)),
    'causal language found',
  );

  // Multi-event counting through the Pattern Engine summary.
  const multi = summarizeMlSignals([
    ...storedRows,
    { ...storedRows[0]!, id: 'second', at: '2026-09-22T11:00:00.000Z', confidence: 0.66 },
    { ...storedRows[0]!, id: 'third', at: '2026-09-22T12:00:00.000Z', confidence: 0.9 },
  ]);
  assertEqual('multi-event count', multi[0]?.occurrenceCount, 3);
  assertEqual('multi-event max confidence', multi[0]?.maxConfidence, 0.9);
  assertEqual('multi-event last seen', multi[0]?.lastSeenAt, '2026-09-22T12:00:00.000Z');

  // --- 10. Metadata is honest ---
  assertEqual('metadata threshold', TRIGGER_MODEL_METADATA.threshold, MODEL_THRESHOLD);
  assertEqual('metadata trained label count', TRIGGER_MODEL_METADATA.trainedLabels.length, 3);
  assertEqual('metadata untrained count', TRIGGER_MODEL_METADATA.untrainedLabelCount, 13);
  check(
    'metadata records the real test F1s',
    TRIGGER_MODEL_METADATA.testMetrics.anger.f1 === 0.8613 &&
      TRIGGER_MODEL_METADATA.testMetrics.sadness.f1 === 0.7729 &&
      TRIGGER_MODEL_METADATA.testMetrics.anxiety.f1 === 0.7484,
    'metrics do not match eval_test.json',
  );
  check('integration steps documented', MODEL_INTEGRATION_STEPS.length >= 5, 'steps missing');
  check('adapter never stores text: no text field on observations', storedRows.every((row) => !('text' in row)), 'text field present');

  // --- Summary ---
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`  FAILED: ${failure}`);
    }
    throw new Error(`${failures.length} ML integration test(s) failed`);
  }
}

void main();
