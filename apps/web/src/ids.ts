import { uuidv7 } from '@ledger/shared';

/** Web Crypto is available in every browser this app supports, and in tests. */
export const newId = (): string => uuidv7((n) => crypto.getRandomValues(new Uint8Array(n)));
export const nowIso = (): string => new Date().toISOString();
