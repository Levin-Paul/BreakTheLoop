# Android Offline Monitoring & Local ALBERT — Architecture

**Status: DESIGN ONLY. Nothing described here is implemented.**
No monitoring code, no AccessibilityService, no screen capture, and no ALBERT
inference exists in this repository. This document specifies boundaries and
constraints so the implementation cannot drift into surveillance.

Scope of this document: how `mobile-app-01` moves from an Expo Go prototype to an
Android-native, offline, explicitly user-enabled monitoring architecture.

Related documents (all still heading-only stubs at
`../docs/`): `ARCHITECTURE.md`, `IMPLEMENTATION_ORDER.md`, `ML_SPEC.md`, `PRIVACY.md`.
This file is currently the most detailed document in the project; the stubs should
eventually defer to it rather than duplicate it.

---

## 1. Verified current state

Measured from this working tree (not assumed):

| Item | Value |
|---|---|
| `expo` | `~57.0.24` (Expo SDK 57) |
| `react-native` | `0.86.3` |
| `react` | `19.2.3` |
| `typescript` | `~6.0.3` |
| `expo-sqlite` | `~57.0.3` |
| Package manager | npm (`package-lock.json`; no `bun.lock`) |
| New Architecture | React Native 0.86 default (Fabric/TurboModules) |
| `app.json` plugins | `["expo-sqlite"]` only |
| `expo-dev-client` | **not installed** |
| `android/`, `ios/` | **absent** and gitignored → Continuous Native Generation |
| Native monitoring code | none |
| Local ML runtime in app | none |
| ALBERT model | `../albert-base-v2`, local directory |

Implemented and verified app code (must remain intact):

```
src/engine/types.ts               RiskState, RecoveryInput, RecoveryResult
src/engine/recoveryEngine.ts      calculateRecoveryState()
src/engine/interventionEngine.ts  getIntervention()
src/engine/testRecoveryEngine.ts  26 assertions, run via `npm test`
src/database/db.ts                expo-sqlite v57 openDatabaseSync handle
src/database/schema.ts            initializeDatabase() / requireDatabase()
src/database/schemaStatements.ts  pure init-statement builder
src/database/checkInPersistence.ts, checkInRepository.ts
src/database/urgePersistence.ts,  urgeRepository.ts
src/screens/{Home,CheckIn,Urge,Insights}.tsx + checkInModel, urgeModel, insightsModel
App.tsx                           screen switching + startup DB init
```

Local ALBERT assets measured on disk:

| File | Bytes |
|---|---|
| `model.safetensors` | 47,372,894 (~45.2 MiB) |
| `pytorch_model.bin` | 47,376,696 |
| `tokenizer.json` | 1,312,669 |
| `spiece.model` | 760,289 |
| `config.json` | 713 |

`config.json` (verbatim values): `model_type: albert`, `vocab_size: 30000`,
`embedding_size: 128`, `hidden_size: 768`, `num_hidden_layers: 12`,
`num_attention_heads: 12`, `intermediate_size: 3072`,
`max_position_embeddings: 512`, `architectures: ["AlbertForMaskedLM"]`.

**ML pipeline reality check:** `../ml/training/train.py`, `evaluate.py`, and
`export_onnx.py` each contain the single line `# placeholder`. There is **no
`.onnx` artifact anywhere** in the project, and no trained classification head.
`../infer_test.py` only runs the *pretrained base* ALBERT and prints
`out.last_hidden_state.shape`. The Python env (`../.venv`) does have
`torch 2.14.0`, `transformers`, `onnx 1.23.0`, `onnxruntime 1.23.2` installed.

So the ALBERT track is **blocked on training + export**, independently of anything
on the mobile side. See §11.

---

## 2. Why Expo Go is insufficient

Expo Go is a **prebuilt, fixed binary downloaded from the store**. You cannot add
native code to it. Concretely, none of the following can ever work in Expo Go:

1. **No custom Android service.** An `AccessibilityService`, a foreground service,
   or any `<service>` entry requires a manifest entry in the *app's own* manifest.
   Expo Go's manifest is fixed and its `applicationId` is Expo's, not ours.
2. **No new native library.** The app ships no `onnxruntime`/LiteRT/execuTorch
   `.so` files, so local model inference has no runtime to call.
3. **No manifest permissions or `<queries>`.** Even the special-access permission
   for `UsageStatsManager` (§7) needs a manifest declaration.
