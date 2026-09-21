// Pure, framework-free model for the Check-In flow.
//
// Nothing here imports React or React Native, so the mapping from a check-in to
// `RecoveryInput` can be exercised directly in Node (see the verification steps
// in the task report) independently of the UI.
import type { RecoveryInput, RiskState } from '../engine/types';

/** Scale bounds for every self-reported field (mood, urge, energy, stress). */
export const MIN_SCALE = 1;
export const MAX_SCALE = 10;

/** How many of the most recent check-ins count as the "recent" window. */
export const RECENT_WINDOW_SIZE = 3;

/** An urge at or above this value counts as one "recent urge" signal. */
export const URGE_SIGNAL_THRESHOLD = 6;

/** A single saved check-in. */
export interface CheckIn {
  id: string;
  createdAt: string;
  mood: number;
  urge: number;
  energy: number;
  stress: number;
  /** `false` means the user reported not staying in control (a lapse). */
  controlled: boolean;
}

/** The values the Check-In form collects, before they become a `CheckIn`. */
export type CheckInDraft = Omit<CheckIn, 'id' | 'createdAt'>;

/** Display labels for the engine's risk states. */
export const RISK_STATE_LABELS: Record<RiskState, string> = {
  stable: 'Stable',
  low_risk: 'Low Risk',
  moderate_risk: 'Moderate Risk',
  high_risk: 'High Risk',
};

/** Clamps a raw form value into the 1-10 scale. */
export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value)));
}

/** Builds a saved check-in from the form values. */
export function createCheckIn(draft: CheckInDraft, now: Date = new Date()): CheckIn {
  return {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    mood: clampScale(draft.mood),
    urge: clampScale(draft.urge),
    energy: clampScale(draft.energy),
    stress: clampScale(draft.stress),
    controlled: draft.controlled,
  };
}

/**
 * Derives the two "recent signal" fields the Recovery Engine expects, from the
 * check-in being scored plus the check-ins that came before it.
 *
 * - `recentUrgeCount`: how many of the last `RECENT_WINDOW_SIZE` *earlier*
 *   check-ins reported an urge at or above `URGE_SIGNAL_THRESHOLD`. The current
 *   check-in is deliberately excluded, because the engine's urge rule already
 *   scores it — counting it here would double-count a single urge event.
 * - `recentRelapse`: true when the current check-in was reported as not
 *   controlled, or when any earlier check-in in the window was. A fresh
 *   "Controlled: No" answer must still register as a relapse right away.
 */
export function deriveRecentSignals(
  checkIn: CheckIn,
  history: readonly CheckIn[],
): Pick<RecoveryInput, 'recentUrgeCount' | 'recentRelapse'> {
  const earlier = history.slice(-RECENT_WINDOW_SIZE);
  return {
    recentUrgeCount: earlier.filter((entry) => entry.urge >= URGE_SIGNAL_THRESHOLD).length,
    recentRelapse: !checkIn.controlled || earlier.some((entry) => !entry.controlled),
  };
}

/**
 * Maps a check-in plus its *earlier* history onto `RecoveryInput`.
 * Pass the check-ins that precede `checkIn`; `checkIn` is never part of the
 * window used for recent signals.
 */
export function toRecoveryInput(
  checkIn: CheckIn,
  history: readonly CheckIn[],
): RecoveryInput {
  return {
    urge: checkIn.urge,
    stress: checkIn.stress,
    mood: checkIn.mood,
    energy: checkIn.energy,
    ...deriveRecentSignals(checkIn, history),
  };
}
