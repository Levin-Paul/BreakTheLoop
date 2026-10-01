// Pure, framework-free domain model for the Relapse -> Post-Lapse Recovery
// flow.
//
// Nothing here imports React or React Native, so record creation, context
// parsing, and the Recovery Engine mapping can be exercised directly in Node.
//
// Wording contract (asserted in tests): the flow is deliberately NOT shame-
// based. It never says "you failed", never assigns blame, never makes a causal
// claim ("stress caused this"). A lapse is recorded as neutral recovery data
// and the immediate focus is the next healthy action.
import type { RecoveryInput } from '../engine/types';

/** Scale bounds for post-lapse mood/stress/urge-intensity self-report. */
export const RELAPSE_SCALE_MIN = 1;
export const RELAPSE_SCALE_MAX = 10;

/**
 * Neutral mid-scale value used for mood/stress when the post-lapse check-in is
 * skipped. Matches urgeModel.NEUTRAL_BACKGROUND: a neutral value contributes 0
 * points, so skipping the check-in can never inflate a risk score by itself.
 */
export const RELAPSE_NEUTRAL_BACKGROUND = 5;

/**
 * How far back a stored relapse counts as "recent" for the Recovery Engine's
 * `recentRelapse` signal and the Insights relapse window.
 */
export const RELAPSE_RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Longest optional free-text the user can store about a lapse. */
export const RELAPSE_MAX_NOTE_LENGTH = 280;

/**
 * Structured environment/context options. Counts, not free text: choosing one
 * stores a stable key, so no explicit description is ever required or stored.
 */
export const RELAPSE_ENVIRONMENTS = [
  'home_alone',
  'home',
  'private_space',
  'shared_space',
  'outdoors',
  'other',
] as const;
export type RelapseEnvironment = (typeof RELAPSE_ENVIRONMENTS)[number];

export const RELAPSE_ENVIRONMENT_LABELS: Record<RelapseEnvironment, string> = {
  home_alone: 'Home alone',
  home: 'Home',
  private_space: 'Another private space',
  shared_space: 'A shared or public space',
  outdoors: 'Outdoors',
  other: 'Somewhere else',
};

/** What the relapse entry screen collects. Nothing is mandatory beyond the tap. */
export interface RelapseDraft {
  /** Structured environment key; stored as a countable label, not free text. */
  environment: RelapseEnvironment;
  /** Whether the user noticed a trigger before the lapse. */
  triggerNoticed: boolean;
  /** Optional, bounded note. Never required, never parsed for explicit detail. */
  note: string;
}

/** One recorded lapse: the minimum structured data recovery insights need. */
export interface RelapseRecord {
  id: string;
  /** ISO timestamp of when the lapse was recorded. */
  createdAt: string;
  environment: RelapseEnvironment;
  triggerNoticed: boolean;
  /** Optional user note, truncated on save. Empty string when none. */
  note: string;
  /** Set once the optional post-lapse check-in is completed. */
  checkInAt: string | null;
  /** Post-lapse self-reports; null until the check-in is completed. */
  checkInMood: number | null;
  checkInStress: number | null;
  checkInUrge: number | null;
}

/** The optional structured post-lapse check-in answers that get persisted. */
export interface PostLapseCheckInDraft {
  mood: number;
  stress: number;
  urgeIntensity: number;
}

/**
 * Which immediate action the user reports taking. Free choice on the screen,
 * but stored only as part of the session (not persisted) — the persisted
 * check-in is the mood/stress/urge triple.
 */
export type PostLapseActionKey = string;

/**
 * The immediate actions offered on the post-lapse screen. Wording is
 * action-focused and shame-free; the list mirrors the high-risk intervention
 * from interventionEngine plus a reset and the recovery tools that exist.
 */
export const POST_LAPSE_ACTIONS: readonly { key: string; label: string }[] = [
  { key: 'leave_environment', label: 'Leave the triggering environment' },
  { key: 'phone_away', label: 'Put the phone away' },
  { key: 'shared_space', label: 'Move to a shared or public space' },
  { key: 'breathing_reset', label: 'Take a short reset / breathing period' },
  { key: 'start_check_in', label: 'Start a check-in' },
  { key: 'review', label: 'Review what happened' },
];

/**
 * Risk-state labels for the post-lapse context. Same four engine states, but
 * the wording frames the state as information for choosing the next step, not
 * as a grade. Also exported under a relapse-specific name for the screen.
 */
export const RISK_STATE_LABELS_POST_LAPSE: Record<string, string> = {
  stable: 'Stable',
  low_risk: 'Low Risk',
  moderate_risk: 'Moderate Risk',
  high_risk: 'High Risk',
};

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return RELAPSE_SCALE_MIN;
  return Math.min(RELAPSE_SCALE_MAX, Math.max(RELAPSE_SCALE_MIN, Math.round(value)));
}

function truncateNote(value: string): string {
  return value.trim().slice(0, RELAPSE_MAX_NOTE_LENGTH);
}