4. **No resource XML.** An accessibility service config
   (`res/xml/accessibility_service_config.xml`) must be bundled at build time.
5. **No distinct app identity.** Android's Accessibility settings list shows the
   app label of the installed package. A monitoring toggle must point at *our*
   app, not at "Expo Go".
6. **No release-equivalent behaviour.** Expo Go is a debug/dev container; service
   lifetime, battery-optimisation exemption, and OS background restrictions behave
   differently from a real install, so results there are not evidence anyway.

Expo Go remains fine for the existing prototype screens (Check-In, Urge, Insights,
Recovery Engine) — those use only `expo-sqlite`, which Expo Go bundles. The
moment a native monitor or local inference is added, Expo Go is permanently out.

---

## 3. Development build requirement

**Yes — a development build is required.** Both native additions (monitoring
service and local inference runtime) are native code, so the existing CNG setup
must be turned into a compiled app.

Nothing was installed and no build was run. Two paths, chosen by you:

| Path | Needs on this machine | Notes |
|---|---|---|
| **A. Local build** — `npx expo run:android` | JDK 17, Android SDK + platform tools, Android Studio (or the SDK/emulator without it), USB debugging for a device | Required for iterative Kotlin work. You asked that Android Studio **not** be installed automatically — so this is a decision, not an action I took. |
| **B. EAS cloud build** — `eas build --platform android --profile development` | Expo account; no local Android toolchain | Produces an installable `.apk` from Windows. Slower loop for native changes, but zero local setup. |

Prerequisite either way: `npx expo install expo-dev-client` (currently **absent**);
this uses `npx expo install`, not `npm install`, so the version resolved matches
SDK 57. That is a dependency change, so it was not done in this task.

After the first build, only native changes require a rebuild:

```sh
npx expo prebuild --clean     # after a native dependency/app-config change
npx expo run:android          # rebuild
npx expo start                # JS-only changes
```

### `android/` must never be hand-edited

`android/` and `ios/` are already gitignored (CNG). Any native monitor code must
therefore live **outside** them, or it is lost on the next `prebuild --clean`.
That constraint drives §5.

### SDK / API-level decisions to make at prebuild time

- `minSdkVersion`: read the generated `android/gradle.properties` after prebuild
  rather than assuming. API-level gates that follow from this doc:
  `AccessibilityService.disableSelf()` → API 24;
  `AccessibilityService.takeScreenshot()` → API 30 (§17);
  `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` → API 34 (§17).
- `compileSdk` / `targetSdk`: whatever SDK 57 generates; any Play-policy
  obligations in §8 key off `targetSdk`.

---

## 4. Target pipeline

```
Android Native Monitor            native, opt-in, per-event, no storage
        ↓
Privacy Filter                    pure, allowlist-first, drops raw text here
        ↓
Local Signal Bus                  typed, bounded, on-device only
        ↓
ALBERT / local classifiers        on-demand, filtered input only
        ↓
Pattern Engine                    deterministic, pure, reads signals only
        ↓
Recovery Engine                   EXISTS — unchanged
        ↓
Intervention Engine               EXISTS — unchanged
```

Each arrow is a boundary with a stated contract. Data may only flow **downward**;
no stage may reach back past it. In particular:

- The Privacy Filter is the **only** stage that ever sees raw event data.
- The Signal Bus never carries raw text (§10).
- ALBERT never receives anything the Signal Bus would not hold (§11).
- The Pattern Engine, Recovery Engine, and Intervention Engine never touch
  Android APIs.
- The Recovery and Intervention engines are **fenced** and stay byte-identical.

---

## 5. Where the native code lives

Since `android/` is generated, native code belongs in a **checked-in local Expo
module**:

```sh
npx create-expo-module@latest --local     # creates modules/<name>/{android,ios,src}
```

NOT run yet — it adds a dependency tree, which is out of scope for this task.

Why this specific layout solves the CNG problem:

- `modules/<name>/android/` is a Gradle library module, checked into git. Prebuild
  regenerates `android/` but never touches `modules/`.
- A library module may ship its **own `android/src/main/AndroidManifest.xml`**, and
  AGP's manifest merger folds it into the app manifest. So the
  `<service android:name=".BreakTheLoopMonitorService" …>` declaration and its
  `<meta-data>` link to the config XML live with the module — no custom config
  plugin needed just to declare the service.
