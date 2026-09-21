import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { saveCheckIn } from '../database/checkInRepository';
import type { PersistenceResult } from '../database/schema';
import { calculateRecoveryState } from '../engine/recoveryEngine';
import type { RecoveryInput, RecoveryResult } from '../engine/types';
import {
  MAX_SCALE,
  MIN_SCALE,
  RECENT_WINDOW_SIZE,
  RISK_STATE_LABELS,
  URGE_SIGNAL_THRESHOLD,
  createCheckIn,
  toRecoveryInput,
  type CheckIn as CheckInRecord,
  type CheckInDraft,
} from './checkInModel';

const DISCLAIMER =
  'This score is a transparent product heuristic, not a medical diagnosis or clinically validated assessment.';

interface CheckInScreenProps {
  /** Session-local check-ins, oldest first. Used for the recent signals. */
  history: readonly CheckInRecord[];
  /** Saves the check-in to session-local state. */
  onSubmit: (checkIn: CheckInRecord) => void;
  /** Returns to the Home screen. */
  onBack: () => void;
}

function ScaleInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const steps = Array.from({ length: MAX_SCALE - MIN_SCALE + 1 }, (_, i) => MIN_SCALE + i);
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
      <View style={styles.scaleRow}>
        {steps.map((step) => {
          const selected = step === value;
          return (
            <Pressable
              key={step}
              onPress={() => onChange(step)}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${step} of ${MAX_SCALE}`}
              accessibilityState={{ selected }}
              style={[styles.step, selected && styles.stepSelected]}>
              <Text style={[styles.stepText, selected && styles.stepTextSelected]}>{step}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function CheckInScreen({ history, onSubmit, onBack }: CheckInScreenProps) {
  const [mood, setMood] = useState(7);
  const [urge, setUrge] = useState(3);
  const [energy, setEnergy] = useState(6);
  const [stress, setStress] = useState(4);
  const [controlled, setControlled] = useState(true);

  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [signals, setSignals] = useState<RecoveryInput | null>(null);
  const [saveStatus, setSaveStatus] = useState<PersistenceResult | null>(null);

  function handleSubmit() {
    const draft: CheckInDraft = { mood, urge, energy, stress, controlled };
    const checkIn = createCheckIn(draft);

    // Recent signals are derived from the earlier check-ins only; this check-in
    // is scored directly by the engine's own rules.
    const input = toRecoveryInput(checkIn, history);

    setSignals(input);
    setResult(calculateRecoveryState(input));

    // Persist to SQLite first, then update session state. Every field the user
    // entered is written; a failure is reported below instead of hidden.
    setSaveStatus(saveCheckIn(checkIn));
    onSubmit(checkIn);
  }

  const saveMessage = saveStatus
    ? saveStatus.ok
      ? 'Check-in saved on this device.'
      : `Check-in not saved: ${saveStatus.error ?? 'SQLite is unavailable here'}.`
    : null;

  // How many earlier check-ins actually fall inside the recent window.
  const windowCount = Math.min(history.length, RECENT_WINDOW_SIZE);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to home">
          <Text style={styles.back}>‹ Home</Text>
        </Pressable>
        <Text style={styles.title}>Check-In</Text>
        <Text style={styles.subtitle}>
          Rate how you are right now. This updates your current recovery state.
        </Text>
      </View>

      <View style={styles.card}>
        <ScaleInput label="Mood" value={mood} onChange={setMood} />
        <ScaleInput label="Urge" value={urge} onChange={setUrge} />
        <ScaleInput label="Energy" value={energy} onChange={setEnergy} />
        <ScaleInput label="Stress" value={stress} onChange={setStress} />

        <View style={styles.field}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Stayed in control?</Text>
          </View>
          <View style={styles.segmentRow}>
            {[true, false].map((option) => {
              const selected = controlled === option;
              const label = option ? 'Yes' : 'No';
              return (
                <Pressable
                  key={label}
                  onPress={() => setControlled(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Controlled ${label}`}
                  accessibilityState={{ selected }}
                  style={[styles.segment, selected && styles.segmentSelected]}>
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={handleSubmit}
          accessibilityRole="button"
          accessibilityLabel="Submit check-in"
          style={styles.submit}>
          <Text style={styles.submitText}>Submit check-in</Text>
        </Pressable>
      </View>

      {result ? (
        <View style={styles.resultCard}>
          <Text style={styles.resultEyebrow}>Current state</Text>
          <Text style={styles.resultState}>{RISK_STATE_LABELS[result.state]}</Text>

          <Text style={styles.resultScore}>Score: {result.score} / 10</Text>

          <Text style={styles.resultHeading}>Reasons</Text>
          {result.reasons.length > 0 ? (
            result.reasons.map((reason) => (
              <Text key={reason} style={styles.reason}>
                {'\u2022'} {reason}
              </Text>
            ))
          ) : (
            <Text style={styles.reason}>{'\u2022'} No risk factors flagged.</Text>
          )}

          <Text style={styles.resultHeading}>Recommended action</Text>
          <Text style={styles.action}>{result.recommendedAction}</Text>

          <Text style={styles.signalsNote}>
            Recent signals used: {signals?.recentUrgeCount ?? 0} urge(s) at or above{' '}
            {URGE_SIGNAL_THRESHOLD}, relapse {signals?.recentRelapse ? 'flagged' : 'not flagged'} in
            the {windowCount} earlier check-in(s).
          </Text>

          {saveMessage ? (
            <Text
              style={[
                styles.persistenceNote,
                saveStatus?.ok ? styles.persistenceOk : styles.persistenceFail,
              ]}>
              {saveMessage}
            </Text>
          ) : null}

          <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f1720',
  },
  screenContent: {
    padding: 20,
    paddingTop: 64,
    paddingBottom: 48,
  },
  header: {
    marginBottom: 20,
  },
  back: {
    color: '#7dd3fc',
    fontSize: 15,
    marginBottom: 12,
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#1b2530',
    borderRadius: 16,
    padding: 16,
  },
  field: {
    marginBottom: 18,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fieldLabel: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  fieldValue: {
    color: '#7dd3fc',
    fontSize: 16,
    fontWeight: '700',
  },
  scaleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  step: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#243141',
  },
  stepSelected: {
    backgroundColor: '#38bdf8',
  },
  stepText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  stepTextSelected: {
    color: '#0f1720',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#243141',
  },
  segmentSelected: {
    backgroundColor: '#38bdf8',
  },
  segmentText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '600',
  },
  segmentTextSelected: {
    color: '#0f1720',
  },
  submit: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitText: {
    color: '#052e16',
    fontSize: 16,
    fontWeight: '700',
  },
  resultCard: {
    marginTop: 20,
    backgroundColor: '#1b2530',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#38bdf8',
  },
  resultEyebrow: {
    color: '#94a3b8',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  resultState: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '700',
    marginTop: 4,
  },
  resultScore: {
    color: '#7dd3fc',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 4,
  },
  resultHeading: {
    color: '#94a3b8',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },
  reason: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 21,
  },
  action: {
    color: '#f8fafc',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  signalsNote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
  },
  disclaimer: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    fontStyle: 'italic',
  },
  persistenceNote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
  },
  persistenceOk: {
    color: '#86efac',
  },
  persistenceFail: {
    color: '#fca5a5',
  },
});
