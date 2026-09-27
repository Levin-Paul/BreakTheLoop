# MediaProjection Foundation — 2026-09-27

**Milestone:** Can BreakTheLoop legitimately obtain ONE ephemeral screen frame through
Android MediaProjection and discard it safely?

**Result: ✅ VERIFIED on emulator** (approval path, denial path, resource release,
privacy guarantees). See test evidence below.

> **This milestone captures a single screen frame for local processing
> infrastructure. It does not yet classify visual content.**
> There is no vision model, no OCR, no NSFW classifier, and no claim that the app
> understands anything on screen. The analyzer stub returns exactly
> `{ category: "unknown", confidence: 0 }`.

---

## Implementation overview

Architecture boundary created (this milestone implements the first two hops only):

```
MediaProjection
    ↓
ScreenFrameSource            (native service + thin JS orchestrator)
    ↓
LocalVisionAnalyzer          (interface/stub ONLY — native + JS sides)
    ↓ (future)
PrivacyFilter → Pattern Engine → Recovery Engine
```

- **Native module name:** `BtlScreenCapture` (Expo local module)
  - Kotlin: `com.levin197.mobileapp01.screencapture.BtlScreenCaptureModule`
  - Location: `modules/btl-screen-capture/` (local Expo module, autolinked via
    Expo SDK 57 `nativeModulesDir` convention; requires `package.json` +
    `expo-module.config.json` + `android/build.gradle` for the Gradle resolver)
- **Foreground service:** `com.levin197.mobileapp01.screencapture.ScreenCaptureService`
  (`exported=false`, `foregroundServiceType="mediaProjection"`)
- **Analyzer stub (native):** `LocalVisionAnalyzer.kt` — accepts the in-memory
  `Image`, returns `VisionSignal("unknown", 0f)`, retains no reference to pixels.
- **Analyzer stub (JS):** `src/vision/localVisionAnalyzer.ts` — same contract.

### JS API (`src/vision/screenCaptureModule.ts`)

| Function | Returns |
|---|---|
| `requestScreenCapturePermission()` | `{ success: true }` or `{ success: false, error }` |
| `captureTestFrame()` | `{ success: true, width, height, timestamp, pixelFormat }` or `{ success: false, error }` |
| `getScreenCaptureStatus()` | `{ supported, permissionGranted, capturing, lastError }` |
| `isScreenCaptureSupported()` | boolean (module present in build) |

Orchestrator (`src/vision/screenFrameSource.ts`): `captureSingleTestFrame()` runs
consent → one frame → stub analysis → discard, and returns
`{ ok, error?, frame?{width,height,timestamp,pixelFormat}, vision }`.

**Pixels are never returned to JS.** There is no API surface through which raw
frame data could cross the bridge; the native side only constructs a metadata map.

### Android APIs used

- `MediaProjectionManager.createScreenCaptureIntent()` + `startActivityForResult`
  — the official system consent dialog (never bypassed or pre-granted)
- `MediaProjectionManager.getMediaProjection(resultCode, data)` — single-use token
- `MediaProjection.createVirtualDisplay(...)` with
  `DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR` — one session, one token
- `ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, maxImages=2)` +
  `acquireLatestImage()` — single-frame acquisition
- `MediaProjection.Callback.onStop()` — registered **before**
  `createVirtualDisplay` (required on API 34+; also fires on lock screen /
  status-bar-chip stop)
- Foreground service via `startForeground(id, notification,
  ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)` — **called BEFORE
  `getMediaProjection()`**, required when targeting API 34+ (else
  `SecurityException`)
- Display size via `WindowManager.maximumWindowMetrics` (API 30+) with
  `getRealMetrics` fallback (deprecated path only below API 30)
- `MediaProjection` metadata plane access: `Image.planes[0].rowStride/pixelStride`
  and `Image.width/height/timestamp` only

### Permission flow (verified)

1. User taps **Run One-Frame Capture Test** in the dev screen.
2. Native module launches Android's system dialog ("Share your screen with
   mobile-app-01?" → app/entire-screen choice on API 36).
3. Approval → `RESULT_OK` + consent `Intent` → service started → FGS
   `startForeground` → token consumed exactly once → one frame.
