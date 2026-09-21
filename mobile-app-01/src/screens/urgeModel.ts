// Pure, framework-free domain model for the Urge -> Intervention -> Recheck flow.
//
// Like `checkInModel.ts`, nothing here imports React or React Native, so the
// mapping onto `RecoveryInput` and the outcome classification can be exercised
// directly in Node.
import type { RecoveryInput, RiskState } from '../engine/types';
import {
  RECENT_WINDOW_SIZE,
  URGE_SIGNAL_THRESHOLD,
  clampScale,
  type CheckIn,
} from './checkInModel';

/** Scale bounds for the "how strong is the urge" questions. */
export const URGE_MIN = 1;
export const URGE_MAX = 10;

/**
 * Neutral mid-scale value used for the background fields (mood/energy/stress)
 * when no check-in exists yet. A neutral value contributes 0 points, so an urge
 * is never scored as risky purely because background data is missing.
 */
export const NEUTRAL_BACKGROUND = 5;

/** Longest free-text the user can store for context/feeling. */
export const MAX_FREE_TEXT_LENGTH = 280;

/** How an urge changed between the capture and the recheck. */
export type UrgeEffectiveness = 'improved' | 'no_change' | 'increased';

export const EFFECTIVENESS_LABELS: Record<UrgeEffectiveness, string> = {
  improved: 'Improved',
  no_change: 'No change',
  increased: 'Increased',
};

/** What the user enters when the urge happens. */
export interface UrgeCapture {
  /** Urge strength before the intervention, 1-10. */
  intensity: number;
  /** "What was happening?" — free text, exactly as entered. */
  context: string;
  /** "What are you feeling?" — free text, exactly as entered. */
  feeling: string;
}

/** The engine assessment captured at the moment the urge was recorded. */
export interface UrgeAssessment {
  state: RiskState;
  score: number;
  /** Intervention text produced by `interventionEngine.getIntervention()`. */
  intervention: string;
}

/** A single urge episode: capture -> intervention -> recheck outcome. */
export interface UrgeEvent {
  id: string;
  createdAt: string;
  intensity: number;
  context: string;
  feeling: string;
  state: RiskState;
  score: number;
  intervention: string;
  /** Urge strength after the intervention; `null` until the recheck. */
  afterIntensity: number | null;
  effectiveness: UrgeEffectiveness | null;
  outcomeAt: string | null;
}

/** Result of mapping the urge plus recent signals onto `RecoveryInput`. */
export interface UrgeInputResult {
  input: RecoveryInput;
  /** How many earlier urges fed `recentUrgeCount`. */
  recentUrgeCount: number;
  /** True when background state came from a check-in rather than the neutral default. */
  usedCheckIn: boolean;
}

function truncate(value: string): string {
  return value.trim().slice(0, MAX_FREE_TEXT_LENGTH);
}

/**
 * Builds the engine input for an urge.
 *
 * - `urge` is the acute intensity the user just reported.
 * - `mood`/`energy`/`stress` come from the most recent check-in, because the
 *   urge flow does not re-ask those questions. Without a check-in they fall back
 *   to `NEUTRAL_BACKGROUND`, which scores 0 and so cannot inflate risk.
 * - `recentUrgeCount` counts *earlier* urge episodes at or above
 *   `URGE_SIGNAL_THRESHOLD`. The urge being scored is excluded so its intensity
 *   is not counted twice (the engine's own urge rule already scores it).
 * - `recentRelapse` comes from the most recent check-in's "stayed in control"
 *   answer; the urge flow itself captures no relapse information.
 */
export function buildUrgeInput(args: {
  intensity: number;
  earlierEvents: readonly UrgeEvent[];
  latestCheckIn: CheckIn | null;
}): UrgeInputResult {
  const { intensity, earlierEvents, latestCheckIn } = args;
  const earlier = earlierEvents.slice(-RECENT_WINDOW_SIZE);
  const recentUrgeCount = earlier.filter(
    (event) => event.intensity >= URGE_SIGNAL_THRESHOLD,
  ).length;

  return {
    recentUrgeCount,
    usedCheckIn: latestCheckIn !== null,
    input: {
      urge: intensity,
      stress: latestCheckIn ? latestCheckIn.stress : NEUTRAL_BACKGROUND,
      mood: latestCheckIn ? latestCheckIn.mood : NEUTRAL_BACKGROUND,
      energy: latestCheckIn ? latestCheckIn.energy : NEUTRAL_BACKGROUND,
      recentUrgeCount,
      recentRelapse: latestCheckIn ? !latestCheckIn.controlled : false,
    },
  };
}

/** Creates the urge episode record straight after capture. */
export function createUrgeEvent(
  capture: UrgeCapture,
  assessment: UrgeAssessment,
  now: Date = new Date(),
): UrgeEvent {
  return {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    intensity: clampScale(capture.intensity),
    context: truncate(capture.context),
    feeling: truncate(capture.feeling),
    state: assessment.state,
    score: assessment.score,
    intervention: assessment.intervention,
    afterIntensity: null,
    effectiveness: null,
    outcomeAt: null,
  };
}

/**
 * Classifies the change between the two self-reported values.
 * This is a plain comparison of what the user entered — it is not evidence that
 * the intervention caused the change, and callers must not present it as such.
 */
export function classifyOutcome(before: number, after: number): UrgeEffectiveness {
  if (after < before) return 'improved';
  if (after > before) return 'increased';
  return 'no_change';
}

/** Returns a copy of the episode with the after-intervention values filled in. */
export function withOutcome(
  event: UrgeEvent,
  afterIntensity: number,
  now: Date = new Date(),
): UrgeEvent {
  const before = clampScale(event.intensity);
  const after = clampScale(afterIntensity);
  return {
    ...event,
    afterIntensity: after,
    effectiveness: classifyOutcome(before, after),
    outcomeAt: now.toISOString(),
  };
}

/** Neutral wording for the result screen. Deliberately avoids causal claims. */
export function describeChange(before: number, after: number): string {
  return `Urge changed from ${clampScale(before)} \u2192 ${clampScale(after)}`;
}
