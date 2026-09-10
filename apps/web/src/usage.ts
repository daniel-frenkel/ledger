/**
 * What the app was used for — proposal 03 §5.
 *
 * Seven kinds, no payload, no entity id, no text. The table this reaches has
 * five columns and a test that says so; this file is the client half of that
 * promise and holds itself to the same shape.
 *
 * Queued in the existing `meta` store rather than a store of its own, so no
 * IndexedDB version bump is needed — the upgrade path calls
 * `createObjectStore` unconditionally and a bump would throw in every browser
 * that already has the database.
 *
 * Best-effort throughout. A dropped usage event is a missing dot on a
 * feasibility chart; a usage event that blocked a client from writing a
 * prediction would be a real failure. Nothing here throws.
 */
import { USAGE_KINDS, type UsageEvent, type UsageKind } from '@ledger/shared';
import { getMeta, setMeta } from '@/db';
import { newId } from '@/ids';

const KEY = 'usage_queue';
/** Enough for a long offline stretch; older ones are dropped rather than grown. */
const CAP = 200;

const isKind = (k: unknown): k is UsageKind => (USAGE_KINDS as readonly string[]).includes(k as string);

async function read(): Promise<UsageEvent[]> {
  try {
    const raw = await getMeta(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is UsageEvent =>
        !!e && typeof e === 'object' && isKind((e as UsageEvent).kind) && typeof (e as UsageEvent).id === 'string',
    );
  } catch {
    return [];
  }
}

/** Record one. Never throws, never blocks anything the person is doing. */
export async function recordUsage(kind: UsageKind): Promise<void> {
  try {
    const queue = await read();
    queue.push({ id: newId(), kind, createdAt: new Date().toISOString() });
    await setMeta(KEY, JSON.stringify(queue.slice(-CAP)));
  } catch {
    // Nothing to do and nothing worth telling anyone.
  }
}

/** What sync should send. */
export const pendingUsage = read;

/**
 * Drop the ones that were accepted. Called after a successful push, and by id
 * rather than by clearing: a usage event recorded while the push was in flight
 * would otherwise be lost.
 */
export async function clearUsage(sent: readonly UsageEvent[]): Promise<void> {
  if (sent.length === 0) return;
  try {
    const gone = new Set(sent.map((e) => e.id));
    const queue = (await read()).filter((e) => !gone.has(e.id));
    await setMeta(KEY, JSON.stringify(queue));
  } catch {
    // As above.
  }
}
