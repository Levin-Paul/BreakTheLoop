import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { countCheckIns, loadRecentCheckIns } from '../database/checkInRepository';
import { initializeDatabase } from '../database/schema';
import {
  countCompletedInterventions,
  countUrges,
  loadRecentUrgeEvents,
} from '../database/urgeRepository';
import {
  detectPatterns,
  hasEnoughEvidence,
  summarizeMlSignals,
  type DetectedPattern,
} from '../engine/patternEngine';
import { countMlSignalObservations, loadRecentMlSignals } from '../database/signalRepository';
import {
  PATTERN_HISTORY_LIMIT,
  PATTERN_STATUS_LABELS,
  RECENT_ACTIVITY_LIMIT,
  buildMlSignalSummaries,
  buildRecentActivity,
  formatConfidence,
  formatDateRange,
  formatStoredTimestamp,
  type ActivityEntry,
} from './insightsModel';

interface InsightsScreenProps {
  /** Returns to the Home screen. */
  onBack: () => void;
}

interface InsightsState {
  status: 'loading' | 'ready' | 'unavailable';
  error?: string;
  checkIns: number;
  urges: number;
  interventions: number;
  mlSignals: number;
  activity: ActivityEntry[];
  patterns: DetectedPattern[];
  mlSummaries: ReturnType<typeof buildMlSignalSummaries>;
}

const EMPTY: Omit<InsightsState, 'status' | 'error'> = {
  checkIns: 0,
  urges: 0,
  interventions: 0,
  mlSignals: 0,
  activity: [],
  patterns: [],
  mlSummaries: [],
};

