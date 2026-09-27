// Honest model/runtime status for the Insights "Local AI" section.
//
// This is a thin, deterministic projection of the ACTUAL runtime state held by
// mlRuntime. It invents nothing:
//   - `available` is true only while a real session-backed adapter is bound
//     (mlRuntime.isTriggerModelBound), i.e. the ONNX session loaded on device;
//   - `error` carries the concrete recorded failure reason when unavailable
//     (the same string the runtime initializer recorded via
//     setTriggerModelUnavailableReason). Status strings are USER-FACING, so the
//     raw error is summarized to a short honest reason without internal stack
//     details;
//   - `trainedLabels` comes from the adapter metadata source of truth
//     (triggerClassifier.TRAINED_TRIGGER_LABELS — exactly anxiety, sadness,
//     anger in tensor column order);
//   - no user text, inference output, or other private content ever enters a
//     status object: the fields are fixed and derived only from runtime state
//     and static model metadata.
import {
  TRIGGER_MODEL_UNAVAILABLE_REASON,
  TRIGGER_MODEL_METADATA,
} from './triggerClassifier';
import { isTriggerModelBound, triggerModelStatusReason } from './mlRuntime';

/** What the app displays about the local model. No user data, ever. */
export interface ModelRuntimeStatus {
  /** True only when a real ONNX session is bound on this device. */
  readonly available: boolean;
  /** Stable model identifier (e.g. "trigger-classifier"). */
  readonly modelId: string;
  /** Runtime powering inference (e.g. "ONNX Runtime"). */
  readonly runtime: string;
  /** The labels the model was actually trained on, in tensor column order. */
  readonly trainedLabels: readonly string[];
  /** Inference always runs locally on this device. */
  readonly inferenceMode: 'local';
  /**
   * Short honest reason when `available` is false; undefined when available.
   * Summarized for display — no stack traces, no internal paths.
   */
  readonly error?: string;
}

/** Runtime name shown in the UI. The adapter wraps onnxruntime-react-native. */
const RUNTIME_NAME = 'ONNX Runtime';

/**
 * Collapses a raw failure reason into a short, user-facing sentence. Internal
 * details (exception text, asset URIs, module names) are intentionally dropped;
 * the wording classifies the failure honestly without leaking internals.
 */
export function summarizeStatusError(rawReason: string): string {
  if (typeof rawReason !== 'string' || rawReason.trim().length === 0) {
    return TRIGGER_MODEL_UNAVAILABLE_REASON;
  }
  // The recorded runtime reason is already a single sentence built by
  // onnxTriggerRuntime ("ONNX trigger classifier failed to initialize: <err>").
  // Keep the cause class but strip anything after a stack-like line break.
  const firstLine = rawReason.split('\n')[0]!.trim();
  if (firstLine.length <= 140) return firstLine;
  return `${firstLine.slice(0, 137).trimEnd()}...`;
}

/**
 * Builds the current status from live runtime state. Deterministic: two calls
 * with the same binding state produce identical objects.
 */
export function getModelRuntimeStatus(): ModelRuntimeStatus {
  const available = isTriggerModelBound();
  const status: ModelRuntimeStatus = {
    available,
    modelId: TRIGGER_MODEL_METADATA.modelId,
    runtime: RUNTIME_NAME,
    trainedLabels: TRIGGER_MODEL_METADATA.trainedLabels,
    inferenceMode: 'local',
  };
  if (!available) {
    return { ...status, error: summarizeStatusError(triggerModelStatusReason()) };
  }
  return status;
}
