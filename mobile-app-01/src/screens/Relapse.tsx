import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { saveRelapseCheckIn, saveRelapseEvent } from '../database/relapseRepository';
import type { PersistenceResult } from '../database/schema';
import { calculateRecoveryState } from '../engine/recoveryEngine';
import type { RecoveryResult } from '../engine/types';
import {
  POST_LAPSE_ACTIONS,
  RELAPSE_ENVIRONMENTS,
  RELAPSE_ENVIRONMENT_LABELS,
  RELAPSE_MAX_NOTE_LENGTH,
  RISK_STATE_LABELS_POST_LAPSE,
  buildRelapseInput,
  createRelapseRecord,
  hasPostLapseCheckIn,
  withPostLapseCheckIn,
  type PostLapseCheckInDraft,
  type RelapseDraft,
  type RelapseEnvironment,
  type RelapseRecord,
} from './relapseModel';
import ScaleInput from './ScaleInput';

// Wording contract: acknowledging a lapse takes courage; this screen must
// never shame. Every line below is action-focused and forward-looking.
const ENTRY_TITLE = 'Record a relapse';
const ENTRY_SUBTITLE =
  'Recording a lapse does not erase your progress. It becomes recovery data you can learn from.';
const ENTRY_PRIVACY_NOTE =
  'Only the time, the place type, and what you choose here are stored, on this device. ' +
  `A note is optional and never required. Nothing is sent anywhere.`;

const RECORDED_TITLE = 'It has been recorded.';
const RECORDED_BODY =
  'Your progress is not erased. Every check-in, urge you resisted, and pattern you learned is still yours. ' +
  'One lapse does not undo them.';
const RECORDED_NEXT = 'What would help right now?';