export default function InsightsScreen({ onBack }: InsightsScreenProps) {
  const [state, setState] = useState<InsightsState>({ status: 'loading', ...EMPTY });

  // Every number below comes from a COUNT/ SELECT on this device's database.
  // If any of them fails, the screen says so instead of showing a fallback value.
  function refresh() {
    const init = initializeDatabase();
    if (!init.ok) {
      setState({ status: 'unavailable', error: init.error, ...EMPTY });
      return;
    }

    const checkInCount = countCheckIns();
    const urgeCount = countUrges();
    const interventionCount = countCompletedInterventions();
    const mlSignalCount = countMlSignalObservations();
    // Patterns need more history than the activity list, so a larger (still
    // bounded) read is used and the activity list slices its own limit.
    const checkInHistory = loadRecentCheckIns(PATTERN_HISTORY_LIMIT);
    const urgeHistory = loadRecentUrgeEvents(PATTERN_HISTORY_LIMIT);
    const mlSignalHistory = loadRecentMlSignals(PATTERN_HISTORY_LIMIT);

    const error = [
      checkInCount.error,
      urgeCount.error,
      interventionCount.error,
      checkInHistory.error,
      urgeHistory.error,
      // ML signals are additive; a failure here degrades only this section.
      mlSignalCount.error,
      mlSignalHistory.error,
    ].find((message) => message !== undefined);

    setState({
      status: error ? 'unavailable' : 'ready',
      error,
      checkIns: checkInCount.count,
      urges: urgeCount.count,
      interventions: interventionCount.count,
      activity: buildRecentActivity(
        checkInHistory.checkIns,
        urgeHistory.events,
        RECENT_ACTIVITY_LIMIT,
      ),
      // Detected only from rows actually stored on this device.
      patterns: detectPatterns(checkInHistory.checkIns, urgeHistory.events),
      mlSignals: mlSignalCount.count,
      // ML-derived signals come from their own table and are summarized with
      // the same counting rules — no invention, no causal wording.
      mlSummaries: buildMlSignalSummaries(summarizeMlSignals(mlSignalHistory.events)),
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to home">
          <Text style={styles.back}>{'\u2039'} Home</Text>
        </Pressable>
        <Text style={styles.title}>Insights</Text>
        <Text style={styles.subtitle}>Counted from what is stored on this device.</Text>
      </View>

      {state.status === 'unavailable' ? (
        <Text style={styles.error}>
          Local data could not be read: {state.error ?? 'SQLite is unavailable'}. Counts below are
          left at 0 rather than guessed.
        </Text>
      ) : null}

      <View style={styles.card}>
        <View style={styles.countRow}>
          <Text style={styles.countLabel}>Check-ins:</Text>
          <Text style={styles.countValue}>{state.checkIns}</Text>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.countLabel}>Urges:</Text>
          <Text style={styles.countValue}>{state.urges}</Text>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.countLabel}>Interventions:</Text>
          <Text style={styles.countValue}>{state.interventions}</Text>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.countLabel}>ML signal events:</Text>
          <Text style={styles.countValue}>{state.mlSignals}</Text>
        </View>
        <Text style={styles.countNote}>
          Interventions counts urge episodes carried through a recheck, so it stays 0 for urges that
          were never rechecked.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>ML model signals</Text>
      {state.mlSummaries.length === 0 ? (
        <Text style={styles.empty}>
          No ML signals recorded yet. When the local classifier runs on text you enter, the labels it
          emits are counted here — separately from the repeated sequences below.
        </Text>
      ) : (
        <View style={styles.card}>
          {state.mlSummaries.map((summary) => (
            <View key={summary.label} style={styles.patternRow}>
              <View style={styles.patternHeader}>
                <Text style={styles.patternStatus}>{summary.label}</Text>
                <Text style={styles.patternCount}>{summary.occurrenceCount} events</Text>
              </View>
              <Text style={styles.patternDescription}>{summary.headline}</Text>
              <Text style={styles.patternMeta}>{summary.detail}</Text>
            </View>
          ))}
          <Text style={styles.countNote}>
            These are counts of what the local model emitted for text you typed — not a diagnosis,
            not a prediction, and not a pattern over time. The model only knows the labels shown
            here; it was never trained on the others.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Local patterns</Text>
      {state.status !== 'ready' ? (
        <Text style={styles.empty}>
          Patterns are still being learned. Nothing is shown until local data can be read.
        </Text>
      ) : !hasEnoughEvidence(state.patterns) ? (
        <Text style={styles.empty}>
          Patterns are still being learned. A sequence is only reported here once it has been seen
          more than once in your stored check-ins and urges.
        </Text>
      ) : (
        <View style={styles.card}>
          {state.patterns
            .filter((pattern) => pattern.occurrenceCount >= 2)
            .map((pattern) => (
              <View key={pattern.id} style={styles.patternRow}>
                <View style={styles.patternHeader}>
                  <Text style={styles.patternStatus}>
                    {PATTERN_STATUS_LABELS[pattern.status]}
                  </Text>
                  <Text style={styles.patternCount}>
                    {pattern.occurrenceCount} occurrences
                  </Text>
                </View>
                <Text style={styles.patternDescription}>{pattern.description}</Text>
                <Text style={styles.patternMeta}>
                  This sequence appeared before {pattern.occurrenceCount} recorded episodes.
                </Text>
                <Text style={styles.patternMeta}>
                  Score {formatConfidence(pattern.confidence)} \u00b7{' '}
                  {formatDateRange(pattern.firstSeenAt, pattern.lastSeenAt)}
                </Text>
              </View>
            ))}
          <Text style={styles.countNote}>
            These are repeated sequences in your own stored history, not predictions and not proof
            of cause. Nothing here leaves this device.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>How these sections differ</Text>
      <View style={styles.card}>
        <Text style={styles.patternMeta}>
          {'\u2022'} ML model signals: what the local text classifier emitted for text you entered,
          on this device, at a moment in time.
        </Text>
        <Text style={styles.patternMeta}>
          {'\u2022'} Local patterns: repeated sequences counted by deterministic rules from your
          stored check-ins and urges.
        </Text>
        <Text style={styles.patternMeta}>
          {'\u2022'} Recovery Engine risk and interventions: not shown as history here; it is applied
          live in the Check-In and Urge flows.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Recent activity</Text>
      {state.activity.length === 0 ? (
        <Text style={styles.empty}>
          {state.status === 'unavailable'
            ? 'Nothing could be read from the local database.'
            : 'No stored check-ins or urges yet.'}
        </Text>
      ) : (
        <View style={styles.card}>
          {state.activity.map((entry) => (
            <View key={`${entry.kind}-${entry.id}`} style={styles.activityRow}>
              <View style={styles.activityHeader}>
                <Text style={styles.activityTitle}>{entry.title}</Text>
                <Text style={styles.activityTime}>{formatStoredTimestamp(entry.createdAt)}</Text>
              </View>
              <Text style={styles.activityDetail}>{entry.detail}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        onPress={refresh}
        accessibilityRole="button"
        accessibilityLabel="Refresh local data"
        style={styles.refresh}>
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
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
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  countLabel: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  countValue: {
    color: '#7dd3fc',
    fontSize: 22,
    fontWeight: '700',
  },
  countNote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 10,
  },
  patternRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c3a4b',
  },
  patternHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  patternStatus: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  patternCount: {
    color: '#94a3b8',
    fontSize: 12,
  },
  patternDescription: {
    color: '#f8fafc',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  patternMeta: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  activityRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c3a4b',
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activityTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  activityTime: {
    color: '#7c8da3',
    fontSize: 12,
  },
  activityDetail: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  empty: {
    color: '#7c8da3',
    fontSize: 13,
    lineHeight: 19,
  },
  error: {
    color: '#fca5a5',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  refresh: {
    backgroundColor: '#243141',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  refreshText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
  },
});