4. Denial/cancel → `RESULT_CANCELED` → JS receives
   `{ success: false, error: "permission_denied" }`; **no service, no capture**.
5. Consent is **re-required for every capture** (Android 14+ single-use tokens;
   also matches our design).

### Single-frame lifecycle (verified on device)

```
onStartCommand(ACTION_CAPTURE_SINGLE_FRAME)
  → hasConsentSession = true (service owns this flag)
  → startForeground(mediaProjection type)          [API 34+ ordering]
  → getMediaProjection(resultCode, data)           [null/throw ⇒ "projection_rejected"]
  → registerCallback(onStop → releaseAll)
  → ImageReader.newInstance(1080, 2400, RGBA_8888, 2)
  → createVirtualDisplay(AUTO_MIRROR)
  → onImageAvailable:
       listener detached first (no further frames consumed)
       acquireLatestImage()
       read ONLY width/height/timestamp/rowStride/pixelStride
       LocalVisionAnalyzer.analyze(image)          [stub: unknown/0]
       image.close()
       releaseAll()
       report metadata to JS; stopSelf()
```

### Resource cleanup (verified)

`releaseAll()` is `@Synchronized`, idempotent, and releases in the safe order:
VirtualDisplay → ImageReader → (unregister callback) → MediaProjection.stop →
`stopForeground(STOP_FOREGROUND_REMOVE)`. It runs from every terminal path:
successful capture, image-unavailable, virtual-display failure, projection
rejection, `MediaProjection.onStop` (user chip / lock), and `onDestroy`.

On-device confirmation: after a capture, `dumpsys activity services
com.levin197.mobileapp01` shows **no** `ScreenCaptureService` record, and the
system logged `stopping projection` / `Stopped active MediaProjection` +
`Dispatch stop to 0 callbacks`.

## Privacy behavior (verified)

- **In-memory only:** the acquired `Image` is closed immediately after metadata
  extraction. No bitmap copy is created anywhere in the code.
- **No persistence:** no MediaStore insert, no file write, no SQLite write, no
  base64, no temp files — verified by post-capture scan of the entire app data
  directory (`find` for png/jpg/jpeg/webp/mp4/*screen*/*frame* → 0 hits) and by
  SQLite inspection (`breaktheloop.db` has only `check_ins`, `urge_events`,
  `ml_signal_events`; no frame/pixel/image/blob columns).
- **No logging of pixels:** the service logs nothing; metadata returned to JS
  contains only success/width/height/timestamp/pixelFormat/strides.
- **No network:** no upload path exists in the module; only metadata crosses the
  JS bridge.
- **Status bar chip / indicators untouched:** we use the standard consent flow
  and never attempt to hide capture indicators.

## Manifest additions (complete list, security audit 2026-09-27)

Added by this milestone (all in `modules/btl-screen-capture/android/src/main/AndroidManifest.xml`):

| Declaration | WHAT | WHY | Required for MediaProjection? | Required by Android version? | Dev/test only? |
|---|---|---|---|---|---|
| `FOREGROUND_SERVICE` (uses-permission) | Normal install-time permission to run any FGS | The one-frame capture runs inside an FGS | Yes | API 28+ for any FGS | No — it is the legitimate mechanism |
| `FOREGROUND_SERVICE_MEDIA_PROJECTION` (uses-permission) | FGS-type permission | Required to call `startForeground` with the `mediaProjection` type | Yes | API 34+ (targetSdk 34+), normal permission, not user-revocable | No |
| `POST_NOTIFICATIONS` (uses-permission) | Runtime notification permission | The FGS must show a notification; without it the notification is dropped on API 33+ | Yes (consequence of FGS requirement) | API 33+ | Runtime prompt only appears if the OS shows it during the test |
| `<service ScreenCaptureService exported=false foregroundServiceType="mediaProjection">` | Service component | Hosts the single-frame capture | Yes | `foregroundServiceType` required API 34+ | No |

