# Onboarding & Discovery Mode

This document describes the onboarding flow, Discovery Mode, and the pattern
insights surfaced on Home, as implemented and verified on this milestone
(2026-09-27). Everything below was verified on the Android emulator through the
real UI; nothing here is planned-but-unbuilt.

## Onboarding

### First-launch behavior

On a fresh install (no `app_state` row), the app boots into a 4-step onboarding
flow. The boot path is resolved from the local SQLite database before the first
screen renders:

- Fresh install or never-completed onboarding → onboarding flow.
- Returning user (`onboarding.completed = true`) → straight to Home.
- If the onboarding state cannot be read, the app fails safely: it shows
  "Local data could not be read" with the error text and a "Try again" button.
  It never guesses and never writes in that state.

### Four stages

Each step is shown as "STEP n OF 4" with its own headline and body, plus a
persistent privacy note: "No account, name, email, or location is requested.
Everything stays on this device."

1. **"Break the loop."** — Understand what drives your urges instead of blindly
   blocking everything.
2. **"First, we learn."** — Discovery Mode starts by observing
   recovery-relevant patterns (when urges happen, what situations surround
   them, emotional patterns, what tends to happen before or after an urge).
3. **"Your data stays on your device."** — Core recovery data is stored
   locally; the local AI runs on-device and works offline; raw private content
   is not intended to become stored product data; the user stays in control,
   including deleting or exporting data.
4. **"You are in control."** — Discovery Mode can be stopped at any time,
   interventions can be adjusted later, data can be deleted at any time, and a
   disclaimer states this is a self-reflection tool, not a replacement for
   professional medical care. The final action button is
   **"Start Discovery Mode"**.

Steps have explicit **Back / Next** buttons (in-app); the flow is never
advanced implicitly.

### Completion persistence

Pressing "Start Discovery Mode" on step 4 writes two rows to the local
`app_state` SQLite table before the Home screen appears:

- `onboarding`: `{ completed: true, completedAt: <epoch ms> }`
- `discovery_mode`: `{ enabled: true, startedAt: <epoch ms> }`

Onboarding completion is a single overwrite-able fact (upsert), idempotent and
never duplicated. If either write fails, onboarding stays up with the error
visible — no partial state is written.

### Back-navigation behavior

While onboarding is on screen, the Android hardware Back button is intercepted
(`BackHandler` returns `true`) and does nothing. Verified on both step 1 and
step 4: Back never leaves the flow and never skips onboarding. The only way
forward is the onboarding's own buttons.

## Discovery Mode

### When it starts

Discovery Mode starts when onboarding is completed ("Start Discovery Mode").
It is enabled by default at that point with `startedAt` set to the completion
time. It can be stopped from Home ("Stop Discovery Mode") and re-enabled later
("Turn back on"); both actions are explicit user actions.

### How enabled/disabled state is persisted

A single `discovery_mode` row in the `app_state` table holds
`{ enabled, startedAt, stoppedAt? }`. Toggling writes the whole row via upsert:
disabling keeps the original `startedAt` and records `stoppedAt`; re-enabling
starts a new period with a fresh `startedAt`. Stopping Discovery Mode changes
only this flag row — check-ins, urges, and ML signal rows are untouched (the
persistence layer contains no DELETE statements at all).

The state is read from SQLite at every app boot, so it survives process death
and device restarts.

### Observation-period wording

The Home Discovery card derives its headline from real database counts:

- Disabled: "Discovery Mode is off."
- No data yet: "Not enough data yet. Keep checking in normally."
- Some data: "Learning your patterns — we're looking for patterns around
  urges, emotions, situations and timing."
- Promoted patterns exist: "Your patterns are becoming clearer."

The card also carries the standing note: "During this stage, Break the Loop
focuses on understanding your patterns. As enough data builds up, it can
suggest when an intervention may help." No promised timelines and no
deterministic claims.

### What data is displayed

The Discovery card shows three counts read live from the local database —
"Check-ins recorded", "Urges recorded", and "Patterns identified" (the last
counts promoted patterns). A dev-only footer independently reports
"N check-in(s) and M urge(s) are stored on this device" plus the privacy
statement. If a read fails, the counts stay at 0 and the error is shown rather
than guessed away.

### How pattern promotion is surfaced

When the existing Pattern Engine finds a promoted (emerging or recurring)
pattern in the stored history, Home shows a banner card above the Discovery
card:

- Title: "PATTERN NOTICED"
- Body: a count-based description, e.g. "Distress (stress 6+ or mood 3 or
  below) appeared within 12 hours before high-urge episodes. It has appeared
  repeatedly in your recent check-ins and urges (2 times)."
- Call to action: "Want to explore what was happening before the urge? Find it
  in Insights."

This wording was verified on-device by creating the underlying data through the
real UI (one distress check-in followed by two high-urge episodes).

## Pattern Insights

