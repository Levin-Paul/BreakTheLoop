// Typed adapter boundary for the local ONNX trigger classifier.
//
// This module is the ONLY place the rest of the app may touch the ML model. It
// wraps `ml/artifacts/trigger-classifier.onnx` (an ALBERT multi-label head whose
// graph already applies sigmoid per label) behind a narrow interface:
//
//     sanitized text -> tokenize -> ONNX session -> probabilities -> signals
//
// Hard rules enforced here, not left to callers:
//   - only the THREE labels that were actually trained exist in this module:
//     `anxiety`, `sadness`, `anger` (column order matches the training run and
//     the ONNX output tensor, see ml/artifacts/trigger-classifier.json). The
//     other 13 taxonomy labels are listed as UNTRAINED and can never be
//     returned, so no caller can accidentally present a fabricated prediction.
//   - user text ALWAYS passes the privacy filter before any session call, and a
//     signal that is only redaction placeholders is rejected outright.
//   - probabilities are validated (finite, within [0, 1], one per trained
//     label). A malformed model output is an error result, never mapped onto
//     invented labels.
//   - this module produces numbers and identifiers only. It never generates
//     therapeutic text, never states or implies causation, and never diagnoses
//     the user. Wording lives in the UI layers.
//
// NOTE ON THE RUNTIME: `onnxruntime-react-native` is NOT yet a dependency of
// mobile-app-01, so no session can be constructed yet. `createOnnxTriggerClassifier`
// accepts an injected session + tokenizer so the adapter, its validation and its
// tests are finished and verified independently of the native integration. See
// MODEL_INTEGRATION_STEPS for exactly what remains.
import { screenText } from '../services/privacyFilter';

/**
 * The labels the classifier was ACTUALLY trained on, in the exact column order
 * of the ONNX output tensor. Source of truth: ml/training/runs/
 * trigger-classifier/best/labels.json and ml/artifacts/trigger-classifier.json.
 * Column 0 of the output tensor is `anxiety`, column 1 `sadness`, column 2
 * `anger`. Changing this order requires re-exporting the model, not editing it.
 */
export const TRAINED_TRIGGER_LABELS = ['anxiety', 'sadness', 'anger'] as const;

export type TrainedTriggerLabel = (typeof TRAINED_TRIGGER_LABELS)[number];

/**
 * Taxonomy labels with NO training data (see ml/dataset/taxonomy.json). They are
 * kept here as an explicit negative space so tests and reviewers can verify the
 * adapter cannot emit them. DO NOT move a label into this list silently.
 */
export const UNTRAINED_TRIGGER_LABELS = [
  'stress',
  'boredom',
  'loneliness',
  'isolation',
  'fatigue',
  'sleep_deprivation',
  'procrastination',
  'doomscrolling',
  'social_media',
  'relationship_conflict',
  'academic_pressure',
  'work_pressure',
  'unknown',
] as const;

export type UntrainedTriggerLabel = (typeof UNTRAINED_TRIGGER_LABELS)[number];

/** Stable identifier of the model this adapter wraps. */
export const MODEL_ID = 'trigger-classifier';

/** Human-readable model version. First trained release (GoEmotions-derived data). */
export const MODEL_VERSION = 'trigger-classifier@1.0.0-albert-base-v2';

/** Fixed decision threshold recorded by the training run (checkpoint_meta.json). */
export const MODEL_THRESHOLD = 0.5;

/** Training used max_seq_len 64; tokenizers must respect it. */
export const MODEL_MAX_SEQUENCE_LENGTH = 64;

/** sha256 of ml/artifacts/trigger-classifier.onnx, for provenance checks. */
export const MODEL_ARTIFACT_SHA256 =
  'df60e372577ae9c01fdb0bcb60df0d4a4b57c30eaebee563dfa9c8b19b166c58';

/**
 * Held-out test metrics reported by ml/training/evaluate.py
 * (ml/training/runs/trigger-classifier/eval_test.json). Kept here as honest
 * provenance. These are text-classification metrics on public data — they are
 * NOT clinical validity and NOT a personalization result, and only cover the
 * three trained labels.
 */
