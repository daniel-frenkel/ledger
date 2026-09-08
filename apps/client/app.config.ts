import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { ExpoConfig } from 'expo/config';

/**
 * Load the one .env at the repo root. Expo reads .env from the app directory,
 * and pnpm sets the cwd per package, so neither finds the root file on its
 * own: walk up to the directory holding pnpm-workspace.yaml and load it from
 * there. `override: false` — a real environment variable always wins, and a
 * missing .env is not an error (CI injects everything directly).
 */
function loadRootEnv(): void {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const file = path.join(dir, '.env');
      if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadRootEnv();

const config: ExpoConfig = {
  name: 'Ledger',
  slug: 'ledger',
  scheme: 'ledger',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'com.valarsystems.ledger',
    supportsTablet: false,
    infoPlist: {
      // Journal and prediction text stay in the app container; no other app may read it.
      NSFaceIDUsageDescription: 'Unlock Ledger.',
    },
  },
  android: {
    package: 'com.valarsystems.ledger',
    // No backup of the local database to Google Drive: it holds plaintext entries.
    allowBackup: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-sqlite', { enableFTS: false }],
    ['expo-notifications', { sounds: [] }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '' },
  },
};

export default config;