### Existing Pattern Engine reused

Home does not implement its own detection. It calls the existing
`patternEngine.detectPatterns()` over the same bounded recent history that the
Insights screen reads, and promotion is decided by the engine's own
`isPromotedPattern` (via `discoveryModel`). No second engine, no duplicated or
re-invented thresholds.

### Promotion criteria are not duplicated

Promotion states come from `patternEngine.statusForCount()`:
`possible` (1 sighting) → `emerging` (2–3) → `recurring` (4+). Only emerging
and recurring are promoted. The banner layer consumes these states; it defines
none of them itself.

### Cautious wording

Banner copy is generated from occurrence counts only. It states what appeared
how many times within what window, never that one event caused another, and
never a prediction about the user. The automated test suite asserts the wording
contract (no causal/deterministic claims, no shame language, count-based
evidence stated, invitation cautious) — see `discoveryModel` tests.

### No spam / duplicate rendering behavior

`buildPatternInsightBanners()` limits Home to at most one banner
(`DISCOVERY_BANNER_LIMIT`), strongest pattern first, keyed by the pattern id so
repeated renders cannot duplicate it. These properties are covered by the
automated tests (at most one banner, strongest first, repeated renders
identical, no duplicate ids) and were confirmed on-device: with 2 sightings of
the same pattern, exactly one banner rendered across multiple Home visits.

## Privacy

### Local storage

All onboarding and Discovery Mode state lives in the app's local SQLite
database (`app_state` table: flags and timestamps only). Recovery data
(check-ins, urges) and ML signal observations remain in their existing local
tables.

### No personal information collected by onboarding

The onboarding screens contain no text inputs at all — there is no field where
a name, email, or any other personal information could be entered. The only
stored facts are the boolean completion flag with its timestamp, and the
Discovery Mode flag with its timestamps.

### No raw screen frames

The screen-capture foundation (dev-only test screen, MediaProjection) has no
database write path; no frame data is persisted by Discovery Mode or by any
part of this milestone.

### No network dependency

The entire onboarding + Discovery Mode path works fully offline. No network
libraries or calls are used by the new code; the classifier note on device
confirms "The local AI runs on-device and offline." No telemetry exists.

## Verification

Automated (rerun after the fresh-install fix below):

- npm test: **256/256 passed** (8 suites, 0 failed)
- TypeScript (`npx tsc --noEmit`): **PASS**
- Android build (`assembleDebug`): **PASS** (build from 2026-09-27)

Manual, on emulator (Medium_Phone API 36, dev client + Metro on port 8081,
`adb reverse tcp:8081 tcp:8081`):

- Emulator run: **PASS** — bundle built (798 modules), `[ml] trigger classifier
  ready` logged, no fatal JS/native errors in the entire run.
- Fresh install / onboarding flow: **PASS** — `pm clear` then launch shows the
  onboarding as the first product screen; all four stages verified with their
  actual copy (see above); "Start Discovery Mode" leads to Home with Discovery
  Mode enabled; hardware Back never bypasses onboarding.
- Restart test: **PASS** — after force-stop and relaunch, no repeated
  onboarding, Home appears, Discovery Mode state persists.
- Disable test: **PASS** — "Stop Discovery Mode" switches to "Discovery Mode
  is off." with "Turn back on"; historical data retained (verified with real
  data present: footer still reported 1 check-in + 2 urges); state still
  disabled after another force-stop/restart.
- Pattern banner: **PASS** — promoted-pattern banner ("PATTERN NOTICED")
  appeared on Home after reaching the 2-sighting threshold through real UI
  flows only (1 distress check-in + 2 high urges within 12 hours). No fake rows
  were inserted.
- Recovery Engine regression: **PASS** — the urge flow still produces the full
  high-risk intervention ("Leave the current environment, put the phone away,
  and move to a shared or public space for 10 minutes.") using the latest
  check-in as background; a case without a session check-in correctly used
  neutral background values. Discovery Mode does not bypass any of it.
- Privacy check: **PASS** — no network calls in `src/` (no fetch/XHR/WebSocket/
  NetInfo/axios); no TextInput in onboarding; `app_state` stores flags and
  timestamps only; no DELETE statements exist in the persistence layer; no
  frame persistence; no telemetry.

Not exercised end-to-end on-device (covered by automated tests instead):

- The `recurring` state (4+ sightings) and the urge-cluster-before-lapse
  detector were not driven through the UI in this run; the emerging
  (2-sighting) promotion path was verified end-to-end on-device.

### Fresh-install fix made during verification

The first fresh-install launch failed with "no such table: app_state": the
`CREATE_APP_STATE_TABLE_SQL` statement existed but was never executed against
the real database. `initializeDatabase()` in `src/database/schema.ts` now runs
it (same pattern as the existing ML signal table bootstrap). This was the only
code change made during verification; all automated and manual verification was
performed after it.