export const MODEL_TEST_METRICS = {
  anxiety: { f1: 0.7484, support: 85 },
  sadness: { f1: 0.7729, support: 286 },
  anger: { f1: 0.8613, support: 498 },
} as const;

/** True only for one of the three trained labels. */
export function isTrainedTriggerLabel(value: string): value is TrainedTriggerLabel {
  return (TRAINED_TRIGGER_LABELS as readonly string[]).includes(value);
}

/** One ML-derived signal, ready for the Pattern Engine. */
export interface TriggerSignal {
  readonly label: TrainedTriggerLabel;
  /** The model's sigmoid probability for this label, in [0, 1]. */
  readonly confidence: number;
  /** Constant source tag so ML signals are never mixed with heuristic ones. */
  readonly source: 'ml';
}

/** Full, validated output of one model run. */
export interface TriggerInference {
  readonly modelId: typeof MODEL_ID;
  readonly modelVersion: typeof MODEL_VERSION;
  /** The trained labels in output-tensor column order. Nothing else, ever. */
  readonly labels: readonly TrainedTriggerLabel[];
  /** Probability per trained label. Keys are exactly `labels`. */
  readonly probabilities: Readonly<Record<TrainedTriggerLabel, number>>;
  /** Labels at or above `threshold`, strongest first. May be empty. */
  readonly signals: readonly TriggerSignal[];
  readonly threshold: number;
}

/** Static description of the model, safe to show in docs or UI. */
export const TRIGGER_MODEL_METADATA = {
  modelId: MODEL_ID,
  version: MODEL_VERSION,
  baseModel: 'albert-base-v2',
  task: 'multi_label_classification' as const,
  outputActivation: 'sigmoid' as const,
  threshold: MODEL_THRESHOLD,
  maxSequenceLength: MODEL_MAX_SEQUENCE_LENGTH,
  trainedLabels: TRAINED_TRIGGER_LABELS,
  untrainedLabelCount: UNTRAINED_TRIGGER_LABELS.length,
  testMetrics: MODEL_TEST_METRICS,
  artifactSha256: MODEL_ARTIFACT_SHA256,
} as const;

/**
 * Minimal session surface the adapter needs — deliberately the shape of an
 * ONNX Runtime session's `run` for this graph (`input_ids`, `attention_mask`
 * int64 tensors; `probabilities` float output flattened to one value per
 * trained label). A real `ort.InferenceSession` satisfies this with a 3-line
 * wrapper; tests use a fake.
 */
export interface TriggerModelSession {
  run(inputs: { readonly inputIds: readonly number[]; readonly attentionMask: readonly number[] }): Promise<ArrayLike<number>>;
}

/** Minimal tokenizer surface. ALBERT SentencePiece is NOT reimplemented here. */
export interface TriggerTokenizer {
  readonly maxLength: number;
  encode(text: string): { readonly inputIds: readonly number[]; readonly attentionMask: readonly number[] };
}

/** Why a classification attempt did not produce an inference. */
export type TriggerFailureStage =
  | 'input' // empty/whitespace text
  | 'privacy' // sensitive content or only redaction placeholders
  | 'model'; // unavailable, runtime error, or malformed output

export type TriggerClassificationResult =
  | { readonly ok: true; readonly inference: TriggerInference }
  | { readonly ok: false; readonly stage: TriggerFailureStage; readonly reason: string };

/** What every adapter can be asked, regardless of runtime status. */
export interface TriggerClassifierAdapter {
  readonly name: string;
  readonly metadata: typeof TRIGGER_MODEL_METADATA;
  /** Whether a session is actually loaded on this device. */
  isAvailable(): Promise<boolean>;
  /**
   * Classifies USER-PROVIDED text. The text is privacy-screened here first;
   * sensitive content never reaches the tokenizer or the session.
   */
  classify(text: string): Promise<TriggerClassificationResult>;
}

const REDACTION_PLACEHOLDER = /\[redacted:[a-z_]+\]/g;

