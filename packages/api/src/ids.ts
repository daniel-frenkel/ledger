/**
 * Server-minted ids.
 *
 * The schema's convention is UUID v7 — time-ordered, so rows sort by creation
 * without a second column and index locality is good. Client-owned rows arrive
 * with their own v7 id; the rows the server originates (invites, the link a
 * redemption creates, formulations, assistant runs) get theirs here, from the
 * same generator in @ledger/shared that the clients use.
 */
import crypto from 'node:crypto';
import { uuidv7 } from '@ledger/shared';

export const newId = (): string => uuidv7((n) => crypto.randomBytes(n));
