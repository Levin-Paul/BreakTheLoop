import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import {
  loadDiscoveryModeState,
  loadOnboardingState,
  saveDiscoveryModeState,
  saveOnboardingState,
} from './src/database/appStateRepository';
import type { DiscoveryModeState } from './src/database/appStatePersistence';
import {
  loadSettingsOrDefaults,
  defaultSettings,
  pruneOldMlSignals,
  type AppSettings,
} from './src/database/settingsRepository';
import { applySignalRetention } from './src/settings/retention';
import { initializeDatabase } from './src/database/schema';
import CheckInScreen from './src/screens/CheckIn';
import HomeScreen from './src/screens/Home';
import InsightsScreen from './src/screens/Insights';
import OnboardingScreen from './src/screens/Onboarding';
import SettingsScreen from './src/screens/Settings';
import ScreenCaptureTestScreen from './src/screens/ScreenCaptureTest';
import UrgeScreen from './src/screens/Urge';
import type { CheckIn } from './src/screens/checkInModel';

// No navigation library is installed (expo-router / react-navigation would be a
// new dependency), so the screens are switched with a single piece of app-level
// state instead.
// 'screenCaptureTest' is a development-only milestone screen (MediaProjection
// foundation); it is clearly labelled inside the screen itself.
type Screen = 'home' | 'checkIn' | 'urge' | 'insights' | 'settings' | 'screenCaptureTest';

/**
 * Boot states, resolved before the first real screen renders:
 *   - 'checking': reading onboarding state from SQLite (brief).
 *   - 'onboarding': fresh install or never-completed onboarding.
 *   - 'failed': the onboarding state could not be read. We fail safely: show an
 *     honest message instead of silently guessing and possibly corrupting data.
 *   - 'ready': normal app (Home and below).
 */
type BootState = 'checking' | 'onboarding' | 'failed' | 'ready';

