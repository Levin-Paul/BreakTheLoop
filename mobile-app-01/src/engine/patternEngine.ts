// Deterministic behavioral pattern engine.
//
// Its job is narrow and honest: take events the app already stored on this
// device and count *repeated sequences* in them. It is not a predictor and it
// does not claim that one event caused another.
//
// Deliberately NOT here:
//   - invented history (every occurrence comes from a real stored row),
//   - causal language. Output says "this sequence appeared before 6 recorded
//     episodes", never "stress caused your relapse".
//
// A pattern is only *promoted* (emerging/recurring) when the same sequence was
// seen more than once. A single sighting stays "possible".
//
// ML signals (see ml/triggerClassifier.ts) enter here ONLY as stored
// observations of what the local model emitted for the user's own text. They are
// counted with the same honesty rules as everything else: occurrence counts and
// neutral wording, never predictions about the user and never causal claims.
import type { CheckIn } from '../screens/checkInModel';
import type { UrgeEvent } from '../screens/urgeModel';
import type { TrainedTriggerLabel } from '../ml/triggerClassifier';

/** One stored observation of an ML signal, as produced by the classifier. */
export interface MlSignalObservation {
  id: string;
  /** ISO timestamp of when the model produced the signal. */
  at: string;
  /** One of the TRAINED labels only; anything else is rejected upstream. */
  label: TrainedTriggerLabel;
  /** Model probability for this label, in [0, 1]. */
  confidence: number;
  /** Always "ml" for observations coming from the classifier. */
  source: 'ml';
  /** The pipeline source of the text that produced the signal (e.g. urge_flow). */
  originSource: string;
  /** Model identity recorded with every observation. */
  modelId: string;
  modelVersion: string;
}

/** Neutral per-label summary of stored ML signal observations. */
export interface MlSignalSummary {
  label: TrainedTriggerLabel;
  /** How many stored events carry this signal. */
  occurrenceCount: number;
  /** Deliberately count-based wording; contains no causal claim. */
  description: string;
  /** Highest model probability seen for this label, in [0, 1]. */
  maxConfidence: number;
  /** ISO timestamp of the most recent event, when any exist. */
  lastSeenAt: string | null;
}

/** How far back a preceding signal may sit to count as part of a sequence. */
export const SEQUENCE_WINDOW_HOURS = 12;
const SEQUENCE_WINDOW_MS = SEQUENCE_WINDOW_HOURS * 60 * 60 * 1000;

/** A check-in counts as "distress" at or above this stress level. */
export const DISTRESS_STRESS_THRESHOLD = 6;
/** A check-in counts as "distress" at or below this mood level. */
export const DISTRESS_MOOD_THRESHOLD = 3;
/** An urge counts as "high" at or above this intensity. */
export const HIGH_URGE_THRESHOLD = 6;
/** How many high urges must precede a lapse to count as a recurrence. */
export const LAPSE_CLUSTER_MIN_URGES = 2;

/** How often a sequence has been seen, mapped to a promotion state. */
export type PatternStatus = 'possible' | 'emerging' | 'recurring';

/** One concrete sighting of a sequence, built from stored timestamps only. */
export interface PatternEvidence {
  /** Neutral one-line summary, e.g. "stress 8 -> urge 7". */
  summary: string;
  /** ISO timestamp of the later event in the sequence. */
  at: string;
}

/** A repeated sequence found in stored events. */
export interface DetectedPattern {
  id: string;
  patternType: 'sequence' | 'recurrence';
  /** Neutral description; contains no causal claim. */
  description: string;
  occurrenceCount: number;
  /**
   * Transparent 0-1 score with diminishing returns, derived from the occurrence
   * count. It is NOT a calibrated probability and must not be shown as one.
   */
  confidence: number;
  status: PatternStatus;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  evidence: PatternEvidence[];
}

/** Internal one-row timeline used by the detectors. */
interface TimelineEvent {
  at: number;
  iso: string;
  kind: 'check_in' | 'urge';
  distress: boolean;
  highUrge: boolean;
  lapse: boolean;
  label: string;
}

