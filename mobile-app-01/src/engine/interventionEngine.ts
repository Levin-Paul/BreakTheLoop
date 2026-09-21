// Maps a risk state to the intervention message shown to the user.
import type { RiskState } from './types';

const INTERVENTIONS: Record<RiskState, string> = {
  stable: 'No intervention needed. Continue normally.',
  low_risk: 'Take a short break and check in with yourself.',
  moderate_risk: 'Step away from the current environment for 10 minutes.',
  high_risk:
    'Leave the current environment, put the phone away, and move to a shared or public space for 10 minutes.',
};

/** Returns the intervention text for the given risk state. */
export function getIntervention(state: RiskState): string {
  return INTERVENTIONS[state];
}
