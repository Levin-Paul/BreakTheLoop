// Runtime binding for the ML classifier.
//
// The rest of the app never imports onnxruntime directly (only
// ml/onnxTriggerRuntime.ts does). Exactly one place binds a session-backed
// adapter at startup; until that happens, the runtime reports honestly that
// the model is unavailable, with the concrete failure reason when one exists.
// This keeps a single dependency direction:
//
//     screens / pipeline -> mlRuntime -> triggerClassifier adapter -> session
//
// The app entry point (index.ts) calls `initializeTriggerClassifierRuntime()`
// once; on failure it records WHY and the app continues without ML inference.
import {
  TRIGGER_MODEL_UNAVAILABLE_REASON,
  createUnavailableTriggerClassifier,
  setTriggerUnavailableReasonLookup,
  type TriggerClassifierAdapter,
} from './triggerClassifier';

let classifier: TriggerClassifierAdapter = createUnavailableTriggerClassifier();

/** Reason reported while no session is bound (overridable by the real runtime). */
let unavailableReason: string = TRIGGER_MODEL_UNAVAILABLE_REASON;

// The unavailable adapter reads the live failure reason from here, so a failed
// on-device initialization surfaces its actual error, not a generic message.
setTriggerUnavailableReasonLookup(() => unavailableReason);

/** True once a session-backed adapter has been bound. */
export function isTriggerModelBound(): boolean {
  return classifier.name !== 'unavailable-trigger-classifier';
}

/**
 * Binds the session-backed adapter. Passing the unavailable adapter is allowed
 * and resets to the honest default (useful in tests).
 */
export function setTriggerClassifier(adapter: TriggerClassifierAdapter): void {
  classifier = adapter;
}

/** The currently bound adapter. Never null — unavailable is a valid state. */
export function getTriggerClassifier(): TriggerClassifierAdapter {
  return classifier;
}

/** Reason reported while no session is bound. */
export function triggerModelStatusReason(): string {
  return isTriggerModelBound() ? 'Local trigger classifier is bound.' : unavailableReason;
}

/**
 * Records WHY the model is unavailable (e.g. failed ONNX session creation with
 * the underlying error). Used by the real runtime initializer so the reason
 * shown in the app is the actual failure, not a generic placeholder.
 */
export function setTriggerModelUnavailableReason(reason: string): void {
  if (typeof reason === 'string' && reason.length > 0) {
    unavailableReason = reason;
  }
}
