import { describe, expect, it } from 'vitest';
import { decryptField, encryptField, envelopeVersion } from '../src/crypto/fields.js';

describe('field encryption', () => {
  it('round-trips unicode text', () => {
    const pt = 'He’ll go quiet — “fine” — for weeks. 😐';
    const ct = encryptField(pt, 'predictions.situation');
    expect(decryptField(ct, 'predictions.situation')).toBe(pt);
  });
  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptField('same', 'x.y');
    const b = encryptField('same', 'x.y');
    expect(a.equals(b)).toBe(false);
  });
  it('binds the column name: moving ciphertext between columns fails', () => {
    const ct = encryptField('secret', 'predictions.situation');
    expect(() => decryptField(ct, 'journal_entries.body')).toThrow();
  });
  it('detects tampering', () => {
    const ct = encryptField('secret', 'x.y');
    ct[ct.length - 1] = (ct[ct.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptField(ct, 'x.y')).toThrow();
  });
  it('writes the key version byte', () => {
    expect(envelopeVersion(encryptField('v', 'x.y'))).toBe(1);
  });
  it('rejects short garbage', () => {
    expect(() => decryptField(Buffer.from([1, 2, 3]), 'x.y')).toThrow();
  });
});
