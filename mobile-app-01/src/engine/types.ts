// Core types for the Recovery Engine.

/**
 * Risk classification produced by the Recovery Engine.
 * Ordered from least to most concerning.
 */
export type RiskState = 'stable' | 'low_risk' | 'moderate_risk' | 'high_risk';

/**
 * Everything the Recovery Engine needs to score a check-in.
 * All self-reported numeric values are on a 0-10 scale,
 * except `mood` and `energy` which are on a 1-10 scale.
 */
export interface RecoveryInput {
  /** Current urge intensity, 0-10 (higher is stronger). */
  urge: number;
  /** Current stress level, 0-10 (higher is more stressed). */
  stress: number;
  /** Current mood, 1-10 (lower is worse). */
  mood: number;
  /** Current energy, 1-10 (lower is worse). */
  energy: number;
  /** Number of urges logged in the recent window. */
  recentUrgeCount: number;
  /** Whether a relapse was logged in the recent window. */
  recentRelapse: boolean;
}

/** Outcome of scoring a check-in. */
export interface RecoveryResult {
  /** Total risk score, clamped to 0-10. */
  score: number;
  /** Risk state derived from `score`. */
  state: RiskState;
  /** Human-readable reasons, one per scoring rule that actually triggered. */
  reasons: string[];
  /** Recommended next action for `state`. */
  recommendedAction: string;
}
