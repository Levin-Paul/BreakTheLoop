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
  RECENT_ACTIVITY_LIMIT,
  buildRecentActivity,
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
  activity: ActivityEntry[];
}

const EMPTY: Omit<InsightsState, 'status' | 'error'> = {
  checkIns: 0,
  urges: 0,
  interventions: 0,
  activity: [],
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
    const recentCheckIns = loadRecentCheckIns(RECENT_ACTIVITY_LIMIT);
    const recentUrges = loadRecentUrgeEvents(RECENT_ACTIVITY_LIMIT);

    const error = [
      checkInCount.error,
      urgeCount.error,
      interventionCount.error,
      recentCheckIns.error,
      recentUrges.error,
    ].find((message) => message !== undefined);

    setState({
      status: error ? 'unavailable' : 'ready',
      error,
      checkIns: checkInCount.count,
      urges: urgeCount.count,
      interventions: interventionCount.count,
      activity: buildRecentActivity(
        recentCheckIns.checkIns,
        recentUrges.events,
        RECENT_ACTIVITY_LIMIT,
      ),
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
        <Text style={styles.countNote}>
          Interventions counts urge episodes carried through a recheck, so it stays 0 for urges that
          were never rechecked.
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