export default function App() {
  const [boot, setBoot] = useState<BootState>('checking');
  const [bootError, setBootError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryModeState | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());

  // Resolves the boot path from the local database. Fresh installs (no stored
  // onboarding row) go to onboarding; everyone else goes straight Home.
  const resolveBoot = useCallback(() => {
    const init = initializeDatabase();
    if (!init.ok) {
      setBootError(init.error ?? 'SQLite is unavailable');
      setBoot('failed');
      return;
    }

    const onboarding = loadOnboardingState();
    if (!onboarding.ok) {
      // Fail safely: surface the error, never guess, never write.
      setBootError(onboarding.error ?? 'Onboarding state could not be read');
      setBoot('failed');
      return;
    }

    if (onboarding.state?.completed) {
      // Returning user. Discovery Mode state is optional context; a read
      // failure here does not block the app (Discovery simply shows as off).
      const discoveryState = loadDiscoveryModeState();
      setDiscovery(discoveryState.ok ? discoveryState.state : null);
      setSettings(loadSettingsOrDefaults());
      setBoot('ready');
      return;
    }

    setBoot('onboarding');
  }, []);

  useEffect(() => {
    resolveBoot();
    // Housekeeping once per launch, after the schema is initialized: prune
    // automated monitoring signal records past the retention window. This is
    // deliberately NOT tied to any screen render and never blocks boot.
    applySignalRetention(Date.now(), loadSettingsOrDefaults(), pruneOldMlSignals);
  }, [resolveBoot]);

  // Android back navigation must not bypass onboarding: while onboarding is on
  // screen, Back does nothing (the flow has its own explicit Back/Next).
  useEffect(() => {
    if (boot !== 'onboarding') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [boot]);

  const handleOnboardingComplete = useCallback(() => {
    const onboardingSave = saveOnboardingState({ completed: true, completedAt: Date.now() });
    if (!onboardingSave.ok) {
      // Fail safely: onboarding stays up with the error visible; no partial
      // state is written.
      setBootError(onboardingSave.error ?? 'Onboarding completion could not be saved');
      setBoot('failed');
      return;
    }
    // Discovery Mode starts when onboarding completes.
    const discoveryState: DiscoveryModeState = { enabled: true, startedAt: Date.now() };
    const discoverySave = saveDiscoveryModeState(discoveryState);
    if (!discoverySave.ok) {
      setBootError(discoverySave.error ?? 'Discovery Mode state could not be saved');
      setBoot('failed');
      return;
    }
    setDiscovery(discoveryState);
    setBoot('ready');
  }, []);

  const handleDiscoveryToggle = useCallback(
    (enabled: boolean) => {
      const previous = discovery ?? { enabled: false, startedAt: Date.now() };
      const next: DiscoveryModeState = enabled
        ? { enabled: true, startedAt: Date.now() }
        : { ...previous, enabled: false, stoppedAt: Date.now() };
      const save = saveDiscoveryModeState(next);
      if (save.ok) {
        // Historical data is untouched: only this flag row changes.
        setDiscovery(next);
      }
    },
    [discovery],
  );

  const latestCheckIn = checkIns.length > 0 ? checkIns[checkIns.length - 1] : null;

  function renderScreen() {
    if (screen === 'checkIn') {
      return (
        <CheckInScreen
          history={checkIns}
          onSubmit={(checkIn) => setCheckIns((previous) => [...previous, checkIn])}
          onBack={() => setScreen('home')}
        />
      );
    }
    if (screen === 'urge') {
      return <UrgeScreen latestCheckIn={latestCheckIn} onBack={() => setScreen('home')} />;
    }
    if (screen === 'insights') {
      return <InsightsScreen onBack={() => setScreen('home')} />;
    }
    if (screen === 'settings') {
      return (
        <SettingsScreen
          settings={settings}
          onMonitoringChange={setSettings}
          discovery={discovery}
          onDiscoveryToggle={handleDiscoveryToggle}
          onAllDataDeleted={() => {
            // Deterministic clean state: the app re-resolves boot from the now
            // empty database, which lands the user back on onboarding.
            setScreen('home');
            setCheckIns([]);
            setDiscovery(null);
            setSettings(defaultSettings());
            resolveBoot();
          }}
          onBack={() => setScreen('home')}
        />
      );
    }
    if (screen === 'screenCaptureTest') {
      return <ScreenCaptureTestScreen onBack={() => setScreen('home')} />;
    }
    return (
      <HomeScreen
        discovery={discovery}
        onDiscoveryToggle={handleDiscoveryToggle}
        onStartCheckIn={() => setScreen('checkIn')}
        onStartUrge={() => setScreen('urge')}
        onOpenInsights={() => setScreen('insights')}
        onOpenSettings={() => setScreen('settings')}
        onOpenScreenCaptureTest={() => setScreen('screenCaptureTest')}
      />
    );
  }

  if (boot === 'checking') {
    return (
      <View style={bootStyles.center}>
        <Text style={bootStyles.text}>Checking local data…</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (boot === 'failed') {
    return (
      <View style={bootStyles.center}>
        <Text style={bootStyles.title}>Local data could not be read</Text>
        <Text style={bootStyles.text}>{bootError}</Text>
        <Text style={bootStyles.note}>
          Nothing was changed or deleted. Close and reopen the app to try again.
        </Text>
        <Pressable
          onPress={resolveBoot}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={bootStyles.retry}>
          <Text style={bootStyles.retryText}>Try again</Text>
        </Pressable>
        <StatusBar style="light" />
      </View>
    );
  }

  if (boot === 'onboarding') {
    return (
      <>
        <OnboardingScreen onComplete={handleOnboardingComplete} />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      {renderScreen()}
      <StatusBar style="light" />
    </>
  );
}

const bootStyles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#0f1720',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  text: {
    color: '#94a3b8',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  note: {
    color: '#7c8da3',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 14,
  },
  retry: {
    backgroundColor: '#243141',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginTop: 22,
  },
  retryText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
});
