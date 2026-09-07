import * as Crypto from 'expo-crypto';
import { uuidv7 } from '@ledger/shared';

export const newId = (): string => uuidv7((n) => Crypto.getRandomBytes(n));
export const nowIso = (): string => new Date().toISOString();
