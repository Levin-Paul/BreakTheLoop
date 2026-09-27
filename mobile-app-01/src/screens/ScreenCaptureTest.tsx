import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  captureSingleTestFrame,
  refreshScreenCaptureStatus,
  type SingleFrameTestOutcome,
} from '../vision/screenFrameSource';
import type { ScreenCaptureStatus } from '../vision/screenCaptureModule';

interface ScreenCaptureTestScreenProps {
  /** Returns to the Home screen. */
  onBack: () => void;
}

/**
 * DEVELOPMENT TEST SCREEN — not product UX.
 *
 * Purpose: prove that BreakTheLoop can legitimately obtain ONE ephemeral
 * screen frame through Android MediaProjection and discard it safely.
 *
 * What it shows:
 *   - native module availability + current status
 *   - the system consent dialog outcome (approve AND deny paths)
 *   - frame metadata (width/height/format/timestamp) on success
 *   - a stable error code on failure
 *
 * It never displays, stores, or claims to understand screen contents.
 */
export default function ScreenCaptureTestScreen({ onBack }: ScreenCaptureTestScreenProps) {
  const [status, setStatus] = useState<ScreenCaptureStatus | null>(null);
  const [outcome, setOutcome] = useState<SingleFrameTestOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    const next = await refreshScreenCaptureStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const runTest = useCallback(async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await captureSingleTestFrame();
      setOutcome(result);
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }, [refreshStatus]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.devBadge}>DEVELOPMENT TEST — NOT PRODUCT UX</Text>
      <Text style={styles.title}>Local Screen Capture{'\n'}Development Test</Text>
      <Text style={styles.disclaimer}>
        This test asks Android for one ephemeral screen frame through the
        official system consent dialog. The frame is processed in native memory
        and immediately discarded. Nothing is stored or uploaded. This app does
        NOT yet understand screen contents.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Status</Text>
        <Text style={styles.mono}>
          {status
            ? `module: supported=${String(status.supported)}  consent=${String(
                status.permissionGranted
              )}  capturing=${String(status.capturing)}\nlastError: ${status.lastError ?? 'none'}`
            : 'loading…'}
        </Text>
      </View>

      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator color="#38bdf8" />
          <Text style={styles.busyText}>Waiting for system consent / capture…</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run single frame capture test"
          style={styles.primaryButton}
          onPress={runTest}>
          <Text style={styles.primaryButtonText}>Run One-Frame Capture Test</Text>
        </Pressable>
      )}

      {outcome ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Result</Text>
          {outcome.ok && outcome.frame ? (
            <>
              <Text style={styles.okText}>SUCCESS — frame captured and discarded</Text>
              <Text style={styles.mono}>
                width: {outcome.frame.width}
                {'\n'}height: {outcome.frame.height}
                {'\n'}format: {outcome.frame.pixelFormat}
                {'\n'}timestamp: {outcome.frame.timestamp}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.failText}>FAILED — nothing was captured</Text>
              <Text style={styles.mono}>error: {outcome.error ?? 'unknown'}</Text>
            </>
          )}
          <Text style={styles.mono}>
            vision (stub): {JSON.stringify(outcome.vision)}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to home"
        style={styles.secondaryButton}
        onPress={onBack}>
        <Text style={styles.secondaryButtonText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f1720',
  },
  content: {
    padding: 24,
    paddingTop: 60,
    alignItems: 'stretch',
  },
  devBadge: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  disclaimer: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 20,
  },
  section: {
    backgroundColor: '#16212c',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  mono: {
    color: '#9fb3c8',
    fontSize: 12,
    lineHeight: 18,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    gap: 10,
  },
  busyText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryButtonText: {
    color: '#082f49',
    fontSize: 15,
    fontWeight: '700',
  },
  okText: {
    color: '#4ade80',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  failText: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  secondaryButton: {
    backgroundColor: '#243141',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 40,
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
});
