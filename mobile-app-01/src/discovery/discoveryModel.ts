// Pure, framework-free model for Discovery Mode.
//
// Everything here derives from values the caller loaded from the existing
// database (counts, patterns). Nothing is invented: no fake counts, no fake
// patterns, no countdown, no arbitrary observation-period length.
//
// Wording contract: cautious, non-causal, non-shaming ("has been observed",
// "a pattern is emerging"), never "this causes your urges".

/** How many promoted (emerging or stronger) patterns to surface at once. */
export const DISCOVERY_BANNER_LIMIT = 1;

/**
 * The current stage of Discovery Mode, derived from real data volume. There is
 * deliberately no fixed day count: the stage follows the evidence.
 */
export type DiscoveryStage = 'no_data' | 'gathering' | 'patterns_forming';

/** What Discovery Mode shows in its status section. */
export interface DiscoveryModeStatus {
  enabled: boolean;
  stage: DiscoveryStage;
  /** One calm sentence describing the stage. Never a deterministic claim. */
  headline: string;
  checkIns: number;
  urges: number;
  /** Patterns that actually crossed the repeated-evidence threshold. */
  promotedPatterns: number;
}

/** A promoted pattern rendered as one in-app insight banner. */
export interface PatternInsightBanner {
  /** Stable id of the underlying pattern (dedup key for rendering). */
  id: string;
  title: 'Pattern noticed';
  /** Neutral description of what has been observed, from stored evidence only. */
  body: string;
  /** Cautious invitation to look closer. Never certainty. */
  callToAction: string;
}

/**
 * True when a pattern crossed the engine's meaningful threshold. Reuses the
 * engine's own promotion rules via the pattern's `status` and repetition —
 * no second engine, no invented threshold.
 */
export function isPromotedPattern(pattern: {
  readonly status: 'possible' | 'emerging' | 'recurring';
  readonly occurrenceCount: number;
}): boolean {
  return pattern.occurrenceCount >= 2 && pattern.status !== 'possible';
}

/**
 * Derives the Discovery Mode status from real stored values.
 *
 * Stage rules (no invented day counts):
 *   - no_data:      no check-ins and no urges recorded yet,
 *   - gathering:    some data exists but no pattern has been promoted,
 *   - patterns_forming: at least one promoted pattern exists.
 */
export function deriveDiscoveryStatus(
  enabled: boolean,
  checkIns: number,
  urges: number,
  promotedPatterns: number,
): DiscoveryModeStatus {
  const stage: DiscoveryStage =
    promotedPatterns > 0 ? 'patterns_forming' : checkIns + urges > 0 ? 'gathering' : 'no_data';

  const headline =
    !enabled
      ? 'Discovery Mode is off.'
      : stage === 'no_data'
        ? 'Not enough data yet. Keep checking in normally.'
        : stage === 'gathering'
          ? 'Learning your patterns — we\u2019re looking for patterns around urges, emotions, situations and timing.'
          : 'Your patterns are becoming clearer.';

  return { enabled, stage, headline, checkIns, urges, promotedPatterns };
}

/**
 * Builds the in-app insight banner for promoted patterns.
 *
 * Only promoted patterns produce a banner; the strongest first; at most
 * `DISCOVERY_BANNER_LIMIT` so the app never spams. Wording is neutral and
 * derived from the pattern's own evidence count — never causal, never
 * deterministic.
 */
export function buildPatternInsightBanners(
  patterns: readonly {
    readonly id: string;
    readonly description: string;
    readonly occurrenceCount: number;
    readonly status: 'possible' | 'emerging' | 'recurring';
  }[],
): PatternInsightBanner[] {
  return patterns
    .filter(isPromotedPattern)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, DISCOVERY_BANNER_LIMIT)
    .map((pattern) => ({
      id: pattern.id,
      title: 'Pattern noticed',
      body: `${pattern.description} It has appeared repeatedly in your recent check-ins and urges (${pattern.occurrenceCount} times).`,
      callToAction: 'Want to explore what was happening before the urge? Find it in Insights.',
    }));
}