- The module can also ship `android/src/main/res/xml/accessibility_service_config.xml`.
- The module exposes a small JS surface via the Expo Modules API (`sendEvent`, plain
  async functions) so the JS layer never sees a `NativeModule` directly.

The JS-facing contract should be tiny and boring, e.g.:

```ts
// NOT IMPLEMENTED — shape only
isMonitoringEnabled(): Promise<boolean>   // reads OS state, never guesses
openMonitoringSettings(): Promise<void>   // deep-links to the OS toggle
requestStop(): Promise<void>              // kill switch, §14
```

Whatever exists must be **honest about OS state**: `isMonitoringEnabled()` must
report what the OS actually reports, never an assumption. This mirrors the existing
repository convention of returning `{ ok, error }` rather than pretending a write
succeeded.

---

## 6. Migration of verified logic into the native boundary

This is the riskiest part of the migration and deserves an explicit warning.

Today the "persistence" modules (`checkInPersistence.ts`, `urgePersistence.ts`,
`schemaStatements.ts`, `checkInModel.ts`, `urgeModel.ts`, `insightsModel.ts`) are
plain TypeScript with no React Native imports, which is exactly why they are
Node-verifiable. Keep them that way:

- **The Privacy Filter should be a pure module in the same style** (ideally at
  `src/monitor/privacyFilter.ts` — pure, injectable clock, no native imports), so its
  deny-list and scrubbing rules are unit-testable from Node with no device.
- The Kotlin service should do **no policy** — it collects an event, calls one
  exported filter entry point, and either drops the event or hands the derived
  signal onward. Policy in Kotlin is policy you cannot test on this machine.

If the filter must live in Kotlin (see §9 for the tradeoff), then it needs its own
Kotlin unit tests plus a **shared JSON test-vector corpus** — one file of
input/expected-output cases executed by both the Kotlin tests and a Node test — so
the two implementations cannot drift.

---

## 7. Android signal source: which mechanism

Two candidate OS mechanisms. They are not equivalent, and the less invasive one
should be tried first.

| | `UsageStatsManager` | `AccessibilityService` |
|---|---|---|
| What it yields | Which package was in the foreground, and for how long (`ACTIVITY_RESUMED`/`ACTIVITY_PAUSED` events) | Window/package/class transitions **and** view-level metadata incl. on-screen text of the current window |
| Permission type | Special app access: "Usage access", user-granted in Settings | Accessibility service, user-enabled in Settings → Accessibility |
| Invasiveness | Low — timing and package identity only, no content | High — content-level access to other apps |
| Play policy burden | `QUERY_ALL_PACKAGES` is restricted, but `UsageStatsManager` itself does not need it; usage access is a declared special permission | Requires the Accessibility API permission declaration and Play approval |
| Can it satisfy the current product need? | **Probably yes for the first version** — "user is in a high-risk context" is largely a package+time signal | Needed only if content-level signals are truly required |

**Recommendation: implement `UsageStatsManager` first, and treat
`AccessibilityService` as a second, optional source behind its own separate
consent.** Rationale: the product's first useful signal is *category + duration*,
which usage stats already provide, and it avoids the single most invasive permission
Android offers. Escalating to accessibility access before it is proven necessary
would be hard to justify to a user or a reviewer.

Note that both are **push-only from the OS** — the app cannot poll a "what is the
user doing" API; it registers and receives. That shapes the Signal Bus (§10) around
a bounded native buffer, not a timer.

---

## 8. Android boundary: AccessibilityService (design only)

Investigated as requested. **Not implemented.** Accurate constraints:

**Role.** It is the only supported way to receive UI/window events from *other*
apps: `TYPE_WINDOW_STATE_CHANGED`, `TYPE_WINDOW_CONTENT_CHANGED`,
`TYPE_VIEW_TEXT_CHANGED`, `TYPE_VIEW_CLICKED`, delivered via
`onAccessibilityEvent()`. Event granularity and window contents are configured by
`res/xml/accessibility_service_config.xml` and the service's
`AccessibilityServiceInfo`.

**Activation is manual and cannot be scripted.** The user must enable the service in
**Settings → Accessibility**. An app cannot enable its own accessibility service, by
design. What the app *can* do:

- detect its own state by querying `AccessibilityManager` /
  `AccessibilityServiceInfo` for enabled services, and
