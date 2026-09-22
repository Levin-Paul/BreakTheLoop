import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { loadRecentUrgeEvents, saveUrgeEvent, saveUrgeOutcome } from '../database/urgeRepository';
import type { PersistenceResult } from '../database/urgeRepository';
import { saveMlSignalObservation } from '../database/signalRepository';
import { ingestUserText } from '../ml/signalIngestion';
import { getIntervention } from '../engine/interventionEngine';
import { calculateRecoveryState } from '../engine/recoveryEngine';
import type { RecoveryResult } from '../engine/types';
import { RECENT_WINDOW_SIZE, RISK_STATE_LABELS, type CheckIn } from './checkInModel';
import {
  EFFECTIVENESS_LABELS,
  MAX_FREE_TEXT_LENGTH,
  URGE_MAX,
  URGE_MIN,
  buildUrgeInput,
  createUrgeEvent,
  describeChange,
  withOutcome,
  type UrgeEvent,
  type UrgeInputResult,
} from './urgeModel';

// The intervention copy itself is never written here — it always comes from
// interventionEngine.getIntervention(), so the wording lives in one place.
const NEUTRAL_RESULT_NOTE =
  'This records what you reported before and after. It does not show that the intervention caused the change.';
const PRIVACY_NOTE =
  'Only what you enter here is stored, on this device. Nothing is captured from your screen, your other apps, or the device itself.';

interface UrgeScreenProps {
  /** Latest check-in, used for background mood/energy/stress signals. */
  latestCheckIn: CheckIn | null;
  /** Returns to the Home screen. */
  onBack: () => void;
}

// Mirrors the ScaleInput in CheckIn.tsx. Kept local so the already-verified
// Check-In screen is untouched; worth extracting once a third screen needs it.
function ScaleInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const steps = Array.from({ length: URGE_MAX - URGE_MIN + 1 }, (_, i) => URGE_MIN + i);
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
              accessibilityLabel={`${label} ${step} of ${URGE_MAX}`}
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

function PersistenceNote({ result, what }: { result: PersistenceResult | null; what: string }) {
  if (!result) return null;
  return (
    <Text style={[styles.persistenceNote, result.ok ? styles.persistenceOk : styles.persistenceFail]}>
      {result.ok
        ? `${what} saved on this device.`
        : `${what} not saved: ${result.error ?? 'SQLite is unavailable here'}.`}
    </Text>
  );
}

type Stage = 'capture' | 'intervention' | 'recheck' | 'result';

