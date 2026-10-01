// Pure, framework-free helpers for the Insights screen.
//
// Kept free of React and of any database import so the merging and formatting can
// be exercised directly in Node.
import type { CheckIn } from './checkInModel';
import type { RelapseEnvironment, RelapseRecord, RelapseWindowSummary } from './relapseModel';
import { RELAPSE_ENVIRONMENT_LABELS, summarizeRelapseWindow } from './relapseModel';
import { EFFECTIVENESS_LABELS, type UrgeEvent } from './urgeModel';
import type {
  MlSignalSummary,
  PatternStatus,
} from '../engine/patternEngine';
import type { ModelRuntimeStatus } from '../ml/modelStatus';
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

export type ActivityKind = 'check_in' | 'urge' | 'relapse';

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

/** Describes a stored relapse from its own structured values. */
export function describeRelapse(relapse: RelapseRecord): string {
  const environment =
    RELAPSE_ENVIRONMENT_LABELS[relapse.environment as RelapseEnvironment] ?? 'Unknown place';
  const trigger = relapse.triggerNoticed ? 'Trigger noticed' : 'No trigger noticed';
  const checkIn = relapse.checkInAt !== null ? 'check-in done' : 'check-in not done';
  return `${environment} \u00b7 ${trigger} \u00b7 ${checkIn}`;
}

/**
 * Merges stored check-ins, urges, and relapses into a single newest-first
 * list. Nothing is invented here: every entry comes from a stored row.
 */
export function buildRecentActivity(
  checkIns: readonly CheckIn[],
  urges: readonly UrgeEvent[],
  relapses: readonly RelapseRecord[] = [],
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
    ...relapses.map((relapse) => ({
      id: relapse.id,
      kind: 'relapse' as const,
      createdAt: relapse.createdAt,
      title: 'Relapse',
      detail: describeRelapse(relapse),
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

/** One label/value row of the Insights "Local AI" model status card. */
export interface ModelStatusLine {
  label: string;
  value: string;
}

/**
 * Builds the compact rows of the "Local AI" status card from the runtime
 * status. Labels are capitalized for display only; the underlying values come
 * verbatim from ModelRuntimeStatus (no user data, no invented fields). The
 * trained-labels row lists the exact trained labels in lowercase, matching the
 * adapter's source of truth.
 */
export function buildModelStatusLines(status: ModelRuntimeStatus): ModelStatusLine[] {
  const lines: ModelStatusLine[] = [
    { label: 'Model', value: 'Trigger Classifier' },
    { label: 'Runtime', value: status.runtime },
    {
      label: 'Labels',
      value: `${status.trainedLabels.length} trained signals (${status.trainedLabels.join(', ')})`,
    },
    { label: 'Inference', value: 'On-device / Offline' },
  ];
  if (!status.available && status.error) {
    lines.push({ label: 'Reason', value: status.error });
  }
  return lines;
}

export type { RelapseWindowSummary };

/**
 * Relapse section for Insights: cautious, count-based lines over the stored
 * rows inside the recent window. Delegates to the pure relapse model's
 * summarizer so the wording contract lives in exactly one place. No causal
 * claims, no raw note text, no shaming.
 */
export function buildRelapseInsights(
  relapses: readonly RelapseRecord[],
  nowMs: number,
): RelapseWindowSummary {
  return summarizeRelapseWindow(relapses, nowMs);
}
