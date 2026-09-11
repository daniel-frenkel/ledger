/**
 * Push registration for check-in prompts. Content is generic; nothing about
 * the entry is in the notification. Registration is optional and asked for
 * once, from Settings — never on first launch.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { setMeta } from '@/db';
import { requestSync } from '@/sync';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('checkins', { name: 'Check-ins', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : {})).data;
  await setMeta('expoPushToken', token);
  requestSync(0);
  return token;
}

/** Local reminder for a scheduled prediction — works offline, no server needed. */
export async function scheduleLocalCheckIn(predictionId: string, at: Date): Promise<void> {
  const when = new Date(at.getTime() + 2 * 60 * 60 * 1000); // past the crest, not in the doorway
  if (when.getTime() <= Date.now()) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: 'CourageLoop', body: 'A prediction is waiting to be checked.', data: { predictionId } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
  });
}