- deep-link the user to `Settings.ACTION_ACCESSIBILITY_SETTINGS`.

The app must therefore show monitoring as **OFF until the OS says otherwise**, and
never render an "on" state optimistically.

**Android 13+ (API 33+) adds a second gate for sideloaded builds.** Accessibility
(and several other special) settings are *restricted* for apps installed outside a
store; the user must first pick **"Allow restricted settings"** from the app's
overflow menu on its App-info page before the toggle becomes available. Any dev
build distributed as an APK must document this, or the toggle will appear broken.

**Hard limitations — things an accessibility service cannot do:**

- **Password fields.** Nodes whose `AccessibilityNodeInfo.isPassword()` is true have
  their text withheld by the framework. This is a kernel-level guarantee, not a
  convention we rely on — but it is also not sufficient, because a field is only
  protected when the app marks it as a password field. The Privacy Filter (§9) must
  not treat this as the only defence.
- **`FLAG_SECURE` windows** cannot be screenshotted or read, so banking and similar
  apps are opaque to it (good for privacy, a gap for any visual plan).
- **No screenshots.** Screen capture is a *separate* API and a separate consent —
  see §17.
- **No autonomous action.** Using the Accessibility API to let the app initiate,
  plan, or execute actions in other apps is prohibited by Play policy. Our use must
  be strictly observational, which also means the service must never perform
  gestures or clicks on the user's behalf.
- **No guaranteed lifetime.** The OS may kill the process; events simply stop. Any
  design that assumes a continuous stream is wrong.

**Google Play policy burden (a real distribution risk, not a formality).** Apps that
target Android 12 (API 31)+ and include an `AccessibilityService` must complete the
Accessibility API permission declaration in Play Console and be approved; prominent
in-app disclosure of the use is also required, and reviewers have rejected apps for
missing it. Treat Play approval as a project risk with an unbounded timeline, and
plan for the possibility that the accessibility path can only ever ship as a
sideloaded build (e.g. F-Droid/enterprise distribution) — which is a product
decision, not an engineering one.

**Additionally required if this path is taken:** a foreground service with a
persistent, user-visible notification is *not* strictly required for an
accessibility service, but a visible "monitoring is running" affordance is required
by this project's own rules (§14) regardless of what the OS demands.

---

## 9. Privacy Filter

The single most important component. It is the *only* stage allowed to see raw
events, and its job is to destroy data, not to store it.

**Contract**

```
RawAndroidEvent  ──▶  privacyFilter(event)  ──▶  LocalSignal | DROP
```

`privacyFilter` is a **pure function**: same input → same output, no I/O, no
network, no clock read except an injected `now`. Drops are the default; a signal is
produced only when the event positively matches an allowlist.

**Rules**

1. **Allowlist-first categories.** A bundled local map of package → category. A
   package not in the map is dropped, not "unknown-categorised". No package list
   ever leaves the device, and the mapping is never fetched remotely.
2. **Deny-list categories are absolute**, checked before the allowlist: password
   managers, authenticators/2FA, banking, payment/wallet, government/ID, health
   records, email, and messaging apps. Whole category, no field-level negotiation.
3. **Drop raw text at the boundary.** Text nodes may be read only to compute a small
   fixed set of features (length, script/language class, presence of digits,
   presence of URL/email shape). The raw string is discarded inside the filter and
   never returned, never logged, never bridged to JS.
4. **Secret-shaped input is dropped entirely**, not redacted: anything matching an
   OTP shape (short digit runs), card-number shape, IBAN/ID shape, JWT/API-key
   shape, or appearing in a node flagged `isPassword()`. Redaction is a fallback for
   logs, not a strategy for storage.
5. **No keyboard content.** `TYPE_VIEW_TEXT_CHANGED` on an editable node is not a
   signal; keystroke-level data is out of scope permanently.
6. **Structural facts only.** Package *category* — not package name — plus activity
   type, duration bucket, and coarse time bucket.
7. **Fail closed.** Unrecognised event type, throw, timeout, or missing metadata →
   drop, and count the drop locally (counts are fine; contents are not).
8. **Filter is versioned.** Stored signals record the filter version, so tightening
   a rule later doesn't retroactively reinterpret old rows.

**Where it runs — an explicit tradeoff**

