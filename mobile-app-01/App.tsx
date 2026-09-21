import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';

import { initializeDatabase } from './src/database/schema';
import CheckInScreen from './src/screens/CheckIn';
import HomeScreen from './src/screens/Home';
import InsightsScreen from './src/screens/Insights';
import UrgeScreen from './src/screens/Urge';
import type { CheckIn } from './src/screens/checkInModel';

// No navigation library is installed (expo-router / react-navigation would be a
// new dependency), so the screens are switched with a single piece of app-level
// state instead.
type Screen = 'home' | 'checkIn' | 'urge' | 'insights';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);

  // Creates the local tables once at startup. Every repository also guards itself
  // with requireDatabase(), so no query can run before the tables exist.
  useEffect(() => {
    initializeDatabase();
  }, []);

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
    return (
      <HomeScreen
        checkInCount={checkIns.length}
        onStartCheckIn={() => setScreen('checkIn')}
        onStartUrge={() => setScreen('urge')}
        onOpenInsights={() => setScreen('insights')}
      />
    );
  }

  return (
    <>
      {renderScreen()}
      <StatusBar style="light" />
    </>
  );
}
