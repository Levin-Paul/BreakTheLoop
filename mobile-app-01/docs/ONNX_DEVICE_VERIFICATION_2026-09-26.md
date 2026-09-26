# ONNX On-Device Verification — 2026-09-26 (failed) → 2026-09-27 re-run (VERIFIED)

**Task:** On-device ONNX inference verification (audit sprint step 1).
**Device:** No physical device detected (`adb devices` empty); user-approved fallback:
Android emulator `Medium_Phone_API_36` (API 36, x86_64 + arm64).

---

## Re-run result (2026-09-27, after the verified autolinking fix): ✅ VERIFICATION PASSED

Real on-device inference **was executed** — three genuine ONNX Runtime sessions ran
inside the app on the emulator, produced validated probabilities, and the results
flowed through the full pipeline to SQLite and the Insights screen.

### Fix applied (2026-09-27)

- Patch file: `patches/onnxruntime-react-native+1.24.3.patch` (23 lines, minimal):
  1. **DELETES `unimodule.json`** from `onnxruntime-react-native@1.24.3` — the file
     that made `expo-modules-autolinking` misclassify the package as an Expo module
     and skip React Native community autolinking (root cause of
     `NativeModules.Onnxruntime === null` → import-time crash in `binding.js`).
  2. Preserves the pre-existing `android/build.gradle` hunk
     (`REACT_NATIVE_MINOR_VERSION < 71`, RN 0.86 compatibility).
- Patch verified with the real flow: deleted `node_modules/onnxruntime-react-native`,
  ran `npm install` → `postinstall` → `patch-package` applied cleanly
  (`onnxruntime-react-native@1.24.3 ✔`), `unimodule.json` gone, Gradle hunk present.
- Native project regenerated: `npx expo prebuild --platform android --no-install`
  → `android/app/build.gradle` now contains
  `implementation project(':onnxruntime-react-native')` (expo prebuild @generated block).
  `expo-modules-autolinking resolve` no longer claims the package (correct: it is now
  handled by RN community autolinking).
- Rebuilt: `./gradlew :app:assembleDebug` (JVM 17 = Android Studio JBR).
  `app-debug.apk` contains `libonnxruntime.so` + `libonnxruntimejsi.so` (all ABIs).
- Installed on `emulator-5554`, `adb reverse tcp:8081 tcp:8081`, Metro on :8081,
  app launched via dev-client deep link.

### Startup verification

```
ReactNativeJS: Running "main" with {"rootTag":1,"initialProps":{},"fabric":true}
ReactNativeJS: [ml] trigger classifier ready
```

- App mounts (no LogBox error, no Dev Launcher fallback).
- Failure signatures absent from logcat: `runtime not ready` = 0, `install' of null` = 0.
- `NativeModules.Onnxruntime` is non-null: the previous session proved a null module
  throws `Cannot read property 'install' of null` at import time; the module now
  imports cleanly and `InferenceSession.create()` succeeds (native binding present).
- Model loaded: bundled `assets/ml/trigger-classifier.int8.onnx` resolved via
  expo-asset → local file URI → real `InferenceSession` (any failure here would have
  produced `[ml] trigger classifier unavailable: <reason>` instead of the ready log).
- Tokenizer loaded: ALBERT Unigram vocab + precompiled charsmap from the bundled
  checkpoint `trigger-classifier-tokenizer.json` (session-bound classifier proves the
  tokenizer passed `createAlbertTokenizer` validation).

### End-to-end inference results (Urge flow, real UI automation)

Path exercised: user text → `signalPipeline.processSignal` (privacy filter) →
`signalIngestion.ingestUserText` → `triggerClassifier` adapter → ONNX Runtime
session → validated probabilities → `ml_signal_events` (SQLite) → Pattern Engine
summaries → Insights UI.

| Input text | Visible result (Urge screen) | Label + confidence |
|---|---|---|
| `I am feeling angry today.` | "Local model recorded 1 signal(s): anger 83%" | anger 0.83 |
| `I feel sad and isolated.` | "Local model recorded 1 signal(s): sadness 91%" | sadness 0.91 |
| `I am anxious about my exams.` | "Local model recorded 1 signal(s): anxiety 69%" | anxiety 0.69 |

Each capture also produced a Recovery Engine assessment (Stable, Score 0/10 —
intensity 1 defaults, no check-in) and "Urge saved on this device." (SQLite write).

### Persistence verified (SQLite, pulled and inspected)