| Placement | Pro | Con |
|---|---|---|
| **Kotlin, in the native module** (recommended) | Raw text never crosses the JS bridge; smallest possible exposure surface | Not Node-testable; needs Kotlin tests + shared test vectors (§6) |
| TypeScript, in `src/monitor/` | Node-verifiable like the existing `*Persistence.ts` modules | Raw text crosses the bridge into the JS runtime, where it can leak via logs, crashes, or dev tooling |

Recommendation: **Kotlin**, because "raw secrets never enter the JS runtime" is a
stronger guarantee than test convenience, and the shared test-vector corpus recovers
most of the testability. This is a decision to confirm before implementing.

---

## 10. Local Signal Bus

A **typed, bounded, local-only** channel between the native boundary and the
classifiers/pattern engine. Not a network bus, not a broker, not a queue on disk.

**Type (target shape)**

```ts
// NOT IMPLEMENTED — architectural sketch
type PackageCategory =
  | 'social' | 'video' | 'gambling' | 'dating' | 'shopping'
  | 'news' | 'games' | 'productivity' | 'unknown_denied';

type ActivityType =
  | 'app_session' | 'app_switch' | 'device_unlock' | 'device_idle'
  | 'notification_posted' | 'screen_off' | 'user_checkin';

type TextSignal = {          // features only — never the source string
  charCount: number;
  hasDigits: boolean;
  hasUrlOrEmail: boolean;
  scriptClass: 'latin' | 'other';
  filterVersion: string;
} | null;

type VisualSignal = null;    // reserved; always null in this phase (§17)

type LocalSignal = {
  timestamp: number;                 // epoch ms, device-local
  packageCategory: PackageCategory;  // category, never the raw package name
  activityType: ActivityType;
  textSignal: TextSignal;
  visualSignal: VisualSignal;
  source: 'usage_stats' | 'accessibility' | 'user_input';
};
```

**Properties**

- **Bounded.** A fixed-size ring buffer on the native side (e.g. a few thousand
  entries) so a long session cannot grow memory without limit, and a monitored app
  cannot be used to exhaust it.
- **Native-buffered, JS-drained.** Signals are produced by Android while the JS
  runtime may be asleep. The Kotlin module buffers; JS attaches, drains, and writes
  through the existing SQLite layer. The buffer is **in-memory only** — a process
  kill discards signals rather than persisting them, which is the safer default.
- **Only durable store is SQLite**, via `expo-sqlite`, in app-private storage
  (a new table, e.g. `local_signals`, alongside the existing `check_ins` /
  `urge_events`). Note the existing schema layer exposes `initializeDatabase()` /
  `requireDatabase()` precisely so a new table can be added without touching
  existing call sites.
- **No raw text, ever.** Enforced by the type: there is no field that can hold it.
- **Observable.** The user can see the last N signals behind a debug/inspection view.
  A black box is not acceptable for a monitor; the signals must be inspectable by
  the person they describe.

---

## 11. ALBERT boundary

**Current reality: not usable yet.** `../ml/training/export_onnx.py` is a
`# placeholder`, no `.onnx` file exists anywhere in the project, and there is no
trained head — so there is nothing to run on device. The mobile side is the *second*
blocker; the first is on the Python side.

**What must exist before any mobile work on this:**

1. A trained classifier head on top of ALBERT (a labelling scheme is needed first —
   that is a `ML_SPEC.md` question, and that file is currently an empty stub).
2. An ONNX (or LiteRT / execuTorch) export from `export_onnx.py`.
3. Quantisation: `model.safetensors` is **47.4 MB** as FP32. Even though ALBERT's
   parameters are shared across layers, the 30 000 × 128 embedding table is the bulk
   of the file, and shipping FP32 unchanged into an APK is not viable for a store
   build. Dynamic INT8 quantisation should be the target (expected order: ~12 MB —
   to be measured, not assumed), with an accuracy delta recorded in `ML_SPEC.md`.
4. A **tokenizer on device**. `spiece.model` (760 KB) / `tokenizer.json` (1.3 MB) is
   SentencePiece; the runtime needs a matching tokenizer implementation. This is real
   work that is easy to forget, and a mismatch silently degrades every prediction.
5. A runtime dependency, which means a new native module and therefore a rebuild:
   `onnxruntime-react-native` is the obvious candidate for an ONNX model; LiteRT or
   execuTorch are alternatives. **Sizing and license review required before choosing**
   — `.so` files ship per ABI and inflate the APK, so ABI splits or app bundles are
   likely needed.

