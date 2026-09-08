/**
 * The crisis gate. Runs BEFORE any entry is persisted, offline, with the
 * same rules the API re-runs on sync. Never blocks the entry; returns what
 * to show. Logs a crisis_events row locally (rule ids only) and queues it.
 */
import { detectRiskInEntry, resourceCards, type CrisisEvent, type RiskDetection } from '@ledger/shared';
import { allCrisisEvents, putCrisisEvent } from '@/db';
import { newId, nowIso } from '@/ids';

export interface GateResult {
  risk: RiskDetection;
  cards: ReturnType<typeof resourceCards>;
  eventId: string | null;
}

export async function crisisGate(source: CrisisEvent['source'], entryId: string, fields: Array<string | null | undefined>): Promise<GateResult> {
  const risk = detectRiskInEntry(fields);
  if (!risk.matched) return { risk, cards: [], eventId: null };
  const ev: CrisisEvent = {
    id: newId(),
    source,
    sourceEntryId: entryId,
    ruleIds: risk.ruleIds,
    resourcesShown: risk.resources,
    detectedOnDevice: true,
    createdAt: nowIso(),
  };
  await putCrisisEvent(ev);
  return { risk, cards: resourceCards(risk.resources), eventId: ev.id };
}

export async function acknowledgeCrisis(eventId: string): Promise<void> {
  const ev = (await allCrisisEvents()).find((e) => e.id === eventId);
  if (ev) await putCrisisEvent({ ...ev, acknowledgedAt: nowIso() });
}
