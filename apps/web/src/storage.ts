/**
 * Storage durability. A browser may evict IndexedDB under pressure, which
 * would drop entries that have not synced yet. Ask for persistence once and
 * record the answer; the server is the durable copy either way.
 */
import { getMeta, oldestQueuedAt, setMeta } from '@/db';

const KEY = 'storagePersisted';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Ask the browser to exempt this origin from eviction. Asked once, ever. */
export async function ensurePersistence(): Promise<void> {
  if (await getMeta(KEY)) return;
  if (!navigator.storage?.persist) {
    await setMeta(KEY, 'unsupported');
    return;
  }
  try {
    const granted = await navigator.storage.persist();
    await setMeta(KEY, granted ? 'granted' : 'denied');
  } catch {
    await setMeta(KEY, 'error');
  }
}

export const persistenceState = (): Promise<string | null> => getMeta(KEY);

/** True when something has been waiting to sync for more than a week. */
export async function hasStaleOutbox(now = Date.now()): Promise<boolean> {
  const oldest = await oldestQueuedAt();
  return !!oldest && now - new Date(oldest).getTime() > WEEK_MS;
}
