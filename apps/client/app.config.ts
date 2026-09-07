import type { ExpoConfig } from 'expo/config';

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
