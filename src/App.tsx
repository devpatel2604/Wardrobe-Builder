import { useLiveQuery } from 'dexie-react-hooks';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { getProfile } from './data/profileRepo';
import { PieceDetailScreen } from './screens/PieceDetailScreen';
import { PieceFormScreen } from './screens/PieceFormScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WardrobeScreen } from './screens/WardrobeScreen';
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
          <Route path="/" element={<Navigate to="/wardrobe" replace />} />
          <Route path="/wardrobe" element={<WardrobeScreen />} />
          <Route path="/wardrobe/new" element={<PieceFormScreen />} />
          <Route path="/wardrobe/:id" element={<PieceDetailScreen />} />
          <Route path="/wardrobe/:id/edit" element={<PieceFormScreen />} />
          <Route path="/profile" element={<ProfileScreen profile={loaded.profile} />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/wardrobe" replace />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/wardrobe">Wardrobe</NavLink>
        <NavLink to="/profile">Profile</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
    </div>
  );
}
