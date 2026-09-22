// Pure, framework-free helpers for the Insights screen.
//
// Kept free of React and of any database import so the merging and formatting can
// be exercised directly in Node.
import type { CheckIn } from './checkInModel';
import { EFFECTIVENESS_LABELS, type UrgeEvent } from './urgeModel';
import type {
  MlSignalSummary,
  PatternStatus,
} from '../engine/patternEngine';
import type { TrainedTriggerLabel } from '../ml/triggerClassifier';

/** How many stored events the "Recent activity" section shows. */
export const RECENT_ACTIVITY_LIMIT = 5;

/**
 * How many stored events the pattern engine reads. Larger than the activity
 * limit because repeated sequences need history; still a bounded read.
 */
export const PATTERN_HISTORY_LIMIT = 200;

/** Display labels for pattern promotion states. */
export const PATTERN_STATUS_LABELS: Record<PatternStatus, string> = {
  possible: 'Possible',
  emerging: 'Emerging',
  recurring: 'Recurring',
};

/**
 * Formats the engine's transparent 0-1 confidence as a percentage string,
 * without relying on Intl. It is a score, not a calibrated probability.
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** Formats the first/last-seen range, falling back to whichever end exists. */
export function formatDateRange(first: string | null, last: string | null): string {
  if (!first && !last) return 'No range available';
  if (first && last && first !== last) {
    return `${formatStoredTimestamp(first)} \u2192 ${formatStoredTimestamp(last)}`;
  }
  return formatStoredTimestamp((last ?? first) as string);
}

export type ActivityKind = 'check_in' | 'urge';

/** One line of the recent activity list, built only from stored values. */
export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  createdAt: string;
  title: string;
  detail: string;
}

/**
 * Formats a stored ISO timestamp for display without relying on Intl, which is
 * not fully available on every React Native runtime.
 */
export function formatStoredTimestamp(iso: string): string {
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  return time.length === 5 ? `${date} ${time}` : iso;
}

/** Describes a stored check-in from its own values. */
export function describeCheckIn(checkIn: CheckIn): string {
  return [
    `Mood ${checkIn.mood}`,
    `Urge ${checkIn.urge}`,
    `Energy ${checkIn.energy}`,
    `Stress ${checkIn.stress}`,
    checkIn.controlled ? 'In control' : 'Not in control',
  ].join(' \u00b7 ');
}

/** Describes a stored urge episode, including its outcome when it has one. */
export function describeUrge(event: UrgeEvent): string {
  if (event.afterIntensity === null) {
    return `Intensity ${event.intensity} \u00b7 awaiting recheck`;
  }
  const label = event.effectiveness ? EFFECTIVENESS_LABELS[event.effectiveness] : 'Unknown';
  return `Intensity ${event.intensity} \u2192 ${event.afterIntensity} \u00b7 ${label}`;
}

/**
 * Merges stored check-ins and urges into a single newest-first list.
 * Nothing is invented here: every entry comes from a stored row.
 */
export function buildRecentActivity(
  checkIns: readonly CheckIn[],
  urges: readonly UrgeEvent[],
  limit: number = RECENT_ACTIVITY_LIMIT,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    ...checkIns.map((checkIn) => ({
      id: checkIn.id,
      kind: 'check_in' as const,
      createdAt: checkIn.createdAt,
      title: 'Check-in',
      detail: describeCheckIn(checkIn),
    })),
    ...urges.map((urge) => ({
      id: urge.id,
      kind: 'urge' as const,
      createdAt: urge.createdAt,
      title: 'Urge',
      detail: describeUrge(urge),
    })),
  ];

  return entries
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}

/** One display-ready ML signal line for the Insights screen. */
export interface MlSignalViewEntry {
  label: TrainedTriggerLabel;
  occurrenceCount: number;
  /** Neutral count-based headline. Never causal. */
  headline: string;
  detail: string;
}

/**
 * Formats stored ML signal summaries for display. The wording is a plain count
 * ("This signal appeared in N recorded events."), never a causal or diagnostic
 * statement — the same honesty rule the Pattern Engine section follows.
 */
export function buildMlSignalSummaries(
  summaries: readonly MlSignalSummary[],
): MlSignalViewEntry[] {
  return summaries.map((summary) => ({
    label: summary.label,
    occurrenceCount: summary.occurrenceCount,
    headline: `This signal appeared in ${summary.occurrenceCount} recorded ${summary.occurrenceCount === 1 ? 'event' : 'events'}.`,
    detail: `Model-emitted signal from text you entered. Highest confidence: ${formatConfidence(summary.maxConfidence)}.`,
  }));
}