**Boundary rules (apply whenever inference is eventually added):**

- **Input is only ever a filtered `TextSignal`-class payload**, never raw screen text,
  never a window dump, never another app's content verbatim.
- **On demand, not continuous.** Classify a short scrubbed snippet when the Pattern
  Engine asks for it, and cache the result against that signal. Never run per
  keystroke, per frame, or on a timer over a growing transcript.
- **The base model stays a feature extractor.** `AlbertForMaskedLM` in the local
  directory is the pretrained base — it is not a risk classifier, and treating its
  masked-LM output as one would be a mistake. The config confirms
  `architectures: ["AlbertForMaskedLM"]`.
- **No embedding persistence.** Embeddings are invertible in practice (embedding
  inversion attacks are well established); storing them is equivalent to storing text.
- **No model download at runtime.** Model ships inside the app (or is provisioned at
  install time). No cloud inference, no telemetry, no remote updates to the model.
- **Degrade, don't fabricate.** If the runtime or model is unavailable, the Pattern
  Engine runs rule-only and the app says so. It must never substitute a made-up
  score — the same honesty rule already applied to SQLite persistence
  ("Check-in not saved: `<real error>`").

---

## 12. Pattern Engine boundary

Deterministic aggregation between raw signals and the Recovery Engine. It is the
monitoring analogue of the existing pure-model modules and should be written the same
way — plain TypeScript, injected clock, no native imports, runnable from `node`.

- **Input:** `LocalSignal[]` already stored in SQLite. Nothing else.
- **Output:** derived features for `RecoveryInput` — the fields that
  `calculateRecoveryState()` already accepts (`urge`, `stress`, `mood`, `energy`,
  `recentUrgeCount`, `recentRelapse`). Design so the engine's existing contract is
  sufficient, because the engine is fenced.
- **Rules must be inspectable.** Same as the Recovery Engine: every contribution
  carries a human-readable reason string, and only triggered rules produce reasons.
  The existing `reasons: string[]` output is the model to copy.
- **Deterministic.** No randomness, no wall-clock reads except an injected `now`.
- **Never diagnoses.** It emits risk signals and pattern summaries, not conditions.

Open question (not decided here): how many of the Recovery Engine's inputs should
eventually be informed by monitoring versus being directly asked of the user. A
monitor-derived `stress` should be visibly distinguishable from a self-reported one.

---

## 13. Recovery & Intervention engine boundary (fenced)

Unchanged, and stay unchanged:

- `calculateRecoveryState()` and `getIntervention()` are **pure** and take no Android,
  SQLite, or monitoring dependency. They must remain callable from a Node test
  forever — that is what `npm test` currently does.
- Monitoring may feed them **inputs**; it may never change their logic.
- `RiskState` unions and the intervention strings are product-visible copy. Adding
  monitoring must not alter them without a deliberate copy decision.
- The existing `src/engine/testRecoveryEngine.ts` suite must keep passing after every
  step below. It is the regression fence around the engines.

---

## 14. Kill switch

Requirements: **explicitly enabled, obviously disabled, and effective immediately.**
Three independent layers, because any one can be bypassed by the user forgetting:

1. **In-app toggle (primary).** A clearly labelled control on the Home screen:
   current state, what is being collected, and one action to stop. It must reflect
   real OS state, not an intent flag.
2. **Native self-disable.** When the user switches monitoring off, the service calls
   `AccessibilityService.disableSelf()` (API 24+) so it stops in-process instead of
   waiting for the user to find the Settings page. Note the asymmetry: an app **can**
   disable its own service, but can never **enable** it — so the kill switch always
   works and the enable path always requires the OS settings screen.
3. **OS-level (always available).** Settings → Accessibility, or stopping/revoking
   usage access. The OS toggle must remain the final authority; the app must never
   attempt to work around it.

Additional requirements:

- **Stop means flush.** Disabling monitoring deletes the in-memory native buffer and
  offers to delete stored signals. "Off" that leaves yesterday's signals on disk is
  not a kill switch.
- **Visible while running.** A persistent status banner in-app, plus a foreground
  service notification if a foreground service is ever used. Android's own indicator
  (e.g. for projection) is not sufficient as the only signal.
- **Safe default on tamper.** If the app cannot determine its own state, it reports
  `unknown` and collects nothing.
