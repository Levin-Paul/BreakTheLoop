# Relapse + Post-Lapse Recovery

Status: **COMPLETE** (verified 2026-10-01 on the Medium_Phone_API_36 emulator).

This milestone adds an honest, shame-free way to record a lapse, an optional
post-lapse check-in that updates the same record, and wires the lapse into the
existing Recovery Engine, Pattern Engine, Insights, export, and delete-all
flows. It is local-first: nothing about a relapse leaves the device.

- **IMPLEMENTED** — exists in the shipping source.
- **VERIFIED** — confirmed working in this milestone's test runs and/or on the emulator.
- **NOT VERIFIED** — exists but was not exercised end-to-end.
- **KNOWN LIMITATIONS** — deliberate constraints worth knowing.

---

## What was built (IMPLEMENTED)

### Relapse entry (`src/screens/Relapse.tsx`, `src/screens/relapseModel.ts`)
- Reached from Home via **"Record a Relapse"**.
- Collects, all optional beyond the tap itself:
  - **Where were you?** — structured environment key (`home_alone`, `home`,
    `private_space`, `shared_space`, `outdoors`, `other`); no free text.
  - **Did you notice a trigger beforehand?** — Yes/No.
  - **Optional note** — free text, hard-bounded at `RELAPSE_MAX_NOTE_LENGTH`
    (280 chars) via `maxLength`. Explicit detail is never required or parsed.