/** Builds a saved relapse record from the entry form. */
export function createRelapseRecord(draft: RelapseDraft, now: Date = new Date()): RelapseRecord {
  return {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    environment: draft.environment,
    triggerNoticed: draft.triggerNoticed,
    note: truncateNote(draft.note),
    checkInAt: null,
    checkInMood: null,
    checkInStress: null,
    checkInUrge: null,
  };
}

/**
 * Returns a copy of the record with the optional post-lapse check-in attached.
 * The lapse row is updated in place (same id), never duplicated.
 */
export function withPostLapseCheckIn(
  record: RelapseRecord,
  draft: PostLapseCheckInDraft,
  now: Date = new Date(),
): RelapseRecord {
  return {
    ...record,
    checkInAt: now.toISOString(),
    checkInMood: clampScale(draft.mood),
    checkInStress: clampScale(draft.stress),
    checkInUrge: clampScale(draft.urgeIntensity),
  };
}

/** True when the optional post-lapse check-in has been completed. */
export function hasPostLapseCheckIn(record: RelapseRecord): boolean {
  return record.checkInAt !== null;
}

export interface RelapseInputResult {
  input: RecoveryInput;
  /** True when background state came from the post-lapse check-in. */
  usedCheckIn: boolean;
}

/**
 * Builds the Recovery Engine input for the moment right after a lapse, so the
 * app can recommend the matching intervention level. Nothing here resets or
 * erases history — it is the same scoring path every check-in and urge uses.
 *
 * `recentRelapse` is true: the lapse itself was just logged.
 * `recentUrgeCount` is 0 here — the relapse flow does not read urge history,
 * so no signal is invented.
 */
export function buildRelapseInput(
  record: RelapseRecord,
  checkIn: PostLapseCheckInDraft | null,
): RelapseInputResult {
  const usedCheckIn = checkIn !== null;
  return {
    usedCheckIn,
    input: {
      urge: checkIn ? clampScale(checkIn.urgeIntensity) : RELAPSE_NEUTRAL_BACKGROUND,
      stress: checkIn ? clampScale(checkIn.stress) : RELAPSE_NEUTRAL_BACKGROUND,
      mood: checkIn ? clampScale(checkIn.mood) : RELAPSE_NEUTRAL_BACKGROUND,
      energy: RELAPSE_NEUTRAL_BACKGROUND,
      recentUrgeCount: 0,
      recentRelapse: true,
    },
  };
}

/** True when the record falls inside the "recent" window ending at `nowMs`. */
export function isWithinRecentWindow(record: RelapseRecord, nowMs: number): boolean {
  const at = Date.parse(record.createdAt);
  if (!Number.isFinite(at)) return false;
  return nowMs - at >= 0 && nowMs - at < RELAPSE_RECENT_WINDOW_MS;
}

/** Newest-first sort by stored timestamp (stable for identical timestamps). */
export function sortRelapsesNewestFirst(
  relapses: readonly RelapseRecord[],
): RelapseRecord[] {
  return [...relapses].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export interface RelapseWindowSummary {
  /** How many relapses were recorded inside the window. */
  count: number;
  /** How many of those had a trigger noticed beforehand. */
  triggerNoticedCount: number;
  /** How many of those completed the post-lapse check-in. */
  checkInCount: number;
  /** Cautious, count-based headline. Never causal, never shaming. */
  headline: string;
  /** One neutral follow-up line derived from the stored counts. */
  detail: string;
}

/**
 * Summarizes the stored relapses for Insights. Every number is a count of real
 * stored rows; the wording only ever reports co-occurrence ("stress was present
 * before ..."), never causation, per the milestone's language rules.
 */
export function summarizeRelapseWindow(
  relapses: readonly RelapseRecord[],
  nowMs: number,
): RelapseWindowSummary {
  const recent = sortRelapsesNewestFirst(relapses).filter((record) =>
    isWithinRecentWindow(record, nowMs),
  );
  const count = recent.length;
  const triggerNoticedCount = recent.filter((record) => record.triggerNoticed).length;
  const checkInCount = recent.filter(hasPostLapseCheckIn).length;

  const headline =
    count === 0
      ? 'No relapses recorded in the last 14 days.'
      : count === 1
        ? 'You recorded 1 relapse in the last 14 days.'
        : `You recorded ${count} relapses in the last 14 days.`;

  const detail =
    count === 0
      ? 'Recording a lapse keeps your history honest; it never erases the progress you made.'
      : `You completed the post-lapse check-in for ${checkInCount} of them. Recording context helps you notice patterns — it does not explain or predict anything on its own.`;

  return { count, triggerNoticedCount, checkInCount, headline, detail };
}

/** True when the string is one of the stored environment keys. */
export function isRelapseEnvironment(value: string): value is RelapseEnvironment {
  return (RELAPSE_ENVIRONMENTS as readonly string[]).includes(value);
}
