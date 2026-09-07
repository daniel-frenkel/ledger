/**
 * Field-level encryption for free text. AES-256-GCM, one derived key per
 * table.column, envelope = version(1) || iv(12) || ciphertext || tag(16).
 *
 * Root keys come from config (FIELD_ENCRYPTION_KEY, and FIELD_ENCRYPTION_KEY_V<n>
 * for rotation). The column name is bound into the key derivation AND into
 * the GCM additional data, so a ciphertext moved between columns fails to
 * decrypt rather than silently succeeding.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config, rootKeyForVersion } from '../config.js';

const IV_LEN = 12;
const TAG_LEN = 16;
const ALG = 'aes-256-gcm';

const keyCache = new Map<string, Buffer>();

function columnKey(version: number, column: string): Buffer {
  const cacheKey = `${version}:${column}`;
  const hit = keyCache.get(cacheKey);
  if (hit) return hit;
  const root = rootKeyForVersion(version);
  const derived = Buffer.from(hkdfSync('sha256', root, Buffer.alloc(0), `ledger:${column}`, 32));
  keyCache.set(cacheKey, derived);
  return derived;
}

/** Encrypt a UTF-8 string for `column` ("predictions.situation"). */
export function encryptField(plaintext: string, column: string, version = config().FIELD_ENCRYPTION_KEY_VERSION): Buffer {
  if (version < 1 || version > 255) throw new Error('key version out of range');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, columnKey(version, column), iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(column, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([version]), iv, ct, tag]);
}

export function decryptField(envelope: Buffer, column: string): string {
  if (envelope.length < 1 + IV_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const version = envelope[0]!;
  const iv = envelope.subarray(1, 1 + IV_LEN);
  const tag = envelope.subarray(envelope.length - TAG_LEN);
  const ct = envelope.subarray(1 + IV_LEN, envelope.length - TAG_LEN);
  const decipher = createDecipheriv(ALG, columnKey(version, column), iv, { authTagLength: TAG_LEN });
  decipher.setAAD(Buffer.from(column, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Version byte of an envelope, for rotation jobs. */
export function envelopeVersion(envelope: Buffer): number {
  return envelope[0] ?? 0;
}

export const enc = (v: string | null | undefined, column: string): Buffer | null =>
  v == null ? null : encryptField(v, column);
export const dec = (v: Buffer | null | undefined, column: string): string | null =>
  v == null ? null : decryptField(v, column);

/** JSON helpers for short arrays (body words). */
export const encJson = (v: unknown, column: string): Buffer | null =>
  v == null ? null : encryptField(JSON.stringify(v), column);
export const decJson = <T>(v: Buffer | null | undefined, column: string): T | null =>
  v == null ? null : (JSON.parse(decryptField(v, column)) as T);

/** Clear derived-key cache (tests, rotation). */
export function resetKeyCache(): void {
  keyCache.clear();
}