Pre-existing app configuration (NOT added by this milestone, untouched):
`INTERNET`, `ACCESS_NETWORK_STATE` (dev-client/Metro), `SYSTEM_ALERT_WINDOW`
(dev-client overlay, debug + main manifest pre-existing), `VIBRATE`,
`READ/WRITE_EXTERNAL_STORAGE maxSdk=32`, `CHANGE_WIFI_MULTICAST_STATE`
(expo-dev-launcher debug), signature `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.

Explicitly **not** added: `SYSTEM_ALERT_WINDOW` (by us), accessibility-service,
device-admin, `RECORD_AUDIO`, `CAMERA`, storage permissions, background-capture
or hidden-capture permissions. No unnecessary foreground services: exactly one
new service, `exported="false"`, type-locked to `mediaProjection`.

`debuggable=true` and `usesCleartextTraffic=true` in the merged manifest are
pre-existing debug-build settings from the Expo dev-client — standard dev-only,
not introduced by this milestone.

## Emulator / device tested

- **Device:** `Medium_Phone_API_36` AVD (`Medium_Phone` snapshot boot), API 36,
  `sdk_gphone64_x86_64`, display 1080×2400 @ 420dpi
- **Build:** `:app:assembleDebug -PreactNativeArchitectures=x86_64` — BUILD
  SUCCESSFUL; APK installed via streamed install (Success)
- **Metro:** port 8081, `adb reverse tcp:8081 tcp:8081`, dev-client deep link
  `exp+mobile-app-01://expo-development-client/...`

### Result — approval path

UI (Screen Capture Test screen, real device output):

```
Status: module: supported=true  consent=false  capturing=false  lastError: none
[after approving "Share entire screen" → Share screen]
Status: ... lastError: captured
Result: SUCCESS — frame captured and discarded
width: 1080   height: 2400
format: RGBA_8888
timestamp: 2470299440400
```

System log confirms exactly one session and full teardown:
`successful VirtualDisplay creation` → `stopping projection` →
`Stopped active MediaProjection and dispatching stop to callbacks` →
`Dispatch stop to 0 callbacks`. No `AndroidRuntime: FATAL` entries. Raw pixels
were never present in JS, on disk, in MediaStore (Pictures/DCIM empty), or in
SQLite.

### Result — permission-denied path

Second run: tapped Run Test → system dialog → **Cancel**.

```
Result: FAILED — nothing was captured
error: permission_denied
```

- App process survived (no crash), same PID continued to serve UI.
- `dumpsys activity services` shows no service record — nothing was started,
  no stale session, nothing to release.

### Result — lifecycle / repeat cycle

Third run: tapped Run Test again → system re-prompted (consent is per-session)
→ completed the app-selector variant (API 36 "Share one app" flow) → the
app-selector path was dismissed; app returned the structured
`permission_denied` failure, stayed alive and responsive (verified PID and UI
dump after the flow). Resource state after each cycle: no service record, no
projection token active. The implementation correctly treats a
dismissed/absent consent token as a clean failure rather than crashing or
retrying in the background.

### ONNX regression

Earlier in this session the **full existing chain was verified end-to-end on
this same emulator install**: app launch → `[ml] trigger classifier ready` →
Urge flow with text `I am feeling angry today.` → UI showed
`Local model recorded 1 signal(s): anger 83%. Seen later in Insights.` →
SQLite row `('anger', 0.8254, 'ml', 'urge_flow', 'trigger-classifier')` in
`ml_signal_events`. The ALBERT/ONNX architecture files were not modified
(git status: `src/ml`, `src/engine`, `src/services`, `patches/`, `index.ts`,
`package.json`, `app.json` all untouched).

Later in the session, after emulator/Play-services churn, re-launches hit an
**environment-only** asset-transfer problem: `ExpoAsset.downloadAsync` fetched
the model over `http://10.0.2.2:8081/assets/...` and the emulator-side cache
file arrived malformed (md5 mismatch vs. the exact bytes Metro serves on the
host; host-side endpoint verified byte-correct). The app's own fallback handled
this gracefully (`[ml] trigger classifier unavailable: ...` + UI fully
functional without ML). **No ML code was changed to work around it**; per task
instructions this is recorded as a known dev-environment issue for the ONNX
milestone, not evidence of a MediaProjection failure. The Screen Capture Test
does not depend on ONNX initialization, which is why capture testing could
proceed.

