import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/auth/session';
import { startSyncListeners, syncNow } from '@/sync';

function Gate() {
  const { session, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === 'sign-in';
    if (!session && !inAuth) router.replace('/sign-in');
    if (session && inAuth) router.replace('/');
  }, [session, loading, segments, router]);

  useEffect(() => {
    if (!session) return;
    void syncNow();
    const stop = startSyncListeners();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNow();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [session]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="predict" options={{ presentation: 'modal', headerShown: true, title: 'Before' }} />
      <Stack.Screen name="resolve/[id]" options={{ presentation: 'modal', headerShown: true, title: 'After' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Gate />
    </SessionProvider>
  );
}