- Wording contract: acknowledging a lapse takes courage; every line is
  action-focused and forward-looking ("Recording a lapse does not erase your
  progress.").

### Cancel behavior
- **‹ Home** and **Cancel** (both `Cancel recording a relapse` /
  `Cancel without recording`) exit **before** any write. Nothing is persisted;
  there is nothing to undo.

### Post-lapse recovery screen
- Shown immediately after recording: "It has been recorded." plus neutral,
  non-causal framing ("Your progress is not erased…").
- Lists concrete immediate actions (leave the environment, put the phone away,
  move to a shared/public space, short reset, start a check-in, review what
  happened).
- Reports persistence honestly: a failed SQLite write shows an explicit
  "could not be saved" message instead of pretending.

### Optional post-lapse check-in
- "Start a check-in (optional)" collects mood / stress / urge-intensity
  (1–10 scales, shared `ScaleInput`) plus which action was taken.
- Submitting calls `withPostLapseCheckIn` and `saveRelapseCheckIn`, which is an
  **UPDATE keyed by the relapse id** (`UPDATE_RELAPSE_CHECK_IN_SQL`) — a second
  insert is impossible by construction; `changes === 0` is surfaced as an
  error, never silently ignored.
- The assessment shown during the check-in comes from the same
  `calculateRecoveryState` engine every other flow uses, with
  `recentRelapse: true` and neutral background values when no check-in data
  exists (`buildRelapseInput`).

### Database schema (`src/database/relapsePersistence.ts`)
- Table `relapse_events`, created idempotently by `initializeDatabase()`
  (`CREATE_RELAPSE_EVENTS_TABLE_SQL`):
  - `id` (primary key), `created_at` (ISO string)
  - `environment` (structured key), `trigger_noticed` (0/1)
  - `note` (bounded optional text)
  - `check_in_at`, `check_in_mood`, `check_in_stress`, `check_in_urge`
    (post-lapse check-in; NULL until completed)
- Repository layer (`src/database/relapseRepository.ts`): `saveRelapseEvent`,
  `saveRelapseCheckIn`, `loadRecentRelapses`, `countRelapses` — all follow the
  honest-result pattern (`{ ok, error? }`, no throws).
- Privacy: the only values written are the ones the user explicitly entered.

### Recovery Engine integration
- A relapse recorded within `RELAPSE_RECENT_WINDOW_MS` (14 days) sets
  `recentRelapse` for subsequent Check-In and Urge flows
  (`App.tsx` → `hasRecentRelapse()` → `storedRelapseInWindow` →
  `deriveRecentSignals` / `buildUrgeInput`).
- The engine adds **+3** and the reason "A recent relapse was logged."
  (`src/engine/recoveryEngine.ts`). No scoring rules were changed by this
  milestone.
- A stored relapse signal does **not** erase history, reset Discovery Mode,
  disable ML, or modify unrelated settings — it only feeds this one flag into
  scoring.

### Pattern / Discovery integration (`src/engine/patternEngine.ts`)
- `buildTimeline(checkIns, urges, relapses)` adds each stored relapse as a
  timeline event with `lapse: true` (label "recorded relapse").
- **Lapse deduplication:** a "Controlled: No" check-in within
  `LAPSE_DEDUPLICATION_WINDOW_MS` (1 hour) of a stored relapse is demoted to a
  plain check-in (`event.lapse = false`) so one real episode is never counted
  twice. The flag is merged, never dropped from both.
- Discovery Mode state lives in `app_state` and is untouched by the relapse
  flow.

### Insights (`src/screens/Insights.tsx`, `src/screens/insightsModel.ts`)
- Count row **"Relapses recorded"** (total stored rows).
- **Relapses** summary from `summarizeRelapseWindow`: count in the last 14
  days, how many had a trigger noticed, how many completed the post-lapse
  check-in. All wording is count-based and observational — explicitly "not a
  judgment, and not a prediction".
- **Recent activity** merges check-ins, urges, and relapses newest-first;
  relapses render as `Relapse · <environment> · <trigger> · check-in done/not done`
  (`describeRelapse`). The optional note text is **not** shown.

### Export (`buildExportPayload`, `src/database/settingsPersistence.ts`)
- `USER_DATA_TABLES` includes `relapse_events`; the payload's
  `relapseEvents[]` mirrors the exact stored rows (environment, triggerNoticed,
  note, check-in fields).

### Delete All Data
- `deleteAllUserDataStatements()` includes a plain `DELETE FROM relapse_events`
  and the verification `SELECT COUNT(*)` for it. Schema objects are untouched
  (`USER_DATA_TABLES` stays exactly five tables).
- Settings copy confirms relapse records are removed; `app_state` is cleared so
  the app boots back to onboarding.

### Privacy copy (`src/settings/privacyCopy.ts`)
- "What is stored locally" gained the **"Relapse records"** bullet (time, place
  type, trigger flag, optional note — "Nothing explicit is ever required").
- `retentionSummary()` now says check-ins, urges, **relapse records**, and other
  history are never auto-deleted.
- `DELETE_CONFIRM_BODY` now names relapse records.
- `Settings.tsx` was fixed during verification to **import** these strings from
  `privacyCopy.ts` instead of shadowing them with stale local constants.

### Tests (`src/settings/testRelapsePersistence.ts`)
- Deterministic Node tests against a real SQLite engine (`node:sqlite`) using
  the exact production SQL — no mocks. Covers record/cancel/persist/migrate,
  same-row post-lapse update, engine input mapping, Insights wording, timeline
  + dedup, export inclusion, delete-all coverage, and privacy constraints
  (note optional and bounded, structured environments, closed copy, no
  frame-like fields).

---

## Verification evidence (VERIFIED)

Automated (final run, 2026-10-01):

- `npm test` → **100 passed, 0 failed**.
- `npx tsc --noEmit` → **0 errors**.
- `./gradlew assembleDebug` (JVM 21 from Android Studio JBR) → `BUILD SUCCESSFUL`
  (re-verified 2026-10-01 after the final source changes);
  `patches/onnxruntime-react-native+1.24.3.patch` remains present and
  `postinstall` re-applies it.

Emulator (Medium_Phone_API_36, `emulator-5554`, expo-dev-client, fresh Metro
bundle of 799 modules served via `adb reverse tcp:8081`):

- **Privacy/Data Controls on the current bundle:** Settings shows the
  "Relapse records" bullet verbatim, the new retention summary
  ("…check-ins, urges, relapse records, and other recovery history are never
  deleted automatically."), and — after the `Settings.tsx` dedup fix — the
  delete-confirmation body naming "relapse records". (A stale-bundle episode
  earlier in the milestone was traced to a transient Metro syntax error; a
  clean Metro restart served the current source.)
- **Relapse entry:** environments, trigger No/Yes, optional note (text entered
  was stored), "Record it" → `relapse_events` = exactly **1** row.
- **Post-lapse check-in:** "Post-lapse check-in saved." shown; the SAME row was
  updated (`check_in_at` set, mood/stress/urge stored); still exactly 1 row —
  no duplicate.
- **Recovery Engine:** a baseline check-in (mood 7 / urge 3 / energy 6 /
  stress 4 / controlled) with a stored relapse scored **3/10, Low Risk**, with
  the sole reason "A recent relapse was logged." and the note "relapse
  flagged". A second check-in with **Controlled: No** inside the dedup window
  still scored **3/10** — no double-count; UI reported "relapse flagged in the
  2 earlier check-in(s)".
- **Insights:** Check-ins 2, Relapses recorded 1; summary "You recorded 1
  relapse in the last 14 days." + "You completed the post-lapse check-in for 1
  of them."; Recent activity shows one Relapse entry ("Home alone · No trigger
  noticed · check-in done") and both check-ins; local patterns section showed
  no duplicate lapse banner (still "being learned", 0 patterns).
- **Discovery Mode:** remained ON ("Learning your patterns…") through the
  relapse flow, scoring, Insights, and a force-stop/restart.
- **Persistence:** force-stop + relaunch preserved the single relapse and both
  check-ins; counts unchanged; no ghost rows.
- **Export (real UI):** the share sheet displayed the production payload with
  `relapseEvents` containing exactly one event (id `mupa6q0i-xxklzf`,
  `environment: "home_alone"`, trigger flag, note, and the full post-lapse
  check-in triple) plus both check-ins.
- **Delete All Data (real UI):** confirmation dialog (new wording) → "Delete
  everything" → app returned to onboarding (STEP 1 OF 4) and the pulled
  database showed `check_ins 0, urge_events 0, ml_signal_events 0,
  relapse_events 0, app_state 0`. After another force-stop/restart the data did
  **not** resurrect. The database was left in this clean state.
- **Privacy source scan:** no `fetch(`/`XMLHttpRequest`/`WebSocket` usage, no
  telemetry or analytics code in `src/`; relapse data lives only in the local
  SQLite file; share-sheet export is user-initiated only.

## NOT VERIFIED

- **Physical devices.** All on-device verification in this milestone used the
  Medium_Phone_API_36 emulator (`emulator-5554`). No physical-device run was
  performed for the relapse flows.
- The cancel path was verified in the earlier session of this milestone (0 rows
  after cancel) and is additionally covered by automated tests; it was not
  re-exercised on the emulator in the final pass.
- `npm run ios` / iOS behavior is entirely untested.

## KNOWN LIMITATIONS

- The optional note is bounded to 280 characters and is never parsed for
  content; Insights intentionally does not display note text.
- The "which action did you take?" choice on the post-lapse check-in is
  session-only by design; the persisted record is the mood/stress/urge triple.
- `buildRelapseInput` deliberately reads no urge history
  (`recentUrgeCount: 0`) — the relapse flow invents no signals.
- `relapse_events` rows are never pruned automatically; retention pruning
  applies only to ML signal records. Users control relapse history via
  Delete All Data.
- Lapse deduplication uses a fixed 1-hour window
  (`LAPSE_DEDUPLICATION_WINDOW_MS`); a "Controlled: No" check-in logged more
  than an hour after a stored relapse counts as a separate episode by design.
- Export relies on the OS share sheet; there is no in-app file writer.
- The relapse flow itself performs no ML inference; ML signal observations and
  relapse records are separate tables by design.