- `files/SQLite/breaktheloop.db` pulled via `run-as`; `ml_signal_events` table present
  with exactly **3 rows** (one per inference): `source='ml'`,
  `originSource='urge_flow'`, `modelId='trigger-classifier'`,
  `modelVersion='trigger-classifier@1.0.0-albert-base-v2'`; one row each for
  `anger`, `sadness`, `anxiety`. User text is NOT in this table (privacy contract).
- Insights screen: Urges: 3, ML signal events: 3, and three ML summaries
  (ANGER / ANXIETY / SADNESS) with highest confidences 83% / 69% / 91% — matching the
  inferences exactly. Pattern Engine `summarizeMlSignals` produced the summaries from
  the stored rows.

### Chain status per requested checklist (2026-09-27)

| Check | Result |
|---|---|
| App launched | YES (UI mounts, Home screen fully interactive) |
| Metro connected | YES (reverse + bundle served, `packager-status:running`) |
| ONNX native module loaded | **YES — `NativeModules.Onnxruntime` non-null (import clean)** |
| Model asset resolved | YES |
| Tokenizer loaded | YES |
| InferenceSession created | YES (int8 ALBERT session on device CPU EP) |
| Real inference executed | **YES — 3 sessions ran** |
| anger / sadness / anxiety results | 0.83 / 0.91 / 0.69 |
| SQLite observation persisted | YES (3 rows in `ml_signal_events`, inspected on-device file) |
| Pattern Engine received signal | YES (`summarizeMlSignals` over loaded rows) |
| Insights updated | YES (counts + 3 label summaries shown) |
| First failure | **NONE** |

### Test-environment note (not an app failure)

Typing into RN `TextInput`s on API 36/Gboard via `adb shell input text` wedges after
the first IME commit (stale `editorInfo` in `dumpsys input_method`). Workaround used:
`am force-stop com.google.android.inputmethod.latin` + `KEYCODE_ESCAPE` +
re-focus + cursor-to-end (KEYCODE_MOVE_END) before each chunk. Pure UI automation
issue; the app itself stayed responsive and every result above is real app output.

### Files changed (this re-run; NOT committed)

- `patches/onnxruntime-react-native+1.24.3.patch` — regenerated; now deletes
  `unimodule.json` + keeps the build.gradle hunk (23 lines total).
- `docs/ONNX_DEVICE_VERIFICATION_2026-09-26.md` — this update.
- Local machine artifacts (gitignored/untracked): `android/` regenerated by prebuild
  (+ `android/local.properties` SDK path), `android/build-debug.log`, pulled DB copy
  `.expo/btl.db`, log capture files.

No source files under `src/` were modified: ML runtime, classifier, tokenizer,
pipeline, ingestion, repositories, engines, screens and `index.ts` are untouched.

---

# Original verification (2026-09-26) — BEFORE the fix

**Result: VERIFICATION FAILED — native module never registered (root cause found).**
Kept below as the failure record; every item below is superseded by the re-run above.

## Environment established

| Step | Result |
|---|---|
| `adb devices` (physical) | **none** — Windows PnP shows no Android USB hardware |
| Emulator booted | `emulator-5554` (Medium_Phone_API_36) |
| Dev build installed | `com.levin197.mobileapp01` (`app-debug.apk`, ABIs: arm64-v8a + x86_64) |
| Metro | started on :8081, `packager-status:running`, bundle built (789→819 modules, 22.7s/8.5s) |
| `adb reverse tcp:8081 tcp:8081` | OK |
| App launched | process 7164, `Running "main"` logged, then **LogBox TypeError** |

## First failure in the chain (exact)

```
ReactNativeJS: [runtime not ready]: TypeError: Cannot read property 'install' of null
  anonymous@103064:18  ← node_modules/onnxruntime-react-native/dist/commonjs/binding.js:13
```

`binding.js` calls `Module.install()` at **import time** when
`NativeModules.Onnxruntime === null`. Reproduced deterministically via LogBox
RELOAD → not a cold-start race. After dismissing the error, the app falls back to
the Dev Launcher — **the app UI never mounts**.

## Root cause (verified with evidence, confirmed upstream)

`onnxruntime-react-native` ships `unimodule.json`, which makes
`expo-modules-autolinking` classify it as an Expo module and **exclude it from
React Native community autolinking**. Consequences (all verified in this repo):

- `npx expo-modules-autolinking resolve` → package found, but `modules: [], packages: []`
  (Gradle project only — that is why `libonnxruntime.so` and the dex classes ship)
- Generated `PackageList.java` has **no** `OnnxruntimePackage` entry
- `NativeModules.Onnxruntime` is `null` at runtime → import-time `Module.install()` throws

Upstream: microsoft/onnxruntime#29004 (closed; root cause behind #19510, #26925, #26796).
