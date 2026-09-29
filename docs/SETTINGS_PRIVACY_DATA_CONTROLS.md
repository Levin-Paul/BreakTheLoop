# Settings, Privacy & Data Controls

Milestone status date: 2026-09-30. Scope: the Settings screen, the local ML
kill switch, data export, delete-all-data, signal retention, and the privacy
guarantees that ship with them.

Everything below separates what is **implemented in code**, what was
**verified** (and how), and what is explicitly **not verified** or a **known
limitation**. Nothing in this document describes aspirational behavior.

---

## IMPLEMENTED

### Settings screen (`src/screens/Settings.tsx`)

- **Recovery Monitoring toggle** — persists to the `settings` row in the
  existing `app_state` table via `settingsRepository.setMonitoringEnabled`.
  Default: ON.
- **Discovery Mode toggle** — reuses the onboarding-milestone persistence
  (`app_state.discovery_mode`). Turning it off never deletes history; only the
  flag row changes.
- **Export my data** — builds a real JSON payload from the local SQLite
  database and hands it to the platform share sheet. No upload happens unless
  the user completes a share themselves.
- **Delete all recovery data** — confirmation modal, then an atomic
  transactional wipe (see below). The app re-resolves boot state and returns to
  onboarding, which is the documented product behavior for a full reset.
- **Privacy section** — stored/not-stored lists (`src/settings/privacyCopy.ts`)
  that mirror the actual schema, plus the retention summary and standing
  privacy lines. Copy is test-asserted (`testSettingsPersistence.ts` covers the
  schema-mirroring claims; privacyCopy's own rule contract is documented in its
  header).

### ML kill switch (real pipeline integration)

- `ml/signalIngestion.ts#ingestUserText` accepts `monitoringEnabled`.
  When `false`, it returns before the privacy filter and any model call:
  no tokenizer run, no ONNX session run, no observation rows.
- The kill switch is also passed through to `signalPipeline.processSignal`
  as a second independent layer.
- The Urge flow (`src/screens/Urge.tsx`) passes
  `monitoringEnabled: isMonitoringEnabled()` — the REAL stored setting — on
  every capture. Manual check-in/urge/intervention behavior is unchanged in
  both states.
- Absent/unreadable settings row defaults to ENABLED (product default), so a
  corrupted settings store can never silently disable monitoring.

### Data Controls

- **Export** (`settingsRepository.buildExportPayload`): reads every user-owned
  row through the same row mappers the repositories use, then assembles the
  payload via the pure `assembleExportPayload`:
  - `schemaVersion`, `exportedAt`, `app.name`
  - `settings` (monitoringEnabled, signalRetentionDays)
  - `checkIns[]` — id, createdAt, mood, urge, energy, stress, controlled
  - `urgeEvents[]` — id, createdAt, intensity, context, feeling, state, score,
    intervention, afterIntensity, effectiveness, outcomeAt
  - `mlSignalObservations[]` — id, at, label, confidence, source,
    originSource, modelId, modelVersion (NO text — text lives only where the
    user typed it)
  - Nothing else exists in the schema (journal/relapse/pattern tables do not
    exist; interventions are columns on urge_events; patterns are derived, not
    stored), so nothing is fabricated.
- **Delete all** (`settingsRepository.deleteAllUserData`): one transaction —
  `DELETE FROM check_ins; DELETE FROM urge_events; DELETE FROM ml_signal_events;
  DELETE FROM app_state;` followed by in-transaction `COUNT(*)` verification of
  every table (any non-zero count rolls the whole transaction back). Schema DDL
  is untouched. `app_state` is included, so onboarding/discovery/settings reset
  and the next launch is a deterministic fresh install.
- **Retention** (`src/settings/retention.ts` +
  `pruneOldMlSignals`): at app launch, `DELETE FROM ml_signal_events WHERE
  created_at < ?` with a deterministic ISO cutoff
  (`retentionCutoffIso(now, days)`, default 30 days). Only the automated
  monitoring-derived table is pruned; check-ins and urges are NEVER
  auto-deleted. A prune failure is reported and never blocks boot.

---

## VERIFIED

### Node test suite (`npm test`) — 337 checks, 0 failed

Executed against a real SQLite engine (`node:sqlite`) using the exact SQL the
shipping repositories run:

- `src/settings/testSettingsPersistence.ts` (58 checks): settings defaults +
  round-trip + invalid-payload surfacing; retention cutoff determinism
  (`retentionCutoffIso(2026-09-30T12:00Z, 30) == 2026-08-31T12:00Z`); retention
  SQL boundary (strictly-older deleted, boundary row kept, check-ins/urges
  untouched even when 60 days old); delete-all covers exactly the four
  user-data tables with plain DELETEs; populated database → all counts 0,
  schema intact; export payload mirrors real rows incl. intervention/outcome;
  empty export is honest zeros; export contains no text field on ML signals
  and no frames/pixels.
- `src/settings/testMonitoringKillSwitch.ts` (23 checks): with a bound adapter
  and a session-call counter around the REAL `ingestUserText` — OFF: rejected
  before privacy, 0 rows, session never invoked, repeated attempts still
  blocked; ON: classified, 1 row stored, session invoked, row carries model
  metadata; toggle OFF→ON restores processing; absent flag defaults to enabled;
  OFF with unavailable model stays a clean rejection.

### TypeScript

- `npx tsc --noEmit` — clean (exit 0).

### Android debug build

- `./gradlew assembleDebug` — BUILD SUCCESSFUL (no native changes required by
  this milestone; the existing build was reused).

### Emulator (Medium_Phone_API_36, emulator-5554) — real UI drive

All steps below were performed through the actual UI (uiautomator dumps +
input taps), and the SQLite file was pulled via `run-as` after each step:

1. Fresh install → onboarding → complete → Home. Discovery banner honest
   ("Not enough data yet"), counts 0/0/0.
2. **Settings opens**; Recovery Monitoring ON, Discovery Mode ON, Export and
   Delete actions and full Privacy section render.
3. **ML toggle OFF** → `app_state.settings` =
   `{"schemaVersion":1,"monitoringEnabled":false,"signalRetentionDays":30}`.
   Toggle shows OFF; Settings re-entry persists OFF.
4. **ML OFF + real urge capture** → urge saved, UI shows the honest note
   "ML signal not recorded: Recovery monitoring is disabled."; database:
   `ml_signal_events = 0`. Manual urge/intervention/recheck flow worked fully.
5. **ML toggle back ON** (after delete-all reset) → completed onboarding,
   toggled monitoring ON in Settings (verified ON in UI).
6. **ML ON + real urge capture** (text "i am so angry and anxious tonight" /
   "feeling stressed") → UI: "Local model recorded 1 signal(s): sadness 72%."
   Database: `ml_signal_events = 1` with real ONNX inference —
   `label=sadness, confidence=0.7182, source=ml, origin_source=urge_flow,
   model_id=trigger-classifier,
   model_version=trigger-classifier@1.0.0-albert-base-v2`. No other labels
   crossed threshold. Urge completed through recheck; outcome persisted.
7. **Export** → platform share sheet opens with the JSON payload ("Export
   prepared. Choose where to save or share it."); cancelling shows "Export
   cancelled." The share targets on this emulator require a Google account
   (Drive/Gmail), so the payload was verified structurally by the Node tests
   against the same assembly code and by the DB pull above (the exported rows
   are exactly the ones the payload maps).
8. **Delete all with data present** (1 urge + 1 ML signal + outcome) →
   confirmation modal → database pulled: all four tables 0 rows including
   `app_state`; UI returned to onboarding STEP 1. Home counts reset 0/0/0.
9. **Restart persistence**: force-stop + relaunch after delete-all →
   onboarding again; database still all-zero. (Earlier in the session,
   force-stop + relaunch with data present kept onboarding completed, state
   and data intact.)
10. **Discovery Mode after delete-all** → reset to a fresh
    `discovery_mode` row written on onboarding completion; Home shows the
    fresh-install Discovery panel. Toggling Discovery off (earlier session
    phase) never removed historical rows.

### Privacy / network scan of `src/**`

Pattern scan for `fetch(`, `XMLHttpRequest`, `WebSocket`, `axios`, `NetInfo`,
`analytics`, `telemetry` (case-insensitive, .ts/.tsx):

- `0` matches for fetch( / XMLHttpRequest / WebSocket / axios / NetInfo.
- `analytics` — 2 matches, both benign: one word in the ALBERT tokenizer
  vocab fixture (`testTokenizerVocab.ts`, a verbatim training-checkpoint
  token), one in Home's privacy footnote saying there IS no analytics.
- `telemetry` — 1 match: a code comment in `appStatePersistence.ts` listing
  what the table does NOT store.
- `package.json` has no network/ads/analytics dependencies (no axios, no
  firebase, no google-signin, etc.). Runtime device logcat shows no app-originated
  network activity; the only account-related prompt seen during testing was
  the OS Google sign-in flow the tester accidentally triggered from the
  launcher, not from app code.

No raw screen frames or raw inference text are persisted (asserted by tests;
schema has no such columns).

---

## NOT VERIFIED

- **Export end-to-end to an external destination.** The share sheet opens and
  the payload is real (built from the live DB), but this emulator's share
  targets (Drive/Gmail) require an account sign-in, so the file was not
  actually written to Drive/disk during this session. Structural correctness
  is covered by the Node tests running the identical assembly code.
- **Physical device.** Nothing in this document was verified on hardware.
  Emulator only (Medium_Phone_API_36).
- **Retention prune on-device over calendar time.** The SQL boundary behavior
  is verified deterministically in Node (real SQLite engine); the launch-time
  prune ran during emulator sessions (no errors observed) but a 30-day window
  cannot be observed end-to-end in one sitting.
- **Export size/performance** with a very large history (thousands of rows)
  is untested; the payload is built in memory.

## KNOWN LIMITATIONS

- Export uses the text share sheet (`Share.share` with a JSON string). For
  large histories a file-based export (`expo-file-system` +
  `expo-sharing`) would be more robust; not implemented in this milestone.
- Retention window (30 days) is a stored setting but has no Settings UI control
  yet; it is changed only in code/DB.
- Delete-all requires confirming on a modal; there is no typed-confirmation
  gate. Acceptable for current scale.
- `ml_signal_events` has no index on `created_at`; with the current data
  volumes this is irrelevant, but a long-lived install might want one.
- The kill switch currently gates the text-signal ingestion path (the only
  automated ML path). If future automated signals are added (e.g. usage-based
  triggers), each must honor `monitoringEnabled` at its own entry point.

---

## Data stored by the app (complete list)

SQLite database `breaktheloop.db` (app-private storage, `files/SQLite/`):

| Table | Contents |
| --- | --- |
| `check_ins` | manual check-ins: id, created_at, mood, urge, energy, stress, controlled |
| `urge_events` | urge episodes: id, created_at, intensity_before, trigger, context, state, score, intervention, intensity_after, effectiveness, outcome_at |
| `ml_signal_events` | automated ML observations: id, created_at, label (anger/sadness/anxiety only), confidence, source, origin_source, model_id, model_version — never the text |
| `app_state` | single-row flags: onboarding completion, Discovery Mode state, settings (monitoringEnabled, signalRetentionDays) |

Nothing else. No accounts, no server, no analytics, no screen frames, no
telemetry identifiers.