export default function RelapseScreen({ onBack }: RelapseScreenProps) {
  const [stage, setStage] = useState<'entry' | 'postLapse' | 'checkIn'>('entry');
  const [environment, setEnvironment] = useState<RelapseEnvironment>('home_alone');
  const [triggerNoticed, setTriggerNoticed] = useState(false);
  const [note, setNote] = useState('');

  const [record, setRecord] = useState<RelapseRecord | null>(null);
  const [saveStatus, setSaveStatus] = useState<PersistenceResult | null>(null);
  const [checkInSaveStatus, setCheckInSaveStatus] = useState<PersistenceResult | null>(null);

  const [mood, setMood] = useState(4);
  const [stress, setStress] = useState(6);
  const [urgeIntensity, setUrgeIntensity] = useState(8);
  const [actionTaken, setActionTaken] = useState<string>(POST_LAPSE_ACTIONS[0]?.key ?? 'leave_environment');

  const [assessment, setAssessment] = useState<RecoveryResult | null>(null);

  function handleRecord() {
    const draft: RelapseDraft = { environment, triggerNoticed, note };
    const created = createRelapseRecord(draft);
    setRecord(created);
    // Persist first; the post-lapse screen always shows, but honestly reports
    // whether the record actually saved on this device.
    setSaveStatus(saveRelapseEvent(created));
    setStage('postLapse');
  }

  function handleCancel() {
    // Safe exit before recording: nothing has been written, nothing to undo.
    setRecord(null);
    setSaveStatus(null);
    onBack();
  }

  function handleStartCheckIn() {
    if (!record) return;
    const draft: PostLapseCheckInDraft = { mood, stress, urgeIntensity };
    const derived = buildRelapseInput(record, draft);
    setAssessment(calculateRecoveryState(derived.input));
    setStage('checkIn');
  }

  function handleCheckInSubmit() {
    if (!record) return;
    const updated = withPostLapseCheckIn(record, { mood, stress, urgeIntensity });
    setRecord(updated);
    // Updates the SAME relapse row (keyed by id) — never a second record.
    setCheckInSaveStatus(saveRelapseCheckIn(updated));
    setStage('postLapse');
  }

  if (stage === 'entry') {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
        <View style={styles.header}>
          <Pressable onPress={handleCancel} accessibilityRole="button" accessibilityLabel="Cancel recording a relapse">
            <Text style={styles.back}>{'\u2039'} Home</Text>
          </Pressable>
          <Text style={styles.title}>{ENTRY_TITLE}</Text>
          <Text style={styles.subtitle}>{ENTRY_SUBTITLE}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Where were you?</Text>
          <View style={styles.optionGrid}>
            {RELAPSE_ENVIRONMENTS.map((option) => {
              const selected = environment === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setEnvironment(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Environment ${RELAPSE_ENVIRONMENT_LABELS[option]}`}
                  accessibilityState={{ selected }}
                  style={[styles.option, selected && styles.optionSelected]}>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {RELAPSE_ENVIRONMENT_LABELS[option]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Did you notice a trigger beforehand?</Text>
          <View style={styles.segmentRow}>
            {[false, true].map((option) => {
              const selected = triggerNoticed === option;
              const label = option ? 'Yes' : 'No';
              return (
                <Pressable
                  key={label}
                  onPress={() => setTriggerNoticed(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Trigger noticed ${label}`}
                  accessibilityState={{ selected }}
                  style={[styles.segment, selected && styles.segmentSelected]}>
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Anything you want to note? (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="A few words are enough. Explicit details are never needed."
            placeholderTextColor="#5b6b7c"
            style={styles.input}
            multiline
            maxLength={RELAPSE_MAX_NOTE_LENGTH}
            accessibilityLabel="Optional note about the relapse"
          />

          <Pressable
            onPress={handleRecord}
            accessibilityRole="button"
            accessibilityLabel="Record the relapse"
            style={styles.recordButton}>
            <Text style={styles.recordButtonText}>Record it</Text>
          </Pressable>
          <Pressable
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel without recording"
            style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>

          <Text style={styles.privacyNote}>{ENTRY_PRIVACY_NOTE}</Text>
        </View>
      </ScrollView>
    );
  }

  if (stage === 'checkIn' && record) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Post-lapse check-in</Text>
          <Text style={styles.subtitle}>
            Optional. A few quick ratings help you see the moment more clearly later.
          </Text>
        </View>

        <View style={styles.card}>
          <ScaleInput label="Mood right now" value={mood} onChange={setMood} />
          <ScaleInput label="Stress right now" value={stress} onChange={setStress} />
          <ScaleInput label="Urge intensity" value={urgeIntensity} onChange={setUrgeIntensity} />

          <Text style={styles.fieldLabel}>Which action did you take?</Text>
          <View style={styles.optionGrid}>
            {POST_LAPSE_ACTIONS.map((action) => {
              const selected = actionTaken === action.key;
              return (
                <Pressable
                  key={action.key}
                  onPress={() => setActionTaken(action.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Action taken: ${action.label}`}
                  accessibilityState={{ selected }}
                  style={[styles.option, selected && styles.optionSelected]}>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {action.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={handleCheckInSubmit}
            accessibilityRole="button"
            accessibilityLabel="Save the post-lapse check-in"
            style={styles.recordButton}>
            <Text style={styles.recordButtonText}>Save check-in</Text>
          </Pressable>

          {assessment ? (
            <View style={styles.assessmentCard}>
              <Text style={styles.eyebrow}>Current state</Text>
              <Text style={styles.state}>{RISK_STATE_LABELS_POST_LAPSE[assessment.state]}</Text>
              <Text style={styles.interventionSmall}>{assessment.recommendedAction}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    );
  }

  // stage === 'postLapse'
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Text style={styles.title}>{RECORDED_TITLE}</Text>
        <Text style={styles.subtitle}>{RECORDED_BODY}</Text>
        {record && hasPostLapseCheckIn(record) ? (
          <Text style={styles.checkInDone}>Post-lapse check-in saved.</Text>
        ) : null}
      </View>

      {saveStatus && !saveStatus.ok ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>
            The lapse could not be saved on this device: {saveStatus.error ?? 'SQLite is unavailable'}.{' '}
            Nothing was lost by closing this screen.
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{RECORDED_NEXT}</Text>
      <View style={styles.card}>
        {POST_LAPSE_ACTIONS.map((action) => (
          <Text key={action.key} style={styles.actionLine}>
            {'\u2022'} {action.label}
          </Text>
        ))}
      </View>

      <Pressable
        onPress={handleStartCheckIn}
        accessibilityRole="button"
        accessibilityLabel="Start the optional post-lapse check-in"
        style={styles.recordButton}>
        <Text style={styles.recordButtonText}>
          {record && hasPostLapseCheckIn(record) ? 'Review or update check-in' : 'Start a check-in (optional)'}
        </Text>
      </Pressable>

      {checkInSaveStatus ? (
        <Text style={[styles.persistenceNote, checkInSaveStatus.ok ? styles.persistenceOk : styles.persistenceFail]}>
          {checkInSaveStatus.ok
            ? 'Check-in saved on this device.'
            : `Check-in not saved: ${checkInSaveStatus.error ?? 'SQLite is unavailable here'}.`}
        </Text>
      ) : null}

      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Done, back to home"
        style={styles.doneButton}>
        <Text style={styles.doneButtonText}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

interface RelapseScreenProps {
  /** Returns to the Home screen. */
  onBack: () => void;
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
  fieldLabel: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 14,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#243141',
  },
  optionSelected: {
    backgroundColor: '#38bdf8',
  },
  optionText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  optionTextSelected: {
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
  recordButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 18,
  },
  recordButtonText: {
    color: '#052e16',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    backgroundColor: '#243141',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  doneButton: {
    backgroundColor: '#243141',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  doneButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
  },
  privacyNote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 10,
  },
  actionLine: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 24,
  },
  checkInDone: {
    color: '#86efac',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 19,
  },
  assessmentCard: {
    backgroundColor: '#16202b',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  eyebrow: {
    color: '#94a3b8',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  state: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  interventionSmall: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 22,
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
