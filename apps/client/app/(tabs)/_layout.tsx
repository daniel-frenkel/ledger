import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '@/ui';

const icon = (glyph: string) => ({ color }: { color: string }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: t.accent, tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.line } }}>
      <Tabs.Screen name="index" options={{ title: 'Open', tabBarIcon: icon('○') }} />
      <Tabs.Screen name="ledger" options={{ title: 'Ledger', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