- **No dark patterns.** Same visual weight as other Home actions; no "are you sure?"
  chain designed to discourage stopping, and no re-enable prompt after every launch.

**Privacy requirements, enforced structurally**

- No screenshots, no screen recording, no frames to disk or memory beyond the instant.
- No inspection of *content* of other apps beyond what §9 permits, and no inspection
  at all of denied categories.
- No device monitoring beyond the two explicitly consented mechanisms in §7.
- Only what the user explicitly enters in the Check-In/Urge flows, plus the filtered
  signals described above.
- No cloud services, no analytics SDK, no crash reporter that could carry signal or
  text payloads, no network calls for monitoring.

---

## 15. Local signal format — architectural example

> **ARCHITECTURAL EXAMPLE — NOT IMPLEMENTED BEHAVIOUR.**
> This is the intended shape of a stored signal. No monitoring exists, no service is
> registered, and no such row is written anywhere today. `visualSignal` is reserved
> and always `null` in this phase.

```json
{
  "timestamp": 1758400000000,
  "packageCategory": "video",
  "activityType": "app_session",
  "textSignal": {
    "charCount": 42,
    "hasDigits": false,
    "hasUrlOrEmail": false,
    "scriptClass": "latin",
    "filterVersion": "1.0.0"
  },
  "visualSignal": null,
  "source": "usage_stats"
}
```

Field notes:

| Field | Type | Notes |
|---|---|---|
| `timestamp` | number | Epoch ms, device clock |
| `packageCategory` | enum | **Category only.** The raw package name is dropped by the privacy filter and never stored or transmitted |
| `activityType` | enum | Coarse behaviour class, not a raw OS event name |
| `textSignal` | object \| null | Derived features only. There is no field capable of holding raw text |
| `visualSignal` | null | Reserved. Always `null` until §17 is separately approved and implemented |
| `source` | enum | Which consented mechanism produced it, for auditability |

A signal with `packageCategory: "unknown_denied"` (deny-listed) or any secret-shaped
match is **not stored at all** — it is dropped inside the filter and only a local drop
counter changes.

---

## 16. Data retention rules

| Data | Stored | Retention | Deleted |
|---|---|---|---|
| Raw Android events | **Never** — dropped in the privacy filter | — | — |
| Raw text from other apps | **Never** — features only, string discarded | — | — |
| In-memory native signal buffer | RAM only | Until process death or kill switch | Immediately on stop |
| `local_signals` rows | SQLite, app-private | Rolling window (**default proposal: 30 days**) | Auto-pruned; all deleted on kill switch |
| Derived pattern summaries | SQLite | Aggregates only, no per-event detail | With their source window |
| Check-ins / urge events | SQLite (exists today) | User-owned, user-deletable | On user request |
| Model / embeddings | Model ships with app | — | Embeddings never persisted |
| Anything off-device | **Nothing** | — | — |

Rules:

- **Retention is enforced by the app, not promised in prose.** A prune runs at
  startup and on a schedule; a row that aged out is gone without user action.
- **Shorter is the default.** The 30-day figure is a starting proposal to be decided
  in `PRIVACY.md` (currently an empty stub) — the code must take it from one place,
  not scatter the number.
- **Storage is app-private but not encrypted.** `expo-sqlite` on Android writes an
  ordinary app-private database file: other apps cannot read it, but it is not
  encrypted at rest, and a rooted/backed-up device changes that calculus. If
  encryption at rest is required, that is a deliberate decision (custom module /
  SQLCipher-class option), not something to assume is already there.
- **Backup implications.** Android auto-backup can copy app-private data off-device,
  which would contradict "no cloud". Monitoring tables must be excluded from backup
  (or backup disabled) — a concrete config requirement, not a footnote.
- **Uninstall = everything gone.** No server copy exists to restore, by design. That
  must be stated plainly to users rather than presented as a limitation.

---

## 17. Future visual analysis boundary

**Not implemented. Not approved. No screenshots, no recording, no frames today.**

Investigated as requested — the two possible mechanisms, with their real constraints:

| Mechanism | Requires | Reality |
|---|---|---|
| `AccessibilityService.takeScreenshot()` | API **30+**; `android:canTakeScreenshot="true"` in the service config; the service already enabled | Silent-ish, same accessibility consent, but keeps the whole Play accessibility approval burden and applies only where the service is allowed to see |
| `MediaProjection` | **Explicit user consent before every capture session** — consent is per session (a session is one `createVirtualDisplay()` call), and on Android 14+ the permission token is single-use; `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` + `FOREGROUND_SERVICE_MEDIA_PROJECTION` permission and a visible notification while capturing | Cannot be made silent or persistent by design; the OS surfaces an indicator |

