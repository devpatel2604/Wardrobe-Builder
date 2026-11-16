import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { db } from '../data/db';

// Every test starts with an empty database.
beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  cleanup();
});
