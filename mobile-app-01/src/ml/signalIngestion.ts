// Ingestion bridge: the single path from USER-PROVIDED TEXT to stored ML signals.
//
//     user text
//       -> signalPipeline.processSignal   (kill switch + privacy filter FIRST)
//       -> mlRuntime classifier           (local ONNX adapter, trained labels only)
//       -> MlSignalObservation rows       (label, confidence, model version)
//       -> Pattern Engine summaries       (see engine/patternEngine.ts)
//
// Nothing here generates therapeutic text, states causation, or diagnoses the
// user: failures are returned as reasons, successes as plain numbers. The
// function never throws — a classification problem must not break the flow that
// supplied the text (e.g. the Urge capture).
//
// The user's text itself is NOT persisted by this module; it stays wherever the
// caller already stores it (urge_events.trigger / context). Only the observation
// record is written.
import { processSignal, type SignalSource } from '../services/signalPipeline';
import { getTriggerClassifier } from './mlRuntime';
import type { MlSignalObservation } from '../engine/patternEngine';
import type { TriggerFailureStage, TriggerSignal } from './triggerClassifier';

/**
 * Storage contract for observation rows. Like the persistence layer's own
 * driver-free pattern, the SQLite repository is INJECTED by the caller (the
 * screen passes `saveMlSignalObservation`), so this module has no database
 * import and runs unchanged in plain Node tests.
 */
export type MlSignalStore = (event: MlSignalObservation) => { ok: boolean; error?: string };

/** Outcome of one ingestion attempt. Never throws; every field is honest. */
export interface TextSignalIngestResult {
  /** False when the privacy pipeline rejected the text (nothing was classified). */
  accepted: boolean;
  /** True only when the model produced a validated inference. */
  classified: boolean;
  /** How many observation rows were actually persisted. */
  stored: number;
  /** The model's threshold-filtered signals, strongest first (empty unless classified). */
  signals: readonly TriggerSignal[];
  /** Present when `accepted` or `classified` is false. */
  stage?: TriggerFailureStage;
  reason?: string;
}

/**
 * Runs user-provided text through the full local boundary.
 *
 * Order is fixed and auditable:
 *   0. monitoring kill switch (the user's explicit setting wins over everything),
 *   1. privacy pipeline (rejects empty/sensitive text BEFORE any model call),
 *   2. local classifier (returns probabilities for trained labels only),
 *   3. persistence of one observation row per emitted signal.
 *
 * `monitoringEnabled` is the Settings kill switch. It defaults to true (the
 * product default), and when false the text is rejected BEFORE the privacy
 * filter and any model call: no inference, no observation rows. The manual
 * urge/check-in flows keep working — only the monitoring-derived ML pass is
 * suppressed.
 */
export async function ingestUserText(args: {
  readonly text: string;
  readonly originSource: SignalSource;
  readonly timestamp: number;
  /** Observation storage, e.g. `saveMlSignalObservation` from the repository. */
  readonly store: MlSignalStore;
  /** Settings kill switch; defaults to true when the caller does not pass it. */
  readonly monitoringEnabled?: boolean;
}): Promise<TextSignalIngestResult> {
  const store = args.store;
  const monitoringEnabled = args.monitoringEnabled ?? true;
  const emptySignals: TriggerSignal[] = [];

  // 0. Kill switch BEFORE the filter and any model work. The user's explicit
  //    setting wins over every automated step below.
  if (!monitoringEnabled) {
    return {
      accepted: false,
      classified: false,
      stored: 0,
      signals: emptySignals,
      stage: 'privacy',
      reason: 'Recovery monitoring is disabled.',
    };
  }

  // 1. Privacy filter BEFORE inference. A sensitive or empty text never reaches
  //    the tokenizer or the session. The pipeline's own kill switch runs here
  //    too, as a second independent layer.
  const pipeline = processSignal(
    { timestamp: args.timestamp, source: args.originSource, textSignal: args.text },
    { enabled: monitoringEnabled },
  );
  if (!pipeline.accepted) {
    return {
      accepted: false,
      classified: false,
      stored: 0,
      signals: emptySignals,
      stage: 'privacy',
      reason: pipeline.reason,
    };
  }

  // 2. Local inference through the bound adapter (unavailable is a valid state
  //    and simply reports `stage: 'model'`).
  const classifier = getTriggerClassifier();
  const result = await classifier.classify(pipeline.signal.textSignal ?? '');
  if (!result.ok) {
    return {
      accepted: true,
      classified: false,
      stored: 0,
      signals: emptySignals,
      stage: result.stage,
      reason: result.reason,
    };
  }

  // 3. Persist one observation per emitted signal. A storage failure is reported
  //    in `stored` vs `signals.length` rather than thrown.
  let stored = 0;
  for (const signal of result.inference.signals) {
    const saved = store({
      id: `${args.timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date(args.timestamp).toISOString(),
      label: signal.label,
      confidence: signal.confidence,
      source: 'ml',
      originSource: args.originSource,
      modelId: result.inference.modelId,
      modelVersion: result.inference.modelVersion,
    });
    if (saved.ok) stored += 1;
  }

  return {
    accepted: true,
    classified: true,
    stored,
    signals: result.inference.signals,
  };
}