function toMillis(iso: string): number | null {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/** Builds the chronological timeline from stored check-ins and urges. */
export function buildTimeline(
  checkIns: readonly CheckIn[],
  urges: readonly UrgeEvent[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const checkIn of checkIns) {
    const at = toMillis(checkIn.createdAt);
    if (at === null) continue;
    const distress =
      checkIn.stress >= DISTRESS_STRESS_THRESHOLD || checkIn.mood <= DISTRESS_MOOD_THRESHOLD;
    events.push({
      at,
      iso: checkIn.createdAt,
      kind: 'check_in',
      distress,
      highUrge: checkIn.urge >= HIGH_URGE_THRESHOLD,
      lapse: !checkIn.controlled,
      label: distress ? `stress ${checkIn.stress}` : `check-in urge ${checkIn.urge}`,
    });
  }

  for (const urge of urges) {
    const at = toMillis(urge.createdAt);
    if (at === null) continue;
    events.push({
      at,
      iso: urge.createdAt,
      kind: 'urge',
      distress: false,
      highUrge: urge.intensity >= HIGH_URGE_THRESHOLD,
      lapse: false,
      label: `urge ${urge.intensity}`,
    });
  }

  return events.sort((a, b) => a.at - b.at);
}

/**
 * Maps an occurrence count to its promotion state. Repeated evidence is
 * required before a pattern is called emerging or recurring.
 */
export function statusForCount(count: number): PatternStatus {
  if (count >= 4) return 'recurring';
  if (count >= 2) return 'emerging';
  return 'possible';
}

/**
 * Transparent confidence with diminishing returns: more occurrences raise it,
 * but it never reaches 1. Documented here so the number is auditable.
 */
export function confidenceForCount(count: number): number {
  const raw = count / (count + 2);
  return Math.round(Math.min(0.9, raw) * 100) / 100;
}

/** True when a pattern rests on more than a single sighting. */
export function isRepeated(pattern: DetectedPattern): boolean {
  return pattern.occurrenceCount >= 2;
}

/** Detector: a distress check-in appears shortly before a high urge. */
function detectDistressBeforeHighUrge(timeline: readonly TimelineEvent[]): DetectedPattern | null {
  const evidence: PatternEvidence[] = [];
  let firstSeenAt: string | null = null;

  for (const event of timeline) {
    if (!event.highUrge) continue;
    const windowStart = event.at - SEQUENCE_WINDOW_MS;
    const preceding = timeline.find(
      (candidate) => candidate.distress && candidate.at >= windowStart && candidate.at <= event.at,
    );
    if (!preceding) continue;
    if (firstSeenAt === null) firstSeenAt = event.iso;
    evidence.push({ summary: `${preceding.label} -> ${event.label}`, at: event.iso });
  }

  if (evidence.length === 0) return null;

  const count = evidence.length;
  return {
    id: 'distress-before-high-urge',
    patternType: 'sequence',
    description: `Distress (stress ${DISTRESS_STRESS_THRESHOLD}+ or mood ${DISTRESS_MOOD_THRESHOLD} or below) appeared within ${SEQUENCE_WINDOW_HOURS} hours before high-urge episodes.`,
    occurrenceCount: count,
    confidence: confidenceForCount(count),
    status: statusForCount(count),
    firstSeenAt,
    lastSeenAt: evidence[evidence.length - 1]?.at ?? null,
    evidence,
  };
}

/** Detector: several high urges appear shortly before a reported lapse. */
function detectUrgeClusterBeforeLapse(timeline: readonly TimelineEvent[]): DetectedPattern | null {
  const evidence: PatternEvidence[] = [];
  let firstSeenAt: string | null = null;

  for (const event of timeline) {
    if (!event.lapse) continue;
    const windowStart = event.at - SEQUENCE_WINDOW_MS;
    const urgesBefore = timeline.filter(
      (candidate) => candidate.highUrge && candidate.at >= windowStart && candidate.at <= event.at,
    );
    if (urgesBefore.length < LAPSE_CLUSTER_MIN_URGES) continue;
    if (firstSeenAt === null) firstSeenAt = event.iso;
    evidence.push({
      summary: `${urgesBefore.length} high urges -> not in control`,
      at: event.iso,
    });
  }

  if (evidence.length === 0) return null;

  const count = evidence.length;
  return {
    id: 'urge-cluster-before-lapse',
    patternType: 'recurrence',
    description: `${LAPSE_CLUSTER_MIN_URGES} or more high urges appeared within ${SEQUENCE_WINDOW_HOURS} hours before a reported lapse.`,
    occurrenceCount: count,
    confidence: confidenceForCount(count),
    status: statusForCount(count),
    firstSeenAt,
    lastSeenAt: evidence[evidence.length - 1]?.at ?? null,
    evidence,
  };
}

/**
 * Counts stored ML signal observations per label and returns the labels that
 * have at least one recorded event, most frequent first.
 *
 * Wording contract: callers present these as "this signal appeared in N
 * recorded events". It is a COUNT of what the model emitted, not a prediction
 * about the user and not a causal claim. Labels the model was never trained on
 * cannot appear here by construction (they are rejected upstream).
 */
export function summarizeMlSignals(
  observations: readonly MlSignalObservation[],
): MlSignalSummary[] {
  const counts = new Map<TrainedTriggerLabel, { count: number; lastAt: string | null; maxConfidence: number }>();

  for (const observation of observations) {
    const entry = counts.get(observation.label) ?? {
      count: 0,
      lastAt: null,
      maxConfidence: 0,
    };
    entry.count += 1;
    entry.maxConfidence = Math.max(entry.maxConfidence, observation.confidence);
    if (entry.lastAt === null || observation.at > entry.lastAt) {
      entry.lastAt = observation.at;
    }
    counts.set(observation.label, entry);
  }

  return [...counts.entries()]
    .map(([label, entry]) => ({
      label,
      occurrenceCount: entry.count,
      description: `The local model emitted the "${label}" signal for ${entry.count} recorded ${entry.count === 1 ? 'event' : 'events'}.`,
      maxConfidence: entry.maxConfidence,
      lastSeenAt: entry.lastAt,
    }))
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.label.localeCompare(b.label));
}

/**
 * Runs every detector over the stored events and returns the patterns that
 * actually have evidence. Strongest (most occurrences) first. Returns an empty
 * array when there is nothing repeated to report — callers must NOT fill that
 * gap with fabricated patterns.
 */
export function detectPatterns(
  checkIns: readonly CheckIn[],
  urges: readonly UrgeEvent[],
): DetectedPattern[] {
  const timeline = buildTimeline(checkIns, urges);
  return [detectDistressBeforeHighUrge(timeline), detectUrgeClusterBeforeLapse(timeline)]
    .filter((pattern): pattern is DetectedPattern => pattern !== null)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

/** Whether the data is rich enough to say anything at all. */
export function hasEnoughEvidence(patterns: readonly DetectedPattern[]): boolean {
  return patterns.some(isRepeated);
}
