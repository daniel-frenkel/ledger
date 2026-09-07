/**
 * UUID v7 — time-ordered ids generated on the client so offline rows have a
 * stable identity before they sync. Takes a random-bytes source so it works
 * in Node (crypto.randomBytes / webcrypto) and React Native (expo-crypto)
 * without this package depending on either.
 */
export type RandomBytes = (n: number) => Uint8Array;

export function uuidv7(rand: RandomBytes, now: number = Date.now()): string {
  const b = new Uint8Array(16);
  const r = rand(10);
  // 48-bit ms timestamp, big-endian
  b[0] = (now / 2 ** 40) & 0xff;
  b[1] = (now / 2 ** 32) & 0xff;
  b[2] = (now / 2 ** 24) & 0xff;
  b[3] = (now / 2 ** 16) & 0xff;
  b[4] = (now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;
  // version 7 in the high nibble of byte 6
  b[6] = 0x70 | (r[0]! & 0x0f);
  b[7] = r[1]!;
  // variant 10xx in byte 8
  b[8] = 0x80 | (r[2]! & 0x3f);
  b[9] = r[3]!;
  b[10] = r[4]!;
  b[11] = r[5]!;
  b[12] = r[6]!;
  b[13] = r[7]!;
  b[14] = r[8]!;
  b[15] = r[9]!;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Timestamp (ms) encoded in a v7 id, for ordering and sanity checks. */
export function uuidv7Time(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}
