import { Link } from 'react-router-dom';
import { PageHeader } from '../ui/controls';

const PLACES = [
  { to: '/profile', name: 'Profile', about: 'Your rules, sizes, palette, stores and week.' },
  { to: '/color-test', name: 'Color photo test', about: 'Which colors suit you next to your face, from your own photos.' },
  { to: '/settings', name: 'Settings', about: 'Setup file, backups, your server, alerts and weather.' },
];

/** The screens that are not opened every day. They share one tab so the tab bar fits a phone. */
export function MoreScreen() {
  return (
    <>
      <PageHeader title="More" />
      <ul className="more-list">
        {PLACES.map((place) => (
          <li key={place.to}>
            <Link className="card more-link" to={place.to}>
              <h2>{place.name}</h2>
              <p className="muted">{place.about}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
