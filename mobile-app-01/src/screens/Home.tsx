import { Pressable, StyleSheet, Text, View } from 'react-native';

interface HomeScreenProps {
  /** Number of check-ins captured in this session. */
  checkInCount: number;
  /** Navigates to the Check-In screen. */
  onStartCheckIn: () => void;
  /** Navigates to the Urge screen. */
  onStartUrge: () => void;
  /** Navigates to the Insights screen. */
  onOpenInsights: () => void;
}

export default function HomeScreen({
  checkInCount,
  onStartCheckIn,
  onStartUrge,
  onOpenInsights,
}: HomeScreenProps) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Break the Loop</Text>
      <Text style={styles.subtitle}>
        Check in with yourself before the urge decides for you.
      </Text>

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

      <Text style={styles.footnote}>
        {checkInCount === 0
          ? 'No check-ins yet this session.'
          : `${checkInCount} check-in(s) this session.`}{' '}
        Check-ins are kept in local memory only for now — they are not written to the database yet.
        Urges you record are stored on this device so they can inform later scores.
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
    marginBottom: 32,
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
  footnote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 28,
    textAlign: 'center',
  },
});
