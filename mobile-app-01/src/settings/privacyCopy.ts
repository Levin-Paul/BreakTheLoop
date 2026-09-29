// Pure copy for the Settings "What we collect / store" section and the
// retention summary. Kept driver-free and framework-free so tests can assert
// the app's privacy claims against reality (npm test), not just render them.
//
// RULES THIS COPY MUST OBEY (asserted in testSettingsPrivacy.ts):
//   - it matches the ACTUAL implementation only,
//   - it never claims a capability that does not exist (e.g. UsageStats),
//   - it names exactly the trained ML labels (anger, sadness, anxiety),
//   - it never says "we collect nothing" (that would be imprecise).

export interface PrivacyCopyItem {
  label: string;
  body: string;
}

/** The monitoring kill-switch explanation shown under the toggle. */
export const MONITORING_EXPLANATION =
  'Turns off automated recovery monitoring. Your existing data stays on this device, and you can still use manual check-ins and recovery tools.';

/** The Discovery Mode description shown under its toggle. */
export const DISCOVERY_DESCRIPTION =
  'Discovery Mode learns patterns from your recovery activity before stronger interventions are introduced.';

/** "What is stored locally" — every entry mirrors a real table/column. */
export const WHAT_IS_STORED: readonly PrivacyCopyItem[] = [
  {
    label: 'Recovery activity you enter',
    body: 'Check-ins, urge episodes (including the intervention shown and your outcome), and the notes you type on them.',
  },
  {
    label: 'Learned patterns',
    body: 'Counts of repeated sequences the Pattern Engine finds in your stored events — computed on this device.',
  },
  {
    label: 'Local ML signal observations',
    body: 'When the on-device model reacts to text you typed, it records the label (only anger, sadness, or anxiety are trained), a confidence number, and the model version. Your text itself is not duplicated here.',
  },
  {
    label: 'App settings and state',
    body: 'Onboarding completion, Discovery Mode on/off, monitoring on/off, and retention window — flags and timestamps only.',
  },
];

/** "What is not stored" — capabilities that genuinely do not exist. */
export const WHAT_IS_NOT_STORED: readonly PrivacyCopyItem[] = [
  {
    label: 'Raw screen frames',
    body: 'No MediaProjection pixels, screen recordings, or screenshots are ever saved.',
  },
  {
    label: 'Cloud copies',
    body: 'There is no server. Recovery data stays on this device unless you explicitly export/share it.',
  },
  {
    label: 'Usage statistics',
    body: 'No app-usage or UsageStats data is collected — that capability is not implemented.',
  },
];

/** Standing privacy lines under the collected/not-stored lists. */
export const PRIVACY_LINES: readonly string[] = [
  'No account is required.',
  'Recovery data stays on this device unless you explicitly export/share it.',
];

/**
 * One-line retention summary shown in Settings. Parameterized by the window so
 * the UI always matches the applied policy.
 */
export function retentionSummary(signalRetentionDays: number): string {
  return (
    `Automated monitoring signal records are pruned after ${signalRetentionDays} days. ` +
    'Your check-ins, urges, and other recovery history are never deleted automatically.'
  );
}

/** Delete-all confirmation dialog copy (title + body + buttons). */
export const DELETE_CONFIRM_TITLE = 'Delete all recovery data?';
export const DELETE_CONFIRM_BODY =
  'This permanently removes your local check-ins, urges, journal entries, relapse history, interventions, learned patterns, and locally stored recovery signals.\n\nThis cannot be undone.';
export const DELETE_CONFIRM_ACTION = 'Delete everything';
export const DELETE_CONFIRM_CANCEL = 'Cancel';
