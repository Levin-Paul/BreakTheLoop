# Physical-Device ML Verification — Trigger Classifier

**Status: PHYSICAL DEVICE VERIFICATION: NOT COMPLETED**

No physical Android device was available at verification time, so the on-device
inference checklist was NOT executed on real hardware. Per the honest-reporting
rule, this is **not** marked as passed. Everything that could be verified without
a physical device was verified, and is recorded below.

---

## Environment

| Item | Value |
|---|---|
| Date | 2026-09-27 |
| Physical device | **NONE DETECTED** — `adb devices` listed only `emulator-5554` (sdk_gphone64_x86_64). No USB device was connected. |
| Android version (physical) | N/A — verification not performed |
| CPU architecture (physical) | N/A — verification not performed |
| Fallback used | None for on-device claims; arm64-v8a + armeabi-v7a ABIs were built so the APK is physical-device-ready |

## Model asset

| Item | Value |
|---|---|
| Model file | `assets/ml/trigger-classifier.int8.onnx` |
| Model size | 40,508,320 bytes (~40.5 MB), INT8-quantized |
| sha256 (recorded in adapter) | `df60e372577ae9c01fdb0bcb60df0d4a4b57c30eaebee563dfa9c8b19b166c58` |
| Tokenizer | `assets/ml/trigger-classifier-tokenizer.json` (1,312,669 bytes, ALBERT Unigram vocab + precompiled charsmap, bundled verbatim) |
| Runtime | `onnxruntime-react-native@1.24.3` (local ONNX Runtime, CPU EP), with `patches/onnxruntime-react-native+1.24.3.patch` applied and preserved |

## What was verified WITHOUT a physical device (2026-09-27)

### On the Android 36 emulator (`emulator-5554`, sdk_gphone64_x86_64)

The full chain was previously verified in this environment
(see `docs/ONNX_DEVICE_VERIFICATION_2026-09-26.md`): native module loaded,
session created, tokenizer built, real inference executed, results persisted to
`ml_signal_events` and shown in Insights (anger 0.83 / sadness 0.91 / anxiety 0.69).

Note (environment issue, recorded honestly): on 2026-09-27, later emulator
sessions hit a Metro-dev-server asset-transfer corruption
(`ExpoAsset.downloadAsync` wrote a malformed cache file; the host-side endpoint
serves byte-correct content, md5 `637d8da201d7c34b733ef6e9ececd313`). The app
degraded gracefully (`[ml] trigger classifier unavailable: ...`, UI fully
functional). This is a dev-environment issue only — release builds bundle the
asset inside the APK and never use this path.

### Automated verification (host, deterministic)

| Check | Result |
|---|---|
| `npm test` | PASS — 168 checks total: 36 recovery, 33 pattern, 78 ML integration, 21 model status; 0 failed |
| `npx tsc --noEmit` | PASS |
| Android build | `npx expo prebuild --clean` + `gradlew :app:assembleDebug` (arm64-v8a, armeabi-v7a) — **BUILD SUCCESSFUL** |
| ONNX patch preserved | Verified post-prebuild: `unimodule.json` deleted, `REACT_NATIVE_MINOR_VERSION < 71` hunk present, `implementation project(':onnxruntime-react-native')` in generated `app/build.gradle` |
| Model status UI | Added to Insights (Local AI card) — see below |
| Model status API | `src/ml/modelStatus.ts` — deterministic, derived from real runtime binding |
| Trained labels | Exactly `['anxiety', 'sadness', 'anger']` (tensor column order), enforced by tests |
| No user text in status | Enforced by tests (status API takes no input; fields are a fixed set) |

### Failure-path behavior (graceful, verified in tests + on emulator)

- Missing/failed model: `initializeTriggerClassifierRuntime()` catches every
  failure, records a concrete reason, binds the unavailable adapter; the app
  runs fully without ML (Urge flow, Pattern Engine, Insights unaffected). No
  crash.
- Corrupt/unavailable runtime: classifier reports
  `{ ok: false, stage: 'model', reason }`; ingestion returns
  `classified: false` and stores nothing.
- The Insights "Local AI" card shows `● Unavailable` with a short honest reason
  (stack lines stripped) instead of internal errors.

## Model status UI (implemented this session)

The Insights screen now contains a compact **Local AI** card, driven by
`ModelRuntimeStatus`:

```
Local AI
● Ready                       (or ● Unavailable)
Model:      Trigger Classifier
Runtime:    ONNX Runtime
Labels:     3 trained signals (anxiety, sadness, anger)
Inference:  On-device / Offline
```

When unavailable, a `Reason` row shows the summarized failure, and the status
dot turns red. The card footer states explicitly: the model runs entirely on
this device offline, knows only the labels listed, is **not** a complete
addiction or trigger detector, and does not read the screen.

## Physical-device checklist (pending — execute when a device is available)

1. `adb devices` shows a USB device; record manufacturer/model, Android
   version, `arm64-v8a`/`armeabi-v7a`.
2. `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
3. `adb reverse tcp:8081 tcp:8081`, start Metro, launch via dev client.
4. Confirm `[ml] trigger classifier ready` in logcat (no unavailable warning).
5. Run the three test phrases through the Urge flow and record probabilities +
   latency per inference:
   - "I am feeling angry today."
   - "I feel sad and isolated."
   - "I am anxious about my exams."
6. Confirm Insights counts the signals; confirm `ml_signal_events` rows.
7. Failure path: temporarily rename the cached model asset, relaunch, confirm
   `● Unavailable` with reason and no crash; restore the asset.
8. Do NOT persist the test phrases as product data (the pipeline never stores
   text; only label/confidence rows are written).

## Known limitations

- **Physical-device verification was NOT completed** (no hardware). All
  on-device claims in this document are emulator-scoped or test-scoped.
- The classifier knows ONLY `anxiety`, `sadness`, `anger`. It does not detect
  stress, boredom, loneliness, isolation, fatigue, doomscrolling, or any other
  state, and must never be presented as such.
- Reported metrics (F1 ~0.75–0.86) are held-out text-classification metrics on
  public data — not clinical validity, not personalization.
- Emulator dev-server asset-transfer corruption is a known environment issue
  for dev builds; release builds are unaffected (asset bundled in APK).