Constraints if it is ever approved:

- **On-device processing only.** Frames are analysed in memory and discarded; no
  frame is written to disk, cache, or a log, ever.
- **FLAG_SECURE windows are unreadable** and must be treated as "no data", not as
  "empty screen".
- **Consent per session** for `MediaProjection` means no background visual
  monitoring; the design must accept that, not engineer around it.
- **Deny-listed surfaces** (banking, messaging, password managers, and anything the
  user marks private) are excluded before analysis.
- **The Privacy Filter runs first, always.** Visual input produces coarse features at
  most — never stored images, never reconstructions.
- **`visualSignal` stays `null` until this section is independently approved and
  implemented.** Its presence in the schema is a placeholder for a decision, not a
  commitment to capture.

---

## 18. Explicitly NOT collected

A hard list. Anything here requires a new, explicit, documented decision:

- Passwords, passphrases, PINs, patterns
- OTPs / one-time codes / 2FA codes
- Authentication tokens, session cookies, API keys, JWTs
- Payment information: card numbers, bank details, transaction contents
- Government IDs and identity documents
- Health, medical, or biometric data
- Keystroke content from any keyboard, including our own
- Message, email, or notification *content* from other apps
- Contact lists, call logs, photo library, files, clipboard
- Location, IP address, or any precise geolocation
- Screenshots or screen recordings (see §17)
- Raw text from other apps (only derived features, and only post-filter)
- Any data leaving the device: no cloud, no analytics, no ads, no third-party SDKs
- Covert or non-user-initiated monitoring of any kind

Monitoring is **explicitly user-enabled, visible, and reversible** — non-negotiable.

---

## 19. Open decisions (needed before implementation)

1. **Build path:** local Android Studio toolchain vs EAS cloud build (§3). Blocks
   everything native.
2. **First signal source:** `UsageStatsManager` (recommended) vs
   `AccessibilityService` (§7).
3. **Distribution:** Play (accessibility declaration + approval, unknown timeline) vs
   sideload/alternate store. This can kill the accessibility path entirely and should
   be decided before writing Kotlin.
4. **Privacy filter placement:** Kotlin vs TypeScript (§9).
5. **Retention window** and whether at-rest encryption is required (§16).
6. **ML prerequisite:** labelling scheme for the classifier head — `ML_SPEC.md` is an
   empty stub, and without it there is nothing to train or export (§11).
7. **Whether monitoring influences Recovery Engine inputs at all**, and how
   monitor-derived values are visually distinguished from self-reported ones (§12).

---

## 20. Implementation order & exact next step

Ordered so that each step is independently verifiable and none of it can regress the
existing, working app:

1. Decide §19 items 1–4. (No code.)
2. `npx expo install expo-dev-client`, then a development build that does nothing new
   — proves the native toolchain end to end before any monitoring code exists.
3. Implement the **pure privacy filter** with its test-vector corpus, un-wired, and
   cover it with tests. No Android code, fully Node/Kotlin-verifiable.
4. Add a local Expo module exposing only `isMonitoringEnabled()`,
   `openMonitoringSettings()`, `requestStop()` — settings deep-link and honest state
   read-back, still collecting nothing.
5. Add the least-invasive source (`UsageStatsManager`) behind an in-app consent
   screen that states exactly what is collected, plus the kill switch from step 4.
6. Wire filtered signals into SQLite via the existing `initializeDatabase()` /
   `requireDatabase()` pattern, with retention pruning.
7. Build the Pattern Engine on stored signals only, feeding existing
   `RecoveryInput` — the Recovery/Intervention engines stay untouched.
8. Only then: assess whether accessibility-level access is genuinely needed, and only
   then start the Play declaration work.
9. ALBERT is a **parallel** track blocked on `train.py` / `export_onnx.py`, not on this
   architecture. Do not let it gate steps 1–8.

**Exact next implementation step:** decide §19 items 1–4, then install
`expo-dev-client` and produce a development build that runs the current app unchanged
on a real Android device. That single step converts all of the above from design into
something testable — and until it is done, every claim about monitoring behaviour on
this architecture is unverified.
