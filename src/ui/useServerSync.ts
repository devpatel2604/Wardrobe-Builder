import { useEffect } from 'react';
import { syncReminders } from '../data/reminders';
import { backupIfDue } from '../data/serverBackup';

/**
 * Runs the daily backup and keeps the reminder settings current, when the
 * app opens and each time it comes back to the front. A web app on an iPhone
 * cannot work in the background, so these are the only moments it can.
 * Does nothing until the phone is connected to the server.
 */
export function useServerSync(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      void backupIfDue();
      void syncReminders();
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [active]);
}
