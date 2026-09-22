# ML → Mobile Integration (boundary complete)

## Status

The ML integration boundary is **complete and tested**. A typed adapter for the
trained ONNX trigger classifier is wired from privacy filter to Pattern Engine
to Insights. Real on-device inference is **not connected yet** because
`onnxruntime-react-native` is not a dependency of `mobile-app-01`; the adapter
runs against an injected session and the app reports the model as honestly
unavailable until that dependency lands. Nothing is faked: no fabricated
labels, no invented metrics, no cloud inference.

## Verified flow

```
USER-PROVIDED TEXT (Urge capture: context + feeling)
      -> signalPipeline.processSignal      kill switch + privacy filter FIRST
      -> ml/signalIngestion.ingestUserText local only, never throws
      -> ml/triggerClassifier adapter      tokenize -> session -> probabilities
      -> MlSignalObservation rows          label, confidence, model version
      -> engine/patternEngine.summarizeMlSignals
      -> Insights "ML model signals" section
```

## What exists in code

| Piece | File |
| --- | --- |
| Typed classifier adapter (trained labels only) | `mobile-app-01/src/ml/triggerClassifier.ts` |
| Runtime registry (binds a session or reports unavailable) | `mobile-app-01/src/ml/mlRuntime.ts` |
| Ingestion bridge pipeline -> classifier -> storage | `mobile-app-01/src/ml/signalIngestion.ts` |
| Observation table SQL / row mapping | `mobile-app-01/src/database/signalPersistence.ts` |
| Observation table expo-sqlite binding | `mobile-app-01/src/database/signalRepository.ts` |
| ML signal summaries (count-based wording) | `mobile-app-01/src/engine/patternEngine.ts` |
| Insights: ML vs patterns vs recovery, separated | `mobile-app-01/src/screens/Insights.tsx` |
| Urge capture wired to ingestion | `mobile-app-01/src/screens/Urge.tsx` |
| Tests (78 checks) | `mobile-app-01/src/ml/testTriggerClassifier.ts` |

## Hard rules enforced in code (not left to callers)

- Only the 3 trained labels (`anxiety`, `sadness`, `anger`) exist in the
  adapter's output type. The 13 untrained taxonomy labels are listed as
  `UNTRAINED_TRIGGER_LABELS` and can never be returned.
- Privacy screening happens BEFORE any tokenizer/session call; a session that
  runs on sensitive text is a test failure.
- Model output is validated: exactly 3 probabilities, finite, in [0, 1].
  Malformed output becomes an error result, never a mapped guess.
- Probabilities are stored and shown as model confidences. Wording is
  count-based ("This signal appeared in N recorded events."), never causal,
  never diagnostic.
- The user's text is NOT copied into the ML signal table; the observation row
  holds label, confidence, timestamps and model version only.

## Model identity recorded with every observation

- `modelId`: `trigger-classifier`
- `modelVersion`: `trigger-classifier@1.0.0-albert-base-v2`
- threshold: `0.5` (from the training run's checkpoint metadata)
- artifact sha256: `df60e372577ae9c01fdb0bcb60df0d4a4b57c30eaebee563dfa9c8b19b166c58`
- held-out test F1 (from `ml/training/runs/trigger-classifier/eval_test.json`):
  anger 0.8613, sadness 0.7729, anxiety 0.7484

## Remaining blocker: real on-device inference

`MODEL_INTEGRATION_STEPS` in `triggerClassifier.ts` is the authoritative list:

1. `npx expo install onnxruntime-react-native` (pulls native binaries).
2. Rebuild the dev client (`expo run:android`).
3. Bundle `ml/artifacts/trigger-classifier.int8.onnx` (~40 MB, preferred on
   mobile) as an app asset, keeping `trigger-classifier.json` as the
   label-order sidecar.
4. Implement `TriggerTokenizer` with the ALBERT SentencePiece tokenizer from
   the training checkpoint (`tokenizer.json`), lowercase, truncate to 64.
5. Wrap `ort.InferenceSession` in `TriggerModelSession` and bind it with
   `mlRuntime.setTriggerClassifier(...)` in the app entry point.
6. Verify on device against the offline reference (`ml/training/infer_test.py`)
   before enabling the feature.

## Test results (this integration pass)

`npm test` in `mobile-app-01`: **166 passed, 0 failed**
(recovery 26, pattern 26, privacy/pipeline 36, ML integration 78)
`tsc --noEmit`: clean.
