import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import type { DiscoveryModeState } from '../database/appStatePersistence';
import {
  buildExportPayload,
  setMonitoringEnabled,
  type AppSettings,
} from '../database/settingsRepository';
import { deleteAllUserData } from '../database/settingsRepository';
import {
  DELETE_CONFIRM_ACTION,
  DELETE_CONFIRM_BODY,
  DELETE_CONFIRM_CANCEL,
  DELETE_CONFIRM_TITLE,
  DISCOVERY_DESCRIPTION,
  MONITORING_EXPLANATION,
  PRIVACY_LINES,
  WHAT_IS_NOT_STORED,
  WHAT_IS_STORED,
  retentionSummary,
} from '../settings/privacyCopy';
import type { PersistenceResult } from '../database/schema';

const MONITORING_LABEL = 'Recovery monitoring';
const ON = 'ON';
const OFF = 'OFF';



interface SettingsScreenProps {
  /** Current persisted settings (already resolved with defaults). */
  settings: AppSettings;
  /** Persists the monitoring kill switch (receives the resulting settings). */
  onMonitoringChange: (settings: AppSettings) => void;
  /** Current Discovery Mode state from the local database. */
  discovery: DiscoveryModeState | null;
  /** Enables/disables Discovery Mode (existing persistence; keeps history). */
  onDiscoveryToggle: (enabled: boolean) => void;
  /** Called after a confirmed delete-all so the app can re-resolve boot state. */
  onAllDataDeleted: () => void;
  /** Returns to the Home screen. */
  onBack: () => void;
}