function isProbabilityArray(value: ArrayLike<number>, expectedLength: number): value is ArrayLike<number> {
  if (value.length !== expectedLength) return false;
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!Number.isFinite(item) || item < 0 || item > 1) return false;
  }
  return true;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Builds the validated probability record and threshold-filtered signals from a
 * raw per-label probability row (ONNX column order). Rejects anything that does
 * not match the trained label set exactly.
 */
export function inferenceFromProbabilities(
  probabilities: ArrayLike<number>,
): { ok: true; inference: TriggerInference } | { ok: false; reason: string } {
  if (!isProbabilityArray(probabilities, TRAINED_TRIGGER_LABELS.length)) {
    return {
      ok: false,
      reason: `Model output must contain exactly ${TRAINED_TRIGGER_LABELS.length} probabilities in [0, 1], one per trained label.`,
    };
  }

  const record: Record<TrainedTriggerLabel, number> = {
    anxiety: round4(probabilities[0]),
    sadness: round4(probabilities[1]),
    anger: round4(probabilities[2]),
  };

  return { ok: true, inference: buildInference(record) };
}

/** Derives threshold-filtered signals (strongest first) from a probability record. */
export function signalsFromProbabilities(
  probabilities: Readonly<Record<TrainedTriggerLabel, number>>,
  threshold: number = MODEL_THRESHOLD,
): TriggerSignal[] {
  return TRAINED_TRIGGER_LABELS.map((label) => ({
    label,
    confidence: probabilities[label],
    source: 'ml' as const,
  }))
    .filter((signal) => signal.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);
}

function buildInference(probabilities: Readonly<Record<TrainedTriggerLabel, number>>): TriggerInference {
  return {
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    labels: TRAINED_TRIGGER_LABELS,
    probabilities,
    signals: signalsFromProbabilities(probabilities),
    threshold: MODEL_THRESHOLD,
  };
}

function isPlaceholderOnly(text: string): boolean {
  return text.replace(REDACTION_PLACEHOLDER, '').trim().length === 0;
}

function validateEncoded(
  encoded: { readonly inputIds: readonly number[]; readonly attentionMask: readonly number[] },
  maxLength: number,
): string | null {
  if (encoded.inputIds.length === 0) return 'Tokenizer produced no input ids.';
  if (encoded.inputIds.length !== encoded.attentionMask.length) {
    return 'Tokenizer produced mismatched input_ids and attention_mask lengths.';
  }
  if (encoded.inputIds.length > maxLength) return 'Tokenizer produced a sequence longer than the model maximum.';
  for (let i = 0; i < encoded.inputIds.length; i += 1) {
    const id = encoded.inputIds[i];
    const mask = encoded.attentionMask[i];
    if (!Number.isInteger(id) || id < 0) return 'Tokenizer produced an invalid input id.';
    if (mask !== 0 && mask !== 1) return 'Tokenizer produced an invalid attention mask value.';
  }
  return null;
}

/**
 * Real adapter around an injected session + tokenizer. The session is the
 * genuinely loaded ONNX runtime session; this constructor performs no I/O and
 * cannot silently fall back to anything.
 */
