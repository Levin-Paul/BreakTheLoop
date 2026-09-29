import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * First-run onboarding: four calm, honest screens.
 *
 * Hard rules for this screen:
 *   - collects NOTHING (no name, email, phone, account, location, contacts,
 *     permissions),
 *   - makes no unsupported claims (the app does not detect everything, is not
 *     medical care, and Discovery Mode is observation-first),
 *   - tone is supportive and non-shaming.
 */
export default function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [slide, setSlide] = useState(0);

  const next = () => setSlide((current) => Math.min(current + 1, SLIDES.length - 1));
  const back = () => setSlide((current) => Math.max(current - 1, 0));
  const isLast = slide === SLIDES.length - 1;

  const current = SLIDES[slide]!;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.step}>{`Step ${slide + 1} of ${SLIDES.length}`}</Text>
      <Text style={styles.title}>{current.title}</Text>
      {current.body.map((paragraph) => (
        <Text key={paragraph} style={styles.body}>
          {paragraph}
        </Text>
      ))}
      {current.bullets ? (
        <View style={styles.bulletCard}>
          {current.bullets.map((bullet) => (
            <Text key={bullet} style={styles.bullet}>
              {'\u2022'} {bullet}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.controls}>
        {slide > 0 ? (
          <Pressable
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel="Previous onboarding step"
            style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
        ) : null}
        {isLast ? (
          <Pressable
            onPress={onComplete}
            accessibilityRole="button"
            accessibilityLabel="Start Discovery Mode"
            style={styles.primaryButton}>
            <Text style={styles.primaryText}>Start Discovery Mode</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel="Next onboarding step"
            style={styles.primaryButton}>
            <Text style={styles.primaryText}>Next</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.footnote}>
        No account, name, email, or location is requested. Everything stays on this device.
      </Text>
    </ScrollView>
  );
}

interface OnboardingSlide {
  title: string;
  body: readonly string[];
  bullets?: readonly string[];
}

const SLIDES: readonly OnboardingSlide[] = [
  {
    title: 'Break the loop.',
    body: [
      'Understand what drives your urges instead of blindly blocking everything.',
    ],
  },
  {
    title: 'First, we learn.',
    body: [
      'Discovery Mode starts by observing recovery-relevant patterns and helping you see them clearly:',
    ],
    bullets: [
      'when urges happen',
      'what situations surround them',
      'emotional patterns around them',
      'what tends to happen before or after an urge',
    ],
  },
  {
    title: 'Your data stays on your device.',
    body: [
      'Your core recovery data (check-ins, urges, patterns) is stored locally on this device.',
      'The local AI runs on-device and works offline. Raw private content is not intended to become stored product data.',
      'You stay in control of your recovery data, including deleting or exporting it.',
    ],
  },
  {
    title: 'You are in control.',
    body: [
      'Discovery Mode can be stopped whenever you want.',
      'Interventions can be adjusted later as the app learns.',
      'You can delete your data at any time.',
      'Break the Loop is a self-reflection tool. It is not a replacement for professional medical care.',
    ],
  },
];

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0f1720',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingTop: 64,
  },
  step: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 38,
    marginBottom: 18,
  },
  body: {
    color: '#94a3b8',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
  },
  bulletCard: {
    backgroundColor: '#1b2530',
    borderRadius: 14,
    padding: 14,
    marginTop: 6,
    marginBottom: 8,
  },
  bullet: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 24,
  },
  controls: {
    flexDirection: 'row',
    marginTop: 26,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 28,
    alignItems: 'center',
    flex: 1,
  },
  primaryText: {
    color: '#052e16',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#243141',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  secondaryText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  footnote: {
    color: '#7c8da3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 22,
    textAlign: 'center',
  },
});
