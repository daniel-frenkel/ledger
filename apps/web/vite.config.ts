import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The directory holding pnpm-workspace.yaml — where the one .env lives. */
function workspaceRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

// The palette in apps/client/src/ui/index.tsx, light theme.
const BG = '#f7f6f2';
const ACCENT = '#8a6a1f';

export default defineConfig({
  // One .env at the repo root serves every package; Vite would otherwise look
  // in apps/web. EXPO_PUBLIC_ is accepted too so the same file feeds the
  // parked Expo client without duplicating values.
  envDir: workspaceRoot(here),
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  resolve: { alias: { '@': path.resolve(here, 'src') } },
  server: { port: 5173, host: true },
  // Typed explicitly: @vitejs/plugin-react and vite-plugin-pwa each resolve
  // their own vite for the peer range, and under exactOptionalPropertyTypes
  // two structurally identical Plugin types are not assignable. The array
  // itself is ordinary; `vite build` type-checks nothing here either way.
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Precache the app shell so the app opens with no network at all.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        // Entries are PHI. Nothing from the API is ever written to the cache,
        // and no runtime caching rule exists that could pick one up.
        runtimeCaching: [],
        navigateFallback: 'index.html',
        // A navigation must never be answered from a cached /v1/ response.
        navigateFallbackDenylist: [/^\/v1\//],
      },
      manifest: {
        name: 'CourageLoop',
        short_name: 'CourageLoop',
        description: 'A prediction ledger for behavioral experiments. Not a therapist.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: BG,
        theme_color: ACCENT,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ] as PluginOption[],
});