export default function UrgeScreen({ latestCheckIn, onBack }: UrgeScreenProps) {
  const [stage, setStage] = useState<Stage>('capture');

  const [intensity, setIntensity] = useState(5);
  const [context, setContext] = useState('');
  const [feeling, setFeeling] = useState('');
  const [afterIntensity, setAfterIntensity] = useState(3);

  const [event, setEvent] = useState<UrgeEvent | null>(null);
  const [finished, setFinished] = useState<UrgeEvent | null>(null);
  const [assessment, setAssessment] = useState<RecoveryResult | null>(null);
  const [signals, setSignals] = useState<UrgeInputResult | null>(null);

  const [earlierEvents, setEarlierEvents] = useState<UrgeEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<PersistenceResult | null>(null);
  const [outcomeSaveStatus, setOutcomeSaveStatus] = useState<PersistenceResult | null>(null);
  // One-line honest status for what the local ML pass did with this capture's
  // text. Null until the first capture; never blocks the flow itself.
  const [mlNote, setMlNote] = useState<string | null>(null);

  // Load earlier episodes once, so past urges count toward the recent signals.
  // Newly captured ones are appended below, so nothing is counted twice.
  useEffect(() => {
    const loaded = loadRecentUrgeEvents(10);
    if (loaded.ok) {
      setEarlierEvents([...loaded.events].reverse());
    } else {
      setHistoryError(loaded.error ?? 'unknown error');
    }
  }, []);

  function handleCapture() {
    const derived = buildUrgeInput({ intensity, earlierEvents, latestCheckIn });
    const result = calculateRecoveryState(derived.input);
    const intervention = getIntervention(result.state);
    const created = createUrgeEvent(
      { intensity, context, feeling },
      { state: result.state, score: result.score, intervention },
    );

    setSignals(derived);
    setAssessment(result);
    setEvent(created);
    setEarlierEvents((previous) => [...previous, created]);
    setSaveStatus(saveUrgeEvent(created));
    setStage('intervention');

    // Fire-and-forget local ML pass on the text the user just typed. It never
    // blocks or alters the intervention flow; failures become a one-line note.
    const mlText = [context, feeling].filter((part) => part.trim().length > 0).join(' ');
    if (mlText.length > 0) {
      void ingestUserText({
        text: mlText,
        originSource: 'urge_flow',
        timestamp: Date.now(),
        store: saveMlSignalObservation,
      })
        .then((ingest) => {
          if (!ingest.accepted) {
            setMlNote(`ML signal not recorded: ${ingest.reason ?? 'rejected by the privacy filter'}.`);
          } else if (!ingest.classified) {
            setMlNote(`ML signal not recorded: ${ingest.reason ?? 'local model unavailable'}.`);
          } else if (ingest.signals.length === 0) {
            setMlNote('Local model ran; no signal reached its threshold, so nothing was recorded.');
          } else {
            setMlNote(
              `Local model recorded ${ingest.stored} signal(s): ${ingest.signals
                .map((signal) => `${signal.label} ${Math.round(signal.confidence * 100)}%`)
                .join(', ')}. Seen later in Insights.`,
            );
          }
        })
        .catch(() => {
          setMlNote('ML signal not recorded: unexpected local error.');
        });
    }
  }

  function handleRecheck() {
    if (!event) return;
    const completed = withOutcome(event, afterIntensity);
    setFinished(completed);
    setOutcomeSaveStatus(saveUrgeOutcome(completed));
    setStage('result');
  }

  const windowCount = Math.min(earlierEvents.length, RECENT_WINDOW_SIZE);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to home">
          <Text style={styles.back}>{'\u2039'} Home</Text>
        </Pressable>
        <Text style={styles.title}>Urge</Text>
        <Text style={styles.subtitle}>
          {stage === 'capture'
            ? 'Record the urge now. You will get one clear next step.'
            : stage === 'intervention'
              ? 'Do this one thing, then come back.'
              : stage === 'recheck'
                ? 'Come back to it once you have done the step.'
                : 'What happened after the intervention.'}
        </Text>
      </View>

      {stage === 'capture' ? (
        <View style={styles.card}>
          <ScaleInput label="How strong is the urge?" value={intensity} onChange={setIntensity} />

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>What was happening?</Text>
            <TextInput
              value={context}
              onChangeText={setContext}
              placeholder="e.g. Home alone, phone in bed"
              placeholderTextColor="#5b6b7c"
              style={styles.input}
              multiline
              maxLength={MAX_FREE_TEXT_LENGTH}
              accessibilityLabel="What was happening"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>What are you feeling?</Text>
            <TextInput
              value={feeling}
              onChangeText={setFeeling}
              placeholder="e.g. Restless, bored, stressed"
              placeholderTextColor="#5b6b7c"
              style={styles.input}
              multiline
              maxLength={MAX_FREE_TEXT_LENGTH}
              accessibilityLabel="What are you feeling"
            />
          </View>

          <Pressable
            onPress={handleCapture}
            accessibilityRole="button"
            accessibilityLabel="Get an intervention"
            style={styles.submit}>
            <Text style={styles.submitText}>Get an intervention</Text>
          </Pressable>

          {historyError ? (
            <Text style={[styles.persistenceNote, styles.persistenceFail]}>
              Earlier urges could not be read ({historyError}), so this score only uses what you
              enter now.
            </Text>
          ) : null}
          <Text style={styles.privacyNote}>{PRIVACY_NOTE}</Text>
        </View>
      ) : null}

      {stage === 'intervention' && assessment && signals ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Current state</Text>
          <Text style={styles.state}>{RISK_STATE_LABELS[assessment.state]}</Text>
          <Text style={styles.score}>Score: {assessment.score} / 10</Text>

          <Text style={styles.eyebrow}>Do this now</Text>
          <Text style={styles.intervention}>{assessment.recommendedAction}</Text>

          {assessment.reasons.length > 0 ? (
            <>
              <Text style={styles.eyebrow}>Why</Text>
              {assessment.reasons.map((reason) => (
                <Text key={reason} style={styles.reason}>
                  {'\u2022'} {reason}
                </Text>
              ))}
            </>
          ) : null}

          <Text style={styles.signalsNote}>
            Signals used: {signals.recentUrgeCount} earlier urge(s) at or above 6 in the last{' '}
            {windowCount} episode(s);{' '}
            {signals.usedCheckIn
              ? 'mood, energy, stress and control taken from your last check-in'
              : 'no check-in yet, so mood, energy and stress were treated as neutral'}
            .
          </Text>

          <Pressable
            onPress={() => setStage('recheck')}
            accessibilityRole="button"
            accessibilityLabel="I am ready to recheck"
            style={styles.submit}>
            <Text style={styles.submitText}>I{'\u2019'}m ready {'\u2192'} Recheck</Text>
          </Pressable>

          <PersistenceNote result={saveStatus} what="Urge" />
          {mlNote ? <Text style={styles.mlNote}>{mlNote}</Text> : null}
        </View>
      ) : null}

      {stage === 'recheck' && assessment ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>The step</Text>
          <Text style={styles.interventionSmall}>{assessment.recommendedAction}</Text>

          <ScaleInput
            label="How strong is the urge now?"
            value={afterIntensity}
            onChange={setAfterIntensity}
          />

          <Pressable
            onPress={handleRecheck}
            accessibilityRole="button"
            accessibilityLabel="Recheck the urge"
            style={styles.submit}>
            <Text style={styles.submitText}>Recheck</Text>
          </Pressable>
        </View>
      ) : null}

      {stage === 'result' && finished && event ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Result</Text>
          <Text style={styles.state}>{describeChange(event.intensity, finished.afterIntensity ?? event.intensity)}</Text>

          <Text style={styles.eyebrow}>Intervention effectiveness</Text>
          <Text style={styles.state}>
            {finished.effectiveness ? EFFECTIVENESS_LABELS[finished.effectiveness] : 'Unknown'}
          </Text>

          <Text style={styles.resultNote}>{NEUTRAL_RESULT_NOTE}</Text>

          <Text style={styles.eyebrow}>Intervention you used</Text>
          <Text style={styles.interventionSmall}>{event.intervention}</Text>

          <PersistenceNote result={saveStatus} what="Urge" />
          <PersistenceNote result={outcomeSaveStatus} what="Outcome" />

          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Done, back to home"
            style={styles.submit}>
            <Text style={styles.submitText}>Done</Text>
          </Pressable>
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
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
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
    marginBottom: 8,
  },
  fieldValue: {
    color: '#fbbf24',
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
    backgroundColor: '#f59e0b',
  },
  stepText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  stepTextSelected: {
    color: '#1f1300',
  },
  input: {
    backgroundColor: '#243141',
    borderRadius: 10,
    color: '#e2e8f0',
    fontSize: 15,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  submit: {
    backgroundColor: '#f59e0b',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  submitText: {
    color: '#1f1300',
    fontSize: 16,
    fontWeight: '700',
  },
  eyebrow: {
    color: '#94a3b8',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },
  state: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
  },
  score: {
    color: '#7dd3fc',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  intervention: {
    color: '#fde68a',
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
  },
  interventionSmall: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 22,
  },
  reason: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 21,
  },
  signalsNote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
  },
  privacyNote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
  },
  resultNote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
    fontStyle: 'italic',
  },
  mlNote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  persistenceNote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  persistenceOk: {
    color: '#86efac',
  },
  persistenceFail: {
    color: '#fca5a5',
  },
});
