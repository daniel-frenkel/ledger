/** Expo push. Content is generic on purpose: "Time to check a prediction." */
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { config } from '../config.js';

let expo: Expo | undefined;
function client(): Expo {
  const token = config().EXPO_ACCESS_TOKEN;
  expo ??= new Expo(token ? { accessToken: token } : {});
  return expo;
}

export async function sendCheckInPrompts(tokens: string[]): Promise<number> {
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) return 0;
  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title: 'CourageLoop',
    body: 'You have a prediction waiting to be checked.',
    sound: null,
    priority: 'normal',
  }));
  let sent = 0;
  for (const chunk of client().chunkPushNotifications(messages)) {
    const tickets = await client().sendPushNotificationsAsync(chunk);
    sent += tickets.filter((t) => t.status === 'ok').length;
  }
  return sent;
}
