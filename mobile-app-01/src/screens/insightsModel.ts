// Pure, framework-free helpers for the Insights screen.
//
// Kept free of React and of any database import so the merging and formatting can
// be exercised directly in Node.
import type { CheckIn } from './checkInModel';
import { EFFECTIVENESS_LABELS, type UrgeEvent } from './urgeModel';

/** How many stored events the "Recent activity" section shows. */
export const RECENT_ACTIVITY_LIMIT = 5;

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