export function createOnnxTriggerClassifier(deps: {
  readonly session: TriggerModelSession;
  readonly tokenizer: TriggerTokenizer;
}): TriggerClassifierAdapter {
  const { session, tokenizer } = deps;

  return {
    name: 'onnx-trigger-classifier',
    metadata: TRIGGER_MODEL_METADATA,
    async isAvailable(): Promise<boolean> {
      return true;
    },
    async classify(text: string): Promise<TriggerClassificationResult> {
      // 1. Input validation — before anything else.
      if (typeof text !== 'string' || text.trim().length === 0) {
        return { ok: false, stage: 'input', reason: 'No text was provided to classify.' };
      }

      // 2. Privacy filter — ALWAYS before the tokenizer or session.
      const screened = screenText(text);
      if (!screened.allowed) {
        return {
          ok: false,
          stage: 'privacy',
          reason: screened.reason ?? 'Text was rejected by the privacy filter.',
        };
      }
      if (isPlaceholderOnly(screened.text)) {
        return {
          ok: false,
          stage: 'privacy',
          reason: 'Text contained only redacted content; nothing was classified.',
        };
      }

      // 3. Tokenize the sanitized text only.
      const encoded = tokenizer.encode(screened.text);
      const encodingError = validateEncoded(encoded, tokenizer.maxLength);
      if (encodingError !== null) {
        return { ok: false, stage: 'model', reason: encodingError };
      }

      // 4. Run the session and validate the raw output BEFORE mapping it.
      let output: ArrayLike<number>;
      try {
        output = await session.run({
          inputIds: [...encoded.inputIds],
          attentionMask: [...encoded.attentionMask],
        });
      } catch (error) {
        return {
          ok: false,
          stage: 'model',
          reason: `Model runtime failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      const result = inferenceFromProbabilities(output);
      if (!result.ok) {
        return { ok: false, stage: 'model', reason: result.reason };
      }
      return { ok: true, inference: result.inference };
    },
  };
}

/**
 * Honest placeholder used until the native ONNX Runtime integration lands. It
 * still enforces the privacy/input rules (so behaviour is identical), but never
 * runs a session and never returns an inference.
 */
export const TRIGGER_MODEL_UNAVAILABLE_REASON =
  'The local ONNX runtime is not integrated on this device yet, so no classification is performed.';

/**
 * Indirection so the unavailable adapter can surface the concrete failure
 * reason recorded by the real runtime (mlRuntime.setTriggerModelUnavailableReason)
 * without a circular import. Overwritten by mlRuntime at bind time.
 */
let unavailableReasonRef: () => string = () => TRIGGER_MODEL_UNAVAILABLE_REASON;

/** Internal: mlRuntime registers the live reason lookup here at module init. */
export function setTriggerUnavailableReasonLookup(lookup: () => string): void {
  unavailableReasonRef = lookup;
}

function triggerModelUnavailableReasonRef(): string {
 return unavailableReasonRef();
}

export function createUnavailableTriggerClassifier(): TriggerClassifierAdapter {
  return {
    name: 'unavailable-trigger-classifier',
    metadata: TRIGGER_MODEL_METADATA,
    async isAvailable(): Promise<boolean> {
      return false;
    },
    async classify(text: string): Promise<TriggerClassificationResult> {
      // Same input/privacy gate as the real adapter, then an honest refusal.
      if (typeof text !== 'string' || text.trim().length === 0) {
        return { ok: false, stage: 'input', reason: 'No text was provided to classify.' };
      }
      const screened = screenText(text);
      if (!screened.allowed) {
        return {
          ok: false,
          stage: 'privacy',
          reason: screened.reason ?? 'Text was rejected by the privacy filter.',
        };
      }
      // Prefer the concrete reason recorded by the real runtime initializer
      // (e.g. the actual ONNX session error) over the generic placeholder.
      const reason = triggerModelUnavailableReasonRef();
      return { ok: false, stage: 'model', reason };
    },
  };
}

/**
 * Exactly what remains before real on-device inference works. Kept next to the
 * adapter so the boundary documents its own gap (same pattern as
 * services/nativeSignalSource.ts).
 */
export const MODEL_INTEGRATION_STEPS = [
  'Add the runtime dependency: npx expo install onnxruntime-react-native (this also pulls the native Android/iOS binaries).',
  'Rebuild the development client (expo run:android) because the ONNX Runtime native module is added.',
  'Bundle ml/artifacts/trigger-classifier.int8.onnx (preferred on mobile, ~40 MB) as an app asset, keeping ml/artifacts/trigger-classifier.json as its label-order sidecar.',
  'Implement TriggerTokenizer with the ALBERT SentencePiece tokenizer from the training checkpoint (tokenizer.json), lower-casing text and truncating to 64 tokens with [CLS]/[SEP] framing.',
  'Wrap the loaded ort.InferenceSession in TriggerModelSession (feed int64 input_ids/attention_mask, read the flattened probabilities output) and register it via mlRuntime.setTriggerClassifier().',
  'Verify on device against the offline reference (ml/training/infer_test.py) before enabling the feature.',
] as const;