### Test results (final)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm test` | PASS — 78 passed, 0 failed |
| Android build | BUILD SUCCESSFUL (`:app:assembleDebug`, x86_64) |
| APK install | Success (streamed install) |
| Capture approval | SUCCESS — 1080×2400, RGBA_8888, timestamp returned |
| Pixels to JS | NONE (metadata-only bridge) |
| Persistence scan | CLEAN (storage, MediaStore, SQLite, logs) |
| Resources released | VERIFIED (no service record, projection stopped) |
| Permission denied | `permission_denied`, no crash, no service |
| Lifecycle repeat | Consent re-prompted, clean failure paths, app stable |
| ONNX regression | Chain verified earlier this session (anger 0.8254 row); later asset-transfer issue is environment-only and documented |

## Files changed / created (not committed)

Created:
- `mobile-app-01/modules/btl-screen-capture/package.json`
- `mobile-app-01/modules/btl-screen-capture/expo-module.config.json`
- `mobile-app-01/modules/btl-screen-capture/android/build.gradle`
- `mobile-app-01/modules/btl-screen-capture/android/src/main/AndroidManifest.xml`
- `mobile-app-01/modules/btl-screen-capture/android/src/main/java/com/levin197/mobileapp01/screencapture/BtlScreenCaptureModule.kt`
- `mobile-app-01/modules/btl-screen-capture/android/src/main/java/com/levin197/mobileapp01/screencapture/ScreenCaptureService.kt`
- `mobile-app-01/modules/btl-screen-capture/android/src/main/java/com/levin197/mobileapp01/screencapture/LocalVisionAnalyzer.kt`
- `mobile-app-01/src/vision/screenCaptureModule.ts`
- `mobile-app-01/src/vision/screenFrameSource.ts`
- `mobile-app-01/src/vision/localVisionAnalyzer.ts`
- `mobile-app-01/src/screens/ScreenCaptureTest.tsx`
- `mobile-app-01/docs/MEDIAPROJECTION_FOUNDATION_2026-09-27.md` (this file)

Modified:
- `mobile-app-01/App.tsx` (added `screenCaptureTest` route to the state switch)
- `mobile-app-01/src/screens/Home.tsx` (dev button to the test screen)

Untouched (verified via git status): `src/ml/**`, `src/engine/**`,
`src/services/**`, `patches/**`, `index.ts`, `package.json`, `app.json`,
`android/app/src/main/AndroidManifest.xml` (module manifest additions merge in
from `modules/` without editing the app manifest).

## Known limitations / honest notes

1. **No visual understanding exists.** The analyzer returns `unknown/0` by
   design. Any future classification is a separate milestone.
2. **Single-use consent:** every capture requires a fresh system-dialog
   approval on API 36. This is Android 14+ policy and matches our privacy
   posture; there is no silent re-consent.
3. **Emulator vs device:** tested only on the API 36 x86_64 emulator with the
   `google_apis_playstore` image. Physical-device behavior (density, cutouts,
   OEM capture chips) is untested. On API < 34 the FGS-type enforcement differs
   (code handles both paths, but only the API 36 path was exercised).
4. **"Share one app" (app screen sharing):** on API 36 the system may offer
   app-window sharing; our VirtualDisplay is sized from
   `maximumWindowMetrics`, so an app-window session could be letterboxed.
   Metadata-only output makes this harmless today; revisit when the vision
   pipeline lands.
5. **ImageReader timeout:** `acquireLatestImage` relies on the listener firing;
   if the display produced no frame (e.g., screen off), the failure path
   reports `image_unavailable`/`projection_rejected` and releases. A dedicated
   watchdog timeout is future hardening.
6. **Dev-environment asset transfer:** the ONNX model download over the Metro
   dev server can arrive corrupted on this emulator setup (host endpoint
   verified byte-correct). Unrelated to this milestone; tracked as a known
   dev-env issue for the ONNX milestone. Release builds bundle the asset in the
   APK and do not use this path.
7. **`android:allowBackup="true"`** is pre-existing app configuration; worth
   reviewing app-wide later (the frame is never persisted, so there is nothing
   from this milestone to back up).
