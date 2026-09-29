import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DiscoveryModeState } from '../database/appStatePersistence';
import { countCheckIns, loadRecentCheckIns } from '../database/checkInRepository';
import { initializeDatabase } from '../database/schema';
import { countUrges, loadRecentUrgeEvents } from '../database/urgeRepository';
import {
  buildPatternInsightBanners,
  deriveDiscoveryStatus,
  isPromotedPattern,
  type PatternInsightBanner,
} from '../discovery/discoveryModel';
import { detectPatterns, type DetectedPattern } from '../engine/patternEngine';
import { PATTERN_HISTORY_LIMIT } from './insightsModel';

interface HomeScreenProps {
  /** Current Discovery Mode state from the local database (null before start). */
  discovery: DiscoveryModeState | null;
  /** Enables/disables Discovery Mode (persists locally; keeps history). */
  onDiscoveryToggle: (enabled: boolean) => void;
  /** Navigates to the Check-In screen. */
  onStartCheckIn: () => void;
  /** Navigates to the Urge screen. */
  onStartUrge: () => void;
  /** Navigates to the Insights screen. */
  onOpenInsights: () => void;
  /** Navigates to the Settings screen. */
  onOpenSettings: () => void;
  /** Navigates to the development-only screen-capture test screen. */
  onOpenScreenCaptureTest: () => void;
}

/**
 * Everything the Discovery card shows, read from this device's database.
 * Nothing is invented: if a read fails the counts stay at 0 and the error is
 * shown, exactly like the Insights screen.
 */
interface DiscoveryData {
  ready: boolean;
  error?: string;
  checkIns: number;
  urges: number;
  patterns: DetectedPattern[];
  banners: PatternInsightBanner[];
}

const EMPTY_DISCOVERY_DATA: DiscoveryData = {
  ready: false,
  checkIns: 0,
  urges: 0,
  patterns: [],
  banners: [],
};

