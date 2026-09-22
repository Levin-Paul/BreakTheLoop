// Local signal pipeline.
//
//     Raw permitted local signal
//             -> Privacy Filter
//             -> Minimal Signal
//             -> Local ML (representation layer)
//
// This module defines the *interface* and the filter step. It does NOT collect
// anything from the device: no collector is wired up here, and nothing is
// stored or uploaded. Callers supply a `RawSignal` that they already have a
// legitimate, user-visible reason to process.
//
// Monitoring is opt-in. When `enabled` is false the pipeline rejects every
// signal, which is the in-code kill switch.
import {
  screenText,
  screenVisual,
  type SensitiveKind,
  type VisualLabel,
} from './privacyFilter';

/** Where a raw signal came from. */
export type SignalSource =
  | 'self_report' // the user typed it on Check-In / Urge
  | 'urge_flow'
  | 'usage_stats' // coarse app-usage metadata, not content
  | 'accessibility' // user-enabled accessibility events, filtered locally
  | 'manual';

/** A raw signal as a collector would hand it to the pipeline. */
export interface RawSignal {
  /** Epoch milliseconds. */
  timestamp: number;
  source: SignalSource;
  /** Coarse app category (e.g. "social", "video"), never an app's content. */
  appCategory?: string;
  /** Coarse activity type (e.g. "scroll", "open", "idle"). */
  activityType?: string;
  /** Free text the user explicitly provided. Never scraped content. */
  textSignal?: string;
  /** A coarse visual label, never raw pixels. */
  visualSignal?: string;
}

/**
 * What the pipeline emits after filtering: the same shape, but with sensitive
 * fields removed and free text guaranteed to have passed the privacy filter.
 */
export interface MinimalSignal {
  timestamp: number;
  source: SignalSource;
  appCategory?: string;
  activityType?: string;
  textSignal?: string;
  visualSignal?: VisualLabel;
}

/** Configuration for a pipeline run. */
export interface SignalPipelineOptions {
  /**
   * Whether the user has monitoring switched on. `false` is a hard kill switch:
   * every signal is rejected before the filter even runs.
   */
  enabled: boolean;
}

/** Result of running one raw signal through the pipeline. */
export type PipelineResult =
  | { accepted: true; signal: MinimalSignal; redactions: SensitiveKind[] }
  | { accepted: false; reason: string; redactions: SensitiveKind[] };

/** The ordered stages, exposed for honest UI copy and docs. */
export const PIPELINE_STAGES = [
  'raw permitted local signal',
  'privacy filter',
  'minimal signal',
  'local ML representation',
] as const;

function isFiniteTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Runs a single raw signal through the privacy filter.
 *
 * Rejection rules, in order:
 *   1. monitoring is disabled (kill switch),
 *   2. the timestamp is missing/invalid,
 *   3. the signal carries no usable content at all,
 *   4. free text contains sensitive content,
 *   5. the visual field is anything other than a coarse label.
 */
export function processSignal(
  raw: RawSignal,
  options: SignalPipelineOptions = { enabled: true },
): PipelineResult {
  if (!options.enabled) {
    return { accepted: false, reason: 'Monitoring is disabled.', redactions: [] };
  }
  if (!isFiniteTimestamp(raw.timestamp)) {
    return { accepted: false, reason: 'Invalid timestamp.', redactions: [] };
  }

  const hasText = typeof raw.textSignal === 'string' && raw.textSignal.trim().length > 0;
  const hasVisual = typeof raw.visualSignal === 'string' && raw.visualSignal.trim().length > 0;
  const hasReadOnlyMetadata =
    (typeof raw.appCategory === 'string' && raw.appCategory.trim().length > 0) ||
    (typeof raw.activityType === 'string' && raw.activityType.trim().length > 0);

  if (!hasText && !hasVisual && !hasReadOnlyMetadata) {
    return { accepted: false, reason: 'Signal carries no usable content.', redactions: [] };
  }

  const redactions = new Set<SensitiveKind>();

  let textSignal: string | undefined;
  if (hasText) {
    const filtered = screenText(raw.textSignal as string);
    if (!filtered.allowed) {
      return { accepted: false, reason: filtered.reason ?? 'Text signal rejected.', redactions: filtered.redactions };
    }
    textSignal = filtered.text;
    filtered.redactions.forEach((kind) => redactions.add(kind));
  }

  let visualSignal: VisualLabel | undefined;
  if (hasVisual) {
    const visual = screenVisual(raw.visualSignal as string);
    if (!visual.allowed) {
      return { accepted: false, reason: visual.reason ?? 'Visual signal rejected.', redactions: [...redactions] };
    }
    visualSignal = visual.label;
  }

  const signal: MinimalSignal = {
    timestamp: raw.timestamp,
    source: raw.source,
    ...(raw.appCategory?.trim() ? { appCategory: raw.appCategory.trim() } : {}),
    ...(raw.activityType?.trim() ? { activityType: raw.activityType.trim() } : {}),
    ...(textSignal ? { textSignal } : {}),
    ...(visualSignal ? { visualSignal } : {}),
  };

  return { accepted: true, signal, redactions: [...redactions] };
}

/** Convenience: run a batch, dropping rejected signals and keeping their reasons. */
export interface BatchResult {
  accepted: MinimalSignal[];
  rejected: { raw: RawSignal; reason: string }[];
}

export function processSignals(
  raws: readonly RawSignal[],
  options: SignalPipelineOptions = { enabled: true },
): BatchResult {
  const accepted: MinimalSignal[] = [];
  const rejected: { raw: RawSignal; reason: string }[] = [];
  for (const raw of raws) {
    const result = processSignal(raw, options);
    if (result.accepted) {
      accepted.push(result.signal);
    } else {
      rejected.push({ raw, reason: result.reason });
    }
  }
  return { accepted, rejected };
}