function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  testID,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  testID: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      <Pressable
        testID={testID}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        accessibilityLabel={label}
        onPress={() => onValueChange(!value)}
        style={[styles.switchTrack, value ? styles.trackOn : styles.trackOff]}>
        <Text style={value ? styles.switchTextOn : styles.switchTextOff}>
          {value ? ON : OFF}
        </Text>
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function SettingsScreen({
  settings,
  onMonitoringChange,
  discovery,
  onDiscoveryToggle,
  onAllDataDeleted,
  onBack,
}: SettingsScreenProps) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  function handleMonitoringChange(enabled: boolean) {
    const result = setMonitoringEnabled(enabled);
    if (result.ok) {
      setSaveError(null);
      onMonitoringChange(result.settings);
    } else {
      setSaveError(result.error ?? 'The setting could not be saved.');
    }
  }

  function handleExport() {
    const result = buildExportPayload();
    if (!result.ok || !result.data) {
      setExportNote(`Export failed: ${result.error ?? 'unknown error'}`);
      return;
    }
    const payload = result.data;
    Share.share({
      // A deterministic structure the user can read and verify. Local share
      // sheet only — nothing is uploaded by this call.
      message: JSON.stringify(payload, null, 2),
      title: 'break-the-loop-export.json',
    })
      .then(() => setExportNote('Export prepared. Choose where to save or share it.'))
      .catch(() => setExportNote('Export cancelled.'));
  }

  function handleDeleteConfirmed() {
    setConfirmVisible(false);
    const result = deleteAllUserData();
    if (result.ok) {
      onAllDataDeleted();
    } else {
      setSaveError(result.error ?? 'Deletion failed; nothing was changed.');
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to home">
          <Text style={styles.back}>{'\u2039'} Home</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <Section title="Recovery Monitoring">
        <SwitchRow
          label={MONITORING_LABEL}
          description={MONITORING_EXPLANATION}
          value={settings.monitoringEnabled}
          onValueChange={handleMonitoringChange}
          testID="monitoring-switch"
        />
      </Section>

      <Section title="Discovery Mode">
        <SwitchRow
          label={`Discovery Mode — ${discovery?.enabled ? ON : OFF}`}
          description={DISCOVERY_DESCRIPTION}
          value={discovery?.enabled ?? false}
          onValueChange={onDiscoveryToggle}
          testID="discovery-switch"
        />
        <Text style={styles.note}>
          Turning Discovery Mode off never deletes your historical recovery data.
        </Text>
      </Section>

      <Section title="Your Data">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export my data"
          style={styles.actionButton}
          onPress={handleExport}>
          <Text style={styles.actionText}>Export my data</Text>
        </Pressable>
        <Text style={styles.note}>
          Saves a readable JSON copy of your recovery data to share or keep. It stays under your
          control and is never uploaded anywhere by the app.
        </Text>
        {exportNote ? <Text style={styles.note}>{exportNote}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete all recovery data"
          style={styles.destructiveButton}
          onPress={() => setConfirmVisible(true)}>
          <Text style={styles.destructiveText}>Delete all recovery data</Text>
        </Pressable>
        <Text style={styles.note}>
          Removes every stored recovery record from this device and resets the app to a fresh
          state. The schema is untouched; nothing is sent anywhere.
        </Text>
      </Section>

      <Section title="Privacy">
        <Text style={styles.privacyHeading}>What is stored locally</Text>
        {WHAT_IS_STORED.map((item) => (
          <Text key={item.label} style={styles.privacyItem}>
            {'\u2022'}
            <Text style={styles.privacyItemLabel}> {item.label}: </Text>
            {item.body}
          </Text>
        ))}
        <Text style={styles.privacyHeading}>What is not stored</Text>
        {WHAT_IS_NOT_STORED.map((item) => (
          <Text key={item.label} style={styles.privacyItem}>
            {'\u2022'}
            <Text style={styles.privacyItemLabel}> {item.label}: </Text>
            {item.body}
          </Text>
        ))}
        <Text style={styles.retentionNote}>{retentionSummary(settings.signalRetentionDays)}</Text>
        {PRIVACY_LINES.map((line) => (
          <Text key={line} style={styles.privacyLine}>
            {line}
          </Text>
        ))}
      </Section>

      <Section title="About">
        <Text style={styles.aboutLine}>
          Break The Loop is a local-first, offline self-reflection tool. It is not a medical
          device and does not replace professional care.
        </Text>
        <Text style={styles.aboutLine}>Version 1.0.0</Text>
      </Section>

      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{DELETE_CONFIRM_TITLE}</Text>
            <Text style={styles.modalBody}>{DELETE_CONFIRM_BODY}</Text>
            <View style={styles.modalButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel deletion"
                style={styles.modalCancel}
                onPress={() => setConfirmVisible(false)}>
                <Text style={styles.modalCancelText}>{DELETE_CONFIRM_CANCEL}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm deletion"
                style={styles.modalDelete}
                onPress={handleDeleteConfirmed}>
                <Text style={styles.modalDeleteText}>{DELETE_CONFIRM_ACTION}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f1720',
  },
  content: {
    padding: 20,
    paddingTop: 64,
    paddingBottom: 48,
  },
  header: {
    marginBottom: 18,
  },
  back: {
    color: '#7dd3fc',
    fontSize: 15,
    marginBottom: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '700',
  },
  section: {
    backgroundColor: '#1b2530',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowLabel: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  rowDescription: {
    color: '#7c8da3',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  switchTrack: {
    minWidth: 64,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  trackOn: {
    backgroundColor: '#155e75',
  },
  trackOff: {
    backgroundColor: '#243141',
  },
  switchTextOn: {
    color: '#7dd3fc',
    fontWeight: '700',
    fontSize: 13,
  },
  switchTextOff: {
    color: '#94a3b8',
    fontWeight: '700',
    fontSize: 13,
  },
  note: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  actionButton: {
    backgroundColor: '#243141',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionText: {
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 14,
  },
  destructiveButton: {
    backgroundColor: '#3b1420',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  destructiveText: {
    color: '#fda4af',
    fontWeight: '700',
    fontSize: 14,
  },
  privacyHeading: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  privacyItem: {
    color: '#9fb0c0',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6,
  },
  privacyItemLabel: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  retentionNote: {
    color: '#7dd3fc',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  privacyLine: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  aboutLine: {
    color: '#9fb0c0',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    marginTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 12, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#1b2530',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  modalBody: {
    color: '#c7d2dc',
    fontSize: 14,
    lineHeight: 21,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  modalCancel: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#243141',
  },
  modalCancelText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  modalDelete: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#b91c1c',
  },
  modalDeleteText: {
    color: '#fff1f2',
    fontWeight: '700',
  },
});
