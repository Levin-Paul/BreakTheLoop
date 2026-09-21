// Scores a check-in and derives a risk state, reasons, and recommended action.
import { getIntervention } from './interventionEngine';
import type { RecoveryInput, RecoveryResult, RiskState } from './types';

const MAX_SCORE = 10;
const MIN_SCORE = 0;

/** Maps a clamped score to its risk state. */
export function getRiskState(score: number): RiskState {
  if (score <= 2) return 'stable';
  if (score <= 4) return 'low_risk';
  if (score <= 7) return 'moderate_risk';
  return 'high_risk';
}

/** Computes risk score, state, reasons, and the recommended intervention. */
export function calculateRecoveryState(input: RecoveryInput): RecoveryResult {
  const reasons: string[] = [];
  let score = 0;

  const { urge, stress, mood, energy, recentUrgeCount, recentRelapse } = input;

  // Urge: >= 8 is +4, otherwise >= 6 is +2 (only one of the two applies).
  if (urge >= 8) {
    score += 4;
    reasons.push('Urge intensity is very high (8 or above).');
  } else if (urge >= 6) {
    score += 2;
    reasons.push('Urge intensity is elevated (6 or above).');
  }

  // Stress: >= 8 is +2, otherwise >= 6 is +1 (only one of the two applies).
  if (stress >= 8) {
    score += 2;
    reasons.push('Stress level is very high (8 or above).');
  } else if (stress >= 6) {
    score += 1;
    reasons.push('Stress level is elevated (6 or above).');
  }

  if (mood <= 3) {
    score += 2;
    reasons.push('Mood is low (3 or below).');
  }

  if (energy <= 3) {
    score += 1;
    reasons.push('Energy is low (3 or below).');
  }

  // Recent urges: 3 or more is +3, otherwise exactly 2 is +2.
  if (recentUrgeCount >= 3) {
    score += 3;
    reasons.push(`${recentUrgeCount} recent urges logged (3 or more).`);
  } else if (recentUrgeCount === 2) {
    score += 2;
    reasons.push('2 recent urges logged.');
  }

  if (recentRelapse) {
    score += 3;
    reasons.push('A recent relapse was logged.');
  }

  const clampedScore = Math.min(MAX_SCORE, Math.max(MIN_SCORE, score));
  const state = getRiskState(clampedScore);

  return {
    score: clampedScore,
    state,
    reasons,
    recommendedAction: getIntervention(state),
  };
}