export default function HomeScreen({
  discovery,
  onDiscoveryToggle,
  onStartCheckIn,
  onStartUrge,
  onOpenInsights,
  onOpenSettings,
  onOpenScreenCaptureTest,
}: HomeScreenProps) {
  const [data, setData] = useState<DiscoveryData>(EMPTY_DISCOVERY_DATA);

  // Reads real counts from the local database. Home remounts on every
  // navigation, so returning from a check-in or urge refreshes the numbers.
  // The same bounded history read that Insights uses feeds the Pattern Engine;
  // promotion rules come from the engine itself via isPromotedPattern — no
  // second engine, no invented thresholds.
  function refresh() {
    const init = initializeDatabase();
    if (!init.ok) {
      setData({ ...EMPTY_DISCOVERY_DATA, error: init.error });
      return;
    }

    const checkInCount = countCheckIns();
    const urgeCount = countUrges();
    const checkInHistory = loadRecentCheckIns(PATTERN_HISTORY_LIMIT);
    const urgeHistory = loadRecentUrgeEvents(PATTERN_HISTORY_LIMIT);

    const error = [
      checkInCount.error,
      urgeCount.error,
      checkInHistory.error,
      urgeHistory.error,
    ].find((message) => message !== undefined);

    if (error !== undefined) {
      setData({ ...EMPTY_DISCOVERY_DATA, ready: false, error });
      return;
    }

    // Detected only from rows actually stored on this device.
    const patterns = detectPatterns(checkInHistory.checkIns, urgeHistory.events);
    setData({
      ready: true,
      checkIns: checkInCount.count,
      urges: urgeCount.count,
      patterns,
      // At most one banner (DISCOVERY_BANNER_LIMIT), strongest first, keyed by
      // the pattern id — repeated renders cannot duplicate it.
      banners: buildPatternInsightBanners(patterns),
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  const promotedPatterns = data.patterns.filter(isPromotedPattern).length;
  const discoveryStatus = deriveDiscoveryStatus(
    discovery?.enabled ?? false,
    data.checkIns,
    data.urges,
    promotedPatterns,
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Break the Loop</Text>
      <Text style={styles.subtitle}>
        Check in with yourself before the urge decides for you.
      </Text>

      {discovery?.enabled ? (
        <>
          {data.banners.map((banner) => (
            <View key={banner.id} style={styles.bannerCard}>
              <Text style={styles.bannerTitle}>{banner.title}</Text>
              <Text style={styles.bannerBody}>{banner.body}</Text>
              <Text style={styles.bannerCta}>{banner.callToAction}</Text>
            </View>
          ))}

          <Pressable
            onPress={onOpenInsights}
            accessibilityRole="button"
            accessibilityLabel="Discovery Mode status"
            style={styles.discoveryCard}>
            <View style={styles.discoveryHeader}>
              <View style={styles.discoveryDot} />
              <Text style={styles.discoveryTitle}>DISCOVERY MODE</Text>
            </View>
            <Text style={styles.discoveryText}>{discoveryStatus.headline}</Text>

            <View style={styles.discoveryCounts}>
              <View style={styles.discoveryCountRow}>
                <Text style={styles.discoveryCountLabel}>Check-ins recorded</Text>
                <Text style={styles.discoveryCountValue}>{data.checkIns}</Text>
              </View>
              <View style={styles.discoveryCountRow}>
                <Text style={styles.discoveryCountLabel}>Urges recorded</Text>
                <Text style={styles.discoveryCountValue}>{data.urges}</Text>
              </View>
              <View style={styles.discoveryCountRow}>
                <Text style={styles.discoveryCountLabel}>Patterns identified</Text>
                <Text style={styles.discoveryCountValue}>{promotedPatterns}</Text>
              </View>
            </View>

            {data.error ? (
              <Text style={styles.discoveryError}>
                Local data could not be read: {data.error}. Counts are left at 0 rather than
                guessed.
              </Text>
            ) : null}

            <Text style={styles.discoveryMeta}>
              During this stage, Break the Loop focuses on understanding your patterns. As enough
              data builds up, it can suggest when an intervention may help.
            </Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.discoveryCardOff}>
          <Text style={styles.discoveryText}>Discovery Mode is off.</Text>
          <Pressable
            onPress={() => onDiscoveryToggle(true)}
            accessibilityRole="button"
            accessibilityLabel="Turn Discovery Mode back on"
            style={styles.discoveryTurnOn}>
            <Text style={styles.discoveryTurnOnText}>Turn back on</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        onPress={onStartUrge}
        accessibilityRole="button"
        accessibilityLabel="I'm having an urge"
        style={styles.urgeButton}>
        <Text style={styles.urgeButtonText}>{'I\u2019m Having an Urge'}</Text>
      </Pressable>

      <Pressable
        onPress={onStartCheckIn}
        accessibilityRole="button"
        accessibilityLabel="Start check-in"
        style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Start Check-In</Text>
      </Pressable>

      <Pressable
        onPress={onOpenInsights}
        accessibilityRole="button"
        accessibilityLabel="Open insights"
        style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Insights</Text>
      </Pressable>

      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Settings</Text>
      </Pressable>

      {discovery?.enabled ? (
        <Pressable
          onPress={() => onDiscoveryToggle(false)}
          accessibilityRole="button"
          accessibilityLabel="Stop Discovery Mode"
          style={styles.devButton}>
          <Text style={styles.discoveryStopText}>Stop Discovery Mode</Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onOpenScreenCaptureTest}
        accessibilityRole="button"
        accessibilityLabel="Open screen capture development test"
        style={styles.devButton}>
        <Text style={styles.secondaryButtonText}>{'Screen Capture Test \u2014 dev'}</Text>
      </Pressable>

      <Text style={styles.footnote}>
        {data.ready
          ? `${data.checkIns} check-in(s) and ${data.urges} urge(s) are stored on this device. `
          : ''}
        Nothing leaves this device: there is no account, no server, and no analytics. The local AI
        runs on-device and offline.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f1720',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 15,
    marginTop: 10,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 21,
  },
  urgeButton: {
    backgroundColor: '#f59e0b',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginBottom: 14,
  },
  urgeButtonText: {
    color: '#1f1300',
    fontSize: 17,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#052e16',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#243141',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginTop: 14,
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  devButton: {
    backgroundColor: '#1a2531',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginTop: 10,
  },
  bannerCard: {
    backgroundColor: '#1c2a3d',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2c4a6e',
  },
  bannerTitle: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  bannerBody: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  bannerCta: {
    color: '#7dd3fc',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  discoveryCard: {
    backgroundColor: '#12252e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 22,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1e4d5f',
  },
  discoveryCardOff: {
    backgroundColor: '#1a2531',
    borderRadius: 14,
    padding: 14,
    marginBottom: 22,
    width: '100%',
    alignItems: 'center',
  },
  discoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  discoveryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#38bdf8',
    marginRight: 8,
  },
  discoveryTitle: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  discoveryText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  discoveryCounts: {
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e4d5f',
  },
  discoveryCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  discoveryCountLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  discoveryCountValue: {
    color: '#7dd3fc',
    fontSize: 15,
    fontWeight: '700',
  },
  discoveryError: {
    color: '#fca5a5',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  discoveryMeta: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  discoveryTurnOn: {
    backgroundColor: '#155e75',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
    marginTop: 10,
  },
  discoveryTurnOnText: {
    color: '#e0f2fe',
    fontSize: 13,
    fontWeight: '600',
  },
  discoveryStopText: {
    color: '#7c8da3',
    fontSize: 13,
    fontWeight: '600',
  },
  footnote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 28,
    textAlign: 'center',
  },
});
