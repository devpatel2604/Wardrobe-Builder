import { useLiveQuery } from 'dexie-react-hooks';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { getProfile } from './data/profileRepo';
import { ColorCaptureScreen } from './screens/colorTest/ColorCaptureScreen';
import { ColorCompareScreen } from './screens/colorTest/ColorCompareScreen';
import { ColorResultsScreen } from './screens/colorTest/ColorResultsScreen';
import { ColorTestScreen } from './screens/colorTest/ColorTestScreen';
import { PieceDetailScreen } from './screens/PieceDetailScreen';
import { PieceFormScreen } from './screens/PieceFormScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TodayScreen } from './screens/TodayScreen';
import { WardrobeScreen } from './screens/WardrobeScreen';
import { WeekScreen } from './screens/WeekScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { useServerSync } from './ui/useServerSync';

export function App() {
  // Wrapped in an object so "still loading" and "no profile yet" can be told apart.
  const loaded = useLiveQuery(async () => ({ profile: await getProfile() }), []);
  // Daily encrypted backup and reminder settings, once connected to the server.
  useServerSync(Boolean(loaded?.profile));

  if (!loaded) return <div className="app" aria-busy="true" />;
  if (!loaded.profile) return <WelcomeScreen />;

  return (
    <div className="app">
      <main className="screen">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayScreen />} />
          <Route path="/week" element={<WeekScreen />} />
          <Route path="/wardrobe" element={<WardrobeScreen />} />
          <Route path="/wardrobe/new" element={<PieceFormScreen />} />
          <Route path="/wardrobe/:id" element={<PieceDetailScreen />} />
          <Route path="/wardrobe/:id/edit" element={<PieceFormScreen />} />
          <Route path="/profile" element={<ProfileScreen profile={loaded.profile} />} />
          <Route path="/color-test" element={<ColorTestScreen />} />
          <Route path="/color-test/capture/:color" element={<ColorCaptureScreen />} />
          <Route path="/color-test/compare" element={<ColorCompareScreen />} />
          <Route path="/color-test/results" element={<ColorResultsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/today">Today</NavLink>
        <NavLink to="/week">Week</NavLink>
        <NavLink to="/wardrobe">Wardrobe</NavLink>
        <NavLink to="/profile">Profile</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
    </div>
  );
}
